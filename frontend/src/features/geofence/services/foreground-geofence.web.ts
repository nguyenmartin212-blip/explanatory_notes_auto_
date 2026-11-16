// src/features/geofence/services/foreground-geofence.web.ts

export interface WebGeofenceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

class ForegroundGeofenceWebService {
  private watchId: number | null = null;
  private lastEmittedAt = 0;
  private readonly minimumIntervalMs = 5_000;

  public startTracking(
    onLocationUpdate: (loc: WebGeofenceLocation) => void,
    onError?: (error: GeolocationPositionError | Error) => void,
  ) {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      onError?.(new Error('Geolocation is not supported by this browser.'));
      return null;
    }

    this.stopTracking();
    this.lastEmittedAt = 0;
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - this.lastEmittedAt < this.minimumIntervalMs) return;
        this.lastEmittedAt = now;
        const { latitude, longitude, accuracy } = position.coords;
        onLocationUpdate({ latitude, longitude, accuracy, timestamp: position.timestamp });
      },
      (error) => {
        if (onError) onError(error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000,
      }
    );
    return this.watchId;
  }

  public stopTracking() {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.lastEmittedAt = 0;
  }
}

export const foregroundGeofenceWeb = new ForegroundGeofenceWebService();