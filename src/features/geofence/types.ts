export type GeofenceState = 'outside' | 'near' | 'inside';

export type GeofenceResult = {
  poiId: string;
  distanceMeters: number;
  state: GeofenceState;
};
