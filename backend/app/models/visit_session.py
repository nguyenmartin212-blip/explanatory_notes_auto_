from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String

from app.database import Base

BigId = BigInteger().with_variant(Integer, "sqlite")


class VisitSession(Base):
    """Mỗi lần quét QR / mở web là một phiên. last_seen_at cập nhật theo heartbeat."""
    __tablename__ = "visit_sessions"

    id = Column(BigId, primary_key=True, autoincrement=True)
    device_id = Column(String(36), ForeignKey("visitor_devices.id", ondelete="CASCADE"), nullable=False)
    qr_code_id = Column(Integer, ForeignKey("qr_codes.id", ondelete="SET NULL"), nullable=True)
    lang_code = Column(String(10))
    started_at = Column(DateTime, nullable=False, default=datetime.now)
    last_seen_at = Column(DateTime, nullable=False, default=datetime.now)
