export const ADMIN_PERMISSION_GROUPS = [
  {
    name: 'Điểm tham quan',
    permissions: [
      ['poi:read', 'Xem điểm tham quan'],
      ['poi:read_draft', 'Xem điểm chưa kích hoạt'],
      ['poi:create', 'Tạo điểm tham quan'],
      ['poi:update', 'Chỉnh sửa điểm tham quan'],
      ['poi:delete', 'Xóa điểm tham quan'],
      ['poi:activate', 'Kích hoạt điểm tham quan'],
    ],
  },
  {
    name: 'Âm thanh',
    permissions: [
      ['audio:read', 'Xem âm thanh'],
      ['audio:generate', 'Tạo yêu cầu âm thanh'],
      ['audio:manage', 'Quản lý tác vụ âm thanh'],
      ['audio:delete', 'Xóa tệp âm thanh'],
    ],
  },
  {
    name: 'Ngôn ngữ',
    permissions: [
      ['localization:read', 'Xem bản dịch'],
      ['localization:update', 'Sửa bản dịch'],
      ['localization:translate', 'Tự động dịch'],
    ],
  },
  {
    name: 'Tài khoản',
    permissions: [
      ['user:read', 'Xem tài khoản'],
      ['user:create', 'Tạo tài khoản'],
      ['user:update', 'Cập nhật tài khoản và vai trò'],
      ['user:delete', 'Xóa tài khoản'],
    ],
  },
  {
    name: 'Vai trò',
    permissions: [
      ['role:read', 'Xem vai trò'],
      ['role:create', 'Tạo vai trò'],
      ['role:update', 'Chỉnh quyền vai trò'],
      ['role:delete', 'Xóa vai trò'],
    ],
  },
  {
    name: 'Chủ điểm tham quan',
    permissions: [
      ['owner:read', 'Xem tài khoản chủ điểm'],
      ['owner:profile', 'Quản lý hồ sơ chủ điểm'],
      ['owner:verify', 'Xác minh chủ điểm'],
      ['owner:view_cccd', 'Xem CCCD đã giải mã'],
    ],
  },
  {
    name: 'Thống kê và khách QR',
    permissions: [
      ['analytics:read', 'Xem thống kê'],
      ['analytics:export', 'Xuất thống kê'],
      ['visitor:read', 'Xem lượt khách QR'],
    ],
  },
  {
    name: 'AI và hệ thống',
    permissions: [
      ['ai:use', 'Sử dụng trợ lý AI'],
      ['ai:manage_limits', 'Quản lý giới hạn AI'],
      ['system:audit_read', 'Xem nhật ký kiểm toán'],
      ['system:runtime_read', 'Xem tình trạng hệ thống'],
      ['system:i18n_manage', 'Quản lý bản dịch giao diện'],
    ],
  },
] as const;

export function hasAdminPermission(permissions: string[] | undefined, permission: string) {
  return Boolean(permissions?.includes('*') || permissions?.includes(permission));
}
