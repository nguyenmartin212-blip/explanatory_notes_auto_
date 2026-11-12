# Go to Horizon — Bản Web đầy đủ

Gói mã nguồn gồm frontend React + Vite, backend FastAPI, MongoDB replica set, Redis, Nginx và dữ liệu mẫu. Giao diện Web dùng React Native Web để tái sử dụng các màn hình đã kiểm thử. Vite biên dịch trực tiếp cho trình duyệt.

## Chạy trên Windows

1. Giải nén ZIP. Mở Docker Desktop và chờ Docker Engine sẵn sàng.
2. Mở PowerShell tại thư mục có `compose.yaml`.
3. Chạy lệnh sau.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-demo.ps1
```

Lần đầu script tạo `.env` với mật khẩu admin ngẫu nhiên. Docker Compose dựng frontend và backend, khởi tạo MongoDB replica set, nạp ba điểm mẫu nếu kho điểm còn trống, rồi khởi động API và Web. Lần đầu có thể mất vài phút để tải image và thư viện.

| Trang | URL mặc định |
|---|---|
| Du khách | [localhost:5174](http://localhost:5174/) |
| QR mẫu Hoàng thành Thăng Long | [Mở liên kết QR](http://localhost:5174/?visit=1&poi=hanoi-thang-long) |
| Quét QR | [Mở camera](http://localhost:5174/?scan=1) |
| Quản trị | [localhost:5174/admin](http://localhost:5174/admin) |
| Swagger API | [localhost:5174/docs](http://localhost:5174/docs) |
| Trạng thái dịch vụ | [localhost:5174/health/ready](http://localhost:5174/health/ready) |

Dùng `SUPERADMIN_USERNAME` và `SUPERADMIN_PASSWORD` trong `.env` để đăng nhập. Nếu cổng `5174` đang bận, đổi `WEB_PORT` trong `.env` rồi chạy lại script. MongoDB, Redis và API giao tiếp qua mạng Docker riêng. Web và API dùng chung origin, nên cookie admin dùng được trực tiếp từ trình duyệt và Swagger.

## Chạy bằng Docker Compose trên hệ điều hành khác

Sao chép `.env.example` thành `.env`, điền mật khẩu admin riêng có ít nhất 8 ký tự, tối đa 72 byte, rồi chạy:

```sh
docker compose up -d --build --wait
docker compose ps
```

Dừng bằng `docker compose down`. Dữ liệu MongoDB, Redis và file audio được lưu trong các volume. Chạy `docker compose logs -f api web` để xem log.

## Các luồng có trong gói

- **Web du khách** có danh sách và chi tiết điểm, ngôn ngữ Việt/Anh/Trung, thuyết minh qua trình duyệt, GPS/geofence, quét QR, check-in/check-out, lưu hành trình và bộ nhớ đệm danh sách điểm.
- **Web quản trị** có đăng nhập, danh sách tài khoản, vai trò và quyền, danh sách lượt khách QR.
- **API** có quản lý điểm, bật/tắt công khai, sửa bản dịch, dịch tự động, TTS tạo MP3, hàng đợi và SSE tiến độ, đồng bộ dữ liệu, gói audio ngoại tuyến, QR CRUD, thống kê và vòng đời tài khoản. Thử các chức năng quản trị API ở Swagger sau khi đăng nhập trên cùng trình duyệt.
- **Dữ liệu mẫu** gồm Hoàng thành Thăng Long, Đại Nội Huế và Chợ Bến Thành. Dữ liệu phát sinh khi chạy được lưu trong volume Docker. Tạo audio và dịch tự động cần kết nối tới Edge TTS và Google Translate. Khi nhà cung cấp dịch giới hạn yêu cầu, các bản dịch mẫu, bản dịch thủ công và cơ chế chọn ngôn ngữ dự phòng vẫn dùng được.

Camera và GPS của trình duyệt dùng được trên localhost hoặc HTTPS, với quyền tương ứng của người dùng. Compose trong gói dành cho chạy local và chỉ công bố cổng Web trên loopback.

## Mã nguồn và kiểm thử

- `frontend/` chứa màn hình Web, `package-lock.json`, cấu hình Vite và Nginx. Có thể chạy `npm ci`, `npm run typecheck` và `npm run build`.
- `backend/` chứa API, cấu hình mẫu, script seed và bộ kiểm thử. Xem [tài liệu backend](backend/README.md) để tra endpoint.
- `compose.yaml` kết nối các dịch vụ. `start-demo.ps1` tạo cấu hình local và chạy Compose.
