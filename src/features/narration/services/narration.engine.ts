import type { NarrationItem } from '../types';

export type NarrationStatus =
  | 'queued'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';

export type NarrationQueueItem = NarrationItem & {
  priority?: number;
  enqueuedAt: number;
  status: NarrationStatus;
};

export type NarrationRuntimeState = {
  current: NarrationQueueItem | null;
  queue: NarrationQueueItem[];
};

const playedAt = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;

function narrationKey(item: NarrationItem) {
  return [
    item.poiId,
    item.language,
    item.source ?? 'tts',
  ].join(':');
}

export function createNarrationRuntimeState(): NarrationRuntimeState {
  return {
    current: null,
    queue: [],
  };
}

export function canPlayNarration(
  item: NarrationItem,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
) {
  const lastPlayed = playedAt.get(narrationKey(item));

  return !lastPlayed || now - lastPlayed >= cooldownMs;
}

export function markNarrationPlayed(
  item: NarrationItem,
  now = Date.now(),
) {
  playedAt.set(narrationKey(item), now);
}

export function resetNarrationHistory() {
  playedAt.clear();
}

export function enqueueNarration(
  state: NarrationRuntimeState,
  item: NarrationItem,
  options?: {
    priority?: number;
    allowDuplicate?: boolean;
  },
): NarrationRuntimeState {
  const key = narrationKey(item);

  const currentKey = state.current
    ? narrationKey(state.current)
    : null;

  const existsInQueue = state.queue.some(
    (queued) => narrationKey(queued) === key,
  );

  if (
    !options?.allowDuplicate &&
    (currentKey === key || existsInQueue)
  ) {
    return state;
  }

  const queuedItem: NarrationQueueItem = {
    ...item,
    priority: options?.priority ?? 0,
    enqueuedAt: Date.now(),
    status: 'queued',
  };

  const queue = [...state.queue, queuedItem].sort((a, b) => {
    const priorityDiff =
      (b.priority ?? 0) - (a.priority ?? 0);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return a.enqueuedAt - b.enqueuedAt;
  });

  return {
    ...state,
    queue,
  };
}

export function takeNextNarration(
  state: NarrationRuntimeState,
): NarrationRuntimeState {
  if (state.current || state.queue.length === 0) {
    return state;
  }

  const next = state.queue[0];

  if (!next) {
    return state;
  }

  const rest = state.queue.slice(1);

  return {
    current: {
      ...next,
      status: 'loading',
    },
    queue: rest,
  };
}

export function setNarrationStatus(
  state: NarrationRuntimeState,
  status: NarrationStatus,
): NarrationRuntimeState {
  if (!state.current) {
    return state;
  }

  return {
    ...state,
    current: {
      ...state.current,
      status,
    },
  };
}

export function completeCurrentNarration(
  state: NarrationRuntimeState,
): NarrationRuntimeState {
  if (state.current) {
    markNarrationPlayed(state.current);
  }

  return {
    ...state,
    current: null,
  };
}

export function stopNarrationRuntime(
  state: NarrationRuntimeState,
): NarrationRuntimeState {
  return {
    current: null,
    queue: [],
  };
}