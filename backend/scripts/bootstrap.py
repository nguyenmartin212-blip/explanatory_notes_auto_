"""Kiểm tra schema đã nhập. Chỉ cài bảng phụ khi được yêu cầu rõ ràng."""
import argparse

from app.database import Base, CORE_TABLES, check_schema, engine
from app.models import web  # noqa: F401


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install-web-tables", action="store_true",
                        help="Tạo các bảng Web tùy chọn trong database hiện tại. Không thêm dữ liệu.")
    args = parser.parse_args()
    check_schema(engine)
    if args.install_web_tables:
        tables = [table for table in Base.metadata.sorted_tables if table.name not in CORE_TABLES]
        Base.metadata.create_all(engine, tables=tables, checkfirst=True)
        print("Đã kiểm tra các bảng Web tùy chọn.")
    else:
        print("Đã tìm thấy toàn bộ bảng trong tệp SQL gốc.")


if __name__ == "__main__":
    main()
