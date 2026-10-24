// src/features/geofence/services/foreground-geofence.web.ts

export interface WebGeofenceLocation {
  latitude: number;
  longitude: number;
}

class ForegroundGeofenceWebService {
  private watchId: number | null = null;

  public startTracking(onLocationUpdate: (loc: WebGeofenceLocation) => void, onError?: (error: any) => void) {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      console.warn('Geolocation is not supported by this browser.');
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        onLocationUpdate({ latitude, longitude });
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
  }

  public stopTracking() {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

export const foregroundGeofenceWeb = new ForegroundGeofenceWebService();