from fastapi import APIRouter

from app.routers import (
    admin,
    ai_advisor,
    analytics,
    audio,
    catalog,
    content,
    device_usage,
    localization,
    maps,
    owner,
    runtime_observability,
    ui_i18n,
    visitors,
)

# The routers of the system. Order is the mount order.
ROUTERS: list[APIRouter] = [
    content.router,
    catalog.router,
    audio.router,
    admin.router,
    admin.poi_compat_router,
    owner.router,
    ai_advisor.router,
    analytics.router,
    device_usage.router,
    localization.router,
    maps.router,
    runtime_observability.router,
    ui_i18n.router,
    visitors.router,
]
