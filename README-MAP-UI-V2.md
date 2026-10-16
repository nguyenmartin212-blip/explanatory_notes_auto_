# Go to Horizon — Map UI Migration V2

Patch này chỉ port **tab Bản đồ** từ Figma Make sang Expo React Native để giữ cách triển khai an toàn từng tab một.

## File thay đổi

- `src/screens/MapScreen.tsx`
- `src/navigation/MainTabNavigator.tsx`

`MainTabNavigator.tsx` chỉ thay đổi một điểm đáng kể: ẩn header mặc định ở tab Map để bản đồ có không gian full-screen giống demo Figma.

## Giữ nguyên logic thật

MapScreen mới vẫn dùng:

- `react-native-maps`
- `expo-location`
- `useOfflinePois()` / SQLite
- Geofence Engine V2
- debounce 1.5s
- cooldown 10 phút
- hysteresis 1.25× radius
- điều hướng `PoiDetail`
- điều hướng `QrScanner`

## UI đã port

- Search overlay
- Filter: Tất cả / Di sản / Tâm linh / Văn hóa
- Vertical map tools
- Map / Satellite
- My Location
- QR shortcut
- Custom audio-guide marker
- Bottom POI card
- GPS status
- Offline content status
- Geofence alert
- Search results
- Dev-only geofence simulation

## Không cài thêm package

Patch dùng các dependency app hiện tại đã có.

## Cài đặt

Giải nén ZIP vào root project và Replace file trùng.

Sau đó chạy:

```powershell
npm run typecheck
npm run lint
npm test
npx expo start -c
```

## Test thủ công trên iPhone

1. Mở tab Bản đồ.
2. Kiểm tra map thật hiển thị.
3. Nhấn marker.
4. Thử Search.
5. Thử filter.
6. Nhấn nút vị trí.
7. Đổi Standard / Satellite.
8. Nhấn QR.
9. Mở POI bằng “Khám phá địa điểm”.
10. Nhấn “Nghe” để mở POI Detail và autoplay narration.
11. Trong development, thử “Mô phỏng đi vào vùng thuyết minh”.

Nếu TypeScript báo route params `autoplay` hoặc `origin` chưa tồn tại, project đang dùng `navigation/types.ts` cũ hơn QR/Narration patch. Không xóa logic Map; hãy gửi file `src/navigation/types.ts` để đồng bộ route type.
