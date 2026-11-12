from app.database import SessionLocal
from app.models import PoiLocalization

POI_PAYLOAD = {
    "region_id": 1,
    "name_vi": "Văn Miếu - Quốc Tử Giám",
    "description_vi": "Văn Miếu - Quốc Tử Giám được xây dựng năm 1070, là trường đại học đầu tiên của Việt Nam.",
    "latitude": 21.028511,
    "longitude": 105.8355,
    "trigger_radius": 80,
}


def create_poi(client, headers) -> int:
    res = client.post("/api/v1/admin/pois", json=POI_PAYLOAD, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def add_english_ready(poi_id: int) -> None:
    """Giả lập pipeline đã sinh xong bản tiếng Anh."""
    with SessionLocal() as db:
        db.add(PoiLocalization(
            poi_id=poi_id, lang_code="en", name="Temple of Literature",
            description="The Temple of Literature was built in 1070.",
            audio_url="/static/audio/test.mp3", audio_status="ready",
        ))
        db.commit()


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_login_wrong_password(client):
    res = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": "sai"})
    assert res.status_code == 401


def test_admin_api_requires_token(client):
    assert client.get("/api/v1/admin/pois").status_code == 401


def test_new_poi_is_hidden_from_visitors(client, admin_headers):
    poi_id = create_poi(client, admin_headers)
    assert client.get("/api/v1/pois").json() == []
    assert client.get(f"/api/v1/pois/{poi_id}").status_code == 404


def test_cannot_activate_without_english_audio(client, admin_headers):
    poi_id = create_poi(client, admin_headers)
    res = client.patch(f"/api/v1/admin/pois/{poi_id}/activation",
                       json={"is_active": True}, headers=admin_headers)
    assert res.status_code == 400


def test_language_fallback(client, admin_headers):
    poi_id = create_poi(client, admin_headers)
    add_english_ready(poi_id)
    res = client.patch(f"/api/v1/admin/pois/{poi_id}/activation",
                       json={"is_active": True}, headers=admin_headers)
    assert res.status_code == 200

    # Xin tiếng Nhật (chưa có) -> trả tiếng Anh
    ja = client.get("/api/v1/pois", params={"lang": "ja"}).json()[0]
    assert ja["lang"] == "en" and ja["is_fallback"] is True
    assert ja["audio_url"] == "/static/audio/test.mp3"

    # Xin tiếng Việt -> trả nội dung gốc, không phải fallback
    vi = client.get("/api/v1/pois", params={"lang": "vi"}).json()[0]
    assert vi["lang"] == "vi" and vi["is_fallback"] is False
    assert vi["name"] == "Văn Miếu - Quốc Tử Giám"


def test_nearby_inside_trigger(client, admin_headers):
    poi_id = create_poi(client, admin_headers)
    add_english_ready(poi_id)
    client.patch(f"/api/v1/admin/pois/{poi_id}/activation", json={"is_active": True}, headers=admin_headers)

    res = client.get("/api/v1/pois/nearby", params={"lat": 21.0286, "lng": 105.8356, "radius": 500})
    data = res.json()
    assert len(data) == 1 and data[0]["inside_trigger"] is True

    far = client.get("/api/v1/pois/nearby", params={"lat": 10.77, "lng": 106.69, "radius": 500})
    assert far.json() == []


def test_online_counter(client, admin_headers):
    res = client.post("/api/v1/analytics/session",
                      json={"device_id": "device-123456", "lang_code": "en", "device_type": "mobile"})
    assert res.status_code == 201
    session_id = res.json()["session_id"]

    assert client.post("/api/v1/analytics/heartbeat", json={"session_id": session_id}).status_code == 200
    assert client.post("/api/v1/analytics/event",
                       json={"session_id": session_id, "event_type": "view_poi"}).status_code == 201

    online = client.get("/api/v1/admin/stats/online", headers=admin_headers).json()
    assert online["online_now"] == 1


def test_heartbeat_unknown_session(client):
    assert client.post("/api/v1/analytics/heartbeat", json={"session_id": 99999}).status_code == 404


# ======================================================================
# Các test bổ sung theo sơ đồ Use Case mới
# ======================================================================
def login_headers(client, username, password):
    res = client.post("/api/v1/admin/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def make_active_poi(client, headers) -> int:
    poi_id = create_poi(client, headers)
    add_english_ready(poi_id)
    res = client.patch(f"/api/v1/admin/pois/{poi_id}/activation", json={"is_active": True}, headers=headers)
    assert res.status_code == 200, res.text
    return poi_id


# ---------------------------------------------------- UC-01 Quét QR
def test_session_with_qr_returns_poi(client, admin_headers):
    poi_id = create_poi(client, admin_headers)
    qr = client.post("/api/v1/admin/qr", headers=admin_headers,
                     json={"code": "hoian01", "label": "QR cổng chính", "poi_id": poi_id})
    assert qr.status_code == 201

    ok = client.post("/api/v1/analytics/session", json={"device_id": "device-aaaa1111", "qr_code": "hoian01"}).json()
    assert ok["qr_valid"] is True and ok["poi_id"] == poi_id and ok["qr_label"] == "QR cổng chính"

    bad = client.post("/api/v1/analytics/session", json={"device_id": "device-aaaa1111", "qr_code": "khongco"}).json()
    assert bad["qr_valid"] is False and bad["poi_id"] is None

    none = client.post("/api/v1/analytics/session", json={"device_id": "device-aaaa1111"}).json()
    assert none["qr_valid"] is None


# ---------------------------------------------------- UC-14 Quản lý mã QR
def test_qr_update_and_deactivate(client, admin_headers):
    qr = client.post("/api/v1/admin/qr", headers=admin_headers,
                     json={"code": "abc123", "label": "QR cũ"}).json()

    res = client.patch(f"/api/v1/admin/qr/{qr['id']}", headers=admin_headers,
                       json={"label": "QR mới", "is_active": False})
    assert res.status_code == 200
    assert res.json()["label"] == "QR mới" and res.json()["is_active"] is False

    # QR đã tắt thì quét không hợp lệ
    s = client.post("/api/v1/analytics/session", json={"device_id": "device-bbbb2222", "qr_code": "abc123"}).json()
    assert s["qr_valid"] is False

    # Tạo trùng mã (kể cả mã đã tắt) phải báo 400, không được lỗi 500
    dup = client.post("/api/v1/admin/qr", headers=admin_headers, json={"code": "abc123", "label": "Trùng"})
    assert dup.status_code == 400


# ---------------------------------------------------- UC-07 Offline
def test_offline_manifest_and_version(client, admin_headers):
    make_active_poi(client, admin_headers)

    m = client.get("/api/v1/offline/manifest", params={"lang": "ja"}).json()
    assert m["poi_count"] == 1
    item = m["items"][0]
    assert item["lang"] == "en" and item["is_fallback"] is True      # chưa có tiếng Nhật -> tiếng Anh
    assert item["audio_url"] == "/static/audio/test.mp3"
    assert m["version"]

    v = client.get("/api/v1/offline/version", params={"lang": "ja"}).json()
    assert v["version"] == m["version"] and v["poi_count"] == 1

    assert client.get("/api/v1/offline/manifest", params={"region": "khongco"}).status_code == 404


def test_offline_version_changes_when_content_changes(client, admin_headers):
    poi_id = make_active_poi(client, admin_headers)
    before = client.get("/api/v1/offline/version", params={"lang": "en"}).json()["version"]

    res = client.put(f"/api/v1/admin/pois/{poi_id}", headers=admin_headers,
                     json={"description_vi": "Mô tả mới đã được cập nhật cho điểm tham quan này."})
    assert res.status_code == 200

    after = client.get("/api/v1/offline/version", params={"lang": "en"}).json()["version"]
    assert before != after


# ---------------------------------------------------- UC-12 Quản lý tài khoản
def test_admin_account_management(client, admin_headers):
    new = client.post("/api/v1/admin/auth/users", headers=admin_headers,
                      json={"username": "staff", "password": "staff12345", "role": "admin"})
    assert new.status_code == 201
    staff_id = new.json()["id"]

    # Tài khoản thường đăng nhập được nhưng KHÔNG được quản lý tài khoản
    staff_headers = login_headers(client, "staff", "staff12345")
    assert client.get("/api/v1/admin/auth/users", headers=staff_headers).status_code == 403

    # Khóa tài khoản -> không đăng nhập được, token cũ cũng hết tác dụng
    assert client.patch(f"/api/v1/admin/auth/users/{staff_id}", headers=admin_headers,
                        json={"is_active": False}).status_code == 200
    assert client.post("/api/v1/admin/auth/login", json={"username": "staff", "password": "staff12345"}).status_code == 401
    assert client.get("/api/v1/admin/auth/me", headers=staff_headers).status_code == 401

    # Mở khóa + đặt lại mật khẩu
    client.patch(f"/api/v1/admin/auth/users/{staff_id}", headers=admin_headers, json={"is_active": True})
    assert client.post(f"/api/v1/admin/auth/users/{staff_id}/reset-password", headers=admin_headers,
                       json={"new_password": "matkhaumoi1"}).status_code == 200
    login_headers(client, "staff", "matkhaumoi1")

    # Xóa tài khoản
    assert client.delete(f"/api/v1/admin/auth/users/{staff_id}", headers=admin_headers).status_code == 204


def test_cannot_lock_or_delete_yourself(client, admin_headers):
    me = client.get("/api/v1/admin/auth/me", headers=admin_headers).json()
    assert client.patch(f"/api/v1/admin/auth/users/{me['id']}", headers=admin_headers,
                        json={"is_active": False}).status_code == 400
    assert client.patch(f"/api/v1/admin/auth/users/{me['id']}", headers=admin_headers,
                        json={"role": "admin"}).status_code == 400
    assert client.delete(f"/api/v1/admin/auth/users/{me['id']}", headers=admin_headers).status_code == 400


def test_change_own_password(client, admin_headers):
    wrong = client.post("/api/v1/admin/auth/change-password", headers=admin_headers,
                        json={"old_password": "sai-roi", "new_password": "matkhaumoi1"})
    assert wrong.status_code == 400

    ok = client.post("/api/v1/admin/auth/change-password", headers=admin_headers,
                     json={"old_password": "matkhau123", "new_password": "matkhaumoi1"})
    assert ok.status_code == 200
    login_headers(client, "admin", "matkhaumoi1")


# ---------------------------------------------------- UC-15 Thống kê
def test_stats_summary(client, admin_headers):
    poi_id = make_active_poi(client, admin_headers)
    sid = client.post("/api/v1/analytics/session",
                      json={"device_id": "device-cccc3333", "lang_code": "en"}).json()["session_id"]
    client.post("/api/v1/analytics/event", json={"session_id": sid, "event_type": "view_poi", "poi_id": poi_id})
    client.post("/api/v1/analytics/event", json={"session_id": sid, "event_type": "play_audio", "poi_id": poi_id})

    # Cùng 1 thiết bị mở thêm 1 phiên nữa: tổng phiên = 2 nhưng số khách duy nhất vẫn = 1
    client.post("/api/v1/analytics/session", json={"device_id": "device-cccc3333", "lang_code": "en"})

    s = client.get("/api/v1/admin/stats/summary", headers=admin_headers).json()
    assert s["online_now"] == 1
    assert s["total_sessions"] == 2
    assert s["unique_visitors"] == 1
    assert len(s["visitors_last_7_days"]) == 1 and s["visitors_last_7_days"][0]["count"] == 1
    assert s["top_pois_by_views"][0]["poi_id"] == poi_id
    assert s["top_pois_by_plays"][0]["count"] == 1
    assert s["languages"][0]["lang_code"] == "en"
