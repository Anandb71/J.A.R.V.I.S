# Project JARVIS — Team Handover Document

**Last Updated:** 2026-04-04  
**Prepared For:** Incoming engineering/design/product contributors  
**Project Repo:** `Jarvis`

---

## 1) Executive Summary

Project JARVIS is a desktop AI assistant built as a **transparent Electron HUD + Python FastAPI backend**. The target experience is a cinematic but practical “digital co-pilot” that is always available on Windows and can:

- monitor system health in real time,
- run conversational workflows,
- support voice in/out,
- integrate screen/gesture awareness modules,
- and maintain strong UX polish and reliability.

The product has moved from prototype toward a usable baseline, but still needs focused work on **startup latency, stability signaling, tray integration, and final UI consistency**.

---

## 2) Product Ambition (North Star)

### Vision
Build the best-in-class Windows desktop AI companion: **always-on, context-aware, visually premium, and operationally reliable**.

### What “great” looks like
- **Feels alive immediately** (fast startup feedback, no dead UI moments).
- **Trustworthy state** (what the user sees is always accurate and current).
- **Cinematic but clean** (high polish, low visual noise, readable over any desktop wallpaper).
- **Modular intelligence** (voice, vision, gesture, automation can be enabled by capability/profile).
- **Production mindset** (diagnosable behavior, graceful degradation, deterministic fallbacks).

### Success Criteria (high-level)
- UI interactive in < 1 sec after app launch.
- Backend status transitions clear and truthful (warming up -> ready -> running/degraded).
- Core flows (chat, metrics, controls) stable across packaged and dev runs.
- Team can onboard in < 1 day and ship independently by module.

---

## 3) Current Architecture Snapshot

## Frontend (Electron Renderer)
- `src/index.html` — HUD shell and layout containers
- `src/css/design-system.css` — tokens, typography, controls baseline
- `src/css/hud.css` — structural layout, panel visuals, interactions
- `src/js/app.js` — orchestration, websocket events, state wiring
- `src/js/websocket.js` — WS client + reconnect
- `src/js/three-engine.js` + `src/js/workers/three-worker.js` — orb/scene rendering
- `src/js/system-gauges.js` — system meters
- `src/js/chat-panel.js` — conversation rendering
- `src/js/voice-client.js` / `audio-transport.js` — voice + playback integration

## Electron Main Process
- `electron/main.js` — window lifecycle, IPC, permissions/CSP
- `electron/preload.js` — secure bridge methods
- `electron/python-bridge.js` — backend process spawn/restart/stop policy

## Backend (Python)
- `backend/main.py` — FastAPI app + websocket endpoint + lifespan
- `backend/api/routes.py` — REST endpoints (`/api/health`, etc.)
- `backend/system/monitor.py` — metrics broadcast (`system:metrics`)

---

## 4) Current State of Work

### Working well
- Packaged app builds (`electron-builder --win --dir`) complete successfully.
- Backend health endpoint available after initialization.
- HUD scaffolding, panel system, orb visualizer, metrics streaming integrated.
- Chat pipeline event handling is present.
- Collapsible side panels and control interactions exist.

### Known pain points
1. **Backend perceived instability:**
   - Real issue is often startup warmup (embedding/model init), not always crash.
   - User sees prolonged “warming up/reconnecting” period and interprets as broken.
2. **Startup UX confidence gap:**
   - Need deterministic readiness pipeline and clearer progress states.
3. **UI polish churn:**
   - Recent iterations changed visual direction repeatedly.
   - Team should lock a shared style guide to avoid regression-by-taste.
4. **Weather/geolocation dependency:**
   - Works only with permission and network; fallback currently generic.

---

## 5) Priority Workstreams (Recommended)

## A. Reliability First (P0)
1. **Startup orchestration contract**
   - Define states: `booting`, `backend_starting`, `backend_warmup`, `ws_connecting`, `ready`, `degraded`.
   - UI uses only these states for controls/labels.
2. **Readiness endpoint enhancement**
   - Add `/api/ready` that returns module-level readiness (`brain_loaded`, `monitor_started`, `ws_available`).
3. **Timeout and fallback strategy**
   - If heavy model not ready in N sec, boot with reduced mode and lazy-load advanced modules.
4. **Process manager telemetry**
   - Track restart reason, count, and last-exit code.

## B. UX/Design Stabilization (P0/P1)
1. Freeze one visual baseline (design tokens + spacing scale + typography scale).
2. Keep Comms panel strictly conversational; diagnostics stay hidden/debug channel.
3. Normalize button hierarchy and panel chrome for consistency.
4. Add explicit loading skeletons instead of empty panels.

## C. Performance (P1)
1. Lazy-load heavy modules where possible (embeddings/model init).
2. Keep orb animation quality adaptive by hardware tier.
3. Add lightweight perf counters in debug mode only.

## D. System Tray Integration (P1)
Implement planned tray workflow:
- show/hide HUD,
- listening mode toggle,
- gesture toggle,
- screen vision toggle,
- privacy mode,
- quit.

---

## 6) Team Role Split (Suggested)

## 1) Platform Engineer (Electron + Process)
- Own `electron/main.js`, `python-bridge.js`, tray integration, startup/readiness lifecycle.
- Deliver deterministic app state machine.

## 2) Backend Engineer (FastAPI + Services)
- Own readiness contract, model lazy-loading, health diagnostics, metrics integrity.
- Ensure graceful degraded mode and predictable startup.

## 3) Frontend Engineer (HUD + State)
- Own renderer state store, websocket event mapping, control gating, chat UX.
- Remove state duplication and race conditions.

## 4) UI/UX Engineer/Designer
- Own final visual language, component kit, spacing/type consistency, accessibility.
- Maintain style guardrails and review diffs.

## 5) QA/Release Engineer
- Own build pipeline checks, smoke scripts, regression matrix, release notes.

---

## 7) Onboarding Runbook (for new contributors)

## Local setup
1. Install Node LTS and Python 3.11+.
2. Create venv in repo root: `.venv`.
3. Install Python deps from backend requirements.
4. Install JS deps via npm.

## Daily dev loop
1. Start backend and renderer.
2. Verify `/api/health` before testing UX assumptions.
3. Test websocket event flow.
4. Confirm UI state transitions under:
   - backend up,
   - backend warming,
   - backend down/restart,
   - reconnect.

## Packaging check
- Build backend bundle if needed.
- Run `npm run build:dir`.
- Launch `dist/win-unpacked/JARVIS.exe` and validate startup state progression.

---

## 8) Quality Gates Before New Feature Merges

A PR should not merge unless:
- Build passes for packaged app.
- No UI state mismatch between panels/top-level indicators.
- Startup/reconnect behavior verified manually.
- No new console/runtime errors in normal flow.
- UX consistency preserved (buttons, spacing, typography, interactions).

---

## 9) Risks and Mitigations

## Risk: Heavy model startup causes “app looks broken”
- **Mitigation:** lazy model load + explicit staged readiness + degraded mode fallback.

## Risk: Design inconsistency from fast iteration
- **Mitigation:** lock design tokens and approve UI changes against checklist.

## Risk: Feature creep before stability
- **Mitigation:** enforce P0 reliability milestones first.

## Risk: User trust erosion from incorrect status labels
- **Mitigation:** status labels driven only by backend-ready contract, not assumptions.

---

## 10) Suggested 2-Week Sprint Plan

## Week 1 (Stability Sprint)
- Implement `/api/ready` with module readiness map.
- Add startup state machine in Electron + renderer.
- Introduce degraded mode boot path.
- Add regression smoke script for launch and reconnect.

## Week 2 (Polish Sprint)
- Lock visual baseline and component styles.
- Improve empty/loading states.
- Implement system tray controls.
- Final UX review and usability pass.

---

## 11) Definition of “Ready to Hand to Broader Team”

- New developer can run app from clean setup in under 30 minutes.
- App gives clear status during startup and never appears frozen.
- Metrics and chat flows are stable in packaged mode.
- Visual system is coherent, documented, and hard to accidentally regress.

---

## 12) Immediate Next Actions (Actionable)

1. Create `readiness` ticket and define API contract.
2. Add renderer state diagram to docs.
3. Build and enforce UI consistency checklist in PR template.
4. Implement tray integration milestone from plan.
5. Freeze a “v1 baseline” theme for all further iterations.

---

## 13) Handover Contacts / Ownership Placeholder

- **Product Owner:** _TBD_
- **Tech Lead:** _TBD_
- **Frontend Owner:** _TBD_
- **Backend Owner:** _TBD_
- **Release/QA Owner:** _TBD_

---

## 14) Final Note

The project has strong foundations and a clear vision. The fastest path to a world-class experience is to prioritize **predictability and UX trust** before adding more feature surface. Once startup reliability and state integrity are nailed, visual and capability expansion will compound much faster and safer.
