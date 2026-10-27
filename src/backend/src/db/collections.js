// MongoDB collection names and their purpose (Chapter 00).
export const POI = 'POI'; // điểm tham quan (nội dung gốc)
export const POI_LOCALIZATIONS = 'poi_localizations'; // bản dịch / nội dung theo ngôn ngữ của POI
export const AUDIO_TASKS = 'audio_tasks'; // tác vụ sinh/xử lý audio (có thể phục hồi sau restart)
export const ADMIN_USERS = 'admin_users'; // tài khoản quản trị
export const ROLES = 'roles'; // vai trò và quyền
export const AUDIT_LOGS = 'audit_logs'; // nhật ký thao tác quản trị
export const AI_USAGE_LIMITS = 'ai_usage_limits'; // hạn mức sử dụng AI advisor
export const VISITOR_VISITS = 'visitor_visits'; // lượt vào / rời điểm tham quan, mã khách ẩn danh

// Chapter 05 — hỗ trợ đồng bộ dữ liệu POI
export const DATASET_META = 'dataset_meta'; // bộ đếm dataset_version của POI đã công khai
export const POI_TOMBSTONES = 'poi_tombstones'; // POI đã bị xóa/gỡ công khai, phục vụ removed_poi_ids

// Chapter 08 — UI bundles dịch tự động (long-tail locale)
export const UI_BUNDLES = 'ui_bundles'; // bản dịch giao diện public-ui đã dịch xong, theo (namespace, locale)

// Chapter 09 — device presence and usage analytics
export const DEVICE_PRESENCE = 'device_presence'; // thiết bị hoạt động gần đây
export const DEVICE_USAGE_SESSIONS = 'device_usage_sessions'; // các phiên sử dụng được ghi nhận
