# Mobile Patch 01 — Map + POI Detail UI

Áp dụng cho repo `explanatory_notes_auto_` (Expo / React Native / TypeScript), dựa trên scaffold v2 đã tạo trước đó. **Không dùng cho repo web `ban-do-tri-thuc`.**

## Cài đặt
1. Giải nén ZIP.
2. Copy thư mục `src` vào root repo `explanatory_notes_auto_`, chọn **Replace** các file trùng.
3. Trong PowerShell tại root repo chạy:

```powershell
npx expo install react-native-maps
npm run typecheck
npm run lint
npm test
npx expo start -c
```

> Không chép `package.json` từ scaffold cũ. Repo hiện tại đã lên Expo SDK 57; `npx expo install` sẽ chọn phiên bản react-native-maps phù hợp.

## Những gì đã có
- Bản đồ native iOS/Android (Google Maps/Apple Maps do hệ điều hành cung cấp).
- 3 marker demo: Hoàng thành Thăng Long, Đại Nội Huế, Chợ Bến Thành.
- Tìm kiếm POI, chuyển giữa Bản đồ/Vệ tinh, chọn marker để zoom vào POI.
- Bottom preview: mô tả + bán kính POI + `Khám phá`.
- POI Detail: hero, mô tả, VI/EN/ZH, script preview, nút thuyết minh.

## Chưa có ở patch này
- Chưa xin quyền GPS, chưa hiển thị vị trí người dùng hoặc tính khoảng cách thực.
- Chưa kích hoạt geofence/background location.
- Nút thuyết minh **chưa phát âm thanh**; hiển thị thông báo rõ ràng. Bước sau nối Narration Engine với audio/TTS.
- Hình ảnh đang dùng hero đồ họa, không dùng ảnh bên ngoài nên không có vấn đề về giấy phép ảnh trong bản demo.
- Test trên Expo Go (Android/iOS), không phải Expo Web.

## Smoke test
1. Mở tab Bản đồ: thấy 3 marker trên Việt Nam.
2. Bấm chip Đại Nội Huế: bản đồ zoom về Huế.
3. Bấm `Khám phá`: mở chi tiết Huế.
4. Đổi ngôn ngữ EN/ZH: tên/mô tả/script đổi.
5. Bấm thuyết minh: hiển thị thông báo tính năng chưa nối engine.
6. Back về Bản đồ; chuyển Vệ tinh; reset Toàn Việt Nam.

## Lưu ý tương thích
Patch xây trên scaffold v2. Nếu bạn đã thay đổi cấu trúc `src/navigation`, `src/features/poi/types.ts` hoặc `src/components/layout/Screen.tsx` sau đó, hãy kiểm tra import khi merge. Patch không thay các file đó.
