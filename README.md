# J.A.R.V.I.S.

> A Windows-first desktop AI assistant with a cinematic HUD, local-first brain, real-time voice, and operational safety controls.

<p align="left">
  <img alt="Version" src="https://img.shields.io/badge/version-v0.1.0-blueviolet">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078D6">
  <img alt="Frontend" src="https://img.shields.io/badge/frontend-Electron%20%2B%20Canvas-00B7FF">
  <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI-009688">
  <img alt="Realtime" src="https://img.shields.io/badge/realtime-WebSocket-5E35B1">
  <img alt="Status" src="https://img.shields.io/badge/status-active-success">
</p>

Current release: **v0.1.0**

## Why this project exists

Most desktop assistants are either pretty demos or useful tools. J.A.R.V.I.S. is engineered to be both:

- **Reliable day-to-day assistant** for chat, voice, telemetry, and automation
- **Modular architecture** with clear boundaries across UI, backend, and providers
- **Performance-aware visual system** that degrades gracefully under load
- **Security-first IPC and tool execution policy** for safer desktop operations

Or, in Tony terms: *high style, low nonsense.*

## Feature highlights

- Transparent, always-on-top Electron HUD with click-through support
- FastAPI backend with REST + WebSocket channels
- Local-first AI routing with optional cloud fallback
- Voice pipeline (wake/transcript/reply events)
- Vision and gesture modules (feature-gated)
- System telemetry with live diagnostics and stress adaptation
- Cinematic startup sequence with custom JARVIS phases

## Screenshots

> Add your captures under `docs/screenshots/` and keep file names stable for public docs.

- `docs/screenshots/startup_hud.png`
- `docs/screenshots/main_dashboard.png`

## Credits and acknowledgements

For complete attributions and third-party notices, see:

- `CREDITS_AND_ACKNOWLEDGEMENTS.md`
- `THIRD_PARTY_NOTICES.md`

### 3D model credit (startup suit)

The Iron Man startup model reference used during development is credited to:

- **Personal Use License**
- **940,556 visits**
- **383,780 downloads**
- **Submitted by:** `deadcode3`

Important: this model is **not** covered by this repository's MIT license. You must comply with the original creator's terms.

### Marvel / trademark disclaimer

J.A.R.V.I.S., Iron Man, and related names/designs are trademarks and/or copyrighted properties of their respective owners (including Marvel). This project is an independent fan/engineering project and is **not affiliated with, endorsed by, or sponsored by Marvel or Disney**.

## Architecture overview

### Frontend (`src/`, `electron/`)

- Electron shell (`electron/main.js`, `electron/preload.js`)
- HUD rendering in HTML/CSS/JS with Canvas and worker-assisted effects
- IPC bridge with sender validation and constrained API exposure

### Backend (`backend/`)

- FastAPI service and websocket hub
- Core brain/router/memory/tool execution modules
- Voice, vision, gestures, system monitoring, and security audit components

## Runtime services

- App shell: Electron
- Backend API: `http://127.0.0.1:8765`
- WebSocket: `ws://127.0.0.1:8765/ws`
- Optional local model runtime: Ollama (`127.0.0.1:11434`)

## Getting started (Windows)

### Prerequisites

- Node.js 18+
- Python 3.10+
- PowerShell
- (Optional) Ollama for local model inference

### Setup

From repository root:

1. `scripts/setup.ps1`
2. `scripts/dev.ps1`

### Development run

- `npm run dev`

### Test commands

- Frontend smoke tests: `npm test`
- Backend tests: `.\.venv\Scripts\python -m pytest backend/tests -q`

## Repository layout

- `electron/` — main process, preload bridge, service orchestration
- `src/` — renderer UI, startup animation, workers, assets
- `backend/` — FastAPI app and AI/service modules
- `.github/workflows/` — CI automation
- `docs/` — public documentation artifacts

## Security and privacy

- IPC handlers validate trusted sender frame before action
- CSP is enforced from Electron session headers
- Tool execution policy supports allow/confirm/deny modes
- Vision pipeline includes privacy-aware capture controls

See `SECURITY.md` for reporting and hardening guidance.

## Contributing

Pull requests are welcome. Please read:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`

## License

This project is released under the MIT License. See `LICENSE`.

Third-party assets, names, and trademarks are subject to their own terms. See `THIRD_PARTY_NOTICES.md`.

---

Built for builders who like their tooling fast, stable, and just a little bit dramatic.
