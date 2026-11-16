"""API quản trị điểm tham quan, bản dịch và audio. Tất cả đều cần đăng nhập."""
from typing import Optional

from fastapi.responses import StreamingResponse
from app.services.audio_sse import event_stream
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db, has_tables
from app.dependencies import get_current_admin
from app.core.exceptions import AppError
from app.schemas.localization import LocalizationOut, LocalizationUpdate
from app.schemas.poi import (ActivationRequest, CategoryOut, GenerateAudioRequest, GenerateAudioResponse,
                             POIAdmin, POICreate, POIUpdate)
from app.services import audio_pipeline_service, localization_service, poi_service
from app.stores import audio_task_store, localization_store, poi_store

router = APIRouter(
    prefix="/api/v1/admin/pois",
    tags=["Admin - Điểm tham quan"],
    dependencies=[Depends(get_current_admin)],  # cả router đều bắt buộc đăng nhập
)


@router.get("", response_model=list[POIAdmin])
def list_pois(
    region_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Tất cả điểm, kể cả chưa kích hoạt."""
    return poi_store.list_all(db, region_id, skip, limit)


@router.post("", response_model=POIAdmin, status_code=201)
def create_poi(
    data: POICreate,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """Tạo điểm mới (mặc định CHƯA hiển thị). Audio các ngôn ngữ được sinh nền."""
    return poi_service.create_poi(db, data, admin)


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return poi_store.list_categories(db)


@router.get("/{poi_id}", response_model=POIAdmin)
def get_poi(poi_id: int, db: Session = Depends(get_db)):
    return poi_service.get_or_404(db, poi_id)


@router.put("/{poi_id}", response_model=POIAdmin)
def update_poi(
    poi_id: int,
    data: POIUpdate,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """Sửa điểm. Nếu đổi tên/mô tả tiếng Việt thì bản dịch và audio được sinh lại."""
    return poi_service.update_poi(db, poi_id, data, admin)


@router.delete("/{poi_id}", status_code=204)
def delete_poi(poi_id: int, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    poi_service.delete_poi(db, poi_id, admin)


@router.patch("/{poi_id}/activation", response_model=POIAdmin)
def set_activation(
    poi_id: int,
    data: ActivationRequest,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """Bật/tắt hiển thị. Bật chỉ được khi đã có bản tiếng Anh + audio sẵn sàng."""
    return poi_service.set_activation(db, poi_id, data.is_active, admin)


@router.post("/{poi_id}/generate-audio", response_model=GenerateAudioResponse, status_code=202)
def generate_audio(
    poi_id: int,
    background: BackgroundTasks,
    data: Optional[GenerateAudioRequest] = None,
    db: Session = Depends(get_db),
):
    """Dịch + sinh audio (chạy nền, trả lời ngay). Xem kết quả ở GET .../localizations."""
    poi_service.get_or_404(db, poi_id, lock=True)
    langs = data.langs if data else None
    if langs is not None:
        available = {language.code for language in localization_store.list_active_languages(db)}
        if not set(langs) <= available:
            raise AppError(422, "Có ngôn ngữ không được hỗ trợ hoặc đã tắt")
        langs = list(dict.fromkeys(langs))
    if not has_tables(db, "audio_tasks"):
        db.commit()
        background.add_task(audio_pipeline_service.generate_for_poi, poi_id, langs)
        return GenerateAudioResponse(detail="Đang tạo audio. Xem kết quả trong danh sách bản dịch.")
    task_id = audio_task_store.enqueue(db, poi_id, langs)
    return GenerateAudioResponse(detail="Đã thêm tác vụ sinh audio vào hàng đợi", task_id=str(task_id))


@router.get("/{poi_id}/localizations", response_model=list[LocalizationOut])
def list_localizations(poi_id: int, db: Session = Depends(get_db)):
    """Xem trạng thái bản dịch + audio (none / processing / ready / failed)."""
    return localization_service.list_for_poi(db, poi_id)


@router.put("/{poi_id}/localizations/{lang}", response_model=LocalizationOut)
def update_localization(
    poi_id: int,
    lang: str,
    data: LocalizationUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """Sửa tay bản dịch của một ngôn ngữ. Audio của ngôn ngữ đó được sinh lại."""
    queued = has_tables(db, "audio_tasks")
    loc = localization_service.save_manual(db, poi_id, lang, data.name, data.description, admin, queued=queued)
    if not queued:
        background.add_task(audio_pipeline_service.generate_for_poi, poi_id, [lang], False)
    return loc


@router.get("/audio-tasks/stream")
async def stream_audio_tasks(request: Request, db: Session = Depends(get_db)):
    if not has_tables(db, "audio_tasks"):
        raise AppError(503, "Schema hiện tại chưa có hàng đợi audio lưu bền.")
    return StreamingResponse(
        event_stream(request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
