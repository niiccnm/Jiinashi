const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Runs view scripts in a VM with mocked imports, IPC, and Svelte lifecycle hooks.
function compileScript(file, wrapInstance = script => script) {
  const fileSource = fs.readFileSync(file, 'utf8');
  const source = file.endsWith('.svelte') ? [...fileSource
    .matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .map(([, attributes, script]) => /\bmodule\b/.test(attributes) ? script : wrapInstance(script)).join('\n') : fileSource;
  return ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  transformers: { before: [context => root => {
    const visit = node => {
      if (ts.isImportDeclaration(node)) return undefined;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('loadModule'), undefined, node.arguments);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit);
  }] },
  }).outputText.replace(/export \{\};?\s*$/, '').replace(/^export /gm, '');
}
const compiled = compileScript('src/App.svelte');

test('dependency discovery and watching exclude archives and scratch directories', async () => {
  const { loadConfigFromFile } = await import('vite');
  const { config } = await loadConfigFromFile({ command: 'serve', mode: 'development' });
  assert.deepEqual(config.optimizeDeps?.entries, ['./index.html']);
  assert.ok(config.server.watch.ignored.includes('**/versions/**'));
  assert.ok(config.server.watch.ignored.includes('**/.tmp/**'));
});

for (const active of [false, true]) {
  test(`Recent synchronizes deletions without a spinner while ${active ? 'visible' : 'hidden'}`, async () => {
    let rows = [{ id: 7, parent_id: 70 }, { id: 8, parent_id: 80 }];
    let reads = 0;
    let holdReload = false;
    let finishReload;
    const listeners = new Map();
    const mounts = [];
    const filter = { blurR18: false, blurR18Hover: false, blurR18Intensity: 12 };
    const library = {
      getRecent: async () => {
        reads++;
        if (holdReload) await new Promise(resolve => { finishReload = resolve; });
        return rows.map(item => ({ ...item }));
      },
    };
    for (const event of ['onItemUpdated', 'onRefreshed', 'onCleared', 'onItemsDeleted']) {
      library[event] = callback => {
        listeners.set(event, callback);
        return () => listeners.delete(event);
      };
    }
    const sandbox = {
      console,
      $state: value => value, $effect() {}, untrack: fn => fn(),
      $props: () => ({ active, contentFilter: filter }),
      onMount: fn => mounts.push(fn), tick: async () => {},
      setTimeout() { return 1; }, clearTimeout() {},
      parseContentFilterSettings: () => filter,
      window: { electronAPI: { library, settings: { getAll: async () => ({}) } } },
    };
    vm.runInNewContext(`${compileScript('src/lib/views/Recent.svelte')}
      globalThis.inspect = () => ({ ids: items.map(item => item.id), loading });`, sandbox);
    const cleanups = mounts.map(fn => fn());
    const flush = () => new Promise(setImmediate);
    try {
      await flush();
      assert.deepEqual(Array.from(sandbox.inspect().ids), [7, 8]);
      assert.equal(sandbox.inspect().loading, false);

      // Deletion events carry the selected parent ID, not every deleted child.
      // Reloading also fills the gap left in the limited Recent list.
      rows = [{ id: 8, parent_id: 80 }, { id: 9, parent_id: 90 }];
      holdReload = true;
      listeners.get('onItemsDeleted')?.([70]);
      assert.equal(reads, 2, 'deletion must refresh the retained Recent list');
      assert.equal(sandbox.inspect().loading, false, 'refresh must not show a spinner');
      finishReload();
      await flush();
      assert.deepEqual(Array.from(sandbox.inspect().ids), [8, 9]);

      holdReload = false;
      rows = [];
      listeners.get('onItemsDeleted')?.([8, 9]);
      await flush();
      assert.deepEqual(Array.from(sandbox.inspect().ids), []);
      assert.equal(sandbox.inspect().loading, false);
    } finally {
      cleanups.forEach(cleanup => cleanup());
      assert.equal(listeners.size, 0, 'all listeners must be removed on unmount');
    }
  });
}

function createApp(search = '', { preload = true, toastStore, showWindow, failedImport } = {}) {
  const effects = [];
  const mounts = [];
  const subscribers = new Set();
  const imports = [];
  const failures = new Set(failedImport ? [failedImport] : []);
  const shown = [];
  const notices = [];
  let appToastListener = null;
  let downloaderToastListener = null;
  let state = { currentView: 'library', currentBook: null, sidebarWidth: 256 };
  const appState = {
    subscribe(fn) { subscribers.add(fn); fn(state); return () => subscribers.delete(fn); },
    update(fn) { state = fn(state); subscribers.forEach(fn => fn(state)); },
  };
  const settings = { blurR18: 'true', blurR18Hover: 'false', blurR18Intensity: '12' };
  const sandbox = {
    console: { error() {}, log() {} }, URLSearchParams,
    $state: value => value, $effect: fn => effects.push(fn),
    onMount: fn => mounts.push(fn),
    Library: function Library() {}, appState,
    toasts: toastStore || { add: (...args) => notices.push(args) },
    DEFAULT_CONTENT_FILTER_SETTINGS: { blurR18: false, blurR18Hover: false, blurR18Intensity: 12 },
    parseContentFilterSettings: () => ({ blurR18: true, blurR18Hover: false, blurR18Intensity: 12 }),
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: fn => queueMicrotask(fn),
    requestIdleCallback: fn => { if (preload) queueMicrotask(fn); },
    async loadModule(path) {
      const name = path.match(/\/(\w+)\.svelte$/)[1].toLowerCase();
      imports.push(name);
      // A failed import can stay cached for the lifetime of the window.
      if (failures.has(name)) throw new Error('Simulated import failure');
      return { default: function LoadedView() {} };
    },
    window: {
      location: { search }, addEventListener() {}, removeEventListener() {},
      electronAPI: {
        settings: { getAll: async () => settings },
        window: { show: async () => { await showWindow?.(); shown.push(true); } },
        notifications: { onToast(callback) {
          appToastListener = callback;
          return () => { appToastListener = null; };
        } },
        downloader: {
          onToast(callback) {
            downloaderToastListener = callback;
            return () => { if (downloaderToastListener === callback) downloaderToastListener = null; };
          },
        },
        library: {
          onTriggerScan: () => () => {},
          getItem: async id => ({ id, current_page: 1 }),
        },
      },
    },
  };
  vm.runInNewContext(`${compiled}\n globalThis.inspect = () => ({ view, currentBook, isInitialLoad, viewComponents });
    globalThis.signalReady = markViewReady;`, sandbox);
  const cleanups = mounts.map(fn => fn());
  return {
    inspect: sandbox.inspect, ready: sandbox.signalReady, shown, imports, failures, notices,
    state: () => state,
    destroy() { cleanups.forEach(fn => fn?.()); effects.length = 0; },
    emitAppToast(...args) { appToastListener?.(...args); },
    emitDownloaderToast(message, type) { downloaderToastListener?.(message, type); },
    navigate: target => appState.update(s => ({ ...s, currentView: target })),
    async flush() { for (let i = 0; i < 30; i++) { effects.forEach(fn => fn()); await Promise.resolve(); } },
  };
}

test('downloader toasts are heard before deferred pages begin loading', async () => {
  const app = createApp();
  app.emitDownloaderToast('Restored download failed', 'error');
  assert.deepEqual(app.notices, [], 'early notices must not start expiring while hidden');
  app.ready('library');
  await app.flush();
  assert.deepEqual(app.notices, [['Restored download failed', 'error']]);

  const logsWindow = createApp('?view=download_logs&taskId=42');
  logsWindow.emitDownloaderToast('Unrelated download', 'info');
  assert.deepEqual(logsWindow.notices, []);
});

for (const search of ['', '?view=download_logs&taskId=42']) {
  test(`startup notices retain their full duration after a slow reveal: ${search || 'library'}`, async () => {
    let now = 0, rows = [], finishShow;
    const timers = [];
    const sandbox = {
      writable: require('svelte/store').writable,
      setTimeout(fn, duration) { timers.push({ fn, at: now + duration }); },
    };
    vm.runInNewContext(`${compileScript('src/lib/stores/toast.ts')}
      globalThis.store = toasts;`, sandbox);
    const unsubscribe = sandbox.store.subscribe(value => { rows = Array.from(value); });
    const advance = ms => {
      now += ms;
      for (let i = timers.length - 1; i >= 0; i--) {
        if (timers[i].at <= now) timers.splice(i, 1)[0].fn();
      }
    };
    const app = createApp(search, {
      toastStore: sandbox.store,
      showWindow: () => new Promise(resolve => { finishShow = resolve; }),
    });
    try {
      app.emitAppToast('Library notice', 'info');
      if (!search) app.emitDownloaderToast('Download failed', 'error');
      const expected = search ? ['Library notice'] : ['Library notice', 'Download failed'];
      advance(5000);
      app.ready('library');
      await app.flush();
      advance(5000);
      assert.equal(app.shown.length, 0, 'the native show promise is still pending');
      finishShow();
      await app.flush();
      assert.equal(app.shown.length, 1);
      assert.deepEqual(rows.map(row => row.message), expected, 'startup notices must survive until reveal');
      assert.deepEqual(rows.map(row => row.type), search ? ['info'] : ['info', 'error']);
      advance(2999);
      assert.equal(rows.length, expected.length, 'the original duration starts after reveal');
      advance(1);
      assert.equal(rows.length, 0);

      app.emitAppToast('Persistent notice', 'warning', 0);
      app.emitAppToast('Longer notice', 'success', 6000);
      advance(6000);
      assert.deepEqual(rows.map(row => row.message), ['Persistent notice']);
      sandbox.store.remove(rows[0].id);
      assert.equal(rows.length, 0, 'manual dismissal still works');
      app.destroy();
      app.emitAppToast('After teardown', 'info');
      assert.equal(rows.length, 0);
    } finally {
      unsubscribe();
    }
  });
}

test('failed initial imports release notices through the fallback reveal', async () => {
  let finishShow;
  const app = createApp('?view=download_logs&taskId=42', {
    failedImport: 'downloadlogs',
    showWindow: () => new Promise(resolve => { finishShow = resolve; }),
  });
  await app.flush();
  assert.deepEqual(app.notices, []);
  finishShow();
  await app.flush();
  assert.deepEqual(app.notices, [
    ['Failed to open this window. Please close it and try again.', 'error'],
  ]);
  assert.equal(app.imports.filter(name => name === 'downloadlogs').length, 1);
});

test('teardown discards queued startup notices and removes their listeners', async () => {
  let finishShow;
  const app = createApp('', { showWindow: () => new Promise(resolve => { finishShow = resolve; }) });
  app.emitAppToast('Queued notice', 'info');
  app.ready('library');
  await app.flush();
  app.destroy();
  app.emitDownloaderToast('After teardown', 'error');
  finishShow();
  await app.flush();
  assert.deepEqual(app.notices, []);
});

test('common page modules preload after the Library is shown', async () => {
  const app = createApp();
  await app.flush();
  assert.equal(app.shown.length, 0);
  app.ready('library');
  await app.flush();
  assert.equal(app.shown.length, 1);
  for (const page of ['favorites', 'downloader', 'recent']) {
    assert.ok(app.inspect().viewComponents[page], `${page} module must be available for mounting`);
  }
});

test('slow first navigation never reveals an unprepared page', async () => {
  const app = createApp();
  app.ready('library');
  await app.flush();
  app.navigate('downloader');
  await app.flush();
  assert.equal(app.inspect().view, 'library');
  app.ready('downloader');
  await app.flush();
  assert.equal(app.inspect().view, 'downloader');
});

test('an old readiness event cannot override newer navigation', async () => {
  const app = createApp();
  app.ready('library');
  await app.flush();
  app.navigate('downloader');
  app.navigate('favorites');
  app.ready('favorites');
  await app.flush();
  app.ready('downloader');
  await app.flush();
  assert.equal(app.inspect().view, 'favorites');
});

test('a persistent failed import preserves the current page and reports restart guidance', async () => {
  const app = createApp('', { preload: false });
  app.ready('library');
  await app.flush();
  app.failures.add('settings');
  app.navigate('settings');
  await app.flush();
  assert.equal(app.inspect().view, 'library');
  app.navigate('settings');
  await app.flush();
  assert.equal(app.inspect().view, 'library');
  assert.deepEqual(app.notices, [
    ['Failed to open this page. Please close and reopen Jiinashi.', 'error'],
    ['Failed to open this page. Please close and reopen Jiinashi.', 'error'],
  ]);
  app.navigate('tags');
  await app.flush();
  assert.equal(app.inspect().view, 'tags', 'a failed page must not block other navigation');
});

// Read App's active prop expression so the test also checks the component wiring.
function createPageInput(app, name) {
  const appSource = fs.readFileSync('src/App.svelte', 'utf8');
  const tag = name === 'Library' ? name : `${name}View`;
  const props = appSource.match(new RegExp(`<${tag}\\b([\\s\\S]*?)/>`))[1];
  const activeExpression = props.match(/active=\{([^}]+)\}/)?.[1] || 'undefined';
  const script = ts.createSourceFile(name, compileScript(`src/lib/views/${name}.svelte`), ts.ScriptTarget.Latest);
  const handlers = script.statements.filter(node => ts.isFunctionDeclaration(node) &&
    ['handleGlobalKeydown', 'handleLibraryMouseButtons', 'handleMouseSideNavigation'].includes(node.name?.text));
  let keyboard = 0, mouse = 0;
  const sandbox = {
    get active() { return vm.runInNewContext(activeExpression, { ...app.inspect(), $appState: app.state() }); },
    get $appState() { return app.state(); },
    openCreateFolderDialog() { keyboard++; },
    showTagEditor: true, closeTagEditor() { keyboard++; },
    mode: 'manga', selectedManga: null,
    metadataBrowserRef: { reloadCurrentResults() { keyboard++; } },
    cancelPendingNavigation() { mouse++; },
    mangaNavIndex: 1, navigateMangaSelection() { mouse++; },
  };
  vm.runInNewContext(handlers.map(node => node.getText(script)).join('\n'), sandbox);
  const event = { preventDefault() {}, stopPropagation() {} };
  return {
    counts: () => ({ keyboard, mouse }),
    async send() {
      const key = name === 'Library' ? 'n' : name === 'Favorites' ? 'Escape' : 'F5';
      await sandbox.handleGlobalKeydown({ ...event, key, ctrlKey: true, shiftKey: true });
      await (sandbox.handleLibraryMouseButtons || sandbox.handleMouseSideNavigation)?.({ ...event, button: 3 });
    },
  };
}

for (const [name, next] of [['Library', 'favorites'], ['Favorites', 'downloader'], ['Downloader', 'favorites']]) {
  for (const failure of [false, true]) {
    test(`${name} retains input ownership during ${failure ? 'failed import' : 'pending navigation'}`, async () => {
      const app = createApp('', { preload: false });
      const current = name.toLowerCase();
      app.ready('library');
      app.navigate(current);
      app.ready(current);
      await app.flush();
      const input = createPageInput(app, name);
      await input.send();
      const expected = { keyboard: 1, mouse: name === 'Favorites' ? 0 : 1 };
      assert.deepEqual(input.counts(), expected, 'visible page must handle input');

      const target = failure ? 'settings' : next;
      if (failure) app.failures.add(target);
      app.navigate(target);
      await app.flush();
      assert.equal(app.inspect().view, current);
      assert.equal(app.state().currentView, target, 'navigation intent must stay intact');
      const pendingInput = failure ? null : createPageInput(app, next === 'favorites' ? 'Favorites' : 'Downloader');
      await input.send();
      assert.deepEqual(input.counts(), { keyboard: 2, mouse: expected.mouse * 2 }, 'still-visible page must retain input');
      await pendingInput?.send();
      if (pendingInput) assert.deepEqual(pendingInput.counts(), { keyboard: 0, mouse: 0 }, 'hidden target must not handle input');

      const resolvedTarget = failure ? 'tags' : target;
      if (failure) app.navigate(resolvedTarget); // Another page can still open.
      else app.ready(target);
      await app.flush();
      assert.equal(app.inspect().view, resolvedTarget);
      await input.send();
      assert.deepEqual(input.counts(), { keyboard: 2, mouse: expected.mouse * 2 }, 'hidden previous page must stop handling input');
      await pendingInput?.send();
      if (pendingInput) assert.equal(pendingInput.counts().keyboard, 1, 'revealed target must handle input');
    });
  }
}

test('reader startup preserves book/page overrides and owns its own reveal', async () => {
  const app = createApp('?view=reader&bookId=7&page=12&initialViewMode=double&initialMangaMode=false');
  app.emitDownloaderToast('Reader notice', 'info');
  assert.deepEqual(app.notices, [['Reader notice', 'info']], 'App must not hold notices behind a reveal owned by Reader');
  await app.flush();
  const { view, currentBook, isInitialLoad, viewComponents } = app.inspect();
  assert.equal(view, 'reader');
  assert.equal(currentBook.id, 7);
  assert.equal(currentBook.current_page, 12);
  assert.equal(currentBook.current_page_offset, 0);
  assert.equal(currentBook.readerInit.initialViewMode, 'double');
  assert.equal(currentBook.readerInit.initialMangaMode, false);
  assert.equal(isInitialLoad, false);
  assert.equal(app.shown.length, 0);
  assert.equal(viewComponents.downloader, undefined);
  assert.equal(app.imports.filter(name => name === 'reader').length, 1);
});

test('download-log windows reveal without waiting for Library or other pages', async () => {
  const app = createApp('?view=download_logs&taskId=42');
  await app.flush();
  assert.equal(app.inspect().view, 'download_logs');
  assert.equal(app.shown.length, 1);
  assert.equal(app.inspect().viewComponents.downloader, undefined);
  assert.equal(app.imports.filter(name => name === 'downloadlogs').length, 1);
});

for (const failQueue of [false, true]) {
  test(`Downloader access does not wait for metadata after local queue ${failQueue ? 'failure' : 'success'}`, async () => {
    const app = createApp();
    app.ready('library');
    await app.flush();
    app.navigate('downloader');
    await app.flush();
    let resolveQueue, rejectQueue;
    const queueRequest = new Promise((resolve, reject) => { resolveQueue = resolve; rejectQueue = reject; });
    const mounts = [], cleanups = [], listeners = new Map();
    const derived = value => value;
    derived.by = fn => fn();
    const listen = name => callback => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    };
    const sandbox = {
      console: { error() {} }, URLSearchParams,
      $state: value => value, $derived: derived, $effect() {},
      $props: () => ({ onReady() {
        assert.equal(listeners.size, 2, 'queue listeners must be attached before revealing the page');
        app.ready('downloader');
      } }),
      onMount: fn => mounts.push(fn), onDestroy: fn => cleanups.push(fn), tick: async () => {},
      createSourceBadgeLookup: () => new Map(),
      window: { location: { search: '' }, electronAPI: {
        downloader: { getQueue: () => queueRequest, onQueueUpdate: listen('doujinshi') },
        manga: {
          getDownloadQueue: async () => [], getSourceCatalog: async () => [{}],
          onDownloaderProgress: listen('manga'),
        },
      } },
    };
    vm.runInNewContext(`${compileScript('src/lib/views/Downloader.svelte')}
      globalThis.queues = () => [queue, mangaQueue];`, sandbox);
    const mounted = Promise.all(mounts.map(fn => fn()));
    try {
      assert.equal(app.inspect().view, 'library');
      if (failQueue) rejectQueue(new Error('Simulated queue failure'));
      else resolveQueue([]);
      await mounted;
      await app.flush();
      assert.equal(app.inspect().view, 'downloader', 'online metadata must not block the local Downloader');
      listeners.get('doujinshi')([{ id: 7, status: 'downloading' }]);
      listeners.get('manga')([{ id: 8, status: 'downloading' }]);
      assert.equal(sandbox.queues()[0][0].id, 7);
      assert.equal(sandbox.queues()[1][0].id, 8);
    } finally {
      cleanups.forEach(fn => fn());
      assert.equal(listeners.size, 0);
    }
  });
}

test('the initial Manga browser has no added loading message or premature results', () => {
  const { compile } = require('svelte/compiler');
  const { render } = require('svelte/server');
  const source = fs.readFileSync('src/lib/components/manga/MetadataBrowser.svelte', 'utf8');
  const { js } = compile(source, { generate: 'server' });
  const code = ts.transpileModule(js.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const compiledExports = {};
  vm.runInNewContext(code, {
    exports: compiledExports, clearTimeout,
    require: name => name.startsWith('svelte') ? require(name) : {},
  });
  const { body } = render(compiledExports.default, { props: { onSelectManga() {} } });
  assert.doesNotMatch(body, /Loading manga|animate-spin|No results found|Load More/);
});

test('returning to Manga restores cached results without another cover or settings wait', async () => {
  let mount;
  let finishSettings;
  const settings = new Promise(resolve => { finishSettings = resolve; });
  const coverTimers = [];
  let coverLoads = 0;
  let metadataLoads = 0;
  const state = value => value;
  state.raw = state;
  const sandbox = {
    $state: state, $effect() {}, $props: () => ({ onSelectManga() {} }),
    onMount: fn => { mount = fn; }, onDestroy() {},
    normalizeSeriesTitleStyle: value => value,
    Image: class { set src(_value) { coverLoads++; } },
    setTimeout(fn) { coverTimers.push(fn); return coverTimers.length; }, clearTimeout() {},
    window: { electronAPI: {
      settings: { get: () => settings },
      manga: { anilistTrending: async () => { metadataLoads++; return { media: [] }; } },
    } },
  };
  vm.runInNewContext(`${compileScript('src/lib/components/manga/MetadataBrowser.svelte')}
    globalThis.restore = setSessionSnapshot;
    globalThis.inspect = () => ({ initialLoading, isLoading, activeTab, searchQuery, page, hasNextPage, searchResults, seriesTitleStyle });`, sandbox);
  const cachedResults = [{ id: 7, title: { romaji: 'Cached manga' }, coverImage: { large: 'cover.jpg' } }];
  sandbox.restore({ activeTab: 'search', searchQuery: 'Cached manga', page: 3,
    hasNextPage: true, searchResults: cachedResults, seriesTitleStyle: 'romaji' });
  const mounted = mount();
  const restored = sandbox.inspect();
  finishSettings('english');
  await new Promise(setImmediate);
  coverTimers.forEach(finish => finish());
  await mounted;

  assert.equal(restored.initialLoading, false, 'cached results must be visible before settings finish');
  assert.equal(restored.isLoading, false);
  assert.equal(restored.activeTab, 'search');
  assert.equal(restored.searchQuery, 'Cached manga');
  assert.equal(restored.page, 3);
  assert.equal(restored.hasNextPage, true);
  assert.deepEqual(Array.from(restored.searchResults), cachedResults);
  assert.equal(sandbox.inspect().seriesTitleStyle, 'english', 'title preferences still refresh');
  assert.equal(metadataLoads, 0, 'restoring a tab must not refetch metadata');
  assert.equal(coverLoads, 0, 'restoring a tab must not repeat cover warmup');
});

for (const timing of ['after completion', 'before completion', 'obsolete completes first', 'newer search', 'pagination']) {
  test(`Manga tab remount preserves pending results: ${timing}`, async () => {
    const requests = [];
    const result = id => ({ media: [{ id, title: { romaji: `Result ${id}` } }],
      pageInfo: { hasNextPage: true } });
    const state = value => value;
    state.raw = state;
    const sandbox = {
      $state: state, $effect() {}, $props: () => ({ onSelectManga() {} }),
      console, setTimeout, clearTimeout,
      normalizeSeriesTitleStyle: value => value,
      parsePositiveId: value => Number(value), parseMangabakaId: () => 0,
      toasts: { add() { assert.fail('Successful searches must not report errors'); } },
      window: { electronAPI: {
        settings: { get: async () => 'romaji' },
        manga: {
          anilistTrending: async () => result(1),
          anilistSearch: (query, page) => new Promise(resolve => requests.push({ query, page, resolve })),
          mangabakaSearch: async () => ({ data: [] }),
        },
      } },
    };
    // Component instances share module state when the Manga tab remounts.
    vm.runInNewContext(compileScript('src/lib/components/manga/MetadataBrowser.svelte', script => `
      globalThis.createBrowser = () => {
        let mount, destroy;
        const onMount = fn => { mount = fn; }, onDestroy = fn => { destroy = fn; };
        ${script.replace(/^  export /gm, '  ')}
        return { mount: () => mount(), destroy: () => destroy(),
          search: query => { searchQuery = query; handleSearch(); }, loadMore: handleLoadMore,
          inspect: () => ({ query: searchQuery, ids: searchResults.map(item => item.id), page, isLoading }) };
      };`), sandbox);
    const flush = () => new Promise(setImmediate);
    const first = sandbox.createBrowser();
    await first.mount();
    first.search('test');
    await flush();
    if (timing === 'pagination') {
      requests[0].resolve(result(7));
      await flush();
      first.loadMore();
      await flush();
    }
    const pending = requests.at(-1);
    first.destroy();
    const expectedId = timing === 'pagination' ? 8 : 7;
    if (timing === 'after completion') {
      pending.resolve(result(expectedId));
      await flush();
    }
    const second = sandbox.createBrowser();
    const mounting = second.mount();
    await flush();
    try {
      if (timing !== 'after completion') {
        const resumed = requests.at(-1);
        assert.notEqual(resumed, pending, 'an incomplete snapshot must resume its request');
        assert.equal(resumed.query, 'test');
        assert.equal(resumed.page, timing === 'pagination' ? 2 : 1);
        if (timing === 'obsolete completes first') {
          pending.resolve(result(70));
          await flush();
          assert.equal(second.inspect().isLoading, true, 'an older instance must not finish the resumed request');
          assert.deepEqual(Array.from(second.inspect().ids), [1]);
        }
        if (timing === 'newer search') {
          second.search('new query');
          await flush();
          requests.at(-1).resolve(result(9));
          await flush();
        }
        resumed.resolve(result(expectedId));
        await flush();
        pending.resolve(result(expectedId));
      }
      await mounting;
      await flush();
      const expectedIds = timing === 'pagination' ? [7, 8] : [timing === 'newer search' ? 9 : 7];
      assert.deepEqual(Array.from(second.inspect().ids), expectedIds);
      assert.equal(second.inspect().query, timing === 'newer search' ? 'new query' : 'test');
      assert.equal(second.inspect().page, timing === 'pagination' ? 2 : 1);
      assert.equal(second.inspect().isLoading, false);
      second.destroy();
      const requestCount = requests.length;
      const third = sandbox.createBrowser();
      await third.mount();
      assert.deepEqual(Array.from(third.inspect().ids), expectedIds, 'older instances must not overwrite saved results');
      assert.equal(requests.length, requestCount, 'completed results must restore without another request');
      third.destroy();
    } finally {
      requests.forEach(request => request.resolve(result(expectedId)));
      await mounting;
    }
  });
}

for (const order of ['initial first', 'search first', 'search without covers', 'obsolete failure', 'obsolete completes first', 'cover wait']) {
  test(`Manga first-load readiness follows the current request: ${order}`, async () => {
    const pending = () => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      return { promise, resolve, reject };
    };
    const initial = pending(), search = pending();
    const result = id => ({ media: [{ id, title: { romaji: `Result ${id}` },
      coverImage: { large: `cover-${id}.jpg` } }], pageInfo: { hasNextPage: false } });
    const images = [], notices = [], timers = new Map();
    let timerId = 0, mount;
    const state = value => value;
    state.raw = state;
    const sandbox = {
      $state: state, $effect() {}, $props: () => ({ onSelectManga() {} }),
      onMount: fn => { mount = fn; }, onDestroy() {},
      console: { error() {}, warn() {} },
      normalizeSeriesTitleStyle: value => value,
      parsePositiveId: value => Number(value), parseMangabakaId: () => 0,
      toasts: { add: (...args) => notices.push(args) },
      Image: class { set src(value) { this.url = value; images.push(this); } },
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
      clearTimeout(id) { timers.delete(id); },
      window: { electronAPI: {
        settings: { get: async () => 'romaji' },
        manga: { anilistTrending: () => initial.promise, anilistSearch: () => search.promise,
          mangabakaSearch: async () => ({ data: [] }) },
      } },
    };
    vm.runInNewContext(`${compileScript('src/lib/components/manga/MetadataBrowser.svelte')}
      globalThis.search = () => { searchQuery = 'test'; handleSearch(); };
      globalThis.inspect = () => ({ initialLoading, isLoading, ids: searchResults.map(item => item.id) });
      globalThis.snapshot = getSessionSnapshot;`, sandbox);
    const flush = () => new Promise(setImmediate);
    const mounting = mount();
    try {
      await flush();
      if (order === 'initial first' || order === 'cover wait') {
        initial.resolve(result(1));
        await flush();
        assert.equal(images.length, 1);
        if (order === 'initial first') { images[0].onload(); await mounting; }
      }
      sandbox.search();
      await flush();
      if (order === 'obsolete completes first') {
        initial.resolve(result(1));
        await flush();
        assert.equal(sandbox.inspect().isLoading, true, 'obsolete response must not stop the current spinner');
        assert.deepEqual(Array.from(sandbox.inspect().ids), [], 'obsolete response must not populate the current search');
      }
      if (order === 'cover wait') {
        images[0].onload();
        await flush();
        assert.equal(sandbox.inspect().initialLoading, true, 'obsolete covers must not reveal results');
        assert.equal(sandbox.inspect().isLoading, true, 'obsolete completion must not stop the current spinner');
      }
      const found = result(7);
      if (order === 'search without covers') delete found.media[0].coverImage;
      search.resolve(found);
      await flush();
      if (order !== 'initial first' && order !== 'search without covers') {
        assert.equal(sandbox.inspect().initialLoading, true, 'first displayed results still warm their covers');
        assert.equal(images.at(-1)?.url, 'cover-7.jpg', 'current results must own first-cover readiness');
        images.at(-1).onload();
        await flush();
      }
      assert.equal(sandbox.inspect().initialLoading, false, 'completed search must not wait for the initial request');
      assert.equal(sandbox.inspect().isLoading, false);
      assert.deepEqual(Array.from(sandbox.inspect().ids), [7]);
      if (order === 'obsolete failure') initial.reject(new Error('Obsolete request failed'));
      else initial.resolve(result(1));
      await flush();
      assert.deepEqual(Array.from(sandbox.inspect().ids), [7], 'late initial response must not replace the search');
      assert.deepEqual(Array.from(sandbox.snapshot().searchResults, item => item.id), [7]);
      assert.deepEqual(notices, [], 'obsolete failures must not report errors for the successful search');
    } finally {
      initial.resolve(result(1)); search.resolve(result(7));
      await flush();
      for (const finish of timers.values()) finish();
      await mounting;
    }
  });
}

for (const slow of [false, true]) {
  test(`a ${slow ? 'slow' : 'fast'} metadata request preserves loading feedback and the existing failure message`, async () => {
    let rejectRequest;
    const request = new Promise((_, reject) => { rejectRequest = reject; });
    let mounting;
    let settingsReads = 0;
    let loadingEffect;
    let spinnerTimer;
    const notices = [];
    const state = value => value;
    state.raw = state;
    const sandbox = {
      $state: state,
      $effect: fn => { loadingEffect = fn; },
      $props: () => ({ onSelectManga() {} }),
      onMount: fn => { mounting = fn(); }, onDestroy() {},
      console: { error() {}, warn() {} },
      setTimeout(fn, delay) { assert.equal(delay, 200); spinnerTimer = fn; return 1; },
      clearTimeout(id) { assert.equal(id, 1); spinnerTimer = undefined; },
      normalizeSeriesTitleStyle: value => value,
      toasts: { add: (...args) => notices.push(args) },
      window: { electronAPI: {
        settings: { get: async () => { settingsReads++; return 'romaji'; } },
        manga: { anilistTrending: () => request },
      } },
    };
    vm.runInNewContext(`${compileScript('src/lib/components/manga/MetadataBrowser.svelte')}
      globalThis.loading = () => isLoading;
      globalThis.spinnerVisible = () => isLoading && showLoadingSpinner;
      globalThis.initialLoading = () => initialLoading;`, sandbox);
    await Promise.resolve();
    assert.equal(sandbox.loading(), true);
    assert.equal(sandbox.initialLoading(), true);
    let cleanup = loadingEffect();
    assert.equal(sandbox.spinnerVisible(), false, 'no immediate spinner flash');
    if (slow) {
      spinnerTimer();
      assert.equal(sandbox.spinnerVisible(), true, 'pending requests get the existing spinner');
    }
    rejectRequest(new Error('Simulated offline response'));
    await mounting;
    assert.equal(sandbox.spinnerVisible(), false, 'completion hides the spinner immediately');
    cleanup();
    assert.equal(spinnerTimer, undefined, 'completion cancels the delayed spinner');
    loadingEffect();
    assert.equal(sandbox.initialLoading(), false);
    assert.equal(sandbox.loading(), false);
    assert.equal(settingsReads, 1);
    assert.deepEqual(notices, [['Downloader: Failed to fetch metadata results.', 'error']]);

    // Unmount during a request to check spinner timer cleanup.
    const nextRequest = vm.runInNewContext('refreshResults()', sandbox);
    cleanup = loadingEffect();
    assert.equal(sandbox.spinnerVisible(), false);
    assert.equal(typeof spinnerTimer, 'function');
    cleanup();
    assert.equal(spinnerTimer, undefined);
    await nextRequest;
  });
}

for (const completion of ['load', 'error', 'timeout']) {
  test(`metadata browser releases its initial cover wait on ${completion}`, async () => {
    let mounting;
    let finishCoverWait;
    const pendingImages = [];
    const state = value => value;
    state.raw = state;

    class TestImage {
      set src(value) {
        this.currentSrc = value;
        pendingImages.push(this);
      }
    }

    const sandbox = {
      $state: state,
      $effect() {},
      $props: () => ({ onSelectManga() {} }),
      onMount: fn => { mounting = fn(); }, onDestroy() {},
      Image: TestImage,
      setTimeout(fn) { finishCoverWait = fn; return 1; }, clearTimeout() {},
      console: { error() {}, warn() {} },
      normalizeSeriesTitleStyle: value => value,
      toasts: { add() {} },
      window: { electronAPI: {
        settings: { get: async () => 'romaji' },
        manga: { anilistTrending: async () => ({
          media: [{ id: 1, title: { romaji: 'Test' }, coverImage: { large: 'cover.jpg' } }],
          pageInfo: { hasNextPage: false },
        }) },
      } },
    };

    vm.runInNewContext(`${compileScript('src/lib/components/manga/MetadataBrowser.svelte')}
      globalThis.initialLoading = () => initialLoading;`, sandbox);
    await new Promise(setImmediate);
    assert.equal(sandbox.initialLoading(), true);
    assert.equal(pendingImages.length, 1);

    if (completion === 'timeout') finishCoverWait();
    else pendingImages[0][completion === 'load' ? 'onload' : 'onerror']();
    await mounting;
    assert.equal(sandbox.initialLoading(), false);
    assert.equal(pendingImages[0].onload, null);
    assert.equal(pendingImages[0].onerror, null);
  });
}
