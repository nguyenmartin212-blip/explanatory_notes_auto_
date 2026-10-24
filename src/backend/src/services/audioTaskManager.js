// AudioTaskManager: runs audio-generation tasks in the background.
// - At most `audioMaxConcurrency` (3) tasks run at the same time.
// - Task state lives in the `audio_tasks` collection, so it survives a restart (startup recovery requeues
//   tasks that were 'running').
// - Statuses: queued, running, paused, completed, failed, cancelled.
// - Admin actions: pause, resume, cancel, retry. A running task is interrupted cooperatively at the next
//   stage boundary (it is never killed mid-write).
// Pipeline per task:  source text -> translate -> cache lookup -> Edge-TTS -> save MP3 -> update localization
// The manager polls the database for queued tasks (every `audioPollIntervalSeconds`, or immediately after an
// admin action / a finished task), and claims them atomically, so it also works with more than one worker
// process. Pause/cancel of a *running* task only works from the process that runs it.
import path from 'node:path';
import { ConflictError, NotFoundError, TtsError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import * as contentService from './contentService.js';
import { iso } from './poiPayload.js';
import { audioTaskStore, poiLocalizationStore } from '../stores/index.js';

export const STAGE_PROGRESS = {
  translating: 10,
  checking_cache: 30,
  synthesizing: 40,
  saving: 85,
  updating_localization: 95,
};

class Interrupted extends Error {
  constructor(kind) { super(kind); this.kind = kind; } // "pause" | "cancel" | "shutdown"
}

/** Public JSON shape of a task (admin API and SSE). */
export function taskView(doc) {
  return {
    task_id: doc.task_id ?? null,
    poi_id: doc.poi_id ?? null,
    language: doc.language ?? null,
    source_lang: doc.source_lang ?? null,
    status: doc.status ?? null,
    stage: doc.stage ?? null,
    progress: doc.progress ?? 0,
    error: doc.error ?? null,
    attempts: doc.attempts ?? 0,
    cache_hit: doc.cache_hit ?? null,
    result: doc.result ?? null,
    audio_url: doc.audio_url ?? null,
    created_at: iso(doc.created_at),
    queued_at: iso(doc.queued_at),
    started_at: iso(doc.started_at),
    finished_at: iso(doc.finished_at),
    updated_at: iso(doc.updated_at),
  };
}

export class AudioTaskManager {
  constructor(db, settings, tts) {
    this.db = db;
    this.settings = settings;
    this.tts = tts;
    this.maxConcurrency = Number(settings.audioMaxConcurrency ?? 3);
    this.pollInterval = Number(settings.audioPollIntervalSeconds ?? 2.0);
    this.running = new Map(); // task_id -> Promise
    this.interrupts = new Map(); // task_id -> "pause" | "cancel"
    this.waker = null;
    this.wakePending = false;
    this.stopping = false;
  }

  // ---- Dispatcher ---------------------------------------------------------------------------------
  get runningCount() { return this.running.size; }

  wake() {
    if (this.waker) this.waker();
    else this.wakePending = true;
  }

  sleepOrWake(signal) {
    if (this.wakePending) {
      this.wakePending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        this.waker = null;
        resolve();
      };
      const timer = setTimeout(done, this.pollInterval * 1000);
      signal?.addEventListener('abort', done, { once: true });
      this.waker = done;
    });
  }

  /** Dispatcher loop; run it as a background worker (stops when `signal` is aborted). */
  async run(signal) {
    try {
      while (!signal?.aborted) {
        if (this.running.size >= this.maxConcurrency) {
          await this.sleepOrWake(signal); // a finished task calls wake()
          continue;
        }
        let task;
        try {
          task = await audioTaskStore.claimNext(this.db);
        } catch (err) {
          logger.exception('Cannot claim an audio task', err);
          await this.sleepOrWake(signal);
          continue;
        }
        if (!task) {
          await this.sleepOrWake(signal);
          continue;
        }
        const job = this.runTask(task);
        this.running.set(task.task_id, job);
      }
    } finally {
      // Shutdown: running tasks stop at their next stage boundary and stay 'running' in the database, so
      // restart recovery requeues them (same behaviour as cancelling the asyncio tasks in the Python version).
      this.stopping = true;
      const jobs = [...this.running.values()];
      await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 2000).unref())]);
    }
  }

  // ---- One task -----------------------------------------------------------------------------------
  async runTask(task) {
    const taskId = task.task_id;
    try {
      let status;
      let fields;
      try {
        fields = await this.pipeline(task);
        status = audioTaskStore.COMPLETED;
        Object.assign(fields, { progress: 100, stage: 'completed' });
      } catch (err) {
        if (err instanceof Interrupted) {
          if (err.kind === 'shutdown') return; // leave it 'running': recovery requeues it
          status = err.kind === 'pause' ? audioTaskStore.PAUSED : audioTaskStore.CANCELLED;
          fields = { stage: status };
        } else {
          logger.exception(`Audio task ${taskId} failed`, err);
          const message = (String(err.message || '').slice(0, 500)) || err.constructor.name;
          status = audioTaskStore.FAILED;
          fields = { error: message, stage: 'failed' };
          try {
            await contentService.failAudio(this.db, {
              poiId: task.poi_id, language: task.language, contentHash: task.content_hash, error: message,
            });
          } catch (err2) {
            logger.exception(`Cannot record audio failure for task ${taskId}`, err2);
          }
        }
      }
      this.interrupts.delete(taskId);
      await audioTaskStore.finalize(this.db, taskId, { status, fields });
    } catch (err) {
      logger.exception(`Audio task ${taskId} could not be finalized`, err);
    } finally {
      this.running.delete(taskId);
      this.wake();
    }
  }

  async stage(task, name, extra = null) {
    await audioTaskStore.setProgress(this.db, task.task_id, { stage: name, progress: STAGE_PROGRESS[name], extra });
    if (this.stopping) throw new Interrupted('shutdown');
    const kind = this.interrupts.get(task.task_id);
    if (kind) throw new Interrupted(kind);
  }

  async pipeline(task) {
    const { poi_id: poiId, language } = task;
    if (this.settings.mediaStorageBackend.trim().toLowerCase() !== 'local') {
      throw new TtsError('Media storage is disabled (MEDIA_STORAGE_BACKEND=none): cannot save audio');
    }
    if ((await poiLocalizationStore.get(this.db, poiId, language)) === null) {
      return { result: 'discarded', error: 'localization no longer exists' };
    }

    const source = task.source_lang || language;
    await this.stage(task, 'translating');
    const spoken = await this.tts.translate(task.text, source, language);

    const key = this.tts.cacheKey(spoken, language);
    await this.stage(task, 'checking_cache');
    const cacheHit = this.tts.cacheHas(key);
    if (!cacheHit) await this.stage(task, 'synthesizing');
    const result = await this.tts.ensureAudio(spoken, language);

    await this.stage(task, 'saving', { cache_hit: result.cacheHit });
    const relPath = `audio/${poiId}/${language}-${result.cacheKey}.mp3`;
    const { sha256, size } = await this.tts.storeAudio(result.cacheKey, path.join(this.settings.mediaDir, relPath));
    const audioUrl = `${this.settings.mediaPublicPrefix.replace(/\/+$/, '')}/${relPath}`;

    await this.stage(task, 'updating_localization');
    const accepted = await contentService.completeAudio(this.db, this.settings, {
      poiId, language, contentHash: task.content_hash, audioPath: relPath, audioUrl, audioSha256: sha256, audioSize: size,
    });
    if (accepted) return { cache_hit: result.cacheHit, result: 'ok', audio_url: audioUrl, error: null };
    // The text changed (or the POI was deleted) while the audio was generated.
    return { cache_hit: result.cacheHit, result: 'stale', audio_url: null };
  }

  // ---- Admin actions ------------------------------------------------------------------------------
  async getTask(taskId) {
    const doc = await audioTaskStore.get(this.db, taskId);
    if (!doc) throw new NotFoundError(`Audio task '${taskId}' not found`);
    return doc;
  }

  interruptRunning(doc, kind) {
    const taskId = doc.task_id;
    if (!this.running.has(taskId)) {
      throw new ConflictError('Task is running in another process or is orphaned; cannot interrupt it here');
    }
    this.interrupts.set(taskId, kind);
    return { ...taskView(doc), interrupt_requested: kind };
  }

  async pause(taskId) {
    let doc = await this.getTask(taskId);
    if (doc.status === audioTaskStore.QUEUED) {
      const moved = await audioTaskStore.transition(this.db, taskId, {
        fromStatuses: [audioTaskStore.QUEUED], toStatus: audioTaskStore.PAUSED,
      });
      if (moved) return taskView(moved);
      doc = await this.getTask(taskId); // it was claimed in the meantime
    }
    if (doc.status === audioTaskStore.RUNNING) return this.interruptRunning(doc, 'pause');
    throw new ConflictError(`Cannot pause a ${doc.status} task`);
  }

  async cancel(taskId) {
    let doc = await this.getTask(taskId);
    if (doc.status === audioTaskStore.QUEUED || doc.status === audioTaskStore.PAUSED) {
      const moved = await audioTaskStore.transition(this.db, taskId, {
        fromStatuses: [audioTaskStore.QUEUED, audioTaskStore.PAUSED],
        toStatus: audioTaskStore.CANCELLED,
        fields: { stage: 'cancelled' },
      });
      if (moved) return taskView(moved);
      doc = await this.getTask(taskId);
    }
    if (doc.status === audioTaskStore.RUNNING) return this.interruptRunning(doc, 'cancel');
    throw new ConflictError(`Cannot cancel a ${doc.status} task`);
  }

  async resume(taskId) {
    const doc = await this.getTask(taskId);
    const moved = await audioTaskStore.transition(this.db, taskId, {
      fromStatuses: [audioTaskStore.PAUSED], toStatus: audioTaskStore.QUEUED, fields: { stage: null, progress: 0 },
    });
    if (!moved) throw new ConflictError(`Cannot resume a ${doc.status} task`);
    this.wake();
    return taskView(moved);
  }

  async retry(taskId) {
    const doc = await this.getTask(taskId);
    const moved = await audioTaskStore.transition(this.db, taskId, {
      fromStatuses: [audioTaskStore.FAILED, audioTaskStore.CANCELLED],
      toStatus: audioTaskStore.QUEUED,
      fields: { stage: null, progress: 0, error: null, result: null, finished_at: null },
    });
    if (!moved) throw new ConflictError(`Cannot retry a ${doc.status} task`);
    await contentService.resetAudioPending(this.db, {
      poiId: moved.poi_id, language: moved.language, contentHash: moved.content_hash,
    });
    this.wake();
    return taskView(moved);
  }

  async listTasks(limit = 100) {
    return (await audioTaskStore.listRecent(this.db, limit)).map(taskView);
  }
}
