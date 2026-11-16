"""Kiểm tra MySQL và các bảng trong SQL gốc bằng truy vấn đọc."""
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import check_schema, engine


def main() -> None:
    try:
        with engine.connect() as connection:
            database, version = connection.execute(text("SELECT DATABASE(), VERSION()")).one()
        check_schema(engine)
    except (SQLAlchemyError, RuntimeError) as error:
        raise SystemExit(f"Kiểm tra MySQL thất bại. {str(error).splitlines()[0]}") from error
    print(f"Đã kết nối {database} trên MySQL {version}. Đủ bảng trong tệp SQL gốc.")


if __name__ == "__main__":
    main()
