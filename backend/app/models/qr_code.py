from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class QrCode(Base):
    """Mỗi mã QR in ra đặt ở một nơi. URL dạng: https://trang-web/?qr=<code>"""
    __tablename__ = "qr_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(40), unique=True, nullable=False)
    label = Column(String(150), nullable=False)
    poi_id = Column(Integer, ForeignKey("pois.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
