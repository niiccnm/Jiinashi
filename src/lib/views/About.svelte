<script lang="ts">
  import { onMount } from "svelte";
  import Dialog from "../components/Dialog.svelte";

  interface Props {
    open: boolean;
    onCancel: () => void;
  }

  let { open, onCancel }: Props = $props();
  let version = $state("...");

  const githubUrl = "https://github.com/niiccnm/Jiinashi";
  const kofiUrl = "https://ko-fi.com/niiccnm";

  onMount(async () => {
    version = await window.electronAPI.utils.getVersion();
  });

  function openExternal(url: string) {
    window.electronAPI.utils.openExternal(url);
  }

  // Update Logic
  type UpdateStatus =
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";

  const isDev = window.electronAPI.env.isDev;

  let updateStatus = $state<UpdateStatus>("idle");
  let newVersion = $state<string | null>(null);
  let downloadProgress = $state(0);
  let errorMessage = $state<string | null>(null);

  onMount(() => {
    // Subscribe to update status
    const unsubscribe = window.electronAPI.update.onStatusChange(
      (status: any) => {
        console.log("[About] Received update status:", status);
        updateStatus = status.status;
        if (status.status === "available") {
          newVersion = status.version;
        } else if (status.status === "downloading") {
          downloadProgress = Math.round(status.progress);
        } else if (status.status === "error") {
          errorMessage = status.error;
        }
      }
    );

    return () => {
      unsubscribe();
    };
  });

  async function checkForUpdates() {
    updateStatus = "checking";
    errorMessage = null;
    try {
      await window.electronAPI.update.check();
    } catch (e) {
      updateStatus = "error";
      errorMessage = "Failed to check for updates";
    }
  }

  function downloadUpdate() {
    window.electronAPI.update.download();
  }

  function installUpdate() {
    window.electronAPI.update.install();
  }

  function runTest() {
    // Reset state for clean test
    updateStatus = "idle";
    downloadProgress = 0;

    // Simulate flow
    window.electronAPI.update.testEvent("available");
    setTimeout(() => {
      window.electronAPI.update.testEvent("downloading");
    }, 500); // 500ms is enough to see the available state but fast enough for a demo
  }
</script>

<Dialog
  {open}
  title=""
  description=""
  confirmText=""
  variant="neutral"
  maxWidth="max-w-xl"
  onConfirm={onCancel}
  {onCancel}
>
  <div class="px-2 pb-6 space-y-4">
    <!-- Hero Section -->
    <div class="text-center space-y-4">
      <div class="relative inline-block">
        <img
          src="logo.svg"
          alt="Jiinashi Logo"
          class="w-24 h-24 mx-auto drop-shadow-xl"
        />
      </div>

      <div class="space-y-1">
        <h2 class="text-3xl font-black text-white tracking-tight">Jiinashi</h2>
        <button
          class="text-sm text-slate-400 font-mono transition-colors {isDev
            ? 'hover:text-white cursor-pointer'
            : 'cursor-default'}"
          title={isDev ? "Click to test update UI" : ""}
          onclick={() => isDev && runTest()}
        >
          v{version}
        </button>
      </div>

      <p class="text-slate-400 text-base max-w-sm mx-auto leading-relaxed">
        A local library manager and reader for <span class="text-slate-200"
          >Doujinshi</span
        >
        and <span class="text-slate-200">Manga</span>.
      </p>
    </div>

    <!-- Actions Section -->
    <div class="grid grid-cols-2 gap-4">
      <!-- GitHub Button -->
      <button
        onclick={() => openExternal(githubUrl)}
        class="group relative flex items-center justify-center gap-3 p-6 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-blue-500/30 rounded-2xl transition-all duration-300 active:scale-95"
      >
        <svg
          class="w-8 h-8 text-slate-400 group-hover:text-white transition-colors"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
          />
        </svg>
        <div class="text-left">
          <span class="block text-sm font-bold text-white">GitHub Repo</span>
          <span class="block text-xs text-slate-500">Source code & issues</span>
        </div>
      </button>

      <!-- Ko-fi Button -->
      <button
        onclick={() => openExternal(kofiUrl)}
        class="group relative flex items-center justify-center gap-3 p-6 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-rose-500/30 rounded-2xl transition-all duration-300 active:scale-95"
      >
        <svg
          class="w-8 h-8 text-slate-400 group-hover:text-rose-400 transition-colors"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <!-- Accurate Ko-fi Cup Icon -->
          <path
            d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.724c-.304 0-.55.246-.55.55v13.475c0 .304.246.55.55.55h11.458s.721 1.054 1.154 1.543l.034.032c.67.653 1.57.994 2.503.946 3.14-.159 3.018-2.521 3.018-2.521 3.518-.17 5.067-1.477 5.86-2.523.865-1.139.628-3.378.129-4.04M18.96 15.358c-.145.474-1.288.544-1.288.544H3.94l.002-1.378h13.73s1.436-.05 1.288-.544c-.222-.746-2.491-.91-2.491-.91s2.524-.132 2.763-.822c.239-.691-2.271-1.018-2.271-1.018s2.261-.173 2.531-.837c.27-.665-2.092-1.163-2.092-1.163s2.174-.183 2.45-.886c.277-.703-2.311-1.332-2.311-1.332h1.492s3.1.281 3.733 3.82c.575 3.204-4.8 3.526-4.8 3.526s5.234.17 5.011 1.007c-.222.836-3.235.845-3.235.845s3.435.163 3.065 1.103c-.371.94-3.111.83-3.111.83s3.16.29 2.565 1.53c-.595 1.24-5.06 1.488-5.06 1.488s5.246-.071 5.37-1.166"
          />
          <!-- Heart on cup -->
          <path
            d="M12.44 10.37c-.36-.36-.94-.36-1.3 0l-.14.14-.14-.14c-.36-.36-.94-.36-1.3 0-.36.36-.36.94 0 1.3l1.44 1.44 1.44-1.44c.36-.36.36-.94 0-1.3z"
            fill="#ff5e5b"
          />
        </svg>
        <div class="text-left">
          <span class="block text-sm font-bold text-white">Donate</span>
          <span class="block text-xs text-slate-500">Support on Ko-fi</span>
        </div>
      </button>
    </div>

    <!-- Update Section -->
    <div class="flex flex-col items-center justify-center pt-2">
      {#if updateStatus === "idle" || updateStatus === "not-available"}
        <div class="flex flex-col items-center gap-2">
          <button
            onclick={checkForUpdates}
            class="text-xs font-medium text-slate-500 hover:text-white transition-colors flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/5"
          >
            {#if updateStatus === "not-available"}
              <svg
                class="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>Up to date</span>
            {:else}
              <svg
                class="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>Check for updates</span>
            {/if}
          </button>
        </div>
      {:else if updateStatus === "checking"}
        <div
          class="flex items-center justify-center gap-2 text-slate-400 py-1.5"
        >
          <svg
            class="animate-spin h-3 w-3 text-blue-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <span class="text-xs">Checking...</span>
        </div>
      {:else if updateStatus === "available"}
        <div
          class="w-full bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 flex items-center justify-between"
        >
          <span class="text-xs font-bold text-blue-200"
            >New version available: v{newVersion}</span
          >
          <button
            onclick={downloadUpdate}
            class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors"
          >
            Download
          </button>
        </div>
      {:else if updateStatus === "downloading"}
        <div class="w-full bg-slate-800/50 rounded-xl p-3 space-y-2">
          <div class="flex justify-between text-xs text-slate-400 font-medium">
            <span>Downloading...</span>
            <span>{downloadProgress}%</span>
          </div>
          <div
            class="w-full bg-slate-700/50 rounded-full h-1.5 overflow-hidden"
          >
            <div
              class="bg-blue-500 h-full transition-all duration-300 ease-out"
              style="width: {downloadProgress}%"
            ></div>
          </div>
        </div>
      {:else if updateStatus === "downloaded"}
        <div
          class="w-full bg-green-500/10 border border-green-500/20 rounded-xl p-3 flex items-center justify-between"
        >
          <span class="text-xs font-bold text-green-200">Update ready</span>
          <button
            onclick={installUpdate}
            class="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-colors"
          >
            Restart
          </button>
        </div>
      {:else if updateStatus === "error"}
        <div class="text-center">
          <p class="text-[10px] text-red-400 mb-1">{errorMessage}</p>
          <button
            onclick={checkForUpdates}
            class="text-xs text-slate-400 hover:text-white underline decoration-dotted"
          >
            Try Again
          </button>
        </div>
      {/if}
    </div>
    <div class="pt-6 border-t border-white/5">
      <p
        class="text-xs text-slate-400 text-center uppercase tracking-widest font-bold"
      >
        Developed by
        <button
          onclick={() => openExternal("https://github.com/niiccnm")}
          class="text-blue-500 hover:text-blue-400 transition-colors"
          >niiccnm</button
        >
      </p>
    </div>
  </div>
</Dialog>
