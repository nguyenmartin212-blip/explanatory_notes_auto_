// RBAC catalog: permissions grouped by domain, and the 2 default roles (only admin accounts exist).
// Permission names are `<domain>:<action>`. Roles are stored in MongoDB (`roles`) and can be edited
// at runtime; this module only defines what exists and what the default roles start with.
// The only wildcard is "*", reserved for `super_admin`.

import { ValueError } from '../core/errors.js';

export const WILDCARD = '*';

export const SUPER_ADMIN_ROLE = 'super_admin';
export const ADMIN_ROLE = 'admin';
export const USER_ROLE = 'user';
export const POI_OWNER_ROLE = 'poi_owner';

// domain -> { permission: description }
export const PERMISSION_CATALOG = {
  poi: {
    'poi:read': 'View public POIs',
    'poi:read_draft': 'View POIs that are not activated yet',
    'poi:create': 'Create POIs',
    'poi:update': 'Update POIs and their localizations',
    'poi:delete': 'Delete POIs',
    'poi:activate': 'Activate (publish) POIs',
  },
  audio: {
    'audio:read': 'View audio and audio packs',
    'audio:generate': 'Request audio generation',
    'audio:manage': 'Manage audio tasks (progress stream, pause, cancel, retry)',
    'audio:delete': 'Delete audio files',
  },
  localization: {
    'localization:read': 'View localizations',
    'localization:update': 'Edit localizations',
    'localization:translate': 'Run automatic translation',
  },
  user: {
    'user:read': 'View user accounts',
    'user:create': 'Create user accounts',
    'user:update': 'Update user accounts',
    'user:delete': 'Delete user accounts',
  },
  role: {
    'role:read': 'View roles',
    'role:create': 'Create roles',
    'role:update': 'Change role permissions',
    'role:delete': 'Delete roles',
  },
  visitor: {
    'visitor:read': 'View anonymous visitor records',
  },
  owner: {
    'owner:read': 'View assigned POI owner information',
    'owner:profile': 'Manage own POI owner profile',
    'owner:verify': 'Verify POI owner accounts',
  },
  analytics: {
    'analytics:read': 'View analytics',
    'analytics:export': 'Export analytics',
  },
  ai: {
    'ai:use': 'Use the AI advisor',
    'ai:manage_limits': 'Manage AI usage limits',
  },
  system: {
    'system:audit_read': 'Read audit logs',
    'system:runtime_read': 'Read runtime observability data',
    'system:i18n_manage': 'Manage UI translations',
  },
};

export const PERMISSIONS = Object.fromEntries(Object.values(PERMISSION_CATALOG).flatMap((g) => Object.entries(g)));
export const ALL_PERMISSIONS = new Set(Object.keys(PERMISSIONS));
export const DOMAINS = Object.keys(PERMISSION_CATALOG);

const ADMIN_EXCLUDED = new Set(['role:create', 'role:update', 'role:delete', 'user:delete', 'owner:verify',]);

export const DEFAULT_ROLES = [
  {
    name: SUPER_ADMIN_ROLE,
    description: 'Full access to everything',
    permissions: [WILDCARD],
    is_default: true,
  },
  {
    name: ADMIN_ROLE,
    description: 'Operates the system; cannot manage roles or delete users',
    permissions: [...ALL_PERMISSIONS].filter((p) => !ADMIN_EXCLUDED.has(p)).sort(),
    is_default: true,
  },
  {
    name: USER_ROLE,
    description: 'Standard account with limited access',
    permissions: ['poi:read'],
    is_default: true,
  },
  {
    name: POI_OWNER_ROLE,
    description: 'POI owner with access to own profile',
    permissions: ['poi:read', 'owner:read', 'owner:profile'],
    is_default: true,
  },
];

/** Return the permissions de-duplicated and sorted; throw if any is unknown. */
export function validatePermissions(permissions, { allowWildcard = false } = {}) {
  const seen = new Set(permissions);
  const unknown = [...seen].filter((p) => !ALL_PERMISSIONS.has(p) && !(allowWildcard && p === WILDCARD)).sort();
  if (unknown.length) throw new ValueError(`Unknown permission(s): ${JSON.stringify(unknown)}`);
  return [...seen].sort();
}
