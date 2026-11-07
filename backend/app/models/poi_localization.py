from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


class PoiLocalization(Base):
    """Bản dịch + audio của một điểm theo một ngôn ngữ."""
    __tablename__ = "poi_localizations"
    __table_args__ = (UniqueConstraint("poi_id", "lang_code", name="uq_poi_lang"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    poi_id = Column(Integer, ForeignKey("pois.id", ondelete="CASCADE"), nullable=False)
    lang_code = Column(String(10), ForeignKey("languages.code"), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    audio_url = Column(String(500))
    # none | processing | ready | failed
    audio_status = Column(String(20), nullable=False, default="none")
    content_hash = Column(String(32))  # dùng để cache audio
    is_machine_translated = Column(Boolean, nullable=False, default=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

    poi = relationship("POI", back_populates="localizations")
