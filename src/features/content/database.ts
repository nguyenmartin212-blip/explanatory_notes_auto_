import * as SQLite from 'expo-sqlite';
import { mockPois, type Poi } from '@/features/poi';

const DB_NAME = 'go-to-horizon.db';
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type PoiRow = {
  id: string;
  name_json: string;
  description_json: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  priority: number;
  images_json: string;
  audio_json: string | null;
  tts_script_json: string | null;
  map_url: string | null;
  updated_at: number;
};

function rowToPoi(row: PoiRow): Poi {
  return {
    id: row.id,
    name: parseJson(row.name_json, { vi: row.id }),
    description: parseJson(row.description_json, { vi: '' }),
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radius_meters,
    priority: row.priority,
    images: parseJson(row.images_json, [] as string[]),
    audio: parseJson(row.audio_json, undefined),
    ttsScript: parseJson(row.tts_script_json, undefined),
    mapUrl: row.map_url ?? undefined,
  };
}

async function openDatabase() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

export async function initContentDatabase() {
  const db = await openDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS pois (
      id TEXT PRIMARY KEY NOT NULL,
      name_json TEXT NOT NULL,
      description_json TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      images_json TEXT NOT NULL DEFAULT '[]',
      audio_json TEXT,
      tts_script_json TEXT,
      map_url TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pois_priority ON pois(priority DESC);
  `);

  const count = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pois');
  if ((count?.count ?? 0) === 0) {
    await replaceOfflinePois(mockPois);
  }

  return db;
}

export async function replaceOfflinePois(pois: Poi[]) {
  const db = await openDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM pois');
    const now = Date.now();
    for (const poi of pois) {
      await db.runAsync(
        `INSERT INTO pois (
          id, name_json, description_json, latitude, longitude,
          radius_meters, priority, images_json, audio_json,
          tts_script_json, map_url, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        poi.id,
        json(poi.name),
        json(poi.description),
        poi.latitude,
        poi.longitude,
        poi.radiusMeters,
        poi.priority,
        json(poi.images),
        poi.audio ? json(poi.audio) : null,
        poi.ttsScript ? json(poi.ttsScript) : null,
        poi.mapUrl ?? null,
        now,
      );
    }
  });
}

export async function getOfflinePois(): Promise<Poi[]> {
  const db = await initContentDatabase();
  const rows = await db.getAllAsync<PoiRow>(
    'SELECT * FROM pois ORDER BY priority DESC, id ASC',
  );
  return rows.map(rowToPoi);
}

export async function getOfflinePoiById(id: string): Promise<Poi | null> {
  const db = await initContentDatabase();
  const row = await db.getFirstAsync<PoiRow>('SELECT * FROM pois WHERE id = ?', id);
  return row ? rowToPoi(row) : null;
}

export async function getOfflineContentStats() {
  const db = await initContentDatabase();
  const row = await db.getFirstAsync<{ count: number; updated_at: number | null }>(
    'SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM pois',
  );
  return {
    poiCount: row?.count ?? 0,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function resetOfflineContent() {
  const db = await openDatabase();
  await db.runAsync('DELETE FROM pois');
  await replaceOfflinePois(mockPois);
}
