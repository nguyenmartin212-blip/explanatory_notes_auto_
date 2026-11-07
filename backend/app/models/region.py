from sqlalchemy import Column, Integer, String

from app.database import Base


class Region(Base):
    """Miền: Bắc / Trung / Nam."""
    __tablename__ = "regions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(10), unique=True, nullable=False)  # north, central, south
    name_vi = Column(String(50), nullable=False)
