import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Speech from 'expo-speech';

import type { Poi } from '@/features/poi';
import type { SupportedLanguage } from '@/types';
import { colors, radius, spacing } from '@/theme';
import {
  canPlayNarration,
  completeCurrentNarration,
  createNarrationRuntimeState,
  enqueueNarration,
  markNarrationPlayed,
  setNarrationStatus,
  stopNarrationRuntime,
  takeNextNarration,
} from '../services/narration.engine';
import {
  NARRATION_LOCALES,
  narrationForPoi,
  supportedNarrationLanguage,
} from '../services/narration-content';

type Mode = 'idle' | 'tts' | 'audio';
type TtsState = 'idle' | 'playing' | 'paused' | 'done';

const RATES = [0.85, 1, 1.15] as const;

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Foreground narration player.
 *
 * Important iOS / Expo Audio lifecycle rule:
 * useAudioPlayer() owns the native AudioPlayer and releases it on unmount.
 * Never call pause/seek/play from the unmount cleanup because the native
 * SharedObject may already have been released.
 */
export function NarrationPlayer({
  poi,
  language,
  autoStart = false,
  origin = 'manual',
}: {
  poi: Poi;
  language: SupportedLanguage;
  autoStart?: boolean;
  origin?: 'manual' | 'geofence' | 'qr';
}) {
  const narrationLanguage = supportedNarrationLanguage(language) ? language : null;

  const item = useMemo(
    () => (narrationLanguage ? narrationForPoi(poi, narrationLanguage) : null),
    [poi, narrationLanguage],
  );

  const audioPlayer = useAudioPlayer(null, { updateInterval: 500 });
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const isFocused = useIsFocused();

  const session = useRef(0);
  const runtime = useRef(createNarrationRuntimeState());
  const autoStartedKey = useRef<string | null>(null);

  const [mode, setMode] = useState<Mode>('idle');
  const [ttsState, setTtsState] = useState<TtsState>('idle');
  const [pendingAudio, setPendingAudio] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [queueSize, setQueueSize] = useState(0);

  const syncRuntimeUi = useCallback(() => {
    setQueueSize(runtime.current.queue.length + (runtime.current.current ? 1 : 0));
  }, []);

  /**
   * expo-audio methods can throw synchronously if Expo has already released
   * the underlying native SharedObject. Keep those errors out of React render.
   */
  const safePauseAudio = useCallback(() => {
    try {
      audioPlayer.pause();
    } catch {
      // Native AudioPlayer may already be released during navigation/unmount.
    }
  }, [audioPlayer]);

  const safePlayAudio = useCallback(() => {
    try {
      audioPlayer.play();
      return true;
    } catch {
      return false;
    }
  }, [audioPlayer]);

  const safeSetPlaybackRate = useCallback(
    (value: number) => {
      try {
        audioPlayer.setPlaybackRate(value);
      } catch {
        // Ignore stale native player during navigation transitions.
      }
    },
    [audioPlayer],
  );

  const safeSeekToStart = useCallback(async () => {
    try {
      await audioPlayer.seekTo(0);
    } catch {
      // Ignore stale/released native player.
    }
  }, [audioPlayer]);

  const stop = useCallback(() => {
    session.current += 1;
    setPendingAudio(false);
    setMode('idle');
    setTtsState('idle');
    runtime.current = stopNarrationRuntime(runtime.current);
    syncRuntimeUi();

    void Speech.stop().catch(() => undefined);

    // Safe while the component is still mounted. The unmount cleanup below
    // deliberately does NOT access audioPlayer.
    safePauseAudio();
    void safeSeekToStart();
  }, [safePauseAudio, safeSeekToStart, syncRuntimeUi]);

  // Reset narration state when POI/language changes.
  useEffect(() => {
    session.current += 1;
    setMode('idle');
    setPendingAudio(false);
    setTtsState('idle');
    setError(null);
    runtime.current = stopNarrationRuntime(runtime.current);
    syncRuntimeUi();
    void Speech.stop().catch(() => undefined);

    return () => {
      // IMPORTANT: do not call audioPlayer.pause()/seekTo()/play() here.
      // useAudioPlayer automatically releases its native object on unmount.
      session.current += 1;
      void Speech.stop().catch(() => undefined);
    };
  }, [poi.id, language, syncRuntimeUi]);

  useEffect(() => {
    if (!isFocused) stop();
  }, [isFocused, stop]);

  // Pause foreground narration when the app loses focus.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;

      if (mode === 'audio' && audioStatus.playing) {
        safePauseAudio();
        runtime.current = setNarrationStatus(runtime.current, 'paused');
        syncRuntimeUi();
        return;
      }

      if (mode === 'tts' && ttsState === 'playing') {
        if (Platform.OS === 'ios' || Platform.OS === 'web') {
          void Speech.pause()
            .then(() => {
              setTtsState('paused');
              runtime.current = setNarrationStatus(runtime.current, 'paused');
              syncRuntimeUi();
            })
            .catch(() => stop());
        } else {
          stop();
        }
      }
    });

    return () => subscription.remove();
  }, [audioStatus.playing, mode, safePauseAudio, stop, syncRuntimeUi, ttsState]);

  useEffect(() => {
    if (mode !== 'audio' || !audioStatus.didJustFinish) return;
    runtime.current = completeCurrentNarration(runtime.current);
    syncRuntimeUi();
  }, [mode, audioStatus.didJustFinish, syncRuntimeUi]);

  useEffect(() => {
    if (mode !== 'audio' || !pendingAudio) return;

    if (audioStatus.error) {
      setPendingAudio(false);
      setError('Không tải được tệp audio. Kiểm tra URL hoặc kết nối mạng.');
      setMode('idle');
      runtime.current = setNarrationStatus(runtime.current, 'error');
      syncRuntimeUi();
      return;
    }

    if (audioStatus.isLoaded) {
      safeSetPlaybackRate(rate);
      const started = safePlayAudio();

      if (!started) {
        setPendingAudio(false);
        setMode('idle');
        setError('Audio player đã được giải phóng. Hãy mở lại điểm thuyết minh.');
        runtime.current = setNarrationStatus(runtime.current, 'error');
        syncRuntimeUi();
        return;
      }

      runtime.current = setNarrationStatus(runtime.current, 'playing');
      if (runtime.current.current) {
        markNarrationPlayed(runtime.current.current);
      }
      syncRuntimeUi();
      setPendingAudio(false);
    }
  }, [
    mode,
    pendingAudio,
    audioStatus.isLoaded,
    audioStatus.error,
    rate,
    safePlayAudio,
    safeSetPlaybackRate,
    syncRuntimeUi,
  ]);

  const start = useCallback(async () => {
    if (!item || !narrationLanguage) return;

    if (origin === 'geofence' && !canPlayNarration(item)) {
      return;
    }

    runtime.current = stopNarrationRuntime(runtime.current);
    runtime.current = enqueueNarration(runtime.current, item, {
      priority: poi.priority,
      allowDuplicate: true,
    });
    runtime.current = takeNextNarration(runtime.current);
    syncRuntimeUi();

    const current = ++session.current;
    setError(null);
    setPendingAudio(false);
    setTtsState('idle');

    // Safe even if a previous AudioPlayer has already become stale.
    safePauseAudio();

    try {
      await Speech.stop();
      if (current !== session.current) return;

      if (item.source === 'audio-file' && item.uri) {
        setMode('audio');

        try {
          audioPlayer.replace(item.uri);
        } catch {
          setMode('idle');
          setError('Không thể tạo trình phát audio cho nội dung này.');
          runtime.current = setNarrationStatus(runtime.current, 'error');
          syncRuntimeUi();
          return;
        }

        setPendingAudio(true);
        runtime.current = setNarrationStatus(runtime.current, 'loading');
        syncRuntimeUi();
        return;
      }

      if (!item.text) {
        setError('Chưa có nội dung thuyết minh cho ngôn ngữ này.');
        runtime.current = setNarrationStatus(runtime.current, 'error');
        syncRuntimeUi();
        return;
      }

      setMode('tts');
      setTtsState('playing');
      runtime.current = setNarrationStatus(runtime.current, 'playing');
      syncRuntimeUi();

      Speech.speak(item.text, {
        language: NARRATION_LOCALES[narrationLanguage],
        rate,
        pitch: 1,
        onDone: () => {
          if (current !== session.current) return;
          setTtsState('done');
          runtime.current = completeCurrentNarration(runtime.current);
          syncRuntimeUi();
        },
        onStopped: () => {
          if (current !== session.current) return;
          setTtsState('idle');
          runtime.current = stopNarrationRuntime(runtime.current);
          syncRuntimeUi();
        },
        onError: () => {
          if (current !== session.current) return;
          setError('Không phát được giọng đọc. Hãy kiểm tra cài đặt giọng nói trên máy.');
          setTtsState('idle');
          runtime.current = setNarrationStatus(runtime.current, 'error');
          syncRuntimeUi();
        },
      });

      markNarrationPlayed(item);
    } catch {
      if (current !== session.current) return;
      setMode('idle');
      setError('Không thể bắt đầu phát thuyết minh.');
      runtime.current = setNarrationStatus(runtime.current, 'error');
      syncRuntimeUi();
    }
  }, [
    item,
    narrationLanguage,
    origin,
    poi.priority,
    rate,
    safePauseAudio,
    syncRuntimeUi,
    audioPlayer,
  ]);

  useEffect(() => {
    if (!autoStart || !item || !isFocused || !narrationLanguage) return;

    const key = `${poi.id}:${narrationLanguage}:${origin}`;
    if (autoStartedKey.current === key) return;

    autoStartedKey.current = key;
    void start();
  }, [autoStart, item, isFocused, narrationLanguage, origin, poi.id, start]);

  const toggle = async () => {
    if (!item) return;

    if (mode === 'audio') {
      if (pendingAudio) return;

      if (audioStatus.playing) {
        safePauseAudio();
        runtime.current = setNarrationStatus(runtime.current, 'paused');
        syncRuntimeUi();
        return;
      }

      if (audioStatus.isLoaded) {
        if (
          audioStatus.didJustFinish ||
          (audioStatus.duration > 0 && audioStatus.currentTime >= audioStatus.duration)
        ) {
          await safeSeekToStart();
        }

        if (safePlayAudio()) {
          runtime.current = setNarrationStatus(runtime.current, 'playing');
          syncRuntimeUi();
        } else {
          setError('Audio player không còn khả dụng. Hãy mở lại điểm thuyết minh.');
        }
        return;
      }

      await start();
      return;
    }

    if (mode === 'tts' && ttsState === 'playing') {
      if (Platform.OS === 'ios' || Platform.OS === 'web') {
        try {
          await Speech.pause();
          setTtsState('paused');
          runtime.current = setNarrationStatus(runtime.current, 'paused');
          syncRuntimeUi();
        } catch {
          stop();
        }
      } else {
        stop();
      }
      return;
    }

    if (mode === 'tts' && ttsState === 'paused') {
      try {
        await Speech.resume();
        setTtsState('playing');
        runtime.current = setNarrationStatus(runtime.current, 'playing');
        syncRuntimeUi();
      } catch {
        await start();
      }
      return;
    }

    await start();
  };

  const playing =
    mode === 'tts'
      ? ttsState === 'playing'
      : mode === 'audio' && audioStatus.playing;

  const progress =
    mode === 'audio' && audioStatus.duration > 0
      ? Math.min(1, audioStatus.currentTime / audioStatus.duration)
      : 0;

  const actionText = pendingAudio
    ? 'Đang tải audio...'
    : playing
      ? Platform.OS === 'android' && mode === 'tts'
        ? '■ Dừng'
        : 'Ⅱ Tạm dừng'
      : mode === 'tts' && ttsState === 'paused'
        ? '▶ Tiếp tục'
        : mode === 'audio' && audioStatus.isLoaded
          ? '▶ Tiếp tục'
          : '▶ Nghe thuyết minh';

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>🎧 TRÌNH PHÁT THUYẾT MINH</Text>
      <Text style={styles.title}>{poi.name[language] ?? poi.name.vi}</Text>
      <Text style={styles.subTitle}>
        {item?.source === 'audio-file' ? 'Bản thu âm (MP3 / audio)' : 'Giọng đọc tự động (TTS)'}
        {' · '}
        {narrationLanguage?.toUpperCase() ?? language.toUpperCase()}
      </Text>

      <View style={styles.engineRow}>
        <Text style={styles.engineBadge}>
          QUEUE V2 · {queueSize > 0 ? `${queueSize} tác vụ` : 'sẵn sàng'}
        </Text>
        <Text style={styles.engineHint}>chống phát trùng</Text>
      </View>

      {mode === 'audio' && (
        <View style={styles.timeline}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.time}>
            {formatTime(audioStatus.currentTime)} / {formatTime(audioStatus.duration)}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            void toggle();
          }}
          disabled={!item || pendingAudio}
          accessibilityRole="button"
          accessibilityLabel={actionText}
          style={[styles.play, (!item || pendingAudio) && styles.disabled]}
        >
          <Text style={styles.playText}>{actionText}</Text>
        </Pressable>

        <Pressable
          onPress={stop}
          accessibilityRole="button"
          accessibilityLabel="Dừng phát"
          style={styles.stop}
        >
          <Text style={styles.stopText}>■ Dừng</Text>
        </Pressable>
      </View>

      <View style={styles.rateRow}>
        <Text style={styles.rateLabel}>Tốc độ</Text>
        {RATES.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: rate === value }}
            onPress={() => {
              setRate(value);
              if (mode === 'audio') safeSetPlaybackRate(value);
            }}
            style={[styles.rateChip, rate === value && styles.rateActive]}
          >
            <Text style={[styles.rateText, rate === value && styles.rateActiveText]}>
              {value}×
            </Text>
          </Pressable>
        ))}
      </View>

      {!narrationLanguage && (
        <Text style={styles.warning}>Ngôn ngữ này chưa được hỗ trợ cho thuyết minh.</Text>
      )}
      {!item && narrationLanguage && (
        <Text style={styles.warning}>Chưa có nội dung cho ngôn ngữ này.</Text>
      )}
      {!!error && <Text style={styles.warning}>{error}</Text>}

      <Text style={styles.hint}>
        {origin === 'qr' ? 'Được kích hoạt từ QR. ' : 'Chỉ phát khi bạn nhấn nghe. '}
        Chuyển màn hình hoặc đổi ngôn ngữ sẽ dừng thuyết minh.
        {Platform.OS === 'ios'
          ? ' Nếu iPhone không có tiếng TTS, hãy tắt chế độ im lặng.'
          : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: 18,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '800',
  },
  title: {
    fontSize: 17,
    color: colors.text,
    fontWeight: '800',
    marginTop: 8,
  },
  subTitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 5,
  },
  engineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  engineBadge: {
    color: colors.teal,
    backgroundColor: '#E6EFE9',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 99,
  },
  engineHint: {
    color: colors.muted,
    fontSize: 10,
  },
  timeline: {
    marginTop: 16,
  },
  track: {
    height: 6,
    borderRadius: 99,
    backgroundColor: '#E8E4DC',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.teal,
  },
  time: {
    color: colors.muted,
    fontSize: 11,
    textAlign: 'right',
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 16,
  },
  play: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 13,
  },
  playText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  stop: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 15,
    backgroundColor: '#F0E8DB',
  },
  stopText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.6,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  rateLabel: {
    color: colors.muted,
    fontSize: 12,
    marginRight: 2,
  },
  rateChip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
  },
  rateActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  rateText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
  },
  rateActiveText: {
    color: '#fff',
  },
  warning: {
    color: colors.primaryDark,
    fontSize: 12,
    marginTop: 12,
  },
  hint: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 14,
  },
});
