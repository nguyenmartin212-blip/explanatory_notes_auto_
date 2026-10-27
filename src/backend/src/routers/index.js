import * as admin from './admin.js';
import * as aiAdvisor from './aiAdvisor.js';
import * as analytics from './analytics.js';
import * as audio from './audio.js';
import * as content from './content.js';
import * as localization from './localization.js';
import * as maps from './maps.js';
import * as owner from './owner.js';
import * as runtimeObservability from './runtimeObservability.js';
import * as uiI18n from './uiI18n.js';
import * as visitors from './visitors.js';

/** The 11 routers of the system (Chapter 00). Order is the mount order. `path` is the mount prefix. */
export const ROUTERS = [
  { tag: 'content', path: '', router: content.router },
  { tag: 'audio', path: '/audio', router: audio.router },
  { tag: 'admin', path: '/admin', router: admin.router },
  { tag: 'owner', path: '/api/owner', router: owner.router },
  { tag: 'ai_advisor', path: '/api/ai-advisor', router: aiAdvisor.router },
  { tag: 'analytics', path: '/api/analytics', router: analytics.router },
  { tag: 'localization', path: '', router: localization.router },
  { tag: 'maps', path: '/api/maps', router: maps.router },
  { tag: 'runtime_observability', path: '/api/runtime-observability', router: runtimeObservability.router },
  { tag: 'ui_i18n', path: '/api/v1/ui-bundles', router: uiI18n.router },
  { tag: 'visitors', path: '/api/visitors', router: visitors.router },
];
