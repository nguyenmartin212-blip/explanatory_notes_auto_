import { useCallback, useEffect, useRef, useState } from 'react';
import type { Poi } from '@/features/poi/types';
import { apiMediaUrl } from '@/services/apiConfig';
import { getOfflineAudio } from './web-hooks';

type Track = (event: 'play_audio' | 'finish_audio', poiId?: number, lang?: string) => void;
type Playback = {
  poiId: string;
  playing: boolean;
  duration: number;
  position: number;
  mode: 'audio' | 'speech';
};
type Active = {
  poiId: string;
  audio?: HTMLAudioElement;
  speech?: SpeechSynthesisUtterance;
  blob?: string;
};

function interrupted(reason: unknown) {
  return reason instanceof DOMException && reason.name === 'AbortError';
}

export function useNarration(lang: string, preferOffline: boolean, track: Track, messages: { unavailable: string; failed: string }) {
  const active = useRef<Active | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState<{ poiId: string; text: string } | null>(null);

  const dispose = useCallback(() => {
    const player = active.current;
    active.current = null;
    if (player?.audio) {
      player.audio.pause();
      player.audio.removeAttribute('src');
      player.audio.load();
    }
    if (player?.speech) speechSynthesis.cancel();
    if (player?.blob) URL.revokeObjectURL(player.blob);
  }, []);

  const stop = useCallback(() => {
    dispose();
    setPlayback(null);
    setError(null);
  }, [dispose]);

  useEffect(() => {
    window.speechSynthesis?.getVoices();
    stop();
    return dispose;
  }, [lang, dispose, stop]);

  const play = useCallback(async (poi: Poi) => {
    const player = active.current;
    if (player?.poiId === poi.id) {
      if (player.audio) {
        if (!player.audio.paused) player.audio.pause();
        else await player.audio.play().catch((reason: unknown) => {
          if (active.current === player && !interrupted(reason)) {
            setError({ poiId: poi.id, text: messages.failed });
          }
        });
      } else if (player.speech) {
        if (speechSynthesis.paused) speechSynthesis.resume();
        else speechSynthesis.pause();
        setPlayback((value) => value && { ...value, playing: !speechSynthesis.paused });
      }
      return;
    }

    stop();
    const content = poi.content;
    const next: Active = { poiId: poi.id };
    active.current = next;
    let started = false;
    const startEvent = () => {
      if (started) return;
      started = true;
      track('play_audio', poi.backendId, content.lang);
    };
    const finish = () => {
      if (active.current !== next) return;
      track('finish_audio', poi.backendId, content.lang);
      stop();
    };
    const fail = (text: string) => {
      if (active.current !== next) return;
      stop();
      setError({ poiId: poi.id, text });
    };
    const speak = () => {
      if (active.current !== next) return;
      if (!('speechSynthesis' in window) || !content.description) return fail(messages.unavailable);
      const prefix = content.lang.toLowerCase().split('-')[0];
      const voice = speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().split('-')[0] === prefix);
      if (!voice) return fail(messages.unavailable);
      const utterance = new SpeechSynthesisUtterance(content.description);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      next.speech = utterance;
      utterance.onstart = () => {
        if (active.current !== next) return;
        setPlayback({ poiId: poi.id, playing: true, duration: 0, position: 0, mode: 'speech' });
        startEvent();
      };
      utterance.onend = finish;
      utterance.onerror = () => fail(messages.failed);
      speechSynthesis.speak(utterance);
    };

    if (!content.audio_url) return speak();
    const blob = preferOffline || !navigator.onLine
      ? await getOfflineAudio(content.audio_url, lang).catch(() => null) : null;
    if (active.current !== next) {
      if (blob) URL.revokeObjectURL(blob);
      return;
    }
    next.blob = blob ?? undefined;
    const audio = new Audio(blob || apiMediaUrl(content.audio_url));
    next.audio = audio;
    const sync = () => {
      if (active.current !== next || next.audio !== audio) return;
      setPlayback({ poiId: poi.id, mode: 'audio', playing: !audio.paused,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0, position: audio.currentTime });
    };
    audio.ontimeupdate = audio.onloadedmetadata = audio.onpause = sync;
    audio.onplaying = () => { sync(); if (active.current === next) startEvent(); };
    audio.onended = finish;
    const fallback = () => {
      if (active.current !== next || next.audio !== audio) return;
      next.audio = undefined;
      audio.pause();
      setPlayback(null);
      speak();
    };
    audio.onerror = fallback;
    await audio.play().catch((reason: unknown) => {
      // Pausing before playback starts aborts the pending play request.
      if (interrupted(reason)) return;
      if (reason instanceof DOMException && reason.name === 'NotAllowedError') fail(messages.failed);
      else fallback();
    });
  }, [lang, messages.failed, messages.unavailable, preferOffline, stop, track]);

  const seek = (position: number) => {
    if (active.current?.audio) active.current.audio.currentTime = position;
  };
  return { play, stop, playback, seek, error };
}
