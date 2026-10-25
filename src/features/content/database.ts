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

export type AppPreferences = {
  language: 'vi' | 'en' | 'zh' | 'ko';
  autoPlayNarration: boolean;
};

const DEFAULT_PREFERENCES: AppPreferences = {
  language: 'vi',
  autoPlayNarration: false,
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

    CREATE TABLE IF NOT EXISTS saved_pois (
      poi_id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS itinerary_pois (
      poi_id TEXT PRIMARY KEY NOT NULL,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_preferences (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
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

export async function getSavedPois(): Promise<Poi[]> {
  const db = await initContentDatabase();
  const rows = await db.getAllAsync<PoiRow>(
    `SELECT p.* FROM pois p
     INNER JOIN saved_pois s ON s.poi_id = p.id
     ORDER BY s.created_at DESC`,
  );
  return rows.map(rowToPoi);
}

export async function isPoiSaved(poiId: string): Promise<boolean> {
  const db = await initContentDatabase();
  const row = await db.getFirstAsync<{ poi_id: string }>(
    'SELECT poi_id FROM saved_pois WHERE poi_id = ?',
    poiId,
  );
  return row !== null;
}

export async function toggleSavedPoi(poiId: string): Promise<boolean> {
  const db = await initContentDatabase();
  const saved = await isPoiSaved(poiId);
  if (saved) {
    await db.runAsync('DELETE FROM saved_pois WHERE poi_id = ?', poiId);
    return false;
  }
  await db.runAsync(
    'INSERT OR IGNORE INTO saved_pois (poi_id, created_at) VALUES (?, ?)',
    poiId,
    Date.now(),
  );
  return true;
}

export async function getItineraryPois(): Promise<Poi[]> {
  const db = await initContentDatabase();
  const rows = await db.getAllAsync<PoiRow>(
    `SELECT p.* FROM pois p
     INNER JOIN itinerary_pois i ON i.poi_id = p.id
     ORDER BY i.position ASC`,
  );
  return rows.map(rowToPoi);
}

export async function addPoiToItinerary(poiId: string): Promise<void> {
  const db = await initContentDatabase();
  const poi = await db.getFirstAsync<{ id: string }>('SELECT id FROM pois WHERE id = ?', poiId);
  if (!poi) throw new Error('Không tìm thấy điểm đến để thêm vào lộ trình.');
  const position = await db.getFirstAsync<{ next_position: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM itinerary_pois',
  );
  await db.runAsync(
    'INSERT OR IGNORE INTO itinerary_pois (poi_id, position, created_at) VALUES (?, ?, ?)',
    poiId,
    position?.next_position ?? 0,
    Date.now(),
  );
}

export async function removePoiFromItinerary(poiId: string): Promise<void> {
  const db = await initContentDatabase();
  await db.runAsync('DELETE FROM itinerary_pois WHERE poi_id = ?', poiId);
  await normalizeItineraryPositions(db);
}

export async function moveItineraryPoi(poiId: string, direction: -1 | 1): Promise<void> {
  const db = await initContentDatabase();
  await db.withTransactionAsync(async () => {
    const rows = await db.getAllAsync<{ poi_id: string; position: number }>(
      'SELECT poi_id, position FROM itinerary_pois ORDER BY position ASC',
    );
    const currentIndex = rows.findIndex((row) => row.poi_id === poiId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= rows.length) return;
    [rows[currentIndex], rows[targetIndex]] = [rows[targetIndex]!, rows[currentIndex]!];
    for (let index = 0; index < rows.length; index += 1) {
      await db.runAsync(
        'UPDATE itinerary_pois SET position = ? WHERE poi_id = ?',
        index,
        rows[index]!.poi_id,
      );
    }
  });
}

export async function clearItinerary(): Promise<void> {
  const db = await initContentDatabase();
  await db.runAsync('DELETE FROM itinerary_pois');
}

export async function getAppPreferences(): Promise<AppPreferences> {
  const db = await initContentDatabase();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM app_preferences',
  );
  const stored = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  const language = stored.language;
  return {
    language: language === 'en' || language === 'zh' || language === 'ko'
      ? language
      : DEFAULT_PREFERENCES.language,
    autoPlayNarration: stored.autoPlayNarration === 'true'
      ? true
      : DEFAULT_PREFERENCES.autoPlayNarration,
  };
}

export async function updateAppPreferences(
  preferences: Partial<AppPreferences>,
): Promise<AppPreferences> {
  const db = await initContentDatabase();
  for (const [key, value] of Object.entries(preferences)) {
    if (value !== undefined) {
      await db.runAsync(
        `INSERT INTO app_preferences (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        key,
        String(value),
      );
    }
  }
  return getAppPreferences();
}

async function normalizeItineraryPositions(db: SQLite.SQLiteDatabase) {
  const rows = await db.getAllAsync<{ poi_id: string }>(
    'SELECT poi_id FROM itinerary_pois ORDER BY position ASC',
  );
  for (let index = 0; index < rows.length; index += 1) {
    await db.runAsync(
      'UPDATE itinerary_pois SET position = ? WHERE poi_id = ?',
      index,
      rows[index]!.poi_id,
    );
  }
}
