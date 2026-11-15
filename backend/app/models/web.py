"""SQL tables used by the browser API and persistent audio queue."""
from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from sqlalchemy.dialects.mysql import DATETIME

from app.database import Base

PreciseDateTime = DateTime().with_variant(DATETIME(fsp=6), "mysql")
DeviceId = String(128, collation="utf8mb4_bin").with_variant(String(128), "sqlite")


class PoiWebId(Base):
    __tablename__ = "poi_web_ids"
    slug = Column(String(81), primary_key=True)
    poi_id = Column(Integer, ForeignKey("pois.id", ondelete="CASCADE"), nullable=False, unique=True)


class WebRole(Base):
    __tablename__ = "web_roles"
    name = Column(String(20), primary_key=True)
    description = Column(String(500), nullable=False)
    permissions = Column(JSON, nullable=False)


class WebSession(Base):
    __tablename__ = "web_sessions"
    refresh_hash = Column(String(64), primary_key=True)
    access_hash = Column(String(64), nullable=False, unique=True)
    user_id = Column(Integer, ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False)
    password_hash = Column(String(64), nullable=False)
    access_expires = Column(DateTime, nullable=False)
    refresh_expires = Column(DateTime, nullable=False, index=True)


class WebVisit(Base):
    __tablename__ = "web_visits"
    visit_id = Column(String(36), primary_key=True)
    poi_id = Column(String(81), nullable=False, index=True)
    entered_at = Column(DateTime, nullable=False, index=True)
    exited_at = Column(DateTime)
    exit_method = Column(String(10))
    saved_itinerary = Column(JSON)


class DevicePresence(Base):
    __tablename__ = "web_device_presence"
    user_id = Column(Integer, ForeignKey("admin_users.id", ondelete="CASCADE"), primary_key=True)
    device_id = Column(DeviceId, primary_key=True)
    device_name = Column(String(100), nullable=False)
    last_seen_at = Column(PreciseDateTime, nullable=False, index=True)


class DeviceUsageSession(Base):
    __tablename__ = "web_device_usage_sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False)
    device_id = Column(DeviceId, nullable=False)
    started_at = Column(PreciseDateTime, nullable=False, index=True)


class AudioTask(Base):
    __tablename__ = "audio_tasks"
    id = Column(Integer, primary_key=True)
    poi_id = Column(Integer, ForeignKey("pois.id", ondelete="CASCADE"), nullable=False, index=True)
    langs = Column(JSON)
    translate = Column(Boolean, nullable=False)
    status = Column(String(20), nullable=False, index=True)
    stage = Column(String(20))
    progress = Column(Integer, nullable=False, default=0)
    updated_at = Column(PreciseDateTime, nullable=False, index=True)
    error = Column(Text)
