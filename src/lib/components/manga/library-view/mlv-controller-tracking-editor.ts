import type { TrackingServiceId } from "./mlv-domain-core";

export type TrackingEditorForm = {
  service: TrackingServiceId;
  label: string;
  iconUrl: string;
  remoteId: number | null;
  hasEntry: boolean;
  status: string;
  progress: string;
  volumes: string;
  score: string;
  totalChapters: number | null;
  totalVolumes: number | null;
  statusOptions: Array<{ value: string; label: string }>;
};

export type TrackingEditorField = "status" | "progress" | "volumes" | "score";

export type TrackingEditorState = {
  open: boolean;
  saving: boolean;
  removing: boolean;
  hydrating: boolean;
  syncBothSitesEnabled: boolean;
  error: string;
  service: TrackingServiceId | null;
  dirty: boolean;
  requestId: number;
  forms: Partial<Record<TrackingServiceId, TrackingEditorForm>>;
};

type TrackingEditorApi = {
  getTrackingAccounts: () => Promise<any[]>;
  getSyncBothSitesSetting: () => Promise<string | null>;
  setSyncBothSitesSetting: (enabled: boolean) => Promise<unknown>;
  updateTrackingEntry: (payload: {
    seriesId: number;
    service: TrackingServiceId;
    remoteId: number;
    chaptersRead: number;
    volumesRead: number;
    score: number | null;
    status: string;
    totalChapters: number | null;
    totalVolumes: number | null;
  }) => Promise<unknown>;
  removeTrackingEntry: (payload: {
    seriesId: number;
    service: TrackingServiceId;
    remoteId: number;
  }) => Promise<unknown>;
};

type TrackingEditorDeps = {
  state: TrackingEditorState;
  api: TrackingEditorApi;
  toasts: { add: (message: string, type?: any, duration?: number) => void };
  formatTrackingListStatus: (value: string) => string;
  getSelectedSeries: () => any;
  getActiveSelectedSeriesId: () => number | null;
  getTrackedAnilistId: () => number | null;
  getTrackedMalId: () => number | null;
  getActiveTrackingServices: () => TrackingServiceId[];
  setActiveTrackingServices: (services: TrackingServiceId[]) => void;
  getUserTrackingStatuses: () => any[];
  refreshCurrentTrackingStatus: (seriesItem?: any) => Promise<void>;
  resolveTrackingServices: (rawTrackingAccounts: any[]) => TrackingServiceId[];
};

const TRACKING_EDITOR_STATUS_OPTIONS: Record<TrackingServiceId, string[]> = {
  anilist: [
    "CURRENT",
    "PLANNING",
    "COMPLETED",
    "PAUSED",
    "DROPPED",
    "REPEATING",
  ],
  mal: ["reading", "plan_to_read", "completed", "on_hold", "dropped"],
};

function getTrackingEditorIconUrl(service: TrackingServiceId) {
  return service === "anilist"
    ? "https://anilist.co/img/icons/favicon-32x32.png"
    : "https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://myanimelist.net&size=32";
}

export function normalizeTrackingStatusValue(
  service: TrackingServiceId,
  rawStatus: unknown,
) {
  const options = TRACKING_EDITOR_STATUS_OPTIONS[service];
  const fallback = options[0] || "";
  const source = String(rawStatus || "").trim();
  if (!source) return fallback;
  const upper = source.replace(/[\s-]+/g, "_").toUpperCase();

  if (service === "anilist") {
    const map: Record<string, string> = {
      READING: "CURRENT",
      CURRENT: "CURRENT",
      PLAN_TO_READ: "PLANNING",
      PLANNING: "PLANNING",
      COMPLETED: "COMPLETED",
      ON_HOLD: "PAUSED",
      PAUSED: "PAUSED",
      DROPPED: "DROPPED",
      REREADING: "REPEATING",
      REPEATING: "REPEATING",
    };
    return map[upper] || fallback;
  }

  const map: Record<string, string> = {
    CURRENT: "reading",
    READING: "reading",
    PLAN_TO_READ: "plan_to_read",
    PLANNING: "plan_to_read",
    COMPLETED: "completed",
    PAUSED: "on_hold",
    ON_HOLD: "on_hold",
    DROPPED: "dropped",
    REREADING: "reading",
    REPEATING: "reading",
  };
  return map[upper] || fallback;
}

function normalizeProgressInput(value: string) {
  const parsed = Number(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeVolumeInput(value: string) {
  const parsed = Number(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeScoreInput(value: string) {
  const parsed = Number(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(0, Math.min(10, Number(parsed.toFixed(1))));
}

export function coerceStatusForProgress(
  service: TrackingServiceId,
  status: string,
  chaptersRead: number,
  options: { demoteOnZero?: boolean } = {},
) {
  const { demoteOnZero = true } = options;
  const normalizedStatus = normalizeTrackingStatusValue(service, status);
  const safeChaptersRead = Number.isFinite(chaptersRead)
    ? Math.max(0, Math.floor(chaptersRead))
    : 0;
  if (safeChaptersRead > 0) {
    const upper = normalizedStatus.replace(/[\s-]+/g, "_").toUpperCase();
    if (service === "anilist" && upper === "PLANNING") {
      return "CURRENT";
    }
    if (service === "mal" && upper === "PLAN_TO_READ") {
      return "reading";
    }
    return normalizedStatus;
  }

  if (demoteOnZero) {
    const upper = normalizedStatus.replace(/[\s-]+/g, "_").toUpperCase();
    if (
      service === "anilist" &&
      (upper === "CURRENT" || upper === "REPEATING")
    ) {
      return "PLANNING";
    }
    if (service === "mal" && upper === "READING") {
      return "plan_to_read";
    }
  }
  return normalizedStatus;
}

export function getTrackingEditorServices(state: TrackingEditorState) {
  const entries = Object.values(state.forms) as TrackingEditorForm[];
  return entries.filter(Boolean);
}

export function getActiveTrackingEditorForm(state: TrackingEditorState) {
  if (state.service && state.forms[state.service]) {
    return state.forms[state.service] || null;
  }
  const services = getTrackingEditorServices(state);
  return services[0] || null;
}

export function createMlvTrackingEditorActions(deps: TrackingEditorDeps) {
  const state = deps.state;

  function setTrackingEditorForm(
    service: TrackingServiceId,
    updates: Partial<TrackingEditorForm>,
  ) {
    const current = state.forms[service];
    if (!current) return;
    state.forms = {
      ...state.forms,
      [service]: {
        ...current,
        ...updates,
      },
    };
  }

  function getConnectedTrackingServices(): TrackingServiceId[] {
    return deps.getActiveTrackingServices().filter(
      (service): service is TrackingServiceId =>
        service === "anilist" || service === "mal",
    );
  }

  function shouldSyncAcrossBothSites(sourceService: TrackingServiceId) {
    if (!state.syncBothSitesEnabled) return false;
    if (!state.forms[sourceService]) return false;
    return Boolean(state.forms.anilist && state.forms.mal);
  }

  async function hydrateSyncBothSitesSetting() {
    try {
      const raw = await deps.api.getSyncBothSitesSetting();
      state.syncBothSitesEnabled = String(raw || "").trim() !== "false";
    } catch {
      state.syncBothSitesEnabled = true;
    }
  }

  function buildTrackingEditorForm(service: TrackingServiceId) {
    const card = deps
      .getUserTrackingStatuses()
      .find((entry) => entry?.service === service);
    const statusOptions = TRACKING_EDITOR_STATUS_OPTIONS[service].map((value) => ({
      value,
      label: deps.formatTrackingListStatus(value),
    }));
    const trackedRemoteId =
      service === "anilist"
        ? Number(deps.getTrackedAnilistId() || 0)
        : Number(deps.getTrackedMalId() || 0);
    const remoteId =
      Number(card?.remoteId || 0) > 0
        ? Number(card?.remoteId || 0)
        : trackedRemoteId > 0
          ? trackedRemoteId
          : null;
    const progress = Number(card?.chaptersRead || 0);
    const volumes = Number(card?.volumesRead || 0);
    const score = Number(card?.score);

    return {
      service,
      label: service === "anilist" ? "AniList" : "MyAnimeList",
      iconUrl: getTrackingEditorIconUrl(service),
      remoteId,
      hasEntry: Boolean(card?.hasEntry),
      status: normalizeTrackingStatusValue(service, card?.status),
      progress: String(Number.isFinite(progress) && progress >= 0 ? progress : 0),
      volumes: String(Number.isFinite(volumes) && volumes >= 0 ? volumes : 0),
      score:
        Number.isFinite(score) && score > 0
          ? String(Number(score.toFixed(1)))
          : "0",
      totalChapters:
        Number.isFinite(Number(card?.totalChapters || 0)) &&
        Number(card?.totalChapters || 0) > 0
          ? Number(card?.totalChapters || 0)
          : null,
      totalVolumes:
        Number.isFinite(Number(card?.totalVolumes || 0)) &&
        Number(card?.totalVolumes || 0) > 0
          ? Number(card?.totalVolumes || 0)
          : null,
      statusOptions,
    } as TrackingEditorForm;
  }

  function forceClose(options: { clearError?: boolean } = {}) {
    state.requestId += 1;
    state.hydrating = false;
    state.removing = false;
    state.dirty = false;
    state.open = false;
    if (options.clearError) {
      state.error = "";
    }
  }

  async function openTrackingEditor() {
    const selectedSeries = deps.getSelectedSeries();
    if (!selectedSeries) return;
    state.error = "";

    let services = getConnectedTrackingServices();
    if (services.length === 0) {
      try {
        const rawTrackingAccounts = await deps.api.getTrackingAccounts();
        services = deps.resolveTrackingServices(rawTrackingAccounts);
        deps.setActiveTrackingServices([...services]);
      } catch {}
    }

    if (services.length === 0) {
      deps.toasts.add("Connect AniList or MAL in Settings", "info");
      return;
    }

    await hydrateSyncBothSitesSetting();

    const forms = services.reduce(
      (acc, service) => {
        acc[service] = buildTrackingEditorForm(service);
        return acc;
      },
      {} as Partial<Record<TrackingServiceId, TrackingEditorForm>>,
    );
    state.forms = forms;
    if (!state.service || !forms[state.service]) {
      state.service = services[0] || null;
    }
    state.dirty = false;
    state.open = true;

    const requestId = ++state.requestId;
    const openedSeriesId = Number(deps.getActiveSelectedSeriesId() || 0);
    state.hydrating = true;
    void (async () => {
      try {
        await deps.refreshCurrentTrackingStatus(selectedSeries);
        if (requestId !== state.requestId) return;
        if (!state.open) return;
        if (state.dirty) return;
        if (Number(deps.getActiveSelectedSeriesId() || 0) !== openedSeriesId) {
          return;
        }

        const latestServices = getConnectedTrackingServices();
        if (latestServices.length === 0) return;
        const latestForms = latestServices.reduce(
          (acc, service) => {
            acc[service] = buildTrackingEditorForm(service);
            return acc;
          },
          {} as Partial<Record<TrackingServiceId, TrackingEditorForm>>,
        );
        state.forms = latestForms;
        if (!state.service || !latestForms[state.service]) {
          state.service = latestServices[0] || null;
        }
      } finally {
        if (requestId === state.requestId) {
          state.hydrating = false;
        }
      }
    })();
  }

  function closeTrackingEditor() {
    if (state.saving || state.removing) return;
    forceClose({ clearError: true });
  }

  function setTrackingEditorActiveService(service: TrackingServiceId) {
    if (!state.forms[service]) return;
    state.service = service;
    state.error = "";
  }

  function setSyncBothSitesEnabled(enabled: boolean) {
    const normalized = Boolean(enabled);
    if (state.syncBothSitesEnabled === normalized) return;
    state.syncBothSitesEnabled = normalized;
    deps.toasts.add(
      normalized ? "Sync Both enabled" : "Sync Both disabled",
      "info",
    );
    void deps.api.setSyncBothSitesSetting(normalized).catch((error) => {
      console.warn("Failed to persist tracking editor sync preference:", error);
      deps.toasts.add("Failed to save Sync Both preference", "error");
    });
  }

  function updateTrackingEditorField(
    service: TrackingServiceId,
    field: TrackingEditorField,
    value: string,
  ) {
    const form = state.forms[service];
    if (!form) return;
    state.dirty = true;
    const syncAcrossBothSites = shouldSyncAcrossBothSites(service);
    const targetServices = syncAcrossBothSites
      ? (["anilist", "mal"] as TrackingServiceId[])
      : [service];

    if (field === "status") {
      const normalizedSourceStatus = normalizeTrackingStatusValue(service, value);
      for (const targetService of targetServices) {
        if (!state.forms[targetService]) continue;
        const mappedStatus =
          targetService === service
            ? normalizedSourceStatus
            : normalizeTrackingStatusValue(targetService, normalizedSourceStatus);
        setTrackingEditorForm(targetService, { status: mappedStatus });
      }
      return;
    }

    if (field === "progress") {
      const next = String(value ?? "").replace(/[^\d]/g, "");
      const nextProgress = Number(next || 0);
      const normalizedSourceStatus = coerceStatusForProgress(
        service,
        form.status,
        nextProgress,
        { demoteOnZero: false },
      );

      for (const targetService of targetServices) {
        const targetForm = state.forms[targetService];
        if (!targetForm) continue;

        const mappedStatus =
          targetService === service
            ? normalizedSourceStatus
            : normalizeTrackingStatusValue(targetService, normalizedSourceStatus);
        setTrackingEditorForm(targetService, {
          progress: next,
          status: coerceStatusForProgress(
            targetService,
            mappedStatus,
            nextProgress,
            { demoteOnZero: false },
          ),
        });
      }
      return;
    }

    if (field === "volumes") {
      const next = String(value ?? "").replace(/[^\d]/g, "");
      for (const targetService of targetServices) {
        if (!state.forms[targetService]) continue;
        setTrackingEditorForm(targetService, { volumes: next });
      }
      return;
    }

    const next = String(value ?? "")
      .replace(",", ".")
      .replace(/[^\d.]/g, "");
    const parts = next.split(".");
    const normalized =
      parts.length <= 1 ? parts[0] : `${parts[0]}.${parts.slice(1).join("")}`;
    for (const targetService of targetServices) {
      if (!state.forms[targetService]) continue;
      setTrackingEditorForm(targetService, { score: normalized });
    }
  }

  async function saveTrackingEditor() {
    const selectedSeries = deps.getSelectedSeries();
    if (!selectedSeries || state.saving || state.removing) {
      return;
    }
    const seriesId = Number(deps.getActiveSelectedSeriesId() || 0);
    if (!seriesId) return;

    const forms = (Object.values(state.forms) as TrackingEditorForm[]).filter(
      Boolean,
    );
    if (forms.length === 0) {
      state.error = "No connected tracking services found.";
      return;
    }
    for (const form of forms) {
      if (!form.remoteId || form.remoteId <= 0) {
        state.error = `${form.label} entry is not linked for this series.`;
        return;
      }
    }

    state.error = "";
    state.saving = true;
    try {
      await Promise.all(
        forms.map((form) => {
          const remoteId = Number(form.remoteId || 0);
          const chaptersRead = normalizeProgressInput(form.progress);
          const volumesRead = normalizeVolumeInput(form.volumes);
          const status = coerceStatusForProgress(
            form.service,
            form.status,
            chaptersRead,
          );
          return deps.api.updateTrackingEntry({
            seriesId,
            service: form.service,
            remoteId,
            chaptersRead,
            volumesRead,
            score: normalizeScoreInput(form.score),
            status,
            totalChapters: form.totalChapters,
            totalVolumes: form.totalVolumes,
          });
        }),
      );

      state.open = false;
      state.dirty = false;
      deps.toasts.add("Tracking status updated", "success");
      try {
        await deps.refreshCurrentTrackingStatus(selectedSeries);
      } catch (refreshError) {
        console.error(
          "Failed to refresh tracking status after update:",
          refreshError,
        );
      }
    } catch (error) {
      console.error("Failed to update tracking entry:", error);
      state.error =
        String((error as any)?.message || "").trim() ||
        "Failed to save tracking changes.";
    } finally {
      state.saving = false;
    }
  }

  async function removeTrackingEditorEntry() {
    const selectedSeries = deps.getSelectedSeries();
    if (!selectedSeries || state.saving || state.removing || !state.service) {
      return;
    }

    const syncAcrossBothSites = shouldSyncAcrossBothSites(state.service);
    const targetServices = syncAcrossBothSites
      ? (["anilist", "mal"] as TrackingServiceId[])
      : [state.service];
    const targetForms = targetServices
      .map((service) => state.forms[service])
      .filter(Boolean) as TrackingEditorForm[];
    const removableForms = targetForms.filter((form) => form.hasEntry);

    if (removableForms.length === 0) {
      state.error = syncAcrossBothSites
        ? "No AniList or MAL entries are in your list."
        : `${targetForms[0]?.label || "Selected"} entry is not in your list.`;
      return;
    }

    for (const form of removableForms) {
      if (!form.remoteId || form.remoteId <= 0) {
        state.error = `${form.label} entry is not linked for this series.`;
        return;
      }
    }

    const seriesId = Number(deps.getActiveSelectedSeriesId() || 0);
    if (!seriesId) return;

    state.removing = true;
    state.error = "";
    try {
      await Promise.all(
        removableForms.map((form) =>
          deps.api.removeTrackingEntry({
            seriesId,
            service: form.service,
            remoteId: Number(form.remoteId || 0),
          }),
        ),
      );

      state.dirty = false;
      await deps.refreshCurrentTrackingStatus(selectedSeries);

      const latestServices = getConnectedTrackingServices();
      if (latestServices.length > 0) {
        state.forms = latestServices.reduce(
          (acc, service) => {
            acc[service] = buildTrackingEditorForm(service);
            return acc;
          },
          {} as Partial<Record<TrackingServiceId, TrackingEditorForm>>,
        );
        if (!state.forms[state.service]) {
          state.service = latestServices[0] || null;
        }
      }

      if (removableForms.length > 1) {
        deps.toasts.add("AniList and MAL entries removed from your list", "success");
      } else {
        deps.toasts.add(
          `${removableForms[0].label} entry removed from your list`,
          "success",
        );
      }
    } catch (error) {
      console.error("Failed to remove tracking entry:", error);
      state.error =
        String((error as any)?.message || "").trim() ||
        "Failed to remove series from list.";
    } finally {
      state.removing = false;
    }
  }

  return {
    forceClose,
    openTrackingEditor,
    closeTrackingEditor,
    setTrackingEditorActiveService,
    setSyncBothSitesEnabled,
    updateTrackingEditorField,
    saveTrackingEditor,
    removeTrackingEditorEntry,
  };
}
