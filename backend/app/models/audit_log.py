from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String

from app.database import Base

BigId = BigInteger().with_variant(Integer, "sqlite")


class AuditLog(Base):
    """Nhật ký: ai làm gì, lúc nào."""

    __tablename__ = "audit_logs"

    id = Column(BigId, primary_key=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True
    )
    action = Column(String(50), nullable=False)  # create_poi, update_poi...
    resource = Column(String(50), nullable=False)  # pois, poi_localizations...
    resource_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
