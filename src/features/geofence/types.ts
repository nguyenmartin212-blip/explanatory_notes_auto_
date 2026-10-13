export type GeofenceState = 'outside' | 'near' | 'inside';

export type GeofenceResult = {
  poiId: string;
  distanceMeters: number;
  state: GeofenceState;
};

export type GeofenceTriggerReason = 'entered' | 'nearby';

export type GeofenceTrigger = GeofenceResult & {
  priority: number;
  reason: GeofenceTriggerReason;
  triggeredAt: number;
};

/**
 * Runtime-only state for foreground geofencing.
 * Keep this in a ref/store; it is intentionally not persisted as JSON.
 */
export type GeofenceRuntimeState = {
  insideIds: Set<string>;
  pendingSince: Map<string, number>;
  lastTriggeredAt: Map<string, number>;
};

export type GeofenceRuntimeOptions = {
  /** Time the user must remain in the trigger zone before an event is emitted. */
  debounceMs?: number;
  /** Same POI cannot trigger again until this duration has elapsed. */
  cooldownMs?: number;
  /** Hysteresis: keep an entered POI active until radius * multiplier. */
  exitMultiplier?: number;
  /** PoC defaults to true only for the real activation radius. */
  triggerOnNear?: boolean;
};
