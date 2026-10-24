// Seed the 3 demo POIs of the app (same data as the FE `src/features/poi/mockData.ts`).
//
//   npm run seed:pois                 # create/update the POIs and make them public
//   node scripts/seed-pois.js --draft # create/update them but keep them private
//
// Safe to run any number of times: a POI is created only if its id does not exist, otherwise it is updated in
// place (upsert by poi_id; localizations by (poi_id, language)). Nothing is duplicated, an unchanged POI does
// not change `dataset_version`, and an audio file is regenerated only if its text changed.
//
// The demo data has no audio, so these POIs do not meet the normal activation rule (English audio ready); the
// script activates them with `force: true`. Audio tasks are queued automatically and are processed when the
// API server runs; until then the app falls back to the device TTS (it reads `ttsScript`).
import { pathToFileURL } from 'node:url';
import { NotFoundError } from '../src/core/errors.js';
import { getSettings } from '../src/core/config.js';
import { connectMongo } from '../src/db/mongo.js';
import { parsePoiCreate, parsePoiUpdate } from '../src/schemas/content.js';
import * as contentService from '../src/services/contentService.js';
import { audioTaskStore, poiDatasetStore, poiLocalizationStore, poiStore } from '../src/stores/index.js';

// Copied from the FE mockData.ts (the FE is the source of truth for this data).
export const DEMO_POIS = [
    {
        poi_id: "hanoi-thang-long",
        latitude: 21.0353,
        longitude: 105.8402,
        radius_meters: 80,
        priority: 10,
        images: [],
        map_url: "https://www.google.com/maps/search/?api=1&query=21.0353,105.8402",
        localizations: {
            vi: {
                name: "Hoàng thành Thăng Long",
                description: "Quần thể di sản giữa lòng Hà Nội, nơi lưu giữ nhiều lớp dấu tích của các triều đại Việt Nam.",
                tts_script: "Hoàng thành Thăng Long là không gian di sản lịch sử tiêu biểu tại Hà Nội.",
            },
            en: {
                name: "Imperial Citadel of Thang Long",
                description: "A heritage complex in the heart of Hanoi preserving traces of successive Vietnamese dynasties.",
                tts_script: "The Imperial Citadel of Thang Long is an important historic heritage site in Hanoi.",
            },
            zh: {
                name: "升龙皇城",
                description: "位于河内市中心的历史遗产群，保留着越南多个朝代的历史印记。",
                tts_script: "升龙皇城是河内重要的历史文化遗产。",
            },
        },
    },
    {
        poi_id: "hue-imperial-city",
        latitude: 16.469,
        longitude: 107.5788,
        radius_meters: 120,
        priority: 10,
        images: [],
        map_url: "https://www.google.com/maps/search/?api=1&query=16.469,107.5788",
        localizations: {
            vi: {
                name: "Đại Nội Huế",
                description: "Không gian kiến trúc cung đình của triều Nguyễn, gắn với lịch sử cố đô Huế.",
                tts_script: "Đại Nội Huế là một phần quan trọng của quần thể di tích Cố đô Huế.",
            },
            en: {
                name: "Hue Imperial City",
                description: "The Nguyen dynasty imperial complex, closely connected with the history of Hue.",
                tts_script: "Hue Imperial City is a central part of the Complex of Hue Monuments.",
            },
            zh: {
                name: "顺化皇城",
                description: "阮朝的宫廷建筑群，与顺化古都的历史密切相关。",
                tts_script: "顺化皇城是顺化古迹群的重要组成部分。",
            },
        },
    },
    {
        poi_id: "saigon-ben-thanh",
        latitude: 10.7721,
        longitude: 106.6983,
        radius_meters: 90,
        priority: 8,
        images: [],
        map_url: "https://www.google.com/maps/search/?api=1&query=10.7721,106.6983",
        localizations: {
            vi: {
                name: "Chợ Bến Thành",
                description: "Một biểu tượng thương mại và đời sống đô thị của Thành phố Hồ Chí Minh.",
                tts_script: "Chợ Bến Thành là một trong những địa điểm quen thuộc tại trung tâm Thành phố Hồ Chí Minh.",
            },
            en: {
                name: "Ben Thanh Market",
                description: "An iconic market representing the commercial and urban life of Ho Chi Minh City.",
                tts_script: "Ben Thanh Market is one of the most recognizable places in central Ho Chi Minh City.",
            },
            zh: {
                name: "滨城市场",
                description: "胡志明市具有代表性的市场，展现当地商业与城市生活。",
                tts_script: "滨城市场是胡志明市中心最具代表性的地点之一。",
            },
        },
    },
];

/** Upsert the demo POIs. Returns { poi_id: 'created' | 'updated' }. */
export async function seed(db, settings, { activate = true } = {}) {
  const result = {};
  for (const data of DEMO_POIS) {
    const poiId = data.poi_id;
    try {
      const { poi_id: _ignored, ...rest } = data;
      await contentService.updatePoi(db, settings, poiId, parsePoiUpdate(rest));
      result[poiId] = 'updated';
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      await contentService.createPoi(db, settings, parsePoiCreate(data));
      result[poiId] = 'created';
    }
    if (activate) await contentService.activatePoi(db, poiId, { force: true });
  }
  return result;
}

export async function ensureIndexes(db) {
  for (const store of [poiStore, poiLocalizationStore, poiDatasetStore, audioTaskStore]) await store.ensureIndexes(db);
}

async function main(activate) {
  const settings = getSettings();
  const { client, db } = await connectMongo(settings);
  try {
    await ensureIndexes(db);
    for (const [poiId, outcome] of Object.entries(await seed(db, settings, { activate }))) {
      console.log(`${poiId}: ${outcome}${activate ? ' (public)' : ' (draft)'}`);
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const draft = process.argv.includes('--draft');
  main(!draft).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
