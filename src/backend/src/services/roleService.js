// Dynamic roles (stored in MongoDB) and role assignment.
// Anti-escalation rules: nobody can grant a permission they do not hold themselves, the wildcard role
// (`super_admin`) is immutable and can only be handed out by a wildcard holder, and the last super admin
// cannot be demoted.
import { DEFAULT_ROLES, SUPER_ADMIN_ROLE, WILDCARD, validatePermissions } from '../auth/permissions.js';
import { ConflictError, NotFoundError, PermissionDenied, ValueError } from '../core/errors.js';
import { adminUserStore, roleStore } from '../stores/index.js';

export const ROLE_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const DEFAULT_ROLE_NAMES = new Set(DEFAULT_ROLES.map((r) => r.name));

function need(ctx, permission) {
  if (!ctx.hasPermission(permission)) {
    throw new PermissionDenied('forbidden', `Missing permission(s): ${permission}`, [permission]);
  }
}

const isWildcardHolder = (ctx) => ctx.permissions.has(WILDCARD);

/** The actor may only hand out permissions they hold themselves. */
function ensureCanGrant(ctx, permissions) {
  if (isWildcardHolder(ctx)) return;
  if (permissions.includes(WILDCARD)) throw new PermissionDenied('forbidden', 'Only a super admin can grant the wildcard permission');
  const missing = [...new Set(permissions)].filter((p) => !ctx.permissions.has(p)).sort();
  if (missing.length) {
    throw new PermissionDenied('forbidden', `Cannot grant permissions you do not hold: ${missing.join(', ')}`, missing);
  }
}

export async function listRoles(db, ctx) {
  need(ctx, 'role:read');
  return roleStore.listAll(db);
}

export async function createRole(db, ctx, { name, permissions, description = '' }) {
  need(ctx, 'role:create');
  const roleName = (name || '').trim().toLowerCase();
  if (!ROLE_NAME_RE.test(roleName)) {
    throw new ValueError('Role name must be 2-40 chars: lower-case letters, digits, underscore; start with a letter');
  }
  let perms;
  try {
    perms = validatePermissions(permissions); // unknown names and "*" are rejected
  } catch (err) {
    throw new ValueError(err.message);
  }
  ensureCanGrant(ctx, perms);
  await roleStore.create(db, { name: roleName, description: description.trim(), permissions: perms, is_default: false });
  return roleStore.get(db, roleName);
}

export async function updateRole(db, ctx, name, { permissions = null, description = null } = {}) {
  need(ctx, 'role:update');
  const role = await roleStore.get(db, name);
  if (!role) throw new NotFoundError(`Role '${name}' not found`);
  if (name === SUPER_ADMIN_ROLE) throw new ConflictError('The super_admin role cannot be modified');

  const fields = {};
  if (permissions !== null) {
    let perms;
    try {
      perms = validatePermissions(permissions);
    } catch (err) {
      throw new ValueError(err.message);
    }
    ensureCanGrant(ctx, perms);
    // Also cannot edit a role that is stronger than yourself (that would be a way to lower it).
    ensureCanGrant(ctx, [...(role.permissions || [])]);
    fields.permissions = perms;
  }
  if (description !== null) fields.description = description.trim();
  if (Object.keys(fields).length) await roleStore.update(db, name, fields);
  return roleStore.get(db, name);
}

export async function deleteRole(db, ctx, name) {
  need(ctx, 'role:delete');
  const role = await roleStore.get(db, name);
  if (!role) throw new NotFoundError(`Role '${name}' not found`);
  if (DEFAULT_ROLE_NAMES.has(name) || role.is_default) throw new ConflictError('Default roles cannot be deleted');
  const inUse = await adminUserStore.countWithRole(db, name);
  if (inUse) throw new ConflictError(`Role '${name}' is assigned to ${inUse} user(s); reassign them first`);
  await roleStore.remove(db, name);
}

export async function assignRole(db, ctx, targetUserId, roleName) {
  need(ctx, 'user:update');
  const role = await roleStore.get(db, roleName);
  if (!role) throw new NotFoundError(`Role '${roleName}' not found`);
  const target = await adminUserStore.getById(db, targetUserId);
  if (!target) throw new NotFoundError(`User '${targetUserId}' not found`);

  ensureCanGrant(ctx, [...(role.permissions || [])]);

  const current = await roleStore.get(db, target.role);
  if (current) ensureCanGrant(ctx, [...(current.permissions || [])]); // changing someone stronger than you
  if (target.role === SUPER_ADMIN_ROLE && roleName !== SUPER_ADMIN_ROLE) {
    if ((await adminUserStore.countWithRole(db, SUPER_ADMIN_ROLE)) <= 1) {
      throw new ConflictError('The last super admin cannot be demoted');
    }
  }
  await adminUserStore.setRole(db, targetUserId, roleName);
  return adminUserStore.getById(db, targetUserId);
}
