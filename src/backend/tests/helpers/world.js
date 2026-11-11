// Test fixture: a fake MongoDB + a temporary media directory, so the real stores/services run end to end.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeDb } from './fakeDb.js';
import * as stores from '../../src/stores/index.js';

export function makeWorld(extraSettings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ena-test-'));
  const db = new FakeDb();
  const settings = {
    isDevelopment: true,
    mediaStorageBackend: 'local',
    mediaDir: path.join(dir, 'media'),
    ttsCacheDir: path.join(dir, 'tts-cache'),
    mediaPublicPrefix: '/media',
    ttsTimeoutSeconds: 5,
    audioMaxConcurrency: 3,
    audioPollIntervalSeconds: 0.02,
    ...extraSettings,
  };
  fs.mkdirSync(settings.mediaDir, { recursive: true });
  const docs = (name) => db.collection(name).docs;
  return {
    db,
    settings,
    dir,
    /** Create the same indexes as the startup seeding (unique constraints). */
    async init() { for (const store of Object.values(stores)) await store.ensureIndexes(db); return this; },
    /** Create a media file so its deletion can be observed. */
    touch(rel) {
      const file = path.join(settings.mediaDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'mp3');
    },
    exists: (rel) => fs.existsSync(path.join(settings.mediaDir, rel)),
    version: () => docs('dataset_meta').find((d) => d._id === 'poi_dataset')?.version ?? 0,
    loc: (poiId, language) => docs('poi_localizations').find((d) => d.poi_id === poiId && d.language === language),
    pois: () => docs('POI'),
    locs: () => docs('poi_localizations'),
    tasks: () => docs('audio_tasks'),
    tombstones: () => docs('poi_tombstones'),
    clearTasks() { db.collection('audio_tasks').docs.length = 0; },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
