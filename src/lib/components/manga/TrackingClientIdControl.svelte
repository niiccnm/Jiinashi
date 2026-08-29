<script lang="ts">
  import { onDestroy } from "svelte";
  import Dialog from "../Dialog.svelte";
  import { toasts } from "../../stores/toast";
  import type { TrackingProvider } from "../../../../electron/preload/types";

  let {
    service,
    label,
    onChanged,
  }: {
    service: TrackingProvider;
    label: string;
    onChanged: () => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let value = $state("");
  let hasCustomValue = $state(false);
  let status = $state("");
  let statusTone = $state<"neutral" | "success" | "error">("neutral");
  let loading = $state(false);
  let showClientId = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let commitInFlight = false;
  let queuedClientId: string | null = null;
  let destroyed = false;
  const registrationUrl = $derived(
    service === "anilist"
      ? "https://anilist.co/settings/developer"
      : "https://myanimelist.net/apiconfig",
  );

  function isValid(candidate: string) {
    return /^[^\s\p{C}]{1,256}$/u.test(candidate);
  }

  async function showDialog() {
    showClientId = false;
    open = true;
    loading = true;
    status = "Loading...";
    statusTone = "neutral";
    try {
      value = await window.electronAPI.manga.getTrackingCustomClientId(service);
      hasCustomValue = Boolean(value);
      status = hasCustomValue ? "Custom ID saved" : "Using bundled default";
    } catch (loadError) {
      console.error(`Failed to load ${label} client ID settings:`, loadError);
      status = "Failed to load setting";
      statusTone = "error";
    } finally {
      loading = false;
    }
  }

  function closeDialog() {
    flushPendingSave();
    open = false;
  }

  function openRegistrationPage() {
    void window.electronAPI.utils.openExternal(registrationUrl);
  }

  function scheduleSave(nextValue: string) {
    value = nextValue;
    statusTone = "neutral";
    if (saveTimer) clearTimeout(saveTimer);

    const normalized = nextValue.trim();
    if (!normalized) {
      if (hasCustomValue || commitInFlight) {
        status = "Waiting to reset...";
        saveTimer = setTimeout(() => void commitClientId(""), 650);
      } else {
        status = "Using bundled default";
      }
      return;
    }
    if (!isValid(normalized)) {
      status = "Use 1–256 characters without spaces";
      statusTone = "error";
      return;
    }

    status = "Waiting to save...";
    saveTimer = setTimeout(() => void commitClientId(normalized), 650);
  }

  function flushPendingSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;

    const normalized = value.trim();
    if (!normalized) {
      if (hasCustomValue || commitInFlight) void commitClientId("");
    } else if (isValid(normalized)) {
      void commitClientId(normalized);
    }
  }

  async function commitClientId(requestedClientId: string) {
    saveTimer = null;
    if (commitInFlight) {
      queuedClientId = requestedClientId;
      return;
    }

    commitInFlight = true;
    let currentClientId: string | null = requestedClientId;
    while (currentClientId !== null) {
      queuedClientId = null;
      const resetting = !currentClientId;
      if (value.trim() === currentClientId) {
        status = resetting ? "Resetting..." : "Saving...";
        statusTone = "neutral";
      }

      try {
        const savedClientId = resetting
          ? await window.electronAPI.manga.resetTrackingCustomClientId(service)
          : await window.electronAPI.manga.setTrackingCustomClientId(
              service,
              currentClientId,
            );
        if (!destroyed) {
          hasCustomValue = Boolean(savedClientId);
          await onChanged();
        }

        if (
          !destroyed &&
          queuedClientId === null &&
          value.trim() === currentClientId
        ) {
          value = savedClientId;
          status = resetting ? "Using bundled default" : "Custom ID saved";
          statusTone = "success";
          toasts.add(
            resetting
              ? `${label} client ID reset to default`
              : `${label} client ID updated`,
            "success",
          );
        }
      } catch (commitError) {
        console.error(`Failed to update ${label} client ID:`, commitError);
        if (!destroyed && value.trim() === currentClientId) {
          status =
            commitError instanceof Error
              ? commitError.message
              : "Failed to update client ID";
          statusTone = "error";
        }
      }

      currentClientId = queuedClientId;
    }
    commitInFlight = false;
  }

  function resetToDefault() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    showClientId = false;
    value = "";
    status = "Resetting...";
    statusTone = "neutral";
    void commitClientId("");
  }

  onDestroy(() => {
    destroyed = true;
    flushPendingSave();
  });
</script>

<button
  type="button"
  onclick={showDialog}
  class="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-400 transition-colors hover:bg-white/[0.07] hover:text-slate-200 active:scale-95"
  aria-label={`${label} client ID settings`}
  title={`${label} client ID settings`}
>
  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9.6 3.3h4.8l.6 2.1c.5.2 1 .5 1.4.8l2.1-.6 2.4 4.2-1.5 1.5v1.6l1.5 1.5-2.4 4.2-2.1-.6c-.4.3-.9.6-1.4.8l-.6 2.1H9.6L9 18.8c-.5-.2-1-.5-1.4-.8l-2.1.6-2.4-4.2 1.5-1.5v-1.6L3.1 9.8l2.4-4.2 2.1.6c.4-.3.9-.6 1.4-.8l.6-2.1Z" />
    <circle cx="12" cy="12.1" r="3" />
  </svg>
</button>

<Dialog
  {open}
  title={`${label} Client ID`}
  description="Leave this empty to use the client ID bundled with Jiinashi. A custom ID saves automatically."
  confirmText=""
  onConfirm={() => {}}
  onCancel={closeDialog}
>
  <div class="space-y-2">
    <label for={`${service}-client-id`} class="ml-1 text-xs font-semibold text-slate-400">
      Custom client ID
    </label>
    <div class="relative">
      <input
        id={`${service}-client-id`}
        type={showClientId ? "text" : "password"}
        {value}
        readonly={loading}
        oninput={(event) => scheduleSave(event.currentTarget.value)}
        placeholder="Use bundled default"
        autocomplete="off"
        spellcheck="false"
        class="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 pr-20 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500/50 read-only:cursor-wait"
      />
      <div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
        <button
          type="button"
          onclick={() => (showClientId = !showClientId)}
          disabled={loading || !value}
          class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={showClientId ? `Hide ${label} client ID` : `Show ${label} client ID`}
          aria-pressed={showClientId}
          title={showClientId ? "Hide client ID" : "Show client ID"}
        >
          {#if showClientId}
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="m4 4 16 16M10.7 10.7a2 2 0 0 0 2.6 2.6M9.9 5.2A10.9 10.9 0 0 1 12 5c5.5 0 9 7 9 7a16.4 16.4 0 0 1-2.1 3.1M6.2 6.2C4.1 7.7 3 10 3 12c0 0 3.5 7 9 7 1.2 0 2.3-.3 3.3-.8" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          {/if}
        </button>
        <button
          type="button"
          onclick={resetToDefault}
          disabled={loading || (!hasCustomValue && !value.trim())}
          class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Reset ${label} client ID to default`}
          title="Reset to bundled default"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.9 8.5A8 8 0 1 1 4 14m.9-5.5H9m-4.1 0V4.4" />
          </svg>
        </button>
      </div>
    </div>
    <p
      class={`ml-1 text-xs font-medium ${statusTone === "error"
        ? "text-rose-400"
        : statusTone === "success"
          ? "text-emerald-400"
          : "text-slate-500"}`}
    >
      {status}
    </p>
    <button
      type="button"
      onclick={openRegistrationPage}
      class="ml-1 inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 transition-colors hover:text-blue-300 focus:outline-none focus-visible:underline"
    >
      Create a client ID on {service === "mal" ? "MAL" : label}
      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M14 5h5v5m0-5-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </svg>
    </button>
  </div>
</Dialog>
