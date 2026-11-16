# Backend Go to Horizon

Cài và chạy trực tiếp bằng Python 3.12 theo [hướng dẫn ở thư mục gốc](../README.md). Lúc khởi động, Backend chỉ kiểm tra các bảng của schema đã nhập. Biến `DATABASE_URL` có thể dùng trong môi trường kiểm thử. Cách chạy thông thường lấy thông số MySQL từ `backend/.env`.

## Triển khai backend trên Vercel

Đặt Root Directory là `backend` và bật biến môi trường hệ thống của Vercel. Trong môi trường Production, cấu hình `DATABASE_URL` hoặc các biến `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` trỏ đến MySQL đã nhập `thuyet_minh.sql`. Sau khi deploy, `/health` kiểm tra tiến trình và `/health/ready` kiểm tra kết nối MySQL. Đặt `SECRET_KEY` cố định nếu dùng đăng nhập quản trị.

Trên Vercel, audio sinh trong lúc chạy nằm ở thư mục tạm của từng instance. Để phục vụ audio lâu dài, lưu tệp trên kho bền vững và dùng URL HTTPS trong bản dịch, hoặc chạy backend ở môi trường có ổ đĩa bền vững.

## API chính

- `GET /api/v1/pois`, `GET /api/v1/pois/{poi_id}` và `GET /api/v1/pois/nearby` trả POI công khai với miền, tọa độ, ảnh, nội dung theo ngôn ngữ và audio sẵn sàng. Danh sách có `region`, `lang`, `skip` và `limit`.
- `GET /api/v1/regions` và `GET /api/v1/languages` nạp lựa chọn từ MySQL.
- `POST /api/v1/analytics/session` xác thực `qr_codes` khi nhận `qr_code`. Mã sai hoặc bị tắt trả `qr_valid: false` và `session_id: null`. Mã hợp lệ cập nhật thiết bị, mở phiên và ghi lượt quét trong cùng giao dịch. `/heartbeat` gia hạn phiên. `/event` tiếp nhận lượt xem và tương tác audio.
- `GET /api/v1/offline/manifest` và `GET /api/v1/offline/version` cung cấp gói dữ liệu công khai.
- API quản trị hỗ trợ Bearer và cookie. Super Admin có quyền tạo, sửa quyền và quản lý tài khoản. Khởi tạo tài khoản đầu tiên bằng `python -m scripts.init_admin` khi có nhu cầu.

## Các bảng Web tùy chọn

SQL gốc chưa có bảng cho lịch sử check-in/check-out Web, lưu lộ trình, thống kê thiết bị quản trị, chỉnh quyền chi tiết, lưu phiên đăng nhập Web hoặc hàng đợi audio bền vững. Bản đồ, QR, ghi nhận du khách, API thống kê, CRUD, bản dịch và gói ngoại tuyến dùng các bảng gốc.

Không cần bổ sung bảng để dùng schema gốc. Nếu đúng là bạn muốn bật lại các tính năng phụ với chính MySQL đó, `python -m scripts.bootstrap --install-web-tables` tạo các bảng thiếu của bản cũ, không nạp dữ liệu. Khởi động lại Backend sau khi chạy. Chạy một tiến trình API khi dùng worker phục hồi tác vụ.

Khi thiếu bảng `audio_tasks`, thao tác tạo audio vẫn gọi Google Translate và Edge TTS ở chế độ chạy nền. Xem kết quả trong danh sách bản dịch. Trạng thái hàng đợi qua SSE và phục hồi tác vụ cần bảng `audio_tasks`.

## Kiểm thử

Chạy `python -m pytest -q` trong `backend`. Test sử dụng SQLite trong bộ nhớ và dữ liệu riêng của test. Test không kết nối MySQL đang dùng.
