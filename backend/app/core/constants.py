"""Các con số cố định của hệ thống. Muốn đổi thì sửa ở đây."""

# Người dùng được tính là "đang online" nếu có nhịp heartbeat trong N giây gần nhất
ONLINE_WINDOW_SECONDS = 90

# Giới hạn độ dài văn bản đem đi sinh giọng đọc
MAX_TTS_CHARS = 3000

# Ngôn ngữ dự phòng (tầng 2 của fallback) và ngôn ngữ gốc (tầng 3)
FALLBACK_LANG = "en"
SOURCE_LANG = "vi"

# Mã ngôn ngữ của hệ thống -> mã mà Google Translate hiểu
TRANSLATE_CODES = {"zh": "zh-CN"}

# Các loại sự kiện thống kê được phép ghi
EVENT_TYPES = ["qr_scan", "view_poi", "play_audio", "finish_audio", "change_lang"]
