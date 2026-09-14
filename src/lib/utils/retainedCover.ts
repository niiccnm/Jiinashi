type CoverOptions = {
  src: string;
  alt: string;
  className: string;
  style: string;
  loading: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
};

// Keep a bounded set of detached, loaded covers for filter and search changes.
// Versioned URLs prevent a replaced cover from reusing an older image.
const covers = new Map<string, HTMLImageElement>();
const MAX_RETAINED_COVERS = 64;

// Warm resources ahead of scrolling without mounting cards or starting their motion.
export function prefetchCovers(loader: HTMLElement, sources: (string | null)[]) {
  const images: HTMLImageElement[] = [];
  let stopped = false;
  const observer = new IntersectionObserver((entries) => {
    if (stopped || !entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    stopped = true;
    for (const src of [...new Set(sources.filter((src): src is string => !!src))].slice(0, 50)) {
      const image = new Image();
      image.fetchPriority = "low";
      image.src = src;
      images.push(image);
      void image.decode().catch(() => {});
    }
  }, { root: loader.parentElement, rootMargin: "500px" });
  observer.observe(loader);
  return () => {
    stopped = true;
    observer.disconnect();
    images.length = 0;
  };
}

function release(src: string, image: HTMLImageElement) {
  image.remove();
  if (!image.complete || image.naturalWidth === 0) return;
  covers.delete(src);
  covers.set(src, image);
  while (covers.size > MAX_RETAINED_COVERS) {
    covers.delete(covers.keys().next().value!);
  }
}

export function retainedCover(node: HTMLElement, options: CoverOptions) {
  let image: HTMLImageElement;

  function attach() {
    image = covers.get(options.src) ?? new Image();
    covers.delete(options.src);
    apply();
    image.draggable = false;
    image.decoding = "sync";
    // A retained element already owns its loaded image resource.
    if (image.getAttribute("src") !== options.src) image.src = options.src;
    node.appendChild(image);
  }

  function apply(previous?: CoverOptions) {
    // Reused images need all attributes set; mounted images need only changed values.
    if (!previous || previous.alt !== options.alt) image.alt = options.alt;
    if (!previous || previous.className !== options.className) image.className = options.className;
    if (!previous || previous.style !== options.style) image.style.cssText = options.style;
    if (!previous || previous.loading !== options.loading) image.loading = options.loading;
    const priority = options.fetchPriority ?? "auto";
    if (!previous || (previous.fetchPriority ?? "auto") !== priority) image.fetchPriority = priority;
  }

  attach();
  return {
    update(next: CoverOptions) {
      if (next.src !== options.src) {
        release(options.src, image);
        options = next;
        attach();
      } else {
        const previous = options;
        options = next;
        apply(previous);
      }
    },
    destroy() {
      release(options.src, image);
    },
  };
}
