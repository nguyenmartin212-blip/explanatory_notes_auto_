from sqlalchemy import Boolean, Column, String

from app.database import Base


class Language(Base):
    """Ngôn ngữ hỗ trợ: vi, en, zh, ja, ko."""
    __tablename__ = "languages"

    code = Column(String(10), primary_key=True)
    name = Column(String(50), nullable=False)
    tts_voice = Column(String(60))  # tên giọng đọc của Edge-TTS
    is_active = Column(Boolean, nullable=False, default=True)
