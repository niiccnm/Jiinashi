<script lang="ts">
  import { slide, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  interface Friend {
    name: string;
    avatar_url?: string;
    profile_url?: string;
    chapter: number;
    service?: "mal" | "anilist";
    status?: string;
  }

  interface Props {
    friends: Friend[];
    onFriendClick?: (friend: Friend) => void;
  }

  let { friends = [], onFriendClick }: Props = $props();
  let isExpanded = $state(false);

  const displayLimit = 5;
  const visibleFriends = $derived(friends.slice(0, displayLimit));
  const remainingCount = $derived(Math.max(0, friends.length - displayLimit));

  function serviceLabel(service?: "mal" | "anilist") {
    return service === "mal" ? "MAL" : "AniList";
  }
</script>

<div class="flex flex-col">
  {#if friends.length > 0}
    <div in:fade={{ duration: 250 }} class="flex items-center gap-4">
      <!-- Avatar Stack -->
      <div class="flex items-center p-1">
        <div class="flex -space-x-3.5">
          {#each visibleFriends as friend, i}
            <span
              class="friend-avatar group/avatar relative inline-flex h-10 w-10 hover:z-30 focus-within:z-30"
              style="z-index: {displayLimit - i}"
            >
              <button
                type="button"
                aria-label={`Open ${friend.name}'s profile`}
                class="inline-block h-10 w-10 overflow-hidden rounded-full bg-slate-800 ring-2 ring-slate-950 transition-transform group-hover/avatar:-translate-y-1 group-focus-within/avatar:-translate-y-1"
                onclick={() => onFriendClick?.(friend)}
              >
                {#if friend.avatar_url}
                  <img
                    src={friend.avatar_url}
                    alt=""
                    class="h-full w-full object-cover transition-transform group-hover/avatar:scale-110"
                  />
                {:else}
                  <div
                    class="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-800 text-xs font-black uppercase text-slate-200"
                  >
                    {friend.name.slice(0, 1)}
                  </div>
                {/if}
              </button>

              <span
                role="tooltip"
                class="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg border border-white/10 bg-slate-950/95 px-2.5 py-1.5 text-[11px] font-bold text-slate-100 opacity-0 shadow-xl backdrop-blur-sm transition-all duration-150 group-hover/avatar:translate-y-0 group-hover/avatar:opacity-100 group-focus-within/avatar:translate-y-0 group-focus-within/avatar:opacity-100"
              >
                {friend.name}
                <span
                  class="absolute left-1/2 top-full h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-slate-950/95"
                ></span>
              </span>
            </span>
          {/each}

          {#if friends.length > 1 || (friends.length === 1 && remainingCount > 0)}
            <button
              onclick={() => (isExpanded = !isExpanded)}
              class="flex h-10 items-center justify-center rounded-full border border-white/5 bg-slate-900 px-4 text-[11px] font-black text-slate-400 hover:text-white hover:bg-slate-800 hover:border-white/10 transition-all z-0 ml-2 group"
            >
              {#if !isExpanded}
                <span class="tracking-widest uppercase">
                  {friends.length} Reading
                </span>
                <svg
                  class="w-3 h-3 ml-2 text-slate-500 group-hover:text-blue-400 transition-colors"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="3"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              {:else}
                <span class="tracking-widest uppercase text-blue-400"
                  >Close</span
                >
                <svg
                  class="w-3 h-3 ml-2 text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="3"
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              {/if}
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if isExpanded}
    <div
      transition:slide={{ duration: 280, easing: cubicOut }}
      class="mt-4 overflow-hidden py-4"
    >
      <div
        class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-3 p-4 bg-slate-900/60 rounded-3xl border border-white/5 shadow-lg relative overflow-hidden"
      >
        {#each friends as friend}
          <button
            type="button"
            class="group flex flex-col gap-4 p-4 rounded-2xl bg-slate-900/40 border border-white/[0.03] hover:bg-white/[0.02] transition-all duration-300 text-left relative overflow-hidden active:scale-[0.98]"
            onclick={() => onFriendClick?.(friend)}
          >
            <div class="flex items-center gap-3">
              <div class="relative">
                {#if friend.avatar_url}
                  <img
                    src={friend.avatar_url}
                    alt={friend.name}
                    class="h-10 w-10 rounded-xl object-cover ring-1 ring-white/10 transition-all"
                  />
                {:else}
                  <div
                    class="h-10 w-10 rounded-xl bg-slate-800 text-sm font-black text-slate-400 flex items-center justify-center uppercase ring-1 ring-white/10"
                  >
                    {friend.name.slice(0, 1)}
                  </div>
                {/if}

                <!-- Service Badge -->
                {#if friend.service}
                  <div
                    class="absolute -bottom-1 -right-1 w-4 h-4 bg-slate-950 rounded-md border border-white/10 flex items-center justify-center p-0.5 shadow-lg"
                  >
                    {#if friend.service === "mal"}
                      <img
                        src="https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://myanimelist.net&size=32"
                        alt="MAL"
                        class="w-full h-full rounded-[1px]"
                      />
                    {:else}
                      <img
                        src="https://anilist.co/img/icons/favicon-32x32.png"
                        alt="AL"
                        class="w-full h-full"
                      />
                    {/if}
                  </div>
                {/if}
              </div>

              <div class="flex flex-col min-w-0">
                <span
                  class="text-sm font-bold text-slate-200 truncate group-hover:text-white transition-colors"
                >
                  {friend.name}
                </span>
                <span
                  class="text-[9px] font-black uppercase tracking-widest text-slate-500 group-hover:text-slate-400 transition-colors"
                >
                  {serviceLabel(friend.service)}
                </span>
              </div>
            </div>

            <div class="flex items-end justify-between mt-auto">
              <div class="flex flex-col">
                <span
                  class="text-[9px] font-black text-slate-600 uppercase tracking-tighter leading-none"
                  >PROGRESS</span
                >
                <span class="text-xs font-black text-blue-400 leading-none"
                  >CHAPTER {friend.chapter}</span
                >
              </div>

              <div
                class="flex items-center gap-1.5 size-6 rounded-lg bg-white/[0.03] group-hover:bg-white/[0.05] items-center justify-center transition-colors"
              >
                <svg
                  class="w-3 h-3 text-slate-600 group-hover:text-blue-400 transition-colors"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="3"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </div>
            </div>

            <!-- Hover Accent Line -->
            <div
              class="absolute bottom-0 left-0 h-[2px] w-0 bg-blue-500 transition-all duration-300 group-hover:w-full"
            ></div>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .friend-avatar:hover,
  .friend-avatar:focus-within {
    z-index: 30 !important;
  }
</style>
