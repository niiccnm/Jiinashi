import type { MlvControllerActionContext } from "./mlv-controller-actions";

type AccessorTuple<T> = [() => T, ((value: T) => void)?];

type MlvControllerStateAccessors = {
  detailLoading: AccessorTuple<boolean>;
  detail: AccessorTuple<any | null>;
  detailSeriesId: AccessorTuple<number | null>;
  friends: AccessorTuple<any[]>;
  trackedAnilistId: AccessorTuple<number | null>;
  trackedMalId: AccessorTuple<number | null>;
  activeTrackingServices: AccessorTuple<any[]>;
  userTrackingStatuses: AccessorTuple<any[]>;
  isTrackingStatusLoading: AccessorTuple<boolean>;
  trackingStatusError: AccessorTuple<string>;
  isDescriptionExpanded: AccessorTuple<boolean>;
  isContinueResolving: AccessorTuple<boolean>;
  detailRequestId: AccessorTuple<number>;
  activeDetailSeriesId: AccessorTuple<number | null>;
  seriesCatalog: AccessorTuple<any[]>;
  selectedSeriesId: AccessorTuple<number | null>;
  trackingStatusVisibleBySeries: AccessorTuple<Record<number, boolean>>;
  activeSelectedSeriesId: AccessorTuple<number | null>;
  selectedSeries: AccessorTuple<any>;
  series: AccessorTuple<any[]>;
};

type CreateActionContextArgs = {
  accessors: MlvControllerStateAccessors;
  deps: Omit<MlvControllerActionContext, "state">;
};

function defineAccessor<State, Key extends keyof State>(
  target: State,
  key: Key,
  accessor: AccessorTuple<State[Key]>,
) {
  const [get, set] = accessor;
  Object.defineProperty(target, key, {
    get,
    set,
    enumerable: true,
    configurable: true,
  });
}

export function createMlvControllerActionContext({
  accessors,
  deps,
}: CreateActionContextArgs): MlvControllerActionContext {
  const actionState = {} as MlvControllerActionContext["state"];
  defineAccessor(actionState, "detailLoading", accessors.detailLoading);
  defineAccessor(actionState, "detail", accessors.detail);
  defineAccessor(actionState, "detailSeriesId", accessors.detailSeriesId);
  defineAccessor(actionState, "friends", accessors.friends);
  defineAccessor(actionState, "trackedAnilistId", accessors.trackedAnilistId);
  defineAccessor(actionState, "trackedMalId", accessors.trackedMalId);
  defineAccessor(
    actionState,
    "activeTrackingServices",
    accessors.activeTrackingServices,
  );
  defineAccessor(
    actionState,
    "userTrackingStatuses",
    accessors.userTrackingStatuses,
  );
  defineAccessor(
    actionState,
    "isTrackingStatusLoading",
    accessors.isTrackingStatusLoading,
  );
  defineAccessor(
    actionState,
    "trackingStatusError",
    accessors.trackingStatusError,
  );
  defineAccessor(
    actionState,
    "isDescriptionExpanded",
    accessors.isDescriptionExpanded,
  );
  defineAccessor(
    actionState,
    "isContinueResolving",
    accessors.isContinueResolving,
  );
  defineAccessor(actionState, "detailRequestId", accessors.detailRequestId);
  defineAccessor(
    actionState,
    "activeDetailSeriesId",
    accessors.activeDetailSeriesId,
  );
  defineAccessor(actionState, "seriesCatalog", accessors.seriesCatalog);
  defineAccessor(actionState, "selectedSeriesId", accessors.selectedSeriesId);
  defineAccessor(
    actionState,
    "trackingStatusVisibleBySeries",
    accessors.trackingStatusVisibleBySeries,
  );
  defineAccessor(
    actionState,
    "activeSelectedSeriesId",
    accessors.activeSelectedSeriesId,
  );
  defineAccessor(actionState, "selectedSeries", accessors.selectedSeries);
  defineAccessor(actionState, "series", accessors.series);
  return {
    ...deps,
    state: actionState,
  };
}
