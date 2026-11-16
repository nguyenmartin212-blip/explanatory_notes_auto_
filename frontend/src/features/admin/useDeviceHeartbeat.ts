import { useEffect } from 'react';
import { sendDeviceHeartbeat } from '@/services/adminApi';

const DEVICE_STORAGE_KEY = 'go-to-horizon.device-id';
const INTERVAL_MS = 45_000;
let deviceId: string | undefined;

function getDeviceId() {
  if (deviceId) return deviceId;
  try {
    const savedId = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (savedId && /^[a-zA-Z0-9._:-]{1,128}$/.test(savedId)) {
      deviceId = savedId;
      return deviceId;
    }
  } catch {
    // Restricted browser storage still permits presence within the current page.
  }

  const random = window.crypto.getRandomValues(new Uint8Array(16));
  deviceId = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
  try {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
  } catch {
    // Reuse the in-memory ID for the rest of the page session.
  }
  return deviceId;
}

export function useDeviceHeartbeat(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let pending = false;
    let lastAttempt = -Infinity;

    async function heartbeat() {
      if (document.visibilityState !== 'visible' || pending || controller.signal.aborted) return;
      const now = performance.now();
      if (now - lastAttempt < INTERVAL_MS - 1_000) return;
      pending = true;
      lastAttempt = now;
      try {
        await sendDeviceHeartbeat(getDeviceId(), controller.signal);
      } catch {
        // Retry on the next scheduled heartbeat without blocking the dashboard.
      } finally {
        pending = false;
      }
    }

    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), INTERVAL_MS);
    const onVisibility = () => void heartbeat();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId]);
}
