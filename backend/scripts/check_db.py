"""Kiểm tra kết nối MySQL của backend.
Chạy trong thư mục backend (đã bật venv):   python -m scripts.check_db
"""

from sqlalchemy import inspect, text

import app.models  # noqa: F401  (để biết dự án cần những bảng nào)
from app.config import settings
from app.database import Base, engine

print(
    f"Đang kết nối tới {settings.DB_USER}@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME} ..."
)

# Gợi ý cách sửa cho các lỗi hay gặp: (đoạn chữ trong lỗi, gợi ý)
HINTS = [
    ("Access denied", "Sai DB_USER hoặc DB_PASSWORD trong file .env."),
    (
        "Unknown database",
        "Chưa có database. Hãy chạy file schema.sql trong MySQL Workbench.",
    ),
    (
        "Can't connect",
        "MySQL chưa chạy (mở Services > MySQL80 > Start) hoặc sai DB_HOST / DB_PORT.",
    ),
    ("cryptography", "Chạy: pip install cryptography"),
    ("pymysql", "Chạy: pip install pymysql"),
]

try:
    with engine.connect() as conn:
        version = conn.execute(text("SELECT VERSION()")).scalar()
    print("1) KẾT NỐI THÀNH CÔNG. Phiên bản MySQL:", version)
except Exception as e:
    print("1) KẾT NỐI THẤT BẠI.")
    print("   Lỗi:", str(e).splitlines()[0])
    for keyword, hint in HINTS:
        if keyword.lower() in str(e).lower():
            print("   Gợi ý:", hint)
            break
    raise SystemExit(1)

existing = set(inspect(engine).get_table_names())
needed = set(Base.metadata.tables.keys())
missing = sorted(needed - existing)
if missing:
    print("2) THIẾU BẢNG:", ", ".join(missing))
    print("   Gợi ý: chạy schema.sql (và schema_analytics.sql) trong MySQL Workbench.")
else:
    print(f"2) Đủ {len(needed)} bảng cần thiết.")
