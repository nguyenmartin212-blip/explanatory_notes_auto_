from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class POI(Base):
    """Điểm tham quan (nội dung gốc tiếng Việt)."""
    __tablename__ = "pois"

    id = Column(Integer, primary_key=True, autoincrement=True)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    name_vi = Column(String(200), nullable=False)
    description_vi = Column(Text, nullable=False)  # lời thuyết minh gốc
    latitude = Column(Numeric(9, 6, asdecimal=False), nullable=False)
    longitude = Column(Numeric(9, 6, asdecimal=False), nullable=False)
    trigger_radius = Column(Integer, nullable=False, default=50)  # mét
    audio_priority = Column(Integer, nullable=False, default=0)
    cover_image_url = Column(String(500))
    is_active = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

    region = relationship("Region")
    # Xóa điểm thì bản dịch và ảnh của nó xóa theo
    localizations = relationship(
        "PoiLocalization", back_populates="poi", cascade="all, delete-orphan"
    )
    images = relationship("PoiImage", cascade="all, delete-orphan")
