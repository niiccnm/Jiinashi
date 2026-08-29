import {
  DEFERRED_LINKER_CONCURRENCY,
  DEFERRED_LINKER_MIN_INTERVAL_MS,
  DEFERRED_RATE_LIMIT_JITTER_MS,
  DEFERRED_TRANSIENT_RETRY_BASE_MS,
  DEFERRED_TRANSIENT_RETRY_MAX_MS,
  type DeferredMangaLinkStats,
  type PendingMangaLinkGroup,
  type ResolveMode,
  isRetryableMangaLinkError,
  toPositiveInt,
} from "./contracts";
import { getItemById, getSetting, setSetting } from "../../database/database";
import { resolveMangaIdForGroup } from "./resolution-core";
import {
  buildDeferredDedupeKey,
  isPendingGroupHomogeneous,
  mergeDeferredJobGroup,
  normalizePendingGroup,
  splitPendingGroupByRootAndAnchor,
} from "./scope-utils";

type DeferredResolutionJob = {
  dedupeKey: string;
  group: PendingMangaLinkGroup;
  mode: ResolveMode;
  retryCount: number;
  revision: number;
  hooks: Array<(itemIds: number[]) => void>;
};

const deferredJobsByKey = new Map<string, DeferredResolutionJob>();
const deferredQueue: DeferredResolutionJob[] = [];
let deferredQueueActive = 0;
let lastDeferredJobStartedAtMs = 0;
let hasRestoredDeferredJobs = false;

const DEFERRED_JOBS_SETTING_KEY = "mangaLinkerDeferredJobsV1";

function persistDeferredJobs() {
  const groups = Array.from(deferredJobsByKey.values()).map((job) => job.group);
  try {
    setSetting(DEFERRED_JOBS_SETTING_KEY, JSON.stringify(groups));
  } catch (error) {
    console.warn("[MangaLinker][Deferred] Failed to persist queue:", error);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function getDeferredRetry(error: unknown, retryCount: number) {
  const retryAfterMs = toPositiveInt((error as any)?.retryAfterMs);
  const status = toPositiveInt(
    (error as any)?.status || (error as any)?.response?.status,
  );
  if (Boolean((error as any)?.isAniListRateLimitError) || status === 429) {
    return { delayMs: retryAfterMs || 30000, reason: "rate-limited" };
  }
  if (!isRetryableMangaLinkError(error)) return null;
  const delayMs = Math.min(
    DEFERRED_TRANSIENT_RETRY_MAX_MS,
    DEFERRED_TRANSIENT_RETRY_BASE_MS * 2 ** Math.min(retryCount, 6),
  );
  return { delayMs, reason: "transient failure" };
}

function pruneResolvedOrMissingItems(
  group: PendingMangaLinkGroup,
): PendingMangaLinkGroup | null {
  const items = group.itemIds.flatMap((itemId) => {
    const item = getItemById(itemId);
    return item &&
      item.type !== "folder" &&
      toPositiveInt(item.manga_series_id) === 0 &&
      String(item.manga_preference || "").toLowerCase() !== "force_non_manga"
      ? [item]
      : [];
  });
  if (items.length === 0) return null;
  return {
    ...group,
    itemIds: items.map(({ id }) => id),
    itemPaths: items.map(({ path }) => path),
  };
}

function processDeferredQueue() {
  if (
    deferredQueueActive >= DEFERRED_LINKER_CONCURRENCY ||
    deferredQueue.length === 0
  ) return;

  while (
    deferredQueueActive < DEFERRED_LINKER_CONCURRENCY &&
    deferredQueue.length > 0
  ) {
    const job = deferredQueue.shift()!;
    deferredQueueActive += 1;
    void (async () => {
      let keepJobQueued = false;
      let processedRevision = job.revision;
      try {
        await delay(
          lastDeferredJobStartedAtMs +
            DEFERRED_LINKER_MIN_INTERVAL_MS -
            Date.now(),
        );
        lastDeferredJobStartedAtMs = Date.now();
        processedRevision = job.revision;
        const normalizedGroup = normalizePendingGroup(job.group);
        const pendingGroup = normalizedGroup
          ? pruneResolvedOrMissingItems(normalizedGroup)
          : null;
        if (!pendingGroup) return;
        job.group = pendingGroup;
        const scopedGroups = isPendingGroupHomogeneous(pendingGroup)
          ? [pendingGroup]
          : splitPendingGroupByRootAndAnchor(pendingGroup);

        const resolvedBoundIds: number[] = [];
        const statusSummary = new Map<string, number>();
        for (const scopedGroup of scopedGroups) {
          const result = await resolveMangaIdForGroup({
            mode: job.mode,
            groupKey: scopedGroup.groupKey,
            folderPath: scopedGroup.folderPath,
            itemIds: scopedGroup.itemIds,
            itemPaths: scopedGroup.itemPaths,
            preferredTitle: scopedGroup.preferredTitle,
            titleCandidates: scopedGroup.titleCandidates,
            scanSessionId: scopedGroup.scanSessionId,
            scanRootPath: scopedGroup.scanRootPath,
            seriesAnchorPath: scopedGroup.seriesAnchorPath,
          });
          statusSummary.set(
            result.status,
            (statusSummary.get(result.status) || 0) + 1,
          );
          if (result.status === "resolved" && result.seriesId) {
            resolvedBoundIds.push(...scopedGroup.itemIds);
          }
        }

        const uniqueBoundIds = Array.from(new Set(resolvedBoundIds));
        if (uniqueBoundIds.length > 0) {
          for (const hook of job.hooks) hook(uniqueBoundIds);
        }
        job.retryCount = 0;
        console.log(
          `[MangaLinker][Deferred] done session=${job.group.scanSessionId || "none"} root=${job.group.scanRootPath || "none"} group=${job.group.groupKey} bound=${uniqueBoundIds.length} statuses=${JSON.stringify(Object.fromEntries(statusSummary.entries()))}`,
        );
      } catch (error) {
        const retry = getDeferredRetry(error, job.retryCount);
        if (retry) {
          job.retryCount += 1;
          const jitterMs = Math.floor(Math.random() * DEFERRED_RATE_LIMIT_JITTER_MS);
          const delayMs = Math.max(1000, retry.delayMs + jitterMs);
          persistDeferredJobs();
          console.warn(
            `[MangaLinker][Deferred] ${retry.reason}; queue paused session=${job.group.scanSessionId || "none"} root=${job.group.scanRootPath || "none"} group=${job.group.groupKey} retry=${job.retryCount} delayMs=${delayMs}`,
          );
          await delay(delayMs);
          keepJobQueued = deferredJobsByKey.get(job.dedupeKey) === job;
          if (keepJobQueued) deferredQueue.unshift(job);
          return;
        }
        console.error(
          `[MangaLinker][Deferred] failed group=${job.group.groupKey}:`,
          error,
        );
      } finally {
        const isCurrentJob = deferredJobsByKey.get(job.dedupeKey) === job;
        const receivedNewWork = processedRevision !== job.revision;
        if (isCurrentJob && (keepJobQueued || receivedNewWork)) {
          keepJobQueued = true;
          if (!deferredQueue.includes(job)) deferredQueue.push(job);
          persistDeferredJobs();
        } else if (isCurrentJob) {
          deferredJobsByKey.delete(job.dedupeKey);
          persistDeferredJobs();
        }
        deferredQueueActive = Math.max(0, deferredQueueActive - 1);
        processDeferredQueue();
      }
    })();
  }
}

export function enqueueDeferredMangaLinkResolution(
  groups: PendingMangaLinkGroup[],
  options?: {
    mode?: ResolveMode;
    onItemsBound?: (itemIds: number[]) => void;
  },
): DeferredMangaLinkStats {
  const mode: ResolveMode = options?.mode || "scan_deferred";
  let queued = 0;
  let deduped = 0;
  for (const rawGroup of groups) {
    const normalized = normalizePendingGroup(rawGroup);
    if (!normalized || !normalized.groupKey) continue;
    const dedupeKey = buildDeferredDedupeKey(normalized);
    const existing = deferredJobsByKey.get(dedupeKey);
    if (existing) {
      existing.group = mergeDeferredJobGroup(existing.group, normalized);
      existing.revision += 1;
      if (options?.onItemsBound) {
        existing.hooks.push(options.onItemsBound);
      }
      deduped += 1;
      continue;
    }
    const job: DeferredResolutionJob = {
      dedupeKey,
      group: normalized,
      mode,
      retryCount: 0,
      revision: 0,
      hooks: options?.onItemsBound ? [options.onItemsBound] : [],
    };
    deferredJobsByKey.set(dedupeKey, job);
    deferredQueue.push(job);
    queued += 1;
  }
  if (queued > 0 || deduped > 0) persistDeferredJobs();
  if (queued > 0 || deduped > 0) {
    console.log(
      `[MangaLinker][Deferred] enqueue queued=${queued} deduped=${deduped} active=${deferredQueueActive} backlog=${deferredQueue.length}`,
    );
  }
  processDeferredQueue();
  return { queued, deduped };
}

export function resumeDeferredMangaLinkResolution(options?: {
  onItemsBound?: (itemIds: number[]) => void;
}): DeferredMangaLinkStats {
  if (hasRestoredDeferredJobs) return { queued: 0, deduped: 0 };
  hasRestoredDeferredJobs = true;

  let groups: PendingMangaLinkGroup[] = [];
  try {
    const parsed = JSON.parse(getSetting(DEFERRED_JOBS_SETTING_KEY) || "[]");
    groups = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[MangaLinker][Deferred] Failed to restore queue:", error);
    persistDeferredJobs();
    return { queued: 0, deduped: 0 };
  }

  const stats = enqueueDeferredMangaLinkResolution(groups, {
    onItemsBound: options?.onItemsBound,
  });
  persistDeferredJobs();
  if (stats.queued > 0) console.log(`[MangaLinker][Deferred] restored=${stats.queued}`);
  return stats;
}

export function clearDeferredMangaLinkResolution() {
  deferredJobsByKey.clear();
  deferredQueue.length = 0;
  persistDeferredJobs();
}
