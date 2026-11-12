# Backend FastAPI

Khởi động toàn bộ ứng dụng với hướng dẫn trong [README gốc](../README.md). Docker Compose ở thư mục gốc cấu hình MongoDB, Redis, backend và Nginx. Backend chạy trên cổng 3000 bên trong mạng Docker, trình duyệt truy cập qua cổng Web.

Để phát triển backend trực tiếp trên máy, dùng Python 3.12, tạo môi trường ảo, cài `requirements.txt` và sao chép `.env.example` sang `.env`. Đặt `MONGO_URI` và `REDIS_URL` trỏ đến các dịch vụ có thể truy cập, rồi chạy `python -m uvicorn app.main:app --port 3000`. Có thể nạp dữ liệu mẫu bằng `python -m scripts.seed_pois --if-empty`.

## Các API chính

| Chức năng | API |
|---|---|
| Điểm công khai và đồng bộ | `GET /pois` cho frontend hiện tại, `GET /poi/load-all` để đồng bộ đầy đủ hoặc theo cursor, `GET /poi/nearby` để tìm gần |
| Danh mục và lọc theo miền | `GET /api/v1/regions`, `GET /api/v1/languages`, `GET /api/v1/pois?region=north&lang=en`, `GET /api/v1/pois/{poi_id}`, `GET /api/v1/pois/nearby` |
| Quản trị điểm và bản dịch | `GET/POST /admin/pois`, `GET/PATCH/DELETE /admin/pois/{poi_id}`, `PATCH /admin/pois/{poi_id}/activation`, `GET /admin/pois/{poi_id}/localizations`, `PUT /admin/pois/{poi_id}/localizations/{lang}` |
| Dịch, TTS và tác vụ audio | `POST /localizations/on-demand`, `POST /localizations/prepare-hotset`, `POST /localizations/warmup`, `POST /audio/tts`, `POST /admin/pois/{poi_id}/generate-audio`, `GET /admin/audio-tasks`, `GET /admin/audio-tasks/stream`, `POST /admin/audio-tasks/{task_id}/{action}` |
| Ngoại tuyến | `GET /api/v1/offline/manifest?region=central&lang=vi`, `GET /api/v1/offline/version` và `GET /audio/pack-manifest`. Client lưu nội dung và MP3 trên thiết bị. |
| QR và thống kê | `GET/POST /api/v1/admin/qr`, `PATCH/DELETE /api/v1/admin/qr/{qr_id}`, `POST /api/v1/analytics/session`, `POST /api/v1/analytics/heartbeat`, `POST /api/v1/analytics/event`, `GET /api/v1/admin/stats/online`, `GET /api/v1/admin/stats/summary` |
| Thống kê thiết bị đăng nhập | `POST /api/analytics/devices/heartbeat`, `GET /api/analytics/usage?period=day` |
| Lượt ghé và hành trình | `POST /api/visitors/check-in`, `POST /api/visitors/check-out`, `POST /api/visitors/itinerary`, `GET /admin/visitor-visits` |
| Tài khoản, quyền và giao diện | `/admin/auth/login`, `/admin/auth/refresh`, `/admin/auth/logout`, `/admin/auth/change-password`, `/admin/users`, `/admin/users/{user_id}/reset-password`, `/admin/users/{user_id}/role`, `/admin/roles`, `GET /api/v1/ui-bundles/{locale}` |

Điểm tham quan dùng `poi_id` kiểu chuỗi. Khi tạo điểm, gửi bản gốc trong `localizations.vi` và chọn `region_code` là `north`, `central` hoặc `south` nếu muốn phân miền. Backend tự xếp hàng tạo nội dung còn thiếu và audio. Bản dịch thủ công đầy đủ được giữ khi chạy lại pipeline. Google Translate và Edge TTS cần Internet.

Để thu thống kê mới, client gửi mã QR vào `/api/v1/analytics/session` cùng ID thiết bị ẩn danh. Backend trả `session_id` và `poi_id` nếu mã trỏ đến điểm đang công khai. Client gửi heartbeat khoảng mỗi 30 giây và ghi `view_poi`, `play_audio`, `finish_audio` khi các sự kiện xảy ra. Báo cáo online đếm thiết bị có heartbeat trong 90 giây. API check-in/check-out của frontend hiện tại tiếp tục ghi lượt ghé độc lập. Muốn frontend hiện tại gửi các sự kiện thống kê mới hoặc có màn hình quản lý QR, cần nối thêm các API tương ứng ở frontend.

Các route và dữ liệu của MySQL trên nhánh `edit` dùng ID số. Khi nhập dữ liệu MySQL cũ, cần ánh xạ sang các document MongoDB và ID chuỗi trong backend này.

## Thống kê thiết bị đăng nhập

Trang quản trị Web tự gửi `device_id` của trình duyệt mỗi 45 giây khi tài khoản đã đăng nhập và trang đang hiển thị. Thiết bị được tính là online trong 2 phút sau heartbeat cuối. Phiên mới bắt đầu khi thiết bị gửi heartbeat đầu tiên hoặc quay lại sau hơn 30 phút. MongoDB replica set lưu thời điểm hoạt động và phiên mới trong cùng một giao dịch.

`GET /api/analytics/usage` yêu cầu quyền `analytics:read`. Dùng `period=day` cho 30 ngày UTC gần nhất hoặc `period=month` cho tháng hiện tại và 11 tháng trước. Có thể truyền đồng thời `from` và `to` theo định dạng `YYYY-MM-DD`, tính cả hai ngày. Một thiết bị được xác định theo cặp tài khoản và mã trình duyệt. Các API du khách ở `/api/v1/analytics` ghi nhận phiên và lượt quét QR riêng.

Luồng SSE audio dùng `GET /admin/audio-tasks/stream`. Đường dẫn `GET /api/v1/admin/pois/audio-tasks/stream` của PR #5 dùng chung quyền `audio:manage` và các sự kiện `snapshot`, `task`, `keepalive`.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt
.\.venv\Scripts\python.exe -m compileall -q app scripts tests
.\.venv\Scripts\python.exe -m pytest -q
```

Đặt `TEST_MONGO_URI` trỏ tới MongoDB replica set để chạy thêm bài test ghi heartbeat đồng thời và tổng hợp phiên theo UTC. Test tạo cơ sở dữ liệu riêng rồi xóa cơ sở dữ liệu đó khi kết thúc. GitHub Actions tự khởi tạo replica set để chạy bài test này.

Các test API kiểm tra phân quyền, thu hồi token sau đổi mật khẩu, QR và thống kê, lượt ghé, kích hoạt điểm, đồng bộ điểm đã gỡ, gói ngoại tuyến, ưu tiên bản dịch thủ công và phục hồi tác vụ audio. Test sử dụng MongoDB và Redis giả lập, đồng thời giả lập dịch văn bản. Kiểm tra thực tế bằng `/health/ready` và tạo audio sau khi các dịch vụ thật đã chạy.
