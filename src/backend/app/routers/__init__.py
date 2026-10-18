from fastapi import APIRouter

from app.routers import (
    admin,
    ai_advisor,
    analytics,
    audio,
    content,
    localization,
    maps,
    owner,
    runtime_observability,
    ui_i18n,
)

# The 10 routers of the system (Chapter 00). Order is the mount order.
ROUTERS: list[APIRouter] = [
    content.router,
    audio.router,
    admin.router,
    owner.router,
    ai_advisor.router,
    analytics.router,
    localization.router,
    maps.router,
    runtime_observability.router,
    ui_i18n.router,
]
