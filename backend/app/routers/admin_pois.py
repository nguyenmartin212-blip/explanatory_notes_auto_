"""API quản trị điểm tham quan, bản dịch và audio. Tất cả đều cần đăng nhập."""
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.schemas.common import MessageResponse
from app.schemas.localization import LocalizationOut, LocalizationUpdate
from app.schemas.poi import ActivationRequest, GenerateAudioRequest, POIAdmin, POICreate, POIUpdate
from app.services import audio_pipeline_service, localization_service, poi_service
from app.stores import poi_store

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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """Tạo điểm mới (mặc định CHƯA hiển thị). Audio các ngôn ngữ được sinh nền."""
    poi = poi_service.create_poi(db, data, admin)
    background_tasks.add_task(audio_pipeline_service.generate_for_poi, poi.id)
    return poi


@router.get("/{poi_id}", response_model=POIAdmin)
def get_poi(poi_id: int, db: Session = Depends(get_db)):
    return poi_service.get_or_404(db, poi_id)


@router.put("/{poi_id}", response_model=POIAdmin)
def update_poi(
    poi_id: int,
    data: POIUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """Sửa điểm. Nếu đổi tên/mô tả tiếng Việt thì bản dịch và audio được sinh lại."""
    poi, text_changed = poi_service.update_poi(db, poi_id, data, admin)
    if text_changed:
        background_tasks.add_task(audio_pipeline_service.generate_for_poi, poi.id)
    return poi


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


@router.post("/{poi_id}/generate-audio", response_model=MessageResponse, status_code=202)
def generate_audio(
    poi_id: int,
    background_tasks: BackgroundTasks,
    data: Optional[GenerateAudioRequest] = None,
    db: Session = Depends(get_db),
):
    """Dịch + sinh audio (chạy nền, trả lời ngay). Xem kết quả ở GET .../localizations."""
    poi_service.get_or_404(db, poi_id)
    langs = data.langs if data else None
    background_tasks.add_task(audio_pipeline_service.generate_for_poi, poi_id, langs)
    return MessageResponse(detail="Đã bắt đầu sinh audio, vui lòng xem trạng thái ở danh sách bản dịch")


@router.get("/{poi_id}/localizations", response_model=list[LocalizationOut])
def list_localizations(poi_id: int, db: Session = Depends(get_db)):
    """Xem trạng thái bản dịch + audio (none / processing / ready / failed)."""
    return localization_service.list_for_poi(db, poi_id)


@router.put("/{poi_id}/localizations/{lang}", response_model=LocalizationOut)
def update_localization(
    poi_id: int,
    lang: str,
    data: LocalizationUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """Sửa tay bản dịch của một ngôn ngữ. Audio của ngôn ngữ đó được sinh lại."""
    loc = localization_service.save_manual(db, poi_id, lang, data.name, data.description, admin)
    background_tasks.add_task(audio_pipeline_service.generate_for_poi, poi_id, [lang], False)
    return loc
