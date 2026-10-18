"""MongoDB collection names and their purpose (Chapter 00)."""

POI = "POI"  # điểm tham quan (nội dung gốc)
POI_LOCALIZATIONS = "poi_localizations"  # bản dịch / nội dung theo ngôn ngữ của POI
AUDIO_TASKS = "audio_tasks"  # tác vụ sinh/xử lý audio (có thể phục hồi sau restart)
ADMIN_USERS = "admin_users"  # tài khoản quản trị
ROLES = "roles"  # vai trò và quyền
AUDIT_LOGS = "audit_logs"  # nhật ký thao tác quản trị
AI_USAGE_LIMITS = "ai_usage_limits"  # hạn mức sử dụng AI advisor

# Chapter 05 — hỗ trợ đồng bộ dữ liệu POI
DATASET_META = "dataset_meta"  # bộ đếm dataset_version của POI đã công khai
POI_TOMBSTONES = "poi_tombstones"  # POI đã bị xóa/gỡ công khai, phục vụ removed_poi_ids

# Chapter 08 — UI bundles dịch tự động (long-tail locale)
UI_BUNDLES = "ui_bundles"  # bản dịch giao diện public-ui đã dịch xong, theo (namespace, locale)
