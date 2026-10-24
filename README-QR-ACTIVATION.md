# Go to Horizon — QR Content Activation

## Mục tiêu
QR đặt tại điểm tham quan/điểm dừng; quét là mở đúng POI và bắt đầu thuyết minh, không phụ thuộc GPS.

## Cài package
```powershell
npx expo install expo-camera
```

## Chạy
```powershell
npm run typecheck
npm run lint
npm test
npx expo start -c
```

## Test trên điện thoại
1. Home -> QR Guide -> Quét QR.
2. Cho phép Camera.
3. Mở `assets/qr/demo-hanoi-thang-long.png` trên màn hình máy tính và đưa iPhone quét.
4. App phải mở Hoàng thành Thăng Long, hiện badge `kích hoạt bằng QR`, và bắt đầu TTS/audio mà không cần bật GPS.
5. Nếu không có màn hình thứ hai, bấm `Dùng QR demo` trong scanner.

## Payload chuẩn
`gotohorizon://poi/hanoi-thang-long`

Parser cũng hỗ trợ `GTH:POI:<id>`, URL `/poi/<id>`, `?poi=<id>` và `?story=<id>` để tương thích với web demo.

## Phạm vi
- Đây là foreground QR scanning bằng camera.
- Không gửi ảnh camera lên server.
- QR chỉ chứa POI id/deep link; dữ liệu nội dung vẫn lấy từ Content Layer của app.
- Production build nên cấu hình camera permission text trong app config. Expo Go có thể test trực tiếp sau khi cài `expo-camera` đúng phiên bản SDK.

## QR ghi nhận khách trên web
- Chạy `npm run web`; terminal in QR tới URL của web trên mạng LAN, mặc định dùng điểm `hanoi-thang-long`. Quét mã bằng điện thoại cùng Wi-Fi để mở trang ghi nhận.
- Đặt `EXPO_PUBLIC_WEB_URL` trước khi chạy nếu dùng URL/tunnel riêng; `EXPO_PORT` đổi cổng web (mặc định `8081`). Script tự đặt `EXPO_PUBLIC_API_URL` theo IP LAN và cổng backend `3000` nếu chưa cấu hình.
- Khách tự nguyện quét QR; không cần tài khoản. Backend lưu mã lượt ngẫu nhiên, mã POI, thời gian vào/ra, cách kết thúc và lộ trình đã chọn trong MongoDB (`visitor_visits`). Không gửi hoặc lưu tọa độ GPS, tên hay số điện thoại.
- Mỗi trình duyệt/thiết bị tạo mã lượt ẩn danh riêng để lượt vào/ra không bị gộp nhầm giữa nhiều khách. Dữ liệu điểm đến được tải từ backend; lộ trình được lưu trên backend theo mã lượt của thiết bị đó.
- Khách có thể xóa lượt tham quan và lộ trình ngay trên trang QR. MongoDB tự xóa bản ghi sau 90 ngày kể từ lúc ghi nhận vào.
- Tùy chọn tự kết thúc: khách chủ động bật GPS trên trang QR. Trình duyệt kiểm tra vị trí cục bộ; khi có 3 lần đo GPS đủ chính xác nằm ngoài 125% bán kính trong ít nhất 10 giây, trang gửi sự kiện kết thúc `exit_method=geofence`. Tọa độ không gửi lên backend hay lưu; trang cần mở và thiết bị/trình duyệt phải tiếp tục cấp vị trí. Nếu không bật GPS hoặc theo dõi bị gián đoạn, khách vẫn có thể bấm **Rời điểm tham quan**.
- Để xem danh sách khách đã quét, mở `http://localhost:3000/docs`, đăng nhập bằng `POST /admin/auth/login`, rồi gọi `GET /admin/visitor-visits`. Chỉ role có quyền riêng `visitor:read` được xem; mặc định role `admin` và `super_admin` có quyền, `user` và `poi_owner` không có. API hỗ trợ `limit`, `offset` và `poi_id`.
- Các loại tài khoản: `super_admin` (toàn quyền), `admin` (vận hành; mặc định được xem khách QR), `poi_owner` (quản lý POI của mình sau xác minh; mặc định không xem khách QR), `user` (tài khoản người dùng; mặc định không xem khách QR). Khách quét QR là khách ẩn danh, không phải tài khoản trong `admin_users`.
- Xem tài khoản/role: `GET /admin/users` cần `user:read`; chỉ trả username, user_id, role và trạng thái, không trả mật khẩu, email hay CCCD. `GET /admin/auth/me` trả danh tính và quyền của tài khoản đang đăng nhập. Gán role bằng `PUT /admin/users/{user_id}/role` cần `user:update`.
- Quản lý role tại `GET /admin/roles` và `PUT /admin/roles/{name}`. `role:update` mặc định chỉ `super_admin` có. Với database cũ, super_admin cần thêm `visitor:read` vào danh sách quyền của role admin bằng API role; seeding không tự ghi đè role đã chỉnh tay. Chỉ cấp quyền cho tài khoản/role cần xem lượt khách.
- Điện thoại và máy chạy web/backend phải cùng mạng Wi-Fi để dùng địa chỉ LAN. Khi triển khai public, dùng HTTPS và cấu hình URL web/API truy cập được từ điện thoại. Mở cùng QR trên hai thiết bị sẽ tạo hai lượt riêng; đây là hành vi dành cho hai lượt quét độc lập, không phải đồng bộ một phiên khách giữa thiết bị.
