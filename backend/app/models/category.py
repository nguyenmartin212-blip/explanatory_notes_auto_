from sqlalchemy import Column, Integer, String

from app.database import Base


class Category(Base):
    """Loại điểm tham quan: di tích, thiên nhiên..."""
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name_vi = Column(String(80), nullable=False)
