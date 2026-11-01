from urllib.parse import quote_plus

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings


def build_database_url() -> str:
    if settings.DATABASE_URL:
        return settings.DATABASE_URL
    password = quote_plus(
        settings.DB_PASSWORD
    )  # mật khẩu có ký tự đặc biệt vẫn an toàn
    return (
        f"mysql+pymysql://{settings.DB_USER}:{password}"
        f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}?charset=utf8mb4"
    )


DATABASE_URL = build_database_url()

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    """Mỗi request mở 1 session, xong thì đóng. Dùng qua Depends(get_db)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
