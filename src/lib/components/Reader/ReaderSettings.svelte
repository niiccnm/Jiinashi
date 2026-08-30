<script lang="ts">
  import { cubicOut, quartOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import { dragScroll } from "../../utils/dragScroll";

  type ViewMode = "single" | "double" | "webtoon";
  type FitMode = "width" | "height" | "contain" | "fill";
  type ImageControlKey = "brightness" | "contrast" | "gamma";

  interface Props {
    show: boolean;
    viewMode: ViewMode;
    fitMode: FitMode;
    mangaMode: boolean;
    brightness: number;
    contrast: number;
    gamma: number;
    greyscale: boolean;
    onClose: () => void;
    onUpdateSettings: (settings: any) => void;
  }

  let {
    show,
    viewMode,
    fitMode,
    mangaMode,
    brightness,
    contrast,
    gamma,
    greyscale,
    onClose,
    onUpdateSettings,
  }: Props = $props();

  const viewModes = [
    {
      value: "single",
      label: "Single",
      detail: "One page",
      pages: [{ x: 13, y: 5, width: 14, height: 22 }],
    },
    {
      value: "double",
      label: "Double",
      detail: "Two pages",
      pages: [
        { x: 5, y: 6, width: 13, height: 20 },
        { x: 22, y: 6, width: 13, height: 20 },
      ],
    },
    {
      value: "webtoon",
      label: "Webtoon",
      detail: "Continuous",
      pages: [
        { x: 13, y: 3, width: 14, height: 7 },
        { x: 13, y: 13, width: 14, height: 7 },
        { x: 13, y: 23, width: 14, height: 7 },
      ],
    },
  ] as const;

  const fitModes = [
    {
      value: "contain",
      label: "Best fit",
      page: { x: 10, y: 4, width: 12, height: 16 },
      webtoon: true,
    },
    {
      value: "width",
      label: "Fit width",
      page: { x: 4, y: 8, width: 24, height: 8 },
      webtoon: true,
    },
    {
      value: "height",
      label: "Fit height",
      page: { x: 10, y: 2, width: 12, height: 20 },
      webtoon: false,
    },
    {
      value: "fill",
      label: "Stretch",
      page: { x: 4, y: 3, width: 24, height: 18 },
      webtoon: false,
    },
  ] as const;

  const directions = [
    {
      mangaMode: false,
      label: "Left to right",
      detail: "Western",
      path: "M5 12h14M14 7l5 5-5 5",
    },
    {
      mangaMode: true,
      label: "Right to left",
      detail: "Manga",
      path: "M19 12H5M10 7l-5 5 5 5",
    },
  ] as const;

  let imageControls = $derived([
    {
      key: "brightness",
      label: "Brightness",
      value: brightness,
      inputValue: `${brightness}`,
      min: 50,
      max: 150,
      step: 1,
      suffix: "%",
    },
    {
      key: "contrast",
      label: "Contrast",
      value: contrast,
      inputValue: `${contrast}`,
      min: 50,
      max: 150,
      step: 1,
      suffix: "%",
    },
    {
      key: "gamma",
      label: "Gamma",
      value: gamma,
      inputValue: (gamma / 100).toFixed(2),
      min: 0.5,
      max: 1.5,
      step: 0.01,
      suffix: "",
    },
  ] as const);

  function update(key: string, value: unknown) {
    onUpdateSettings({ [key]: value });
  }

  function resetImageDisplay() {
    update("brightness", 100);
    update("contrast", 100);
    update("gamma", 100);
    update("greyscale", false);
  }

  function commitImageControl(
    key: ImageControlKey,
    input: HTMLInputElement,
    fallback: string,
  ) {
    const rawValue = input.value.trim();
    const parsed = rawValue === "" ? Number.NaN : Number(rawValue);
    if (!Number.isFinite(parsed)) {
      input.value = fallback;
      return;
    }

    const scaled = key === "gamma" ? parsed * 100 : parsed;
    const value = Math.min(150, Math.max(50, Math.round(scaled)));
    input.value = key === "gamma" ? (value / 100).toFixed(2) : `${value}`;
    update(key, value);
  }

  function selectImageControlValue(input: HTMLInputElement) {
    requestAnimationFrame(() => {
      if (document.activeElement === input) input.select();
    });
  }

  function containWheel(node: HTMLElement) {
    const stopPropagation = (event: WheelEvent) => event.stopPropagation();
    node.addEventListener("wheel", stopPropagation);
    return {
      destroy: () => node.removeEventListener("wheel", stopPropagation),
    };
  }
</script>

{#if show}
  <aside
    in:fly={{ x: 16, duration: 150, opacity: 1, easing: quartOut }}
    out:fly={{ x: "100%", duration: 170, opacity: 1, easing: cubicOut }}
    class="reader-settings"
    data-reader-settings
    aria-labelledby="reader-settings-title"
    use:containWheel
  >
    <header class="settings-header">
      <div>
        <p class="settings-kicker">Reader</p>
        <h2 id="reader-settings-title">Settings</h2>
      </div>

      <button class="close-button" onclick={onClose} aria-label="Close reader settings">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </header>

    <div class="settings-content" use:dragScroll={{ axis: "y" }}>
      <section aria-labelledby="view-mode-heading">
        <div class="section-heading">
          <h3 id="view-mode-heading">Page layout</h3>
          <p>Choose how pages are arranged.</p>
        </div>

        <div class="layout-options" role="group" aria-label="Page layout">
          {#each viewModes as mode}
            <button
              class="layout-option"
              class:active={viewMode === mode.value}
              onclick={() => update("viewMode", mode.value)}
              aria-pressed={viewMode === mode.value}
            >
              <svg class="layout-preview" aria-hidden="true" viewBox="0 0 40 32">
                {#each mode.pages as page}
                  <rect
                    x={page.x}
                    y={page.y}
                    width={page.width}
                    height={page.height}
                    rx="1"
                  />
                {/each}
              </svg>
              <span class="option-label">{mode.label}</span>
              <span class="option-detail">{mode.detail}</span>
            </button>
          {/each}
        </div>
      </section>

      <section aria-labelledby="scale-mode-heading">
        <div class="section-heading">
          <h3 id="scale-mode-heading">Page sizing</h3>
          <p>Set how each page fills the reader.</p>
        </div>

        <div class="sizing-options" role="group" aria-label="Page sizing">
          {#each fitModes as mode}
            {#if viewMode !== "webtoon" || mode.webtoon}
              <button
                class="sizing-option"
                class:active={fitMode === mode.value}
                onclick={() => update("fitMode", mode.value)}
                aria-pressed={fitMode === mode.value}
              >
                <svg class="fit-icon" aria-hidden="true" viewBox="0 0 32 24">
                  <rect class="fit-viewport" x="1" y="1" width="30" height="22" rx="3" />
                  <rect
                    class="fit-page"
                    x={mode.page.x}
                    y={mode.page.y}
                    width={mode.page.width}
                    height={mode.page.height}
                    rx="1"
                  />
                </svg>
                <span>{mode.label}</span>
                <svg class="check-icon" aria-hidden="true" viewBox="0 0 20 20">
                  <path d="m5 10 3 3 7-7" />
                </svg>
              </button>
            {/if}
          {/each}
        </div>

        {#if viewMode === "webtoon"}
          <p class="webtoon-note">
            Best fit keeps each page visible. Drag to scroll, or use Ctrl-scroll to zoom.
          </p>
        {/if}
      </section>

      {#if viewMode !== "webtoon"}
        <section aria-labelledby="reading-direction-heading">
          <div class="section-heading">
            <h3 id="reading-direction-heading">Reading direction</h3>
            <p>Set the order used for page turns.</p>
          </div>

          <div class="direction-options" role="group" aria-label="Reading direction">
            {#each directions as direction}
              <button
                class:active={mangaMode === direction.mangaMode}
                onclick={() => update("mangaMode", direction.mangaMode)}
                aria-pressed={mangaMode === direction.mangaMode}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d={direction.path} />
                </svg>
                <span>
                  <span class="direction-label">{direction.label}</span>
                  <span class="direction-detail">{direction.detail}</span>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      <section aria-labelledby="image-display-heading">
        <div class="section-heading image-heading">
          <div>
            <h3 id="image-display-heading">Image display</h3>
            <p>Fine-tune the page without editing the source.</p>
          </div>
          <button class="reset-button" onclick={resetImageDisplay}>Reset</button>
        </div>

        <div class="image-controls">
          <button
            class="greyscale-option"
            class:active={greyscale}
            type="button"
            onclick={() => update("greyscale", !greyscale)}
            aria-pressed={greyscale}
          >
            <svg class="greyscale-icon" aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 4a8 8 0 0 1 0 16Z" />
            </svg>
            <span class="greyscale-copy">
              <span class="greyscale-label">Greyscale</span>
              <span class="greyscale-detail">Remove color from pages</span>
            </span>
            <kbd>Ctrl+Shift+C</kbd>
            <span class="toggle-track" aria-hidden="true">
              <span class="toggle-thumb"></span>
            </span>
          </button>

          {#each imageControls as control}
            <div class="image-control">
              <div class="slider-heading">
                <label for={`reader-${control.key}`}>{control.label}</label>
                <span class="slider-actions">
                  <span class="value-editor">
                    <input
                      class="control-value"
                      class:with-suffix={Boolean(control.suffix)}
                      type="text"
                      inputmode="decimal"
                      role="spinbutton"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={control.inputValue}
                      aria-label={`${control.label} value`}
                      aria-valuemin={control.min}
                      aria-valuemax={control.max}
                      aria-valuenow={Number(control.inputValue)}
                      onclick={(event) => selectImageControlValue(event.currentTarget)}
                      onchange={(event) =>
                        commitImageControl(
                          control.key,
                          event.currentTarget,
                          control.inputValue,
                        )}
                      onkeydown={(event) => {
                        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                          event.preventDefault();
                          const current = Number(event.currentTarget.value);
                          const fallback = Number(control.inputValue);
                          const direction = event.key === "ArrowUp" ? 1 : -1;
                          const next = Math.min(
                            control.max,
                            Math.max(
                              control.min,
                              (Number.isFinite(current) ? current : fallback) +
                                control.step * direction,
                            ),
                          );
                          event.currentTarget.value =
                            control.key === "gamma" ? next.toFixed(2) : `${Math.round(next)}`;
                          commitImageControl(
                            control.key,
                            event.currentTarget,
                            control.inputValue,
                          );
                        }
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          event.currentTarget.value = control.inputValue;
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    {#if control.suffix}
                      <span class="value-suffix" aria-hidden="true">{control.suffix}</span>
                    {/if}
                  </span>
                  <button
                    class="control-reset"
                    type="button"
                    disabled={control.value === 100}
                    onclick={() => update(control.key, 100)}
                    aria-label={`Reset ${control.label.toLowerCase()}`}
                    title={`Reset ${control.label.toLowerCase()}`}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M4.9 8.5A8 8 0 1 1 4 14m.9-5.5H9m-4.1 0V4.4" />
                    </svg>
                  </button>
                </span>
              </div>
              <input
                id={`reader-${control.key}`}
                type="range"
                min="50"
                max="150"
                step="1"
                value={control.value}
                style={`--range-progress: ${control.value - 50}%`}
                oninput={(event) =>
                  update(control.key, parseInt(event.currentTarget.value))}
              />
            </div>
          {/each}
        </div>
      </section>
    </div>
  </aside>
{/if}

<style>
  .reader-settings {
    --panel: #0b0d12;
    --surface: #12151c;
    --surface-raised: #181c25;
    --border: #252b36;
    --border-strong: #343c49;
    --text: #f4f6f8;
    --muted: #8f99a8;
    --subtle: #687282;
    --accent: #3b82f6;
    --accent-soft: #172b4d;
    position: absolute;
    inset: 0 0 0 auto;
    z-index: 40;
    display: flex;
    width: min(23.5rem, 100vw);
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    box-shadow: -18px 0 48px rgb(0 0 0 / 0.42);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .settings-header {
    display: flex;
    min-height: 5.25rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--border);
    padding: 1rem 1.25rem 1rem 1.5rem;
    background: #0e1117;
  }

  .settings-kicker {
    margin: 0 0 0.15rem;
    color: var(--accent);
    font-size: 0.625rem;
    font-weight: 750;
    letter-spacing: 0.18em;
    line-height: 1;
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 680;
    letter-spacing: -0.025em;
    line-height: 1.35;
  }

  .close-button {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    flex: none;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    transition: color 140ms, border-color 140ms, background-color 140ms, transform 140ms;
  }

  .close-button:hover {
    border-color: var(--border-strong);
    background: var(--surface-raised);
    color: var(--text);
  }

  .close-button:active,
  .reset-button:active {
    transform: scale(0.95);
  }

  .close-button svg {
    width: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.8;
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    scrollbar-gutter: stable;
    cursor: grab;
  }

  section {
    padding: 1.4rem 1.5rem 1.5rem;
  }

  section + section {
    border-top: 1px solid var(--border);
  }

  .section-heading {
    margin-bottom: 0.9rem;
  }

  .section-heading h3 {
    margin: 0;
    color: #e9edf2;
    font-size: 0.8125rem;
    font-weight: 680;
    letter-spacing: 0.01em;
    line-height: 1.4;
  }

  .section-heading p {
    margin: 0.2rem 0 0;
    color: var(--subtle);
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .layout-options {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .layout-option {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--surface);
    padding: 0.8rem 0.35rem 0.7rem;
    color: var(--muted);
    cursor: pointer;
    transition: color 150ms, border-color 150ms, background-color 150ms, transform 150ms;
  }

  .layout-option::after {
    position: absolute;
    inset: auto 0 0;
    height: 2px;
    background: var(--accent);
    content: "";
    opacity: 0;
    transform: scaleX(0.35);
    transition: opacity 150ms, transform 150ms;
  }

  .layout-option:hover,
  .sizing-option:hover {
    border-color: var(--border-strong);
    background: var(--surface-raised);
    color: var(--text);
  }

  .layout-option:active,
  .sizing-option:active,
  .direction-options button:active {
    transform: scale(0.98);
  }

  .layout-option.active,
  .sizing-option.active {
    border-color: #315b96;
    background: var(--accent-soft);
    color: var(--text);
  }

  .layout-option.active::after {
    opacity: 1;
    transform: scaleX(1);
  }

  .layout-preview {
    width: 2.5rem;
    height: 2rem;
    margin-bottom: 0.55rem;
    fill: #1e232d;
    stroke: currentColor;
    stroke-width: 1;
  }

  .option-label,
  .option-detail,
  .direction-label,
  .direction-detail {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option-label {
    font-size: 0.75rem;
    font-weight: 650;
  }

  .option-detail {
    margin-top: 0.1rem;
    color: var(--subtle);
    font-size: 0.625rem;
  }

  .layout-option.active .option-detail {
    color: #93b4e8;
  }

  .sizing-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .sizing-option {
    display: grid;
    min-height: 3.2rem;
    grid-template-columns: 1.8rem minmax(0, 1fr) 1rem;
    align-items: center;
    gap: 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.7rem;
    background: var(--surface);
    padding: 0.55rem 0.65rem;
    color: #c6ccd5;
    font-size: 0.7rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: color 140ms, border-color 140ms, background-color 140ms, transform 140ms;
  }

  .fit-icon {
    width: 1.8rem;
    height: 1.35rem;
    overflow: visible;
    fill: none;
  }

  .fit-viewport {
    stroke: #46505f;
  }

  .fit-page {
    fill: #242a34;
    stroke: #8a95a4;
  }

  .check-icon {
    width: 1rem;
    fill: none;
    stroke: var(--accent);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
    opacity: 0;
  }

  .sizing-option.active .check-icon {
    opacity: 1;
  }

  .webtoon-note {
    margin: 0.75rem 0 0;
    border-left: 2px solid #315b96;
    padding-left: 0.7rem;
    color: var(--subtle);
    font-size: 0.675rem;
    line-height: 1.55;
  }

  .direction-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: #090b0f;
    padding: 0.3rem;
  }

  .direction-options button {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.55rem;
    border: 1px solid transparent;
    border-radius: 0.55rem;
    background: transparent;
    padding: 0.55rem 0.6rem;
    color: var(--subtle);
    text-align: left;
    cursor: pointer;
    transition: color 140ms, border-color 140ms, background-color 140ms, transform 140ms;
  }

  .direction-options button:hover {
    color: #c7ced8;
  }

  .direction-options button.active {
    border-color: var(--border-strong);
    background: var(--surface-raised);
    color: var(--text);
  }

  .direction-options svg {
    width: 1.15rem;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .direction-label {
    font-size: 0.675rem;
    font-weight: 650;
  }

  .direction-detail {
    margin-top: 0.08rem;
    color: var(--subtle);
    font-size: 0.575rem;
  }

  .image-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .reset-button {
    flex: none;
    border: 1px solid #2d4770;
    border-radius: 0.5rem;
    background: #111c2d;
    padding: 0.35rem 0.65rem;
    color: #79aaf5;
    font-size: 0.65rem;
    font-weight: 650;
    cursor: pointer;
    transition: color 140ms, border-color 140ms, background-color 140ms, transform 140ms;
  }

  .reset-button:hover {
    border-color: #3d649c;
    background: #172742;
    color: #a9c8fa;
  }

  .image-controls {
    display: grid;
    gap: 1.15rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--surface);
    padding: 1rem;
  }

  .greyscale-option {
    display: grid;
    width: 100%;
    grid-template-columns: 1.25rem minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.65rem;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    padding: 0 0 0.95rem;
    color: var(--muted);
    text-align: left;
    cursor: pointer;
  }

  .greyscale-icon {
    width: 1.25rem;
    height: 1.25rem;
    fill: #272d37;
    stroke: #8c96a4;
    stroke-width: 1.35;
  }

  .greyscale-icon path {
    fill: #c9cfd7;
    stroke: none;
  }

  .greyscale-copy,
  .greyscale-label,
  .greyscale-detail {
    display: block;
    min-width: 0;
  }

  .greyscale-label {
    color: #c6ccd5;
    font-size: 0.7rem;
    font-weight: 620;
  }

  .greyscale-detail {
    margin-top: 0.08rem;
    overflow: hidden;
    color: var(--subtle);
    font-size: 0.6rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .greyscale-option kbd {
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    background: #0a0c10;
    padding: 0.2rem 0.35rem;
    color: #737d8b;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.525rem;
    font-weight: 550;
    line-height: 1;
  }

  .toggle-track {
    position: relative;
    width: 1.8rem;
    height: 1rem;
    border: 1px solid #3a424e;
    border-radius: 999px;
    background: #242a33;
    transition: border-color 140ms, background-color 140ms;
  }

  .toggle-thumb {
    position: absolute;
    top: 0.125rem;
    left: 0.125rem;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 999px;
    background: #9ca5b1;
    transition: background-color 140ms, transform 140ms;
  }

  .greyscale-option:hover .greyscale-label {
    color: var(--text);
  }

  .greyscale-option.active .toggle-track {
    border-color: #3972c3;
    background: var(--accent);
  }

  .greyscale-option.active .toggle-thumb {
    background: #ffffff;
    transform: translateX(0.8rem);
  }

  .slider-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.6rem;
    color: #c6ccd5;
    font-size: 0.7rem;
    font-weight: 580;
  }

  .slider-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .control-reset {
    display: grid;
    width: 1.7rem;
    height: 1.7rem;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: 0.35rem;
    background: transparent;
    padding: 0;
    color: #7d8795;
    cursor: pointer;
    transition: color 140ms, background-color 140ms;
  }

  .control-reset:hover:not(:disabled) {
    background: #202630;
    color: #d8dde5;
  }

  .control-reset:disabled {
    color: #505967;
    cursor: default;
  }

  .control-reset svg {
    width: 0.9rem;
    height: 0.9rem;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .value-editor {
    display: inline-flex;
    min-width: 2.8rem;
    height: 1.5rem;
    align-items: center;
    justify-content: center;
    gap: 0.08rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: #0a0c10;
    padding: 0 0.32rem;
    transition: border-color 140ms, background-color 140ms;
  }

  .value-editor:hover {
    border-color: var(--border-strong);
  }

  .value-editor:focus-within {
    border-color: #596372;
    background: #0d1015;
  }

  .control-value {
    width: 2.15rem;
    min-width: 0;
    appearance: textfield;
    border: 0;
    outline: 0;
    background: transparent;
    box-shadow: none !important;
    color: #aeb7c4;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.625rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .control-value.with-suffix {
    text-align: right;
  }

  .control-value:focus,
  .control-value:active,
  .control-value:focus-visible {
    outline: 0;
    box-shadow: none !important;
  }

  .control-value::-webkit-inner-spin-button,
  .control-value::-webkit-outer-spin-button {
    margin: 0;
    appearance: none;
  }

  .value-suffix {
    color: #7f8997;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.625rem;
  }

  input[type="range"] {
    width: 100%;
    height: 1rem;
    margin: 0;
    appearance: none;
    border: 0;
    outline: 0;
    background: transparent;
    box-shadow: none !important;
    cursor: pointer;
  }

  input[type="range"]::-webkit-slider-runnable-track {
    height: 0.25rem;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--accent) 0 var(--range-progress),
      #303744 var(--range-progress) 100%
    );
  }

  input[type="range"]::-webkit-slider-thumb {
    width: 0.9rem;
    height: 0.9rem;
    margin-top: -0.325rem;
    appearance: none;
    border: 3px solid var(--accent);
    border-radius: 999px;
    background: #f5f7fa;
    box-shadow: 0 0 0 2px var(--surface);
    transition: transform 120ms;
  }

  input[type="range"]:hover::-webkit-slider-thumb {
    transform: scale(1.12);
  }

  button:focus-visible {
    outline: 2px solid #75a9f7;
    outline-offset: 2px;
  }

  input[type="range"]:focus,
  input[type="range"]:active,
  input[type="range"]:focus-visible {
    border-color: transparent;
    outline: none;
    box-shadow: none !important;
  }

  input[type="range"]:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px #707987;
  }

  @media (max-width: 340px) {
    section,
    .settings-header {
      padding-right: 1rem;
      padding-left: 1rem;
    }

    .option-detail {
      display: none;
    }

    .greyscale-option kbd {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reader-settings *,
    .reader-settings *::before,
    .reader-settings *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
    }
  }
</style>
