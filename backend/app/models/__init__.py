"""Import hết các model để SQLAlchemy biết có những bảng nào."""
from app.models.admin_user import AdminUser
from app.models.audit_log import AuditLog
from app.models.category import Category
from app.models.language import Language
from app.models.poi import POI
from app.models.poi_image import PoiImage
from app.models.poi_localization import PoiLocalization
from app.models.qr_code import QrCode
from app.models.region import Region
from app.models.visit_event import VisitEvent
from app.models.visit_session import VisitSession
from app.models.visitor_device import VisitorDevice

__all__ = [
    "AdminUser", "AuditLog", "Category", "Language", "POI", "PoiImage",
    "PoiLocalization", "QrCode", "Region", "VisitEvent", "VisitSession", "VisitorDevice",
]
