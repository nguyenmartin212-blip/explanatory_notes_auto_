export const ADMIN_PERMISSION_GROUPS = [
  {
    name: 'Thống kê và khách QR',
    permissions: [
      ['analytics:read', 'Xem thống kê thiết bị'],
      ['visitor:read', 'Xem lượt khách QR'],
    ],
  },
] as const;

export function hasAdminPermission(permissions: string[] | undefined, permission: string) {
  return Boolean(permissions?.includes('*') || permissions?.includes(permission));
}
