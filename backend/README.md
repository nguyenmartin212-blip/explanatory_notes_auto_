# Backend – Thuyết minh đa ngôn ngữ các khu vực nổi tiếng 3 miền

FastAPI + MySQL + SQLAlchemy. Sinh giọng đọc bằng edge-tts, dịch bằng deep-translator.

## 1. Cài đặt (làm 1 lần)

Yêu cầu: Python 3.10+ và MySQL 8 đã chạy

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
```

Tạo file cấu hình:

```bash
copy .env.example .env         # Windows   (macOS/Linux: cp .env.example .env)
```

Mở `.env` và điền `DB_PASSWORD` (mật khẩu MySQL của bạn) và `SECRET_KEY` (một chuỗi dài bất kỳ).

## 2. Tạo tài khoản admin đầu tiên

```bash
python -m scripts.init_admin
```

## 3. Chạy server

```bash
uvicorn app.main:app --reload
```

Mở trình duyệt: **http://localhost:8000/docs** – đây là trang Swagger, bạn thử mọi API ngay tại đó.

## 4. Thử luồng chính trên trang /docs

1. `POST /api/v1/admin/auth/login` → nhập tài khoản vừa tạo → copy `access_token`.
2. Bấm nút **Authorize** (góc trên phải) → dán token → Authorize.
3. `POST /api/v1/admin/pois` → tạo điểm tham quan mới. Hệ thống tự dịch và sinh audio ở chế độ nền (cần internet, mất khoảng vài chục giây).
4. `GET /api/v1/admin/pois/{id}/localizations` → xem trạng thái từng ngôn ngữ: `processing` → `ready` (hoặc `failed`).
5. `PATCH /api/v1/admin/pois/{id}/activation` với `{"is_active": true}` → bật hiển thị (chỉ được khi bản tiếng Anh đã `ready`).
6. `GET /api/v1/pois?lang=en` → du khách thấy điểm. Thử `lang=ja` khi chưa có tiếng Nhật để thấy **fallback**.
7. Mở `http://localhost:8000/static/audio/<tên-file>.mp3` để nghe thử.

> 3 điểm mẫu trong `Thuyet_minh_da_ngon_ngu.sql` đã được bật sẵn nhưng chưa có audio.
> Muốn có bản dịch + audio cho chúng: `python -m scripts.generate_all_audio`.

## 5. Chạy test (không cần MySQL, không cần internet)

```bash
pytest
```

## 6. Cấu trúc thư mục

```
app/
  main.py            Khởi động app, gắn router, CORS, /static
  config.py          Đọc .env
  database.py        Kết nối MySQL
  dependencies.py    Kiểm tra token đăng nhập (get_current_admin)
  core/              security (bcrypt, JWT), constants, exceptions
  models/            Bảng database (SQLAlchemy)
  schemas/           Dữ liệu vào/ra của API (Pydantic)
  stores/            Câu truy vấn database
  services/          Nghiệp vụ (fallback, dịch, TTS, pipeline, thống kê...)
  routers/           Các URL của API
  static/audio/      File MP3 sinh ra
scripts/             init_admin, generate_all_audio
tests/               pytest
```

Luồng một request: `router → service → store → MySQL`

| Lớp     | Làm gì                                 | Không làm gì                              |
| ------- | -------------------------------------- | ----------------------------------------- |
| router  | Nhận request, gọi service, trả kết quả | Không viết truy vấn, không viết nghiệp vụ |
| schema  | Mô tả và kiểm tra dữ liệu              | Không có logic                            |
| service | Nghiệp vụ (quy tắc của hệ thống)       | Không biết về HTTP                        |
| store   | Truy vấn database                      | Không có nghiệp vụ                        |
| model   | Mô tả bảng                             | Không có logic                            |

## 7. Danh sách API (đối chiếu với sơ đồ Use Case)

**Du khách (công khai)** – tiền tố `/api/v1`

| Use case                   | API                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| UC-01 Quét QR / mở web     | `POST /analytics/session` (gửi `qr_code`; trả về `poi_id` của điểm gắn với mã QR)             |
| UC-02 Chọn ngôn ngữ        | `GET /languages`                                                                              |
| UC-03 Xem bản đồ, các điểm | `GET /pois`                                                                                   |
| UC-04 Lọc theo miền        | `GET /regions`, `GET /pois?region=north`                                                      |
| UC-05 Xem chi tiết điểm    | `GET /pois/{id}?lang=`                                                                        |
| UC-06 Nghe thuyết minh     | `audio_url` trong dữ liệu điểm; ghi `play_audio` / `finish_audio` qua `POST /analytics/event` |
| UC-07 Tải và dùng offline  | `GET /offline/manifest?lang=&region=`, `GET /offline/version?lang=&region=`                   |
| UC-08 Tự phát khi đến gần  | `GET /pois/nearby?lat=&lng=&radius=` (có `inside_trigger`)                                    |
| UC-11 Fallback 3 tầng      | tự động trong mọi API trả nội dung (`lang`, `is_fallback`)                                    |
| Thống kê người online      | `POST /analytics/heartbeat` (mỗi ~30 giây), `POST /analytics/event`                           |

UC-09 (audio dự phòng bằng TTS trình duyệt) và UC-10 (GPS) làm ở frontend.

**Admin (cần token)** – tiền tố `/api/v1/admin`

| Use case                              | API                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------ |
| UC-13 Đăng nhập                       | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`         |
| UC-12 Quản lý tài khoản (Super Admin) | `GET                                                                     | POST /auth/users`, `PATCH /auth/users/{id}`(đổi vai trò, khóa/mở khóa),`POST /auth/users/{id}/reset-password`, `DELETE /auth/users/{id}` |
| UC-14 Quản lý mã QR                   | `GET                                                                     | POST /qr`, `PATCH /qr/{id}`, `DELETE /qr/{id}`                                                                                           |
| UC-15 Xem thống kê                    | `GET /stats/online`, `GET /stats/summary`                                |
| UC-16 Bật/tắt hiển thị                | `PATCH /pois/{id}/activation`                                            |
| UC-17 Sửa bản dịch thủ công           | `GET /pois/{id}/localizations`, `PUT /pois/{id}/localizations/{lang}`    |
| UC-18 Quản lý điểm                    | `GET                                                                     | POST /pois`, `GET                                                                                                                        | PUT | DELETE /pois/{id}` |
| UC-19 Sinh bản dịch và audio          | tự chạy khi tạo/sửa điểm; chạy tay bằng `POST /pois/{id}/generate-audio` |

**Mã QR:** in đường dẫn `https://<trang-web>/?qr=<code>` vào mã QR. Khi du khách mở đường dẫn,
frontend lấy `qr` trên URL và gửi vào `POST /analytics/session`.

**Gợi ý cho frontend:** để bảng "top điểm xem nhiều" có dữ liệu, hãy gửi event `view_poi` khi du khách mở một điểm.

**Offline:** backend chỉ cung cấp gói dữ liệu (`manifest`). Việc lưu file về máy do frontend làm
(Service Worker + IndexedDB). Mỗi lần mở app, gọi `/offline/version` và so với phiên bản đã lưu;
khác nhau thì tải lại.

## 8. Lỗi thường gặp

| Lỗi                                                             | Cách xử lý                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Can't connect to MySQL server`                                 | MySQL chưa chạy, hoặc sai `DB_HOST/DB_PORT` trong `.env`                                                |
| `Access denied for user`                                        | Sai `DB_USER/DB_PASSWORD`                                                                               |
| `Unknown database 'Thuyet_minh_da_ngon_ngu'`                    | Chưa chạy `thuyet_minh.sql`                                                                             |
| `RuntimeError: 'cryptography' package is required`              | `pip install cryptography`                                                                              |
| `ModuleNotFoundError: No module named 'app'`                    | Đang đứng sai thư mục, hãy `cd backend` rồi chạy lại                                                    |
| Bản dịch `failed`                                               | Máy không có internet hoặc bị giới hạn. Xem log trong cửa sổ chạy uvicorn, rồi gọi lại `generate-audio` |
| Một ngôn ngữ hoàn toàn không xuất hiện trong danh sách bản dịch | Việc dịch bị lỗi trước khi lưu được; xem log và thử `generate-audio` lại                                |
| 401 ở trang /docs                                               | Token hết hạn (30 phút), đăng nhập lại và Authorize lại                                                 |
