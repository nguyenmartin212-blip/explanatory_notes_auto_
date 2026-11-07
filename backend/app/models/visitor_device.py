from datetime import datetime

from sqlalchemy import Column, DateTime, String

from app.database import Base


class VisitorDevice(Base):
    """Thiết bị ẩn danh của du khách (id là UUID do frontend tạo)."""
    __tablename__ = "visitor_devices"

    id = Column(String(36), primary_key=True)
    first_seen_at = Column(DateTime, nullable=False, default=datetime.now)
    last_seen_at = Column(DateTime, nullable=False, default=datetime.now)
    preferred_lang = Column(String(10))
    device_type = Column(String(10), nullable=False, default="unknown")
