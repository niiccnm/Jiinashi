import { app, net } from "electron";
import { createHash } from "crypto";
import { createRequire } from "module";
import path from "path";
import fs from "fs/promises";
import {
  getInstalledExtensions,
  addExtension,
  removeExtension,
} from "../database/queries/manga";
import { getSetting, setSetting } from "../database/database";
import type {
  IMangaSource,
  MangaExtension,
  MangaExtensionConfig,
  MangaExtensionSite,
} from "../types/manga-types";
import {
  getBaseSourceName,
  getSourceGroupId,
} from "../../src/lib/utils/source-grouping";

type ExtensionRegistration = {
  manifest: MangaExtension;
  sources: IMangaSource[];
};

type CatalogEntry = {
  id: string;
  name: string;
  version: string;
  contentType: "manga" | "novel";
  entry: string;
  sha256: string;
  assets?: string[];
};

type ExtensionCatalog = {
  schemaVersion: 1;
  name: string;
  extensions: CatalogEntry[];
};

export type ExtensionRepository = {
  url: string;
  name: string;
  extensionIds: string[];
  lastUpdated: string;
};

const REPOSITORIES_SETTING = "extensionRepositories";
const requireFromApp = createRequire(import.meta.url);

function normalizeExtensionConfig(
  config: MangaExtensionConfig | Record<string, unknown> | null | undefined,
): MangaExtensionConfig | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const normalized: MangaExtensionConfig = { ...config };
  const siteStates =
    config.siteStates &&
    typeof config.siteStates === "object" &&
    !Array.isArray(config.siteStates)
      ? Object.fromEntries(
          Object.entries(config.siteStates).map(([key, value]) => [
            key,
            value !== false,
          ]),
        )
      : undefined;
  if (siteStates && Object.keys(siteStates).length) normalized.siteStates = siteStates;
  else delete normalized.siteStates;
  return normalized;
}

function buildSitesForSources(
  sources: IMangaSource[],
  config: MangaExtensionConfig | null,
): MangaExtensionSite[] {
  const groups = new Map<string, MangaExtensionSite & { order: number }>();
  const siteStates = config?.siteStates || {};
  for (const [index, source] of sources.entries()) {
    const siteId = getSourceGroupId(source);
    const existing = groups.get(siteId);
    if (existing) {
      existing.source_ids.push(source.id);
      existing.icon_url ||= source.iconUrl;
      existing.base_url ||= source.baseUrl;
      continue;
    }
    groups.set(siteId, {
      id: siteId,
      name: getBaseSourceName(source),
      base_url: source.baseUrl,
      icon_url: source.iconUrl,
      source_ids: [source.id],
      is_enabled: siteStates[siteId] !== false,
      order: index,
    });
  }
  return Array.from(groups.values())
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...site }) => site);
}

function cloneExtensionManifest(
  manifest: MangaExtension,
  sources: IMangaSource[],
): MangaExtension {
  const config = normalizeExtensionConfig(manifest.config);
  return {
    ...manifest,
    config,
    repository_url: String(config?.repositoryUrl || "") || undefined,
    repository_name: String(config?.repositoryName || "") || undefined,
    content_type:
      config?.contentType === "novel" ? "novel" : manifest.content_type || "manga",
    sites: buildSitesForSources(sources, config),
  };
}

function validateHttpUrl(value: string, base?: string) {
  const parsed = base ? new URL(value, base) : new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Repository URLs must use HTTP or HTTPS");
  }
  return parsed.toString();
}

function safeId(value: string) {
  const normalized = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized)) {
    throw new Error(`Invalid extension id: ${normalized || "(empty)"}`);
  }
  return normalized;
}

function parseCatalog(value: unknown): ExtensionCatalog {
  if (!value || typeof value !== "object") throw new Error("Invalid repository catalog");
  const catalog = value as Partial<ExtensionCatalog>;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.extensions)) {
    throw new Error("Unsupported repository catalog format");
  }
  const extensions = catalog.extensions.map((item) => {
    const entry = item as CatalogEntry;
    safeId(entry.id);
    if (!entry.name || !entry.version || !entry.entry || !entry.sha256) {
      throw new Error(`Incomplete catalog entry for ${entry.id}`);
    }
    if (entry.contentType !== "manga" && entry.contentType !== "novel") {
      throw new Error(`Unsupported content type for ${entry.id}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) {
      throw new Error(`Invalid checksum for ${entry.id}`);
    }
    return entry;
  });
  return {
    schemaVersion: 1,
    name: String(catalog.name || "Extension Repository").trim(),
    extensions,
  };
}

export class ExtensionLoader {
  private sources = new Map<string, IMangaSource>();
  private sourceOwners = new Map<string, string>();
  private extensions = new Map<string, ExtensionRegistration>();
  private persistedExtensions = new Map<string, MangaExtension>();
  private repositories: ExtensionRepository[] = [];

  async init() {
    this.sources.clear();
    this.sourceOwners.clear();
    this.extensions.clear();
    this.persistedExtensions = new Map(
      getInstalledExtensions().map((extension) => [
        extension.id,
        { ...extension, config: normalizeExtensionConfig(extension.config) },
      ]),
    );
    this.repositories = this.readRepositories();

    for (const persisted of this.persistedExtensions.values()) {
      const modulePath = String(persisted.config?.modulePath || "").trim();
      if (!modulePath || persisted.source_type !== "external") continue;
      try {
        await this.loadModule(modulePath, persisted);
      } catch (error) {
        console.error(`[Extensions] Failed to load ${persisted.id}:`, error);
      }
    }
  }

  getRepositories() {
    return this.repositories.map((repository) => ({ ...repository }));
  }

  async importRepository(repositoryUrl: string) {
    const url = validateHttpUrl(String(repositoryUrl || "").trim());
    const catalog = parseCatalog(await this.fetchJson(url));
    const installedIds: string[] = [];
    const previousRepository = this.repositories.find((item) => item.url === url);

    for (const entry of catalog.extensions) {
      await this.installEntry(url, catalog.name, entry);
      installedIds.push(entry.id);
    }

    for (const staleId of previousRepository?.extensionIds || []) {
      if (!installedIds.includes(staleId)) {
        await this.removeInstalledExtension(staleId);
      }
    }

    const repository: ExtensionRepository = {
      url,
      name: catalog.name,
      extensionIds: installedIds,
      lastUpdated: new Date().toISOString(),
    };
    this.repositories = [
      ...this.repositories.filter((item) => item.url !== url),
      repository,
    ];
    this.persistRepositories();
    return repository;
  }

  async removeInstalledExtension(id: string) {
    const registration = this.extensions.get(id);
    const persisted = this.persistedExtensions.get(id);
    const sourceIds = registration?.sources.map((source) => source.id) || [];
    for (const sourceId of sourceIds) {
      if (this.sourceOwners.get(sourceId) === id) {
        this.sources.delete(sourceId);
        this.sourceOwners.delete(sourceId);
      }
    }
    this.extensions.delete(id);
    this.persistedExtensions.delete(id);
    removeExtension(id);

    const modulePath = String(
      registration?.manifest.config?.modulePath || persisted?.config?.modulePath || "",
    );
    if (modulePath) {
      const extensionRoot = path.resolve(this.getExtensionRoot());
      const target = path.resolve(path.dirname(modulePath));
      if (target.startsWith(`${extensionRoot}${path.sep}`)) {
        await fs.rm(target, { recursive: true, force: true });
      }
    }

    this.repositories = this.repositories
      .map((repository) => ({
        ...repository,
        extensionIds: repository.extensionIds.filter(
          (extensionId) => extensionId !== id,
        ),
      }))
      .filter((repository) => repository.extensionIds.length > 0);
    this.persistRepositories();
  }

  private async installEntry(
    repositoryUrl: string,
    repositoryName: string,
    entry: CatalogEntry,
  ) {
    const extensionId = safeId(entry.id);
    const entryUrl = validateHttpUrl(entry.entry, repositoryUrl);
    const bytes = await this.fetchBytes(entryUrl, 25 * 1024 * 1024);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest.toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new Error(`Checksum verification failed for ${entry.name}`);
    }

    const directory = path.join(this.getExtensionRoot(), extensionId);
    await fs.mkdir(directory, { recursive: true });
    const modulePath = path.join(directory, "extension.cjs");
    const pendingModulePath = path.join(directory, "extension.next.cjs");
    await fs.writeFile(pendingModulePath, bytes);

    for (const asset of entry.assets || []) {
      const assetUrl = validateHttpUrl(asset, repositoryUrl);
      const assetName = path.basename(new URL(assetUrl).pathname);
      if (!assetName) throw new Error(`Invalid asset path for ${entry.name}`);
      await fs.writeFile(
        path.join(directory, assetName),
        await this.fetchBytes(assetUrl, 5 * 1024 * 1024),
      );
    }

    const previous = this.persistedExtensions.get(extensionId);
    const previousRepositoryUrl = String(previous?.config?.repositoryUrl || "").trim();
    if (previousRepositoryUrl && previousRepositoryUrl !== repositoryUrl) {
      throw new Error(
        `Extension id ${extensionId} is already owned by another repository`,
      );
    }
    const manifest: MangaExtension = {
      id: extensionId,
      name: entry.name,
      version: entry.version,
      source_type: "external",
      content_type: entry.contentType,
      is_enabled: previous?.is_enabled ?? true,
      installed_at: previous?.installed_at || new Date().toISOString(),
      config: {
        ...(normalizeExtensionConfig(previous?.config) || {}),
        repositoryUrl,
        repositoryName,
        modulePath,
        contentType: entry.contentType,
      },
    };
    let registration: ExtensionRegistration;
    try {
      registration = this.readModule(pendingModulePath, manifest);
      await fs.copyFile(pendingModulePath, modulePath);
    } finally {
      await fs.rm(pendingModulePath, { force: true });
    }
    await this.registerExtension(registration);
  }

  private async loadModule(modulePath: string, persisted: MangaExtension) {
    await this.registerExtension(this.readModule(modulePath, persisted));
  }

  private readModule(
    modulePath: string,
    persisted: MangaExtension,
  ): ExtensionRegistration {
    const resolved = requireFromApp.resolve(modulePath);
    delete requireFromApp.cache[resolved];
    const loaded = requireFromApp(resolved);
    const exported = loaded?.extension || loaded?.default || loaded;
    if (!exported?.manifest || !Array.isArray(exported?.sources)) {
      throw new Error("Extension module did not export a valid registration");
    }
    if (String(exported.manifest.id) !== persisted.id) {
      throw new Error("Extension module id does not match its catalog entry");
    }
    for (const source of exported.sources) this.validateSource(source);
    return {
      manifest: {
        ...exported.manifest,
        ...persisted,
        source_type: "external",
        config: normalizeExtensionConfig(persisted.config),
      },
      sources: exported.sources,
    };
  }

  private validateSource(source: Partial<IMangaSource>) {
    const methods = ["getPopular", "getLatest", "search", "getDetail", "getChapters", "getChapterPages"];
    if (!source?.id || !source.name || !source.baseUrl || !source.lang) {
      throw new Error("Extension contains an incomplete source");
    }
    if (methods.some((method) => typeof (source as any)[method] !== "function")) {
      throw new Error(`Source ${source.id} does not implement the required methods`);
    }
    if (source.lang.toLowerCase() !== "any") {
      try {
        Intl.getCanonicalLocales(source.lang);
      } catch {
        throw new Error(`Source ${source.id} has an invalid language tag`);
      }
    }
  }

  private async fetchJson(url: string) {
    const bytes = await this.fetchBytes(url, 5 * 1024 * 1024);
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("Repository did not return valid JSON");
    }
  }

  private async fetchBytes(url: string, maxBytes: number) {
    const response = await net.fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Repository request failed (${response.status})`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > maxBytes) throw new Error("Repository file is too large");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("Repository file is too large");
    return bytes;
  }

  private getExtensionRoot() {
    return path.join(app.getPath("userData"), "extensions");
  }

  private readRepositories(): ExtensionRepository[] {
    try {
      const parsed = JSON.parse(getSetting(REPOSITORIES_SETTING) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persistRepositories() {
    setSetting(REPOSITORIES_SETTING, JSON.stringify(this.repositories));
  }

  private mergeManifest(manifest: MangaExtension): MangaExtension {
    const persisted = this.persistedExtensions.get(manifest.id);
    return {
      ...manifest,
      is_enabled: persisted?.is_enabled ?? manifest.is_enabled ?? true,
      installed_at: persisted?.installed_at || manifest.installed_at || new Date().toISOString(),
      icon_url: manifest.icon_url || persisted?.icon_url,
      config: normalizeExtensionConfig(manifest.config ?? persisted?.config),
    };
  }

  private persistExtension(registration: ExtensionRegistration) {
    addExtension({ ...registration.manifest, sites: undefined });
    this.persistedExtensions.set(registration.manifest.id, {
      ...registration.manifest,
      sites: undefined,
    });
  }

  private isSourceSiteEnabled(extension: ExtensionRegistration, source: IMangaSource) {
    const sites = extension.manifest.sites || buildSitesForSources(extension.sources, extension.manifest.config ?? null);
    return sites.find((entry) => entry.source_ids.includes(source.id))?.is_enabled ?? true;
  }

  private refreshExtensionSites(id: string) {
    const registration = this.extensions.get(id);
    if (!registration) return;
    registration.manifest = cloneExtensionManifest(registration.manifest, registration.sources);
  }

  async registerExtension(extension: ExtensionRegistration) {
    const manifest = this.mergeManifest(extension.manifest);
    for (const source of extension.sources) {
      this.sources.set(source.id, source);
      this.sourceOwners.set(source.id, manifest.id);
    }
    const registration = {
      manifest: cloneExtensionManifest(manifest, extension.sources),
      sources: [...extension.sources],
    };
    this.extensions.set(manifest.id, registration);
    this.persistExtension(registration);
  }

  getSource(id: string) {
    return this.sources.get(id);
  }

  getAllSources() {
    return Array.from(this.sources.values());
  }

  getEnabledSources() {
    return this.getAllSources().filter((source) => {
      const extension = this.extensions.get(this.sourceOwners.get(source.id) || "");
      return !extension || (extension.manifest.is_enabled && this.isSourceSiteEnabled(extension, source));
    });
  }

  getExtensions() {
    return Array.from(this.extensions.values()).map((registration) =>
      cloneExtensionManifest(registration.manifest, registration.sources),
    );
  }

  async toggleExtension(id: string, enabled: boolean) {
    const registration = this.extensions.get(id);
    if (!registration) return;
    registration.manifest.is_enabled = enabled;
    this.refreshExtensionSites(id);
    this.persistExtension(registration);
  }

  async toggleExtensionSite(extensionId: string, siteId: string, enabled: boolean) {
    const registration = this.extensions.get(extensionId);
    if (!registration) return;
    const valid = new Set(buildSitesForSources(registration.sources, registration.manifest.config ?? null).map((site) => site.id));
    if (!valid.has(siteId)) return;
    const config = normalizeExtensionConfig(registration.manifest.config) || {};
    config.siteStates = { ...(config.siteStates || {}), [siteId]: enabled };
    registration.manifest.config = config;
    this.refreshExtensionSites(extensionId);
    this.persistExtension(registration);
  }
}

export const extensionLoader = new ExtensionLoader();
