# Go to Horizon — Content Layer + SQLite Offline

Patch này triển khai khối **Content Layer** theo tiêu chí giảng viên:

- POI được lưu cục bộ bằng SQLite.
- App vẫn đọc được danh sách POI, mô tả, toạ độ, bán kính, priority, ảnh, audio/TTS script và map link khi offline.
- Lần đầu mở app, SQLite tự seed từ dữ liệu demo hiện có.
- Map và POI Detail chuyển sang đọc dữ liệu từ SQLite thay vì đọc trực tiếp `mockPois`.
- Có repository API để sau này đồng bộ dữ liệu từ server/CMS bằng `replaceOfflinePois()`.

## Cài dependency

```powershell
npx expo install expo-sqlite
```

Sau đó:

```powershell
npm run typecheck
npm run lint
npm test
npx expo start -c
```

## Kiến trúc

```text
Server / CMS (sau này)
        │
        ▼
replaceOfflinePois()
        │
        ▼
SQLite: go-to-horizon.db
        │
        ├── MapScreen
        ├── Geofence Engine
        ├── QR Activation
        └── PoiDetail + Narration
```

## Ghi chú

- Patch chưa triển khai đồng bộ mạng thật; mới tạo nền tảng local-first.
- Audio file offline sẽ là bước riêng kế tiếp; SQLite hiện lưu metadata/URL của audio, không nhét binary audio vào database.
- Nếu database đã tồn tại từ bản thử trước và cần seed lại, có thể gọi `resetOfflineContent()` trong development.
