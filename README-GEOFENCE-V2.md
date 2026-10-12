# Go to Horizon — Geofence Engine V2 patch

Patch này bám theo tiêu chí PoC của giảng viên: POI có lat/lng + bán kính + priority; GPS cập nhật vị trí; Geofence Engine chọn POI phù hợp; chống spam bằng debounce/cooldown; sau đó phát event để UI/Narration xử lý.

## File thay đổi

- `src/features/geofence/types.ts`
- `src/features/geofence/services/foreground-geofence.ts`
- `src/features/geofence/index.ts`
- `src/screens/MapScreen.tsx`
- `tests/geofence-v2.test.ts`

Patch KHÔNG ghi đè `NarrationPlayer`, `PoiDetailScreen`, package.json hoặc cấu hình Expo nên giữ nguyên Narration/Audio patch mới nhất.

## Logic V2

1. GPS fix phải đủ chính xác (`accuracy <= min(75m, radius)`).
2. Khi vào activation radius, POI phải ổn định 1.5 giây trước khi trigger (debounce).
3. Nếu nhiều POI cùng đủ điều kiện: ưu tiên `inside`, sau đó `priority` cao hơn, sau đó khoảng cách gần hơn.
4. Sau trigger, cùng POI có cooldown 10 phút.
5. Khi ở sát biên, dùng exit hysteresis `radius * 1.25` để tránh enter/exit liên tục do GPS jitter.
6. Cooldown chặn một lần re-entry thì lần đó được settle im lặng; muốn trigger lại phải exit rồi re-enter sau cooldown.

## Cài

Giải nén vào root `explanatory_notes_auto_` và Replace file trùng.

Không cần cài package mới.

Sau đó chạy:

```powershell
npm run typecheck
npm run lint
npm test
npx expo start -c
```

## Test trên iPhone

- Bật GPS trong tab Map.
- `⚗ Thử gợi ý` vẫn chỉ test UI, không giả GPS.
- Trigger thật chỉ xuất hiện khi GPS thật đi vào bán kính POI và fix đủ chính xác.
- Narration/Audio vẫn mở từ `PoiDetail` như patch trước.

## Chưa làm trong patch này

- Background location/geofencing.
- Narration queue/state machine.
- SQLite/offline sync.
- QR activation.

Đó là các bước tiếp theo theo thứ tự PoC/MVP.
