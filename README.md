# JARVIS

*A real-time desktop AI assistant for Windows, combining voice, screen awareness, system intelligence, and a holographic HUD.*

---

## What is JARVIS?

JARVIS is a Windows-first assistant designed to feel like a dependable co-pilot rather than a chatbot tab.

It combines:
- an **Electron-based transparent HUD**,
- a **Python + FastAPI backend** for AI/automation pipelines,
- **voice interaction** (wake word, STT, TTS),
- **screen-aware assistance** (privacy-controlled vision),
- **system telemetry and automation tools**,
- and **adaptive performance tiers** so it remains responsive across hardware classes.

In short: cinematic when your machine can afford it, practical when it can’t. (No drama, only useful sci-fi.)

---

## Project Goals

- Deliver a reliable, low-latency desktop assistant for daily workflows.
- Keep architecture modular so providers and subsystems can be swapped without rewrites.
- Prioritize **safety, observability, and graceful degradation** over flashy but fragile behavior.
- Maintain strong privacy controls for screen-aware features.

---

## AI Modes (Local-First + Optional Cloud)

JARVIS supports two official brain modes:

### 1) Local Mode (default)
- Privacy-first and API-key free
- Designed for small, optimized models that still work well for day-to-day commands
- Recommended baseline models (quantized):
  - `qwen2.5:3b-instruct` (Q4)
  - `llama3.2:3b-instruct` (Q4)
- Best when you want safer data locality and predictable costs

### 2) API Mode (optional)
- User provides API key(s)
- Better for complex reasoning and heavier coding/planning tasks
- Useful when you want higher capability beyond small local models

### Recommended open-source default
- **Ship with Local Mode enabled by default**
- Keep **API Mode opt-in**
- Offer a simple router: local for routine requests, cloud for difficult ones (if enabled)

---

## Architecture at a Glance

### Frontend
- **Electron** overlay (transparent, always-on-top, click-through aware)
- **Three.js** visual core for HUD effects
- **D3.js / Canvas** for real-time system gauges

### Backend
- **FastAPI** app with WebSocket + REST control surface
- AI brain with local-first provider abstraction (+ optional cloud adapters)
- Voice stack (wake word, STT, TTS)
- Vision stack (screen capture + analyzer + privacy layer)
- Gesture and system modules

### Communication
- **WebSocket** for real-time streams (state, metrics, events)
- **REST** for config and command endpoints

---

## Implementation Strategy

The delivery strategy is risk-adjusted and performance-first:

1. Foundation and process lifecycle
2. Voice MVP
3. AI + safe tools
4. Vision + privacy controls
5. HUD polish + optimization pass
6. Beta hardening with soak tests and diagnostics

This repo treats performance as an engineering contract, not a wish:
- tiered quality profiles,
- strict P95 goals,
- automatic degradation ladder,
- profiling/telemetry release gates.

---

## Performance Philosophy

JARVIS is designed around this principle:

> “No lag” means **adaptive responsiveness across real hardware**, not forcing full effects on every machine.

Key practices:
- Render-on-demand where continuous rendering is unnecessary
- Main-thread protection (batch reads/writes, avoid layout thrashing)
- Explicit GPU resource disposal for dynamic Three.js assets
- Worker/process offloading for heavy non-UI tasks
- Runtime down-tiering under sustained pressure

---

## Repository Plan Documents

This implementation is driven by the following planning artifacts in `plans/`:

- `research_synthesis.md`
- `mvp_delivery_plan_12_weeks.md`
- `risk_register.md`
- `cost_latency_budget.md`
- `testing_observability_plan.md`
- `performance_engineering_playbook.md`
- `hardware_tier_matrix.md`

Master plan:
- `implementation_plan.md`

---

## Status

Current phase: **Phase 10 hardening in progress**.

Implemented in repo now:
- Electron shell with IPC sender validation + permission/CSP security hardening
- FastAPI backend with local-first AI routing, tool safety policy, memory, and streaming chat
- Full-duplex voice path (VAD + STT + streaming TTS)
- Vision inspection/capture with privacy filtering and sensitive-window redaction
- Structured tool audit logging and gesture subsystem scaffolding (feature-gated)

Next milestone focus:
- complete gesture runtime integration and tune gesture confidence thresholds,
- validate packaging pipeline (`PyInstaller` + `electron-builder`) end-to-end,
- expand automated tests and soak-run observability checks.

---

## Quick Start (Windows)

From the repository root:

1. Run setup script:
  - `scripts/setup.ps1`
2. Launch dev app:
  - `scripts/dev.ps1`

What this starts now:
- Electron HUD shell
- Python FastAPI backend on `127.0.0.1:8765`
- WebSocket heartbeat stream to HUD
- Local-first AI chat endpoint: `POST /api/chat`
- Safety policy check endpoint: `GET /api/tool-policy-check/{tool_name}`

Local AI requirement for default mode:
- Install and run Ollama
- Pull at least one small model (default configured: `qwen2.5:3b-instruct`)

If Python dependencies are already installed and you prefer direct launch:
- `npm run dev`

---

## Credits & Acknowledgments

This project plan is built on the work of many maintainers, researchers, and open-source communities. Full credit to the people and teams behind the resources we reviewed and are implementing from.

### Internal planning credits
- JARVIS planning set in this repository:
  - `implementation_plan.md`
  - all documents under `plans/`

### Platform and architecture references
- **Electron** documentation and security/performance guidance
- **FastAPI** documentation (WebSockets, lifespan patterns, testing)

### Rendering and frontend performance references
- **Three.js** manuals and ecosystem guidance
  - rendering on demand
  - OffscreenCanvas + worker patterns
  - cleanup/disposal practices
- **Chrome for Developers / web.dev** performance engineering resources
  - layout thrashing avoidance
  - compositor-friendly animation guidance
  - Long Animation Frames (LoAF) API
- **MDN Web Docs** for Web Workers, OffscreenCanvas, structured clone, and message passing behavior

### Voice, AI, and multimodal references
- **faster-whisper** and **CTranslate2** ecosystem
- **Picovoice Porcupine** and **openWakeWord**
- **MediaPipe** (hand landmarking/tracking modes)
- **Ollama** and **llama.cpp** local inference ecosystems
- **Gemini / Google AI** model lifecycle and API docs
- **OpenAI** platform docs (provider abstraction planning)

### Windows capture and automation references
- **BetterCam** (Desktop Duplication capture path)
- **pywinauto** and related Windows automation ecosystem docs

### Open-source assistant inspiration
- **Linguflex**
- **Mycroft**

If your work appears in this stack and should be explicitly listed or linked differently, please open an issue/PR—we’ll gladly update credits.

---

## License

License is currently TBD for this repository.

Until a license file is added, treat this project as all-rights-reserved by default.

---

## Final Note

JARVIS aims to be the rare combo of ambitious and stable.

If we ever have to choose between “looks amazing” and “works every day,” we choose “works every day” first—and then make it look amazing anyway.
