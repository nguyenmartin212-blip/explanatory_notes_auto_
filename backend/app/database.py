from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine, URL, make_url
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.core.exceptions import AppError


def build_database_url() -> URL:
    if settings.DATABASE_URL:
        return make_url(settings.DATABASE_URL)
    return URL.create(
        "mysql+pymysql", username=settings.DB_USER, password=settings.DB_PASSWORD,
        host=settings.DB_HOST, port=int(settings.DB_PORT), database=settings.DB_NAME,
        query={"charset": "utf8mb4"},
    )


DATABASE_URL = build_database_url()

if DATABASE_URL.get_backend_name() == "sqlite":
    sqlite_args = {"connect_args": {"check_same_thread": False}}
    if DATABASE_URL.database in (None, "", ":memory:"):
        sqlite_args["poolclass"] = StaticPool
    engine = create_engine(DATABASE_URL, **sqlite_args)
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


CORE_TABLES = frozenset({
    "regions", "languages", "categories", "pois", "poi_images", "poi_localizations",
    "admin_users", "audit_logs", "qr_codes", "visitor_devices", "visit_sessions", "visit_events",
})
TABLES: frozenset[str] | None = None


def check_schema(bind: Engine) -> frozenset[str]:
    """Chỉ kiểm tra schema của SQL đã nhập."""
    tables = frozenset(inspect(bind).get_table_names())
    missing = CORE_TABLES - tables
    if missing:
        raise RuntimeError("Thiếu bảng trong cơ sở dữ liệu đã cấu hình: " + ", ".join(sorted(missing)))
    return tables


def has_tables(db: Session, *names: str) -> bool:
    tables = TABLES if TABLES is not None else inspect(db.connection()).get_table_names()
    return all(name in tables for name in names)


def get_db():
    """Mỗi request mở 1 session, xong thì đóng. Dùng qua Depends(get_db)."""
    if not settings.DATABASE_CONFIGURED:
        raise AppError(503, "Backend chưa được cấu hình kết nối MySQL.")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
