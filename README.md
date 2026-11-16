# Go to Horizon

Frontend chạy bằng Vite và Backend chạy bằng FastAPI. Dữ liệu du lịch lấy từ MySQL `Thuyet_minh_da_ngon_ngu` qua API. Tệp [thuyet_minh.sql](thuyet_minh.sql) chứa schema và dữ liệu mẫu.

## Chuẩn bị MySQL

Máy cần MySQL, Python 3.12 và Node.js 22. Có thể tải MySQL Community Server trực tiếp từ trang chính thức. [MySQL Community Server](https://dev.mysql.com/downloads/mysql/)

1. Khởi động MySQL. Nếu schema chưa được nhập, mở file SQL đi kèm bằng MySQL Workbench và chạy một lần. Nếu đã có schema và dữ liệu, giữ bộ dữ liệu đang dùng.
2. Dùng hai cửa sổ PowerShell, bắt đầu ở thư mục gốc của repo.

### Backend

```powershell
Set-Location backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Điền `DB_USER`, `DB_PASSWORD`, `DB_HOST` và `DB_PORT` trong `backend/.env` theo MySQL của bạn. Giữ `DB_NAME=Thuyet_minh_da_ngon_ngu`. Đặt `SECRET_KEY` bằng một chuỗi ngẫu nhiên riêng nếu triển khai.

```powershell
.\.venv\Scripts\python.exe -m scripts.check_db
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 3000
```

### Frontend

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Mở [trang du khách](http://localhost:5173/) hoặc [trang quản trị](http://localhost:5173/admin). Swagger ở [cổng 3000](http://127.0.0.1:3000/docs). Dùng `npm.cmd run build` và `npm.cmd run preview` để chạy bản build hỗ trợ tải gói ngoại tuyến ở [cổng 4173](http://127.0.0.1:4173/).

Khi triển khai, phục vụ `frontend/dist` qua HTTPS và chuyển tiếp API cùng origin sang FastAPI, gồm `/api/`, `/admin/` (các đường dẫn con), `/pois` và `/static/`. Trả `index.html` cho các đường dẫn giao diện như `/admin` và `/poi/<id>`. Duy trì thư mục `backend/app/static/audio` trên bộ lưu trữ lâu dài nếu tạo audio trên máy chủ.

## Dữ liệu của bản SQL

- File SQL có miền, ngôn ngữ, danh mục và ba POI được công khai. Bản đồ dùng tọa độ POI và nền OpenStreetMap. GPS lấy từ quyền vị trí của trình duyệt.
- Nếu thiếu bản dịch, hệ thống ưu tiên tiếng Anh hiện có rồi dùng tiếng Việt gốc. Nếu thiếu audio ghi sẵn, trang báo trạng thái và có thể đọc bằng giọng trình duyệt khi hỗ trợ ngôn ngữ. Audio của Backend có thể đặt trong `backend/app/static/audio` và lưu URL `/static/audio/<tệp>` trong bản dịch hoặc dùng URL HTTP(S) hợp lệ.
- File SQL chưa có tài khoản quản trị hoặc mã QR. Khi cần, tạo tài khoản đầu tiên bằng `.\.venv\Scripts\python.exe -m scripts.init_admin` từ thư mục Backend. Lệnh yêu cầu bạn nhập tài khoản và mật khẩu. Trong quản trị, tạo mã QR và chọn POI. URL QR có dạng `/?qr=<mã>`.
- Trang quản trị tiếp tục quản lý tài khoản, POI, bản dịch, QR và thống kê du khách từ schema gốc. Google Translate và Edge TTS chỉ được gọi theo thao tác quản trị. Các phiên đăng nhập Web lưu tạm trong tiến trình khi schema chưa có bảng phiên.
- Khi cơ sở dữ liệu đã có các bảng Web phụ của bản cũ, các chức năng tương ứng tiếp tục dùng chúng. Chi tiết ở [README Backend](backend/README.md).
