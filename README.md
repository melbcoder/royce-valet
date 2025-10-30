# Royce Valet — Local Only (Vite + React) — v1.8.5
- Removed mock date; uses real time only.
- Active Vehicles: **no Retrieve** button (queue controls only).
- Notifications: chime + counter persist until **acknowledged**; acknowledge doesn't add alerts.
- Guests can **request** in any status except **Out**.
- Status dropdown retained (colour dots, click-to-clear).
- Scheduled → Queue auto-removal 10 min prior.
- History with search; departure prompt + Undo.
- Settings: **Clear Demo Data** only.
- Local-only storage.

## Run
```bash
npm install
npm run dev
```