# Map render fix

Replace `src/screens/MapScreen.tsx` with the included file.

This version gives `react-native-maps` an explicit full-screen wrapper and map size, while keeping overlay cards above it with z-index. This avoids cases where the native map view is mounted but its render layer is not visible behind the screen background/overlay layout on iOS Expo Go.

After replacing:

```powershell
npm run typecheck
npx expo start -c
```
