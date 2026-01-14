<script lang="ts">
  import { slide } from 'svelte/transition'

  interface Props {
    show: boolean
    viewMode: 'single' | 'double' | 'webtoon'
    fitMode: 'width' | 'height' | 'contain' | 'fill'
    mangaMode: boolean
    brightness: number
    contrast: number
    gamma: number
    onClose: () => void
    onUpdateSettings: (settings: any) => void
  }

  let { 
    show, 
    viewMode, 
    fitMode, 
    mangaMode,
    brightness,
    contrast,
    gamma,
    onClose,
    onUpdateSettings
  }: Props = $props()

  function update(key: string, value: any) {
    onUpdateSettings({ [key]: value })
  }
</script>

{#if show}
  <div 
    transition:slide={{ axis: 'x', duration: 200 }}
    class="absolute top-0 right-0 bottom-0 w-80 bg-gray-900/95 backdrop-blur-xl border-l border-white/10 z-40 shadow-2xl flex flex-col"
  >
    <div class="p-5 border-b border-white/10 flex justify-between items-center">
      <h2 class="text-lg font-semibold text-white">Reader Settings</h2>
      <button onclick={onClose} class="text-gray-400 hover:text-white transition-colors" aria-label="Close Settings">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-5 space-y-8">
      
      <!-- View Mode -->
      <div class="space-y-3">
        <h3 class="text-xs uppercase tracking-wider text-gray-400 font-semibold">View Mode</h3>
        <div class="grid grid-cols-3 gap-2">
          <button 
            class="p-2 rounded-lg text-sm border {viewMode === 'single' ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'}"
            onclick={() => update('viewMode', 'single')}
          >
            Single
          </button>
          <button 
            class="p-2 rounded-lg text-sm border {viewMode === 'double' ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'}"
            onclick={() => update('viewMode', 'double')}
          >
            Double
          </button>
          <button 
            class="p-2 rounded-lg text-sm border {viewMode === 'webtoon' ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'}"
            onclick={() => update('viewMode', 'webtoon')}
          >
            Webtoon
          </button>
        </div>
      </div>

      <!-- Fit Mode -->
      {#if viewMode !== 'webtoon'}
      <div class="space-y-3">
        <h3 class="text-xs uppercase tracking-wider text-gray-400 font-semibold">Scale Mode</h3>
        <div class="grid grid-cols-2 gap-2">
           <button 
            class="p-2 rounded-lg text-sm border {fitMode === 'contain' ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'}"
            onclick={() => update('fitMode', 'contain')}
          >
            Best Fit
          </button>
          <button 
            class="p-2 rounded-lg text-sm border {fitMode === 'width' ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'}"
            onclick={() => update('fitMode', 'width')}
          >
            Fit Width
          </button>
          <button 
            class="p-2 rounded-lg text-sm border {fitMode === 'height' ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'}"
            onclick={() => update('fitMode', 'height')}
          >
            Fit Height
          </button>
          <button 
            class="p-2 rounded-lg text-sm border {fitMode === 'fill' ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'}"
            onclick={() => update('fitMode', 'fill')}
          >
            Stretch
          </button>
        </div>
      </div>
      {/if}

      <!-- Page Direction -->
      {#if viewMode !== 'webtoon'}
      <div class="space-y-3">
         <h3 class="text-xs uppercase tracking-wider text-gray-400 font-semibold">Reading Direction</h3>
         <div class="flex items-center justify-between bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <span class="text-sm text-gray-300">RTL (Manga Mode)</span>
            <button 
              class="w-12 h-6 rounded-full transition-colors relative {mangaMode ? 'bg-blue-600' : 'bg-gray-600'}"
              onclick={() => update('mangaMode', !mangaMode)}
              aria-label="Toggle RTL Mode"
            >
              <div class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform {mangaMode ? 'translate-x-6' : 'translate-x-0'}"></div>
            </button>
         </div>
         <p class="text-xs text-gray-500 px-1">Enables Right-to-Left reading order.</p>
      </div>
      {/if}

      <!-- Image Adjustments -->
      <div class="space-y-4">
        <div class="flex justify-between items-center">
             <h3 class="text-xs uppercase tracking-wider text-gray-400 font-semibold">Image Display</h3>
             <button 
                class="text-xs text-blue-400 hover:text-blue-300"
                onclick={() => { update('brightness', 100); update('contrast', 100); update('gamma', 100); }}
             >
                Reset
             </button>
        </div>
        
        <div class="space-y-1">
            <div class="flex justify-between text-xs text-gray-400">
                <span>Brightness</span>
                <span>{brightness}%</span>
            </div>
            <input 
              type="range" min="50" max="150" step="1" 
              value={brightness}
              oninput={(e) => update('brightness', parseInt(e.currentTarget.value))}
              class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
        </div>

        <div class="space-y-1">
            <div class="flex justify-between text-xs text-gray-400">
                <span>Contrast</span>
                <span>{contrast}%</span>
            </div>
            <input 
              type="range" min="50" max="150" step="1" 
              value={contrast}
              oninput={(e) => update('contrast', parseInt(e.currentTarget.value))}
              class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
        </div>
        
        <div class="space-y-1">
            <div class="flex justify-between text-xs text-gray-400">
                <span>Gamma</span>
                <span>{gamma / 100}</span>
            </div>
            <input 
              type="range" min="50" max="150" step="1" 
              value={gamma}
              oninput={(e) => update('gamma', parseInt(e.currentTarget.value))}
              class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
        </div>
      </div>

    </div>
    
    <div class="p-4 border-t border-white/10 text-xs text-gray-500 text-center">
        Jiinashi Reader v1.0
    </div>
  </div>
{/if}
