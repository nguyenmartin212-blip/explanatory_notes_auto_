// Server-Sent Events stream of audio task progress.
// GET /admin/audio-tasks/stream sends:
//   event: snapshot   the most recent tasks, once, when the client connects
//   event: task       every time a task changes (status, stage or progress)
//   : keepalive       a comment line while nothing changes
// Changes are read from the database (the `updated_at` of each task), not from in-process events, so the
// stream works with several worker processes.
import { taskView } from './audioTaskManager.js';
import { audioTaskStore } from '../stores/index.js';

export function formatSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const defaultSleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const defaultClock = () => performance.now() / 1000;

/** Async generator of SSE chunks. `isDisconnected()` is polled between iterations. */
export async function* eventStream(db, {
  isDisconnected,
  pollSeconds = 1.0,
  keepaliveSeconds = 15.0,
  snapshotLimit = 100,
  sleep = defaultSleep,
  clock = defaultClock,
}) {
  const snapshot = await audioTaskStore.listRecent(db, snapshotLimit);
  yield formatSse('snapshot', { tasks: snapshot.map(taskView) });

  // Several changes can share one millisecond: a task counts as "already sent" only if time AND state match.
  const signature = (doc) => `${doc.updated_at.getTime()}|${doc.status}|${doc.stage}|${doc.progress}`;
  const seen = new Map(snapshot.filter((t) => t.updated_at).map((t) => [t.task_id, signature(t)]));
  let cursor = snapshot.length && snapshot.some((t) => t.updated_at)
    ? new Date(Math.max(...snapshot.filter((t) => t.updated_at).map((t) => t.updated_at.getTime())))
    : new Date();
  let lastSent = clock();

  while (!(await isDisconnected())) {
    await sleep(pollSeconds);
    let emitted = false;
    for (const doc of await audioTaskStore.listUpdatedSince(db, cursor)) {
      const updatedAt = doc.updated_at;
      if (!updatedAt || seen.get(doc.task_id) === signature(doc)) continue;
      seen.set(doc.task_id, signature(doc));
      if (updatedAt > cursor) cursor = updatedAt;
      emitted = true;
      yield formatSse('task', taskView(doc));
    }
    if (emitted) {
      lastSent = clock();
    } else if (clock() - lastSent >= keepaliveSeconds) {
      lastSent = clock();
      yield ': keepalive\n\n';
    }
  }
}
