from sqlalchemy import Column, ForeignKey, Integer, String

from app.database import Base


class PoiImage(Base):
    __tablename__ = "poi_images"

    id = Column(Integer, primary_key=True, autoincrement=True)
    poi_id = Column(Integer, ForeignKey("pois.id", ondelete="CASCADE"), nullable=False)
    image_url = Column(String(500), nullable=False)
    caption = Column(String(255))
    sort_order = Column(Integer, nullable=False, default=0)
