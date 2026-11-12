"""Tạo tài khoản Super Admin đầu tiên.
Chạy trong thư mục backend:   python -m scripts.init_admin
(Hoặc đặt biến môi trường ADMIN_USERNAME / ADMIN_PASSWORD để khỏi phải gõ.)
"""
import getpass
import os
import sys

import app.models  # noqa: F401
from app.core.security import hash_password
from app.database import Base, SessionLocal, engine
from app.stores import admin_store


def main() -> None:
    Base.metadata.create_all(bind=engine)

    username = os.getenv("ADMIN_USERNAME") or input("Tên đăng nhập admin: ").strip()
    password = os.getenv("ADMIN_PASSWORD") or getpass.getpass("Mật khẩu (ít nhất 8 ký tự): ")

    if len(username) < 3 or len(password) < 8:
        print("Tên đăng nhập >= 3 ký tự và mật khẩu >= 8 ký tự.")
        sys.exit(1)

    with SessionLocal() as db:
        if admin_store.get_by_username(db, username):
            print(f"Tài khoản '{username}' đã tồn tại.")
            sys.exit(1)
        admin_store.create(db, username, hash_password(password), "super_admin")
        print(f"Đã tạo Super Admin '{username}'.")


if __name__ == "__main__":
    main()
