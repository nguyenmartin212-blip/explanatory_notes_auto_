import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiPost } from '@/services/apiClient';

type Session = { session_id: number | null; qr_valid: boolean | null; poi_id: number | null; web_visits: boolean };
type EventType = 'view_poi' | 'play_audio' | 'finish_audio' | 'change_lang';

export function useVisitorSession(qrCode: string | null, lang: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const current = useRef<Promise<Session> | null>(null);
  const latestLanguage = useRef(lang);
  latestLanguage.current = lang;

  useEffect(() => {
    let active = true;
    let sessionId: number | null = null;
    const start = () => {
      if (!current.current) {
        let deviceId: string = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)),
          (byte) => byte.toString(16).padStart(2, '0')).join('');
        try {
          const saved = localStorage.getItem('gth-visitor-device');
          if (saved) deviceId = saved;
          else localStorage.setItem('gth-visitor-device', deviceId);
        } catch { /* A temporary device ID still identifies this page. */ }
        current.current = apiPost<Session>('/api/v1/analytics/session', {
          device_id: deviceId, qr_code: qrCode, lang_code: latestLanguage.current,
        }).catch((error: unknown) => {
          if (qrCode !== null && error instanceof ApiError && error.status === 422) {
            return { session_id: null, qr_valid: false, poi_id: null, web_visits: false };
          }
          throw error;
        });
        void current.current.then(async (result) => {
          if (!active) return;
          sessionId = result.session_id;
          setSession(result);
          setSessionError(false);
          if (result.qr_valid === false) {
            // An invalid code never creates a QR visit. The visitor may still browse the regular map.
            current.current = apiPost<Session>('/api/v1/analytics/session', {
              device_id: deviceId, lang_code: latestLanguage.current,
            });
            await current.current.then((browse) => { if (active) sessionId = browse.session_id; }).catch(() => undefined);
          }
        }, () => {
          if (!active) return;
          current.current = null;
          setSessionError(true);
        });
      }
    };
    start();
    const timer = window.setInterval(() => {
      if (sessionId === null) {
        if (navigator.onLine) start();
        return;
      }
      void apiPost('/api/v1/analytics/heartbeat', { session_id: sessionId }).catch(() => undefined);
    }, 30_000);
    window.addEventListener('online', start);
    return () => {
      active = false;
      current.current = null;
      window.clearInterval(timer);
      window.removeEventListener('online', start);
    };
  }, [qrCode]);

  const track = useCallback((type: EventType, poiId?: number, eventLanguage = latestLanguage.current) => {
    if (type !== 'change_lang' && poiId === undefined) return;
    void current.current?.then((result) => result.session_id !== null && apiPost('/api/v1/analytics/event', {
      session_id: result.session_id, event_type: type, poi_id: poiId, lang_code: eventLanguage,
    })).catch(() => undefined);
  }, []);

  return { session, sessionError, track };
}
