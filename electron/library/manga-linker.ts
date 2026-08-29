export {
  type MangaLinkResolveInput,
  type MangaLinkCandidate,
  type MangaLinkResolveResult,
  type PendingMangaLinkItem,
  type PendingMangaLinkGroup,
  type DeferredMangaLinkStats,
  type MangaLinkHealResult,
} from "./manga-linker/contracts";

export { inferMangaLinkTitle } from "./manga-linker/title-utils";

export {
  deriveScanSeriesAnchorFolder,
  deriveSeriesAnchorFromScanRoot,
  deriveStructuralScopeRootForFile,
  resolvePendingScopeRootPathForFile,
  buildPendingMangaLinkGroups,
} from "./manga-linker/scope-utils";

export {
  resolveCandidates,
  applyMangaIdBinding,
  resolveMangaIdForGroup,
  resolvePendingMangaLinkGroups,
} from "./manga-linker/resolution-core";

export {
  enqueueDeferredMangaLinkResolution,
  resumeDeferredMangaLinkResolution,
  clearDeferredMangaLinkResolution,
} from "./manga-linker/deferred-queue";

export { healContaminatedSeriesLinksForRoot } from "./manga-linker/healer";
