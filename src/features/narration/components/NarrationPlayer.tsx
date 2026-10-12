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
import { NARRATION_LOCALES, narrationForPoi } from '../services/narration-content';

type Language = SupportedLanguage;
type Mode = 'idle' | 'tts' | 'audio';
type TtsState = 'idle' | 'playing' | 'paused' | 'done';
const RATES = [0.85, 1, 1.15] as const;

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/** Foreground, user-initiated player. No autoplay when a geofence is entered. */
export function NarrationPlayer({
  poi,
  language,
  autoStart = false,
  origin = 'manual',
}: {
  poi: Poi;
  language: Language;
  autoStart?: boolean;
  origin?: 'manual' | 'geofence' | 'qr';
}) {
  const item = useMemo(() => narrationForPoi(poi, language), [poi, language]);
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

  const stop = useCallback(() => {
    session.current += 1; // Invalidate late speech callbacks from previous playbacks.
    setPendingAudio(false);
    setMode('idle');
    setTtsState('idle');
    runtime.current = stopNarrationRuntime(runtime.current);
    syncRuntimeUi();
    void Speech.stop().catch(() => undefined);
    audioPlayer.pause();
    void audioPlayer.seekTo(0).catch(() => undefined);
  }, [audioPlayer, syncRuntimeUi]);

  // Stop when leaving POI detail or changing language/POI.
  useEffect(() => {
    setMode('idle');
    setPendingAudio(false);
    setTtsState('idle');
    setError(null);
    runtime.current = stopNarrationRuntime(runtime.current);
    syncRuntimeUi();
    return () => {
      session.current += 1;
      void Speech.stop().catch(() => undefined);
      audioPlayer.pause();
    };
  }, [audioPlayer, poi.id, language, syncRuntimeUi]);

  useEffect(() => {
    if (!isFocused) stop();
  }, [isFocused, stop]);

  // Pause foreground narration when the app loses focus (e.g. app switch / system interruption).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      if (mode === 'audio' && audioStatus.playing) {
        audioPlayer.pause();
        runtime.current = setNarrationStatus(runtime.current, 'paused');
        syncRuntimeUi();
      } else if (mode === 'tts' && ttsState === 'playing') {
        if (Platform.OS === 'ios' || Platform.OS === 'web') {
          void Speech.pause().then(() => {
            setTtsState('paused');
            runtime.current = setNarrationStatus(runtime.current, 'paused');
            syncRuntimeUi();
          }).catch(() => stop());
        } else {
          stop();
        }
      }
    });
    return () => subscription.remove();
  }, [audioPlayer, audioStatus.playing, mode, stop, syncRuntimeUi, ttsState]);

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
      return;
    }
    if (audioStatus.isLoaded) {
      audioPlayer.setPlaybackRate(rate);
      audioPlayer.play();
      runtime.current = setNarrationStatus(runtime.current, 'playing');
      if (runtime.current.current) markNarrationPlayed(runtime.current.current);
      syncRuntimeUi();
      setPendingAudio(false);
    }
  }, [mode, pendingAudio, audioStatus.isLoaded, audioStatus.error, audioPlayer, rate, syncRuntimeUi]);

  const start = useCallback(async () => {
    if (!item) return;

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
    audioPlayer.pause();
    try {
      await Speech.stop();
      if (current !== session.current) return;
      if (item.source === 'audio-file' && item.uri) {
        setMode('audio');
        // URL may be a remote https:// file or a local file:// path.
        audioPlayer.replace(item.uri);
        setPendingAudio(true);
        runtime.current = setNarrationStatus(runtime.current, 'loading');
        syncRuntimeUi();
        return;
      }
      if (!item.text) {
        setError('Chưa có nội dung thuyết minh cho ngôn ngữ này.');
        return;
      }
      setMode('tts');
      setTtsState('playing');
      runtime.current = setNarrationStatus(runtime.current, 'playing');
      syncRuntimeUi();
      Speech.speak(item.text, {
        language: NARRATION_LOCALES[language],
        rate,
        pitch: 1,
        onDone: () => {
          if (current === session.current) {
            setTtsState('done');
            runtime.current = completeCurrentNarration(runtime.current);
            syncRuntimeUi();
          }
        },
        onStopped: () => {
          if (current === session.current) {
            setTtsState('idle');
            runtime.current = stopNarrationRuntime(runtime.current);
            syncRuntimeUi();
          }
        },
        onError: () => {
          if (current === session.current) {
            setError('Không phát được giọng đọc. Hãy kiểm tra cài đặt giọng nói trên máy.');
            setTtsState('idle');
            runtime.current = setNarrationStatus(runtime.current, 'error');
            syncRuntimeUi();
          }
        },
      });
      markNarrationPlayed(item);
    } catch {
      if (current === session.current) {
        setMode('idle');
        setError('Không thể bắt đầu phát thuyết minh.');
        runtime.current = setNarrationStatus(runtime.current, 'error');
        syncRuntimeUi();
      }
    }
  }, [item, origin, poi.priority, syncRuntimeUi, audioPlayer, language, rate]);

  useEffect(() => {
    if (!autoStart || !item || !isFocused) return;
    const key = `${poi.id}:${language}:${origin}`;
    if (autoStartedKey.current === key) return;
    autoStartedKey.current = key;
    void start();
  }, [autoStart, item, isFocused, language, origin, poi.id, start]);

  const toggle = async () => {
    if (!item) return;
    if (mode === 'audio') {
      if (pendingAudio) return;
      if (audioStatus.playing) {
        audioPlayer.pause();
        runtime.current = setNarrationStatus(runtime.current, 'paused');
        syncRuntimeUi();
      }
      else if (audioStatus.isLoaded) {
        if (audioStatus.didJustFinish || (audioStatus.duration > 0 && audioStatus.currentTime >= audioStatus.duration)) {
          await audioPlayer.seekTo(0);
        }
        audioPlayer.play();
        runtime.current = setNarrationStatus(runtime.current, 'playing');
        syncRuntimeUi();
      } else await start();
      return;
    }
    if (mode === 'tts' && ttsState === 'playing') {
      if (Platform.OS === 'ios' || Platform.OS === 'web') {
        try {
          await Speech.pause();
          setTtsState('paused');
          runtime.current = setNarrationStatus(runtime.current, 'paused');
          syncRuntimeUi();
        }
        catch { stop(); }
      } else stop(); // Android does not support Speech.pause().
      return;
    }
    if (mode === 'tts' && ttsState === 'paused') {
      try {
        await Speech.resume();
        setTtsState('playing');
        runtime.current = setNarrationStatus(runtime.current, 'playing');
        syncRuntimeUi();
      }
      catch { await start(); }
      return;
    }
    await start();
  };

  const playing = mode === 'tts' ? ttsState === 'playing' : mode === 'audio' && audioStatus.playing;
  const progress = mode === 'audio' && audioStatus.duration > 0
    ? Math.min(1, audioStatus.currentTime / audioStatus.duration)
    : 0;
  const actionText = pendingAudio ? 'Đang tải audio...'
    : playing ? (Platform.OS === 'android' && mode === 'tts' ? '■ Dừng' : 'Ⅱ Tạm dừng')
      : mode === 'tts' && ttsState === 'paused' ? '▶ Tiếp tục'
        : mode === 'audio' && audioStatus.isLoaded ? '▶ Tiếp tục'
          : '▶ Nghe thuyết minh';

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>🎧 TRÌNH PHÁT THUYẾT MINH</Text>
      <Text style={styles.title}>{poi.name[language] ?? poi.name.vi}</Text>
      <Text style={styles.subTitle}>
        {item?.source === 'audio-file' ? 'Bản thu âm (MP3 / audio)' : 'Giọng đọc tự động (TTS)'}
        {' · '}{language.toUpperCase()}
      </Text>
      <View style={styles.engineRow}>
        <Text style={styles.engineBadge}>QUEUE V2 · {queueSize > 0 ? `${queueSize} tác vụ` : 'sẵn sàng'}</Text>
        <Text style={styles.engineHint}>chống phát trùng</Text>
      </View>
      {mode === 'audio' && (
        <View style={styles.timeline}>
          <View style={styles.track}><View style={[styles.fill, { width: `${progress * 100}%` }]} /></View>
          <Text style={styles.time}>{formatTime(audioStatus.currentTime)} / {formatTime(audioStatus.duration)}</Text>
        </View>
      )}
      <View style={styles.actions}>
        <Pressable
          onPress={() => { void toggle(); }}
          disabled={!item || pendingAudio}
          accessibilityRole="button"
          accessibilityLabel={actionText}
          style={[styles.play, (!item || pendingAudio) && styles.disabled]}
        >
          <Text style={styles.playText}>{actionText}</Text>
        </Pressable>
        <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel="Dừng phát" style={styles.stop}>
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
              if (mode === 'audio') audioPlayer.setPlaybackRate(value);
            }}
            style={[styles.rateChip, rate === value && styles.rateActive]}
          >
            <Text style={[styles.rateText, rate === value && styles.rateActiveText]}>{value}×</Text>
          </Pressable>
        ))}
      </View>
      {!item && <Text style={styles.warning}>Chưa có nội dung cho ngôn ngữ này.</Text>}
      {!!error && <Text style={styles.warning}>{error}</Text>}
      <Text style={styles.hint}>
        {origin === 'qr' ? 'Được kích hoạt từ QR. ' : 'Chỉ phát khi bạn nhấn nghe. '}Chuyển màn hình hoặc đổi ngôn ngữ sẽ dừng thuyết minh.
        {Platform.OS === 'ios' ? ' Nếu iPhone không có tiếng TTS, hãy tắt chế độ im lặng.' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: 18 },
  eyebrow: { color: colors.primary, fontSize: 10, letterSpacing: 1, fontWeight: '800' },
  title: { fontSize: 17, color: colors.text, fontWeight: '800', marginTop: 8 },
  subTitle: { fontSize: 12, color: colors.muted, marginTop: 5 },
  engineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  engineBadge: { color: colors.teal, backgroundColor: '#E6EFE9', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 99 },
  engineHint: { color: colors.muted, fontSize: 10 },
  timeline: { marginTop: 16 },
  track: { height: 6, borderRadius: 99, backgroundColor: '#E8E4DC', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.teal },
  time: { color: colors.muted, fontSize: 11, textAlign: 'right', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 16 },
  play: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 12, padding: 13 },
  playText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stop: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingHorizontal: 15, backgroundColor: '#F0E8DB' },
  stopText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  rateLabel: { color: colors.muted, fontSize: 12, marginRight: 2 },
  rateChip: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9 },
  rateActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  rateText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  rateActiveText: { color: '#fff' },
  warning: { color: colors.primaryDark, fontSize: 12, marginTop: 12 },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 14 },
});
