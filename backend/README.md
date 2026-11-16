# Backend Go to Horizon

API thuyết minh đa ngôn ngữ cho các khu vực nổi tiếng ba miền, viết bằng **FastAPI** và **SQLAlchemy**, dữ liệu lưu trong **MySQL** (`Thuyet_minh_da_ngon_ngu`). Hướng dẫn cài đặt toàn bộ dự án (MySQL, frontend) nằm ở [README thư mục gốc](../README.md). Tài liệu này mô tả riêng phần backend.

## Yêu cầu

- Python 3.12
- MySQL đã nhập file `thuyet_minh.sql` (database `Thuyet_minh_da_ngon_ngu`)
- Kết nối internet khi dùng chức năng dịch (Google Translate) và sinh audio (Edge TTS)

## Cài đặt và chạy

Chạy trong thư mục `backend` bằng PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Mở `.env`, điền thông tin MySQL (xem phần [Cấu hình](#cấu-hình)), sau đó:

```powershell
.\.venv\Scripts\python.exe -m scripts.check_db
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 3000
```

- `scripts.check_db` kiểm tra kết nối MySQL và kiểm tra đủ bảng của file SQL gốc.
- Backend chạy ở cổng **3000** (frontend Vite đang chuyển tiếp API tới `127.0.0.1:3000`).
- Swagger: http://127.0.0.1:3000/docs
- Kiểm tra sống: `GET /health`. Kiểm tra kết nối cơ sở dữ liệu: `GET /health/ready` (trả 503 nếu không truy vấn được MySQL).

Lúc khởi động, backend **không tự tạo bảng**. Nó chỉ kiểm tra các bảng của schema đã nhập và dừng với thông báo "Thiếu bảng trong cơ sở dữ liệu đã cấu hình" nếu thiếu. Nếu gặp lỗi này, hãy nhập lại file `thuyet_minh.sql`.

## Cấu hình

Cấu hình đọc từ file `backend/.env` (đặt cạnh thư mục `app/`). Mẫu nằm ở `.env.example`.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `DB_HOST` | `127.0.0.1` | Máy chủ MySQL |
| `DB_PORT` | `3306` | Cổng MySQL |
| `DB_USER` | `root` | Tài khoản MySQL |
| `DB_PASSWORD` | rỗng | Mật khẩu MySQL |
| `DB_NAME` | `Thuyet_minh_da_ngon_ngu` | Tên database |
| `DATABASE_URL` | rỗng | Chuỗi kết nối đầy đủ, nếu đặt sẽ dùng thay các biến `DB_*` (dùng cho kiểm thử, ví dụ SQLite) |
| `SECRET_KEY` | tự sinh mỗi lần chạy | Khóa ký JWT. Nên đặt cố định khi triển khai, nếu để trống thì mỗi lần khởi động lại sẽ làm mất hiệu lực các token cũ |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Thời hạn token đăng nhập admin |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Danh sách nguồn được gọi API, ngăn cách bằng dấu phẩy |

Các hằng số cố định nằm trong `app/core/constants.py`:

- `ONLINE_WINDOW_SECONDS = 90`: người dùng được tính "đang online" nếu có heartbeat trong 90 giây gần nhất.
- `MAX_TTS_CHARS = 3000`: độ dài tối đa văn bản đem sinh giọng đọc.
- `SOURCE_LANG = "vi"` và `FALLBACK_LANG = "en"`: ngôn ngữ gốc và ngôn ngữ dự phòng.
- `TRANSLATE_CODES = {"zh": "zh-CN"}`: ánh xạ mã ngôn ngữ sang mã Google Translate.
- `EVENT_TYPES`: `qr_scan`, `view_poi`, `play_audio`, `finish_audio`, `change_lang`.

## Cấu trúc thư mục

```
backend/
  app/
    main.py            Khởi tạo FastAPI, CORS, /static, đăng ký router, worker audio
    config.py          Đọc .env
    database.py        Kết nối, check_schema, danh sách bảng bắt buộc, get_db
    dependencies.py    Xác thực admin, kiểm tra quyền theo chức năng
    core/              constants, exceptions, security (băm mật khẩu, JWT)
    models/            Bảng SQLAlchemy (web.py chứa các bảng phụ)
    schemas/           Mô hình dữ liệu vào/ra (Pydantic)
    stores/            Truy vấn cơ sở dữ liệu
    services/          Nghiệp vụ: POI, bản dịch, audio, thống kê, offline, xác thực
    routers/           Các nhóm API
    static/audio/      File MP3 sinh ra (phục vụ qua /static/audio/...)
    static/images/     Ảnh (phục vụ qua /static/images/...)
  scripts/             check_db, init_admin, bootstrap, generate_all_audio
  tests/               pytest
```

## Dữ liệu

### Bảng của file SQL gốc (bắt buộc)

`regions`, `languages`, `categories`, `pois`, `poi_images`, `poi_localizations`, `admin_users`, `audit_logs`, `qr_codes`, `visitor_devices`, `visit_sessions`, `visit_events`.

Bản đồ, mã QR, ghi nhận du khách, thống kê, quản lý POI, bản dịch và gói ngoại tuyến chỉ cần các bảng này. File SQL có sẵn miền, ngôn ngữ, danh mục và ba POI, nhưng **chưa có tài khoản quản trị và mã QR**.

### Bảng Web tùy chọn

Định nghĩa trong `app/models/web.py`, **không có** trong file SQL gốc:

| Bảng | Dùng cho |
| --- | --- |
| `poi_web_ids` | Mã định danh (slug) POI cho giao diện Web |
| `web_roles` | Tùy chỉnh quyền của vai trò `admin` |
| `web_sessions` | Lưu bền phiên đăng nhập Web (cookie) |
| `web_visits` | Check-in, check-out và lộ trình của du khách |
| `web_device_presence`, `web_device_usage_sessions` | Thống kê thiết bị quản trị |
| `audio_tasks` | Hàng đợi tạo audio lưu bền, theo dõi tiến độ qua SSE, phục hồi sau khi tắt máy |

Không bắt buộc phải có các bảng này. Muốn bật các tính năng phụ, chạy:

```powershell
.\.venv\Scripts\python.exe -m scripts.bootstrap --install-web-tables
```

Lệnh chỉ tạo các bảng còn thiếu (`checkfirst`), không nạp dữ liệu. Khởi động lại backend sau khi chạy. Nếu chạy không có tham số, `bootstrap` chỉ kiểm tra schema gốc. Khi dùng worker hàng đợi, chỉ chạy **một** tiến trình API.

Khi thiếu bảng nào, tính năng tương ứng trả mã **503** kèm thông báo rõ ràng, các tính năng còn lại vẫn chạy bình thường:

- Thiếu `web_visits`: các API check-in, lộ trình và danh sách lượt khách.
- Thiếu `web_roles`: không chỉnh được quyền vai trò (`PUT /admin/roles/{name}`).
- Thiếu `audio_tasks`: không có luồng SSE. Tạo audio vẫn chạy nền (`BackgroundTasks`) nhưng không có hàng đợi bền và không phục hồi tác vụ sau khi khởi động lại.
- Thiếu `web_sessions`: phiên đăng nhập Web lưu tạm trong bộ nhớ tiến trình, mất khi khởi động lại.

## API

Mọi đường dẫn bên dưới tính từ gốc `http://127.0.0.1:3000`.

### Du khách (công khai)

| Phương thức | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/api/v1/regions` | Danh sách miền (north, central, south) |
| GET | `/api/v1/languages` | Các ngôn ngữ đang hỗ trợ |
| GET | `/api/v1/pois` | Danh sách POI đang hiển thị. Tham số: `region`, `lang` (mặc định `vi`), `skip`, `limit` (mặc định 20, tối đa 100) |
| GET | `/api/v1/pois/nearby` | POI quanh vị trí. Tham số: `lat`, `lng`, `radius` (mét, mặc định 500, tối đa 50000), `lang`. Trả khoảng cách và cờ "đang trong vùng kích hoạt" |
| GET | `/api/v1/pois/{poi_id}` | Chi tiết một POI, tham số `lang` |
| GET | `/api/v1/offline/manifest` | Gói dữ liệu ngoại tuyến: danh sách POI, đường dẫn audio, dung lượng, phiên bản. Tham số: `lang`, `region` |
| GET | `/api/v1/offline/version` | Kiểm tra nhanh phiên bản gói ngoại tuyến. Tham số: `lang`, `region` |

POI công khai gồm: miền, tọa độ, ảnh (`image_urls`), độ ưu tiên audio, nội dung theo ngôn ngữ và đường dẫn audio nếu đã sẵn sàng.

**Nội dung theo ngôn ngữ (fallback 3 tầng):** ngôn ngữ được yêu cầu, rồi tiếng Anh, rồi tiếng Việt gốc. `audio_url` chỉ trả về khi bản dịch ở trạng thái `ready` và file thật sự tồn tại (hoặc là URL HTTP/HTTPS hợp lệ).

### Thống kê du khách

| Phương thức | Đường dẫn | Mô tả |
| --- | --- | --- |
| POST | `/api/v1/analytics/session` | Mở phiên. Body gồm `device_id`, `lang_code`, `device_type` và tùy chọn `qr_code` |
| POST | `/api/v1/analytics/heartbeat` | Gia hạn phiên (frontend gọi khoảng 30 giây một lần) |
| POST | `/api/v1/analytics/event` | Ghi hành động: `view_poi`, `play_audio`, `finish_audio`, `change_lang` |

Quy tắc của `/session`:

- Có `qr_code`: máy chủ kiểm tra bảng `qr_codes`. Mã sai hoặc bị tắt trả `qr_valid: false` và `session_id: null`, **không** tạo phiên.
- Mã hợp lệ: cập nhật thiết bị, mở phiên và ghi sự kiện `qr_scan` trong **cùng một giao dịch**. Phản hồi có thêm `qr_label` và `poi_id` của điểm gắn với mã.
- Mã QR phải dài 3 đến 40 ký tự, chỉ gồm chữ, số, `-`, `_`. Sai định dạng thì máy chủ trả 422 (frontend hiểu là mã không hợp lệ). `device_id` dài 8 đến 36 ký tự (UUID do frontend tạo).
- Không có `qr_code`: tạo phiên duyệt web bình thường, `qr_valid` là `null`.
- Phản hồi có cờ `web_visits` cho biết schema có bảng `web_visits` hay không.

Sự kiện `qr_scan` **không** gửi được qua `/event`, chỉ máy chủ ghi khi xác thực mã (gửi sẽ nhận 422). Nếu `poi_id` không tồn tại hoặc đang ẩn, `/event` trả 404.

### Quản trị (`/api/v1/admin`, cần đăng nhập)

Xác thực bằng **Bearer token** (JWT) hoặc **cookie** phiên Web.

| Nhóm | Phương thức và đường dẫn | Mô tả |
| --- | --- | --- |
| Đăng nhập | `POST /api/v1/admin/auth/login` | Đăng nhập, nhận token |
| | `GET /api/v1/admin/auth/me` | Thông tin tài khoản hiện tại |
| | `POST /api/v1/admin/auth/change-password` | Đổi mật khẩu |
| Tài khoản | `GET`, `POST /api/v1/admin/auth/users` | Danh sách, tạo tài khoản |
| | `PATCH`, `DELETE /api/v1/admin/auth/users/{admin_id}` | Sửa, xóa tài khoản |
| | `POST /api/v1/admin/auth/users/{admin_id}/reset-password` | Đặt lại mật khẩu |
| POI | `GET`, `POST /api/v1/admin/pois` | Danh sách (kể cả chưa hiển thị), tạo POI |
| | `GET`, `PUT`, `DELETE /api/v1/admin/pois/{poi_id}` | Xem, sửa, xóa |
| | `GET /api/v1/admin/pois/categories` | Danh mục |
| | `PATCH /api/v1/admin/pois/{poi_id}/activation` | Bật/tắt hiển thị |
| Bản dịch, audio | `POST /api/v1/admin/pois/{poi_id}/generate-audio` | Dịch và sinh audio (trả 202) |
| | `GET /api/v1/admin/pois/{poi_id}/localizations` | Trạng thái bản dịch và audio (`none`, `processing`, `ready`, `failed`) |
| | `PUT /api/v1/admin/pois/{poi_id}/localizations/{lang}` | Sửa tay bản dịch một ngôn ngữ |
| | `GET /api/v1/admin/pois/audio-tasks/stream` | Luồng SSE tiến độ tác vụ audio (cần bảng `audio_tasks`) |
| Thống kê | `GET /api/v1/admin/stats/online` | Số người đang online |
| | `GET /api/v1/admin/stats/summary` | Tổng hợp: lượt quét QR, khách duy nhất, phiên, theo ngày, top điểm, theo ngôn ngữ, theo mã QR |
| Mã QR | `GET`, `POST /api/v1/admin/qr` | Danh sách, tạo mã QR (gắn với một POI) |
| | `PATCH`, `DELETE /api/v1/admin/qr/{qr_id}` | Sửa (bật/tắt), xóa mã |

Quy tắc đáng chú ý:

- Tạo POI mới thì mặc định **chưa hiển thị**. Chỉ bật hiển thị được khi POI đã có bản tiếng Anh và audio sẵn sàng.
- Sửa tên hoặc mô tả tiếng Việt thì bản dịch máy và audio cũ bị đánh dấu hết hiệu lực và được sinh lại.
- Ảnh phải là đường dẫn `/static/...` hoặc URL HTTP/HTTPS hợp lệ, tối đa 30 ảnh mỗi POI.
- Thống kê yêu cầu quyền `analytics:read`.
- Các thao tác quan trọng được ghi vào bảng `audit_logs`.

### API cho giao diện Web

Các route này phục vụ giao diện Web quản trị và du khách:

| Phương thức | Đường dẫn | Mô tả |
| --- | --- | --- |
| POST | `/admin/auth/login`, `/admin/auth/refresh`, `/admin/auth/logout` | Đăng nhập, làm mới, đăng xuất bằng cookie `gth_web_access` và `gth_web_refresh` |
| GET | `/admin/auth/me` | Tài khoản, quyền và các tính năng bảng phụ đang bật |
| GET | `/admin/users` | Danh sách tài khoản (chỉ Super Admin) |
| PUT | `/admin/users/{user_id}/role` | Gán vai trò `admin` hoặc `super_admin` (chỉ Super Admin) |
| GET, PUT | `/admin/roles`, `/admin/roles/{name}` | Xem, chỉnh quyền vai trò (chỉ Super Admin, sửa cần bảng `web_roles`) |
| GET | `/admin/audio-tasks/stream` | Luồng SSE tiến độ audio (chỉ Super Admin) |
| GET | `/pois` | Danh sách POI cho Web, tham số `lang` |
| POST | `/api/visitors/check-in`, `/api/visitors/check-out` | Check-in, check-out (`exit_method`: `manual` hoặc `geofence`) |
| POST, DELETE | `/api/visitors/itinerary`, `/api/visitors/itinerary/{visit_id}` | Lưu, xóa lộ trình (1 đến 20 điểm) |
| DELETE | `/api/visitors/{visit_id}` | Xóa lượt tham quan |
| GET | `/admin/visitor-visits` | Danh sách lượt khách (quyền `visitor:read`) |
| POST | `/api/analytics/devices/heartbeat` | Heartbeat thiết bị quản trị |
| GET | `/api/analytics/usage` | Thống kê sử dụng theo ngày hoặc tháng (quyền `analytics:read`) |

## Phân quyền

- Có hai vai trò: `super_admin` (toàn quyền) và `admin`.
- Quyền mặc định của `admin` là `visitor:read` và `analytics:read`. Khi có bảng `web_roles`, Super Admin chỉnh được các quyền này.
- Mật khẩu tối đa 72 byte (giới hạn của bcrypt). Token JWT yêu cầu có `sub` và `exp`, mã tài khoản trong `sub` phải hợp lệ.

## Dịch và sinh audio

Quy trình trong `app/services/audio_pipeline_service.py`:

1. Lấy tên và mô tả tiếng Việt của POI.
2. Dịch sang từng ngôn ngữ đang bật bằng `deep-translator` (Google Translate). Văn bản dài được cắt theo câu, mỗi đoạn tối đa 4000 ký tự.
3. Sinh file MP3 bằng `edge-tts` theo giọng cấu hình trong cột `tts_voice` của bảng `languages`.
4. Lưu bản dịch và trạng thái audio vào `poi_localizations`.

Đặc điểm:

- **Cache theo nội dung:** tên file là `MD5(ngôn ngữ | giọng | nội dung)`. Nội dung không đổi thì dùng lại file cũ, không gọi lại edge-tts.
- File được ghi vào tệp tạm rồi đổi tên, nên không bao giờ có file audio dở dang. Mỗi lần gọi TTS có timeout 60 giây.
- Mỗi ngôn ngữ xử lý độc lập, một ngôn ngữ lỗi không làm hỏng các ngôn ngữ khác.
- Khi có bảng `audio_tasks`, tác vụ vào hàng đợi SQL, một worker nền xử lý lần lượt, các tác vụ đang chạy dở được xếp lại khi khởi động. Khi không có bảng này, tác vụ chạy bằng `BackgroundTasks` của FastAPI.

Sinh lại bản dịch và audio cho toàn bộ POI (cần internet):

```powershell
.\.venv\Scripts\python.exe -m scripts.generate_all_audio
```

## Script

| Lệnh | Tác dụng |
| --- | --- |
| `python -m scripts.check_db` | Kiểm tra kết nối MySQL và đủ bảng của SQL gốc |
| `python -m scripts.init_admin` | Tạo tài khoản Super Admin đầu tiên. Hỏi tên đăng nhập (từ 3 ký tự) và mật khẩu (từ 8 ký tự), hoặc đặt biến môi trường `ADMIN_USERNAME`, `ADMIN_PASSWORD` |
| `python -m scripts.bootstrap` | Kiểm tra schema. Thêm `--install-web-tables` để tạo các bảng Web phụ |
| `python -m scripts.generate_all_audio` | Dịch và sinh audio cho tất cả POI |

Trong PowerShell, dùng `.\.venv\Scripts\python.exe -m ...` như các ví dụ ở trên.

## Mã QR

File SQL chưa có mã QR. Sau khi tạo tài khoản bằng `init_admin`, đăng nhập trang quản trị, tạo mã QR và chọn POI. Link trong mã có dạng `<địa chỉ trang>/?qr=<mã>`, và địa chỉ được lấy từ địa chỉ trang quản trị đang mở. Vì vậy muốn quét bằng điện thoại, hãy mở trang quản trị bằng địa chỉ mạng LAN hoặc địa chỉ công khai, không dùng `localhost`.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Có 32 test trong `tests/` (`test_api.py`, `test_geo_service.py`, `test_localization_fallback.py`, `test_web_integration.py`). Test dùng SQLite trong bộ nhớ với dữ liệu riêng, thư mục audio tạm, và **không kết nối** MySQL đang dùng.
