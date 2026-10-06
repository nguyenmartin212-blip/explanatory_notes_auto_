import type { NarrationItem } from '../types';

const playedAt = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;

export function canPlayNarration(
  item: NarrationItem,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
) {
  const lastPlayed = playedAt.get(item.poiId);
  return !lastPlayed || now - lastPlayed >= cooldownMs;
}

export function markNarrationPlayed(item: NarrationItem, now = Date.now()) {
  playedAt.set(item.poiId, now);
}

export function resetNarrationHistory() {
  playedAt.clear();
}
