# Explanatory Notes Auto — Mobile

React Native + Expo frontend for the multilingual automatic tour-guide project.

## Architecture

The codebase uses a feature-based frontend architecture:

- `src/components`: reusable UI/layout components without business rules.
- `src/features`: independent business features. Each feature exposes a public API through `index.ts`.
- `src/screens`: application screens.
- `src/navigation`: React Navigation configuration.
- `src/services`: shared API/network clients.
- `src/store`: global state when needed.
- `src/hooks`: shared hooks.
- `src/theme`: colors, spacing, radius and design tokens.
- `src/types`: app-wide TypeScript types.
- `src/utils`: pure utility functions.
- `src/constants`: static app configuration.

## Core features planned

1. Map + POI
2. GPS foreground/background tracking
3. Geofence engine
4. Contextual narration + audio/TTS
5. Multilingual content
6. QR activation
7. Itinerary sync
8. Offline content
9. CI/CD

## Local setup

```bash
npm install
npm run typecheck
npm run lint
npm test
npx expo start
```

## Git flow

Recommended:

```text
main
└── develop
    ├── feature/map-poi
    ├── feature/geofence
    ├── feature/narration
    └── feature/qr
```

Merge features into `develop` through Pull Requests. Merge `develop` into `main` for releases.
