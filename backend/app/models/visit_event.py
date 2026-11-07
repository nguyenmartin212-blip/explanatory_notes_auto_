from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String

from app.database import Base

BigId = BigInteger().with_variant(Integer, "sqlite")


class VisitEvent(Base):
    """Một hành động của du khách: quét QR, xem điểm, nghe audio..."""
    __tablename__ = "visit_events"

    id = Column(BigId, primary_key=True, autoincrement=True)
    session_id = Column(BigId, ForeignKey("visit_sessions.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(20), nullable=False)
    poi_id = Column(Integer, ForeignKey("pois.id", ondelete="SET NULL"), nullable=True)
    lang_code = Column(String(10))
    created_at = Column(DateTime, nullable=False, default=datetime.now)
