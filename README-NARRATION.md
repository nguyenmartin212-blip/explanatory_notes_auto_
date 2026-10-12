# GO TO HORIZON — Narration / Audio Player patch

Patch dành cho `explanatory_notes_auto_`, áp dụng **sau** `explanatory-notes-map-poi-ui-patch.zip` và `go-to-horizon-gps-geofence-patch.zip`.

## 1. Cài đặt

1. Sao lưu hoặc commit code hiện tại.
2. Giải nén ZIP tại thư mục gốc repo, giữ nguyên đường dẫn `src/...` và `tests/...`, chọn Replace khi được hỏi.
3. Chạy:

```powershell
npx expo install expo-speech expo-audio
npm run typecheck
npm run lint
npm test
npx expo start -c
```

**Không thay `package.json` hoặc `package-lock.json` bằng bản cũ.** `expo install` sẽ chọn version tương thích với Expo SDK đang cài (SDK 57 nếu repo của bạn đang dùng SDK 57).

## 2. Kiểm tra trên iPhone

- Mở tab Map → chọn một POI → Khám phá (hoặc nút gợi ý Geofence → Xem thuyết minh).
- Trong POI Detail chọn Tiếng Việt / English / 中文 → `▶ Nghe thuyết minh`.
- Thử `Ⅱ Tạm dừng`, `▶ Tiếp tục`, `■ Dừng`, tốc độ 0.85× / 1× / 1.15×.
- Chuyển ngôn ngữ hoặc rời màn hình để xác nhận audio dừng.
- Nếu iPhone không phát tiếng khi dùng TTS, tắt công tắc im lặng và kiểm tra âm lượng.

## 3. Đã làm

- TTS đa ngôn ngữ VI/EN/ZH bằng `expo-speech` trên thiết bị; **không yêu cầu API key**.
- MP3 player bằng `expo-audio` nếu `poi.audio?.[language]` có URI hợp lệ; có play/pause/stop và thời lượng/progress.
- Khi không có MP3, dùng `poi.ttsScript[language]` hoặc `poi.description[language]` để TTS.
- Không tự phát khi người dùng bước vào geofence; chỉ gợi ý rồi người dùng nhấn phát.
- Dừng phát khi rời màn hình / đổi ngôn ngữ. Tốc độ phát tùy chỉnh.
- Tôn trọng giới hạn Expo Speech: TTS pause/resume hỗ trợ iOS/Web, Android chỉ dừng rồi nghe lại.

## 4. Chưa làm / giới hạn

- Chưa có MP3 thật trong ZIP, nên 3 POI demo phát **TTS**. Để nghe bản thu âm, cung cấp URL audio hợp lệ vào `src/features/poi/mockData.ts` (trường `audio`).
- Chưa có tải offline audio, không tự phát khi GPS vào vùng, không chạy nền/khóa màn hình.
- TTS phụ thuộc giọng đọc và gói ngôn ngữ có trên thiết bị; chất lượng/giọng có thể khác nhau.
- Không sửa `MapScreen.tsx` hay Geofence Engine; GPS patch vẫn nguyên.

## 5. Cách thêm MP3

Trong một POI:

```ts
audio: {
  vi: 'https://your-domain.example/audio/hue-vi.mp3',
  en: 'https://your-domain.example/audio/hue-en.mp3',
  zh: 'https://your-domain.example/audio/hue-zh.mp3',
},
```

Chỉ dùng tệp bạn có quyền sử dụng. Không điền URL giả vào production. MP3 có thể cần mạng; offline audio sẽ là bước sau.

## 6. Danh sách file thay đổi

- `src/screens/PoiDetailScreen.tsx` (thay thế)
- `src/features/narration/components/NarrationPlayer.tsx` (mới)
- `src/features/narration/services/narration-content.ts` (mới)
- `src/features/narration/index.ts` (thay thế)
- `tests/narration-content.test.ts` (mới)

**Lưu ý:** Nếu bạn đã sửa `PoiDetailScreen.tsx` sau patch Map + POI, hãy diff/merge thay vì Replace mù để tránh mất phần mới.
