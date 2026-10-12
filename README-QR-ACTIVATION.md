# Go to Horizon — QR Content Activation

## Mục tiêu
Bám tiêu chí GV: QR đặt tại điểm tham quan/điểm dừng; quét là mở đúng POI và bắt đầu thuyết minh, không phụ thuộc GPS.

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

## Test trên iPhone
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
