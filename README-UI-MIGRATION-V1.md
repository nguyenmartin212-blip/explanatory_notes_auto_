# Go to Horizon — UI Migration V1

Mục tiêu: port lớp giao diện Home / Explore từ bản Figma Make sang Expo React Native, nhưng giữ nguyên logic thật của app (SQLite Content Layer, Root Navigation, QR, POI Detail).

## File thay đổi

- `src/screens/HomeScreen.tsx`
- `src/navigation/MainTabNavigator.tsx`
- `src/theme/tokens.ts`

## Những gì đã port

- Header thương hiệu Go to Horizon
- Hero editorial Huế
- CTA mở POI Detail thật
- QR shortcut mở QrScanner thật
- Danh sách POI lấy từ `useOfflinePois()` / SQLite
- Filter UI
- Card POI dạng horizontal carousel
- Continue listening card
- Tone màu Figma Make: cream + deep teal + terracotta
- Bottom tab bar gần phong cách bản demo hơn

## Không thay đổi

- GPS
- Geofence Engine
- Narration Engine
- QR Scanner logic
- SQLite database
- MapScreen
- PoiDetailScreen

## Ảnh

Figma Make đang dùng ảnh Unsplash qua URL. Patch V1 giữ cách này làm demo visual. Sau khi UI được duyệt, nên chuyển ảnh thành dữ liệu Content Layer/CMS hoặc assets có nguồn rõ ràng.

## Cài đặt

Không cần package mới.

Giải nén patch vào root project và Replace file trùng, sau đó:

```powershell
npm run typecheck
npm run lint
npm test
npx expo start -c
```

Nếu Expo đang chạy bình thường, sau khi Save có thể Fast Refresh ngay.

## Ghi chú

Đây là Migration V1 tập trung vào `Home / Explore`. Các screen tiếp theo nên port theo thứ tự:

1. POI Detail
2. Narration Player
3. Map
4. QR Scanner
5. Saved / Itinerary
6. Offline
7. Settings + permission states
