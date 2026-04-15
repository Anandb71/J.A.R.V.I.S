/**
 * J.A.R.V.I.S. — Main Application Orchestrator
 *
 * Boot sequence → WebSocket → Three.js → Voice → HUD State Machine
 */

import { ChatPanel } from './chat-panel.js';
import { SystemGauges } from './system-gauges.js';
import { VoiceClient } from './voice-client.js';
import { AudioTransport } from './audio-transport.js';
import { JarvisSocket } from './websocket.js';

const WS_URL = 'ws://127.0.0.1:8765/ws';
const API_BASE = 'http://127.0.0.1:8765/api';
const CHAT_UNLOCK_TIMEOUT_MS = 15000;

class JarvisApp {
  constructor() {
    // State
    this.backendReady = false;
    this.wsConnected = false;
    this.ws = null;
    this.reconnectAttempt = 0;
    this.maxReconnect = 20;
    this.booted = false;

    // Sub-systems
    this.chat = null;
    this.gauges = null;
    this.voiceClient = null;
    this.audioTransport = null;
    this.threeWorker = null;

    // DOM refs (set during boot)
    this.dom = {};

    // Clock interval
    this._clockInterval = null;

    // Chatting state
    this._chatLocked = false;
    this._chatUnlockTimer = null;
    this._lastLatency = null;
    this._assistantBuffer = '';
    this._weatherTimer = null;
    this._textChatVoiceReplyEnabled = true;
    this._armorTelemetryState = 'nominal';
    this._armorDiagnosticsState = 'ok';
    this._clickthroughUi = false;
    this._aiEra = 'jarvis';
    this._telemetryPulseTimer = null;
    this._lastTelemetryPulseAt = 0;
    this._lastStressBand = null;
    this._exprRaf = null;
    this._exprStartTs = 0;
    this._audioLevelTarget = 0;
    this._audioLevel = 0;
    this._nullAnchor = { x: 0, y: 0 };
    this._nullAnchorTarget = { x: 0, y: 0 };
    this._codeStreamTimer = null;
    this._arcPower = 100;
    this._tacticalContacts = [];
    this._overlayTickTimer = null;
    this._alertTickerTimer = null;
    this._labGesture = null;
    this._lastOverlayUpdateAt = 0;
    this._overlayUpdateIntervalMs = 420;
    this._minimalUi = false;
    this._bootAnimRaf = null;
    this._bootAnimStartedAt = 0;
    this._bootCanvasCtx = null;
    this._bootParticles = [];
    this._bootResizeHandler = null;
    this._bootSuitModel = null;
    this._bootSuitModelLoadPromise = null;
  }

  /** ── Boot Sequence — Cinematic v5.0 ──────────────────────────── */
  async boot() {
    this._cacheDOM();
    document.body.classList.add('startup-sequence');
    this._setAiEra('jarvis');

    // Run suit-up sequence (15 phases)
    await this._runStartupSequence();

    // Init subsystems while overlay is still up
    this._initHealthMatrix();
    this._startClock();
    this.chat = new ChatPanel(this.dom.chatPanel);
    this.gauges = new SystemGauges();
    this.gauges.init();
    this._initThreeJs();
    this._initCinematicHudRig();
    this._startCodeStream();
    this._startExpressionRig();
    this._connectWebSocket();

    // Complete boot — reveal HUD
    this._completeBoot();
    this._bindUI();
    this._startWeatherLoop();
    this.chat.addSystem('J.A.R.V.I.S. v0.1.0 is online. All systems nominal. At your service, sir.');
  }

  /** Cache DOM references */
  _cacheDOM() {
    this.dom = {
      bootOverlay: document.getElementById('boot-overlay'),
      bootCanvas: document.getElementById('boot-canvas'),
      bootLog: document.getElementById('boot-log'),
      bootProgressFill: document.getElementById('boot-progress-fill'),
      bootSidePanel: document.getElementById('boot-side-panel'),
      bootCounter: document.getElementById('boot-counter'),
      bootLoadingText: document.getElementById('boot-loading-text'),
      hudRoot: document.getElementById('hud-root'),
      clock: document.getElementById('clock'),
      calendar: document.getElementById('calendar'),
      chatPanel: document.getElementById('chat-panel'),
      chatInput: document.getElementById('chat-input'),
      chatQuickActions: document.getElementById('chat-quick-actions'),
      btnSend: document.getElementById('btn-send'),
      btnMic: document.getElementById('btn-mic'),
      btnToggleVoiceReply: document.getElementById('btn-toggle-voice-reply'),
      btnClickthrough: document.getElementById('btn-toggle-clickthrough'),
      btnFocus: document.getElementById('btn-toggle-hud'),
      brandPill: document.getElementById('brand-pill'),
      backendStatus: document.getElementById('backend-status'),
      voiceState: document.getElementById('voice-state'),
      wsStatus: document.getElementById('ws-status'),
      modeStatus: document.getElementById('mode-status'),
      latencyDisplay: document.getElementById('latency-display'),
      healthDotUi: document.getElementById('hm-ui'),
      healthDotApi: document.getElementById('hm-api'),
      healthDotAi: document.getElementById('hm-ai'),
      threeCanvas: document.getElementById('three-canvas'),
      collapseLeft: document.getElementById('btn-collapse-left'),
      collapseRight: document.getElementById('btn-collapse-right'),
      armorBusState: document.getElementById('armor-bus-state'),
      armorGpuTemp: document.getElementById('armor-gpu-temp'),
      armorCpuTemp: document.getElementById('armor-cpu-temp'),
      armorModule: document.getElementById('armor-signature-module'),
      codeStream: document.getElementById('code-stream'),
      particleFlow: document.getElementById('particle-flow'),
      centerPanel: document.querySelector('.center-panel'),
      tacticalTargets: document.getElementById('tactical-targets'),
      threatFeed: document.getElementById('threat-feed'),
      tacticalMapDots: document.getElementById('tactical-map-dots'),
      incomingTrajectory: document.getElementById('incoming-trajectory'),
      outgoingTrajectory: document.getElementById('outgoing-trajectory'),
      arcPowerRing: document.getElementById('arc-power-ring'),
      arcPowerValue: document.getElementById('arc-power-value'),
      integrityWireframe: document.getElementById('integrity-wireframe'),
      integrityLabel: document.getElementById('integrity-label'),
      vitalTemp: document.getElementById('vital-temp'),
      vitalO2: document.getElementById('vital-o2'),
      vitalAlt: document.getElementById('vital-alt'),
      vitalMach: document.getElementById('vital-mach'),
      vitalSpeed: document.getElementById('vital-speed'),
      envO2: document.getElementById('env-o2'),
      envRad: document.getElementById('env-rad'),
      envTox: document.getElementById('env-tox'),
      imagingMode: document.getElementById('imaging-mode'),
      objectIdentification: document.getElementById('object-identification'),
      commsWaveform: document.getElementById('comms-waveform'),
      satFeedA: document.getElementById('sat-feed-a'),
      satFeedB: document.getElementById('sat-feed-b'),
      alertTicker: document.getElementById('alert-ticker'),
      holoWorkspace: document.getElementById('holo-workspace'),
      holoTrash: document.getElementById('holo-trash'),
    };
  }

  /** Update boot overlay log */
  _bootLog(msg) {
    if (this.dom.bootLog) {
      this.dom.bootLog.textContent = msg;
    }
  }

  /** Typewriter-style boot log — cinematic feel */
  async _bootLogTyped(msg) {
    if (!this.dom.bootLog) return;
    this.dom.bootLog.textContent = '';
    for (let i = 0; i < msg.length; i++) {
      this.dom.bootLog.textContent += msg[i];
      await this._sleep(6 + Math.random() * 6);
    }
    await this._sleep(30);
  }

  /** ── CINEMATIC BOOT SEQUENCE v28.0 (SPEC-ACCURATE) ──────────────── */
  async _runStartupSequence() {
    await this._loadBootSuitModel();
    this._startBootCinematic();
    this._setBootPhase('phase-1');
    this._bootLog('INITIATING SYSTEM 1....');
    await this._sleep(2800);
    this._speakBootLine('Welcome back, sir.');

    this._setBootPhase('phase-2');
    this._bootLog('CHECKSUM: OK');
    await this._sleep(2900);
    this._speakBootLine('Core systems synchronized.');

    this._setBootPhase('phase-3');
    await this._sleep(3600);
    this._speakBootLine('Deploying tactical schematics.');

    this._setBootPhase('phase-4');
    this._bootLog('ARC REACTOR IGNITION');
    this._speakBootLine('Arc reactor online. All systems are now fully operational.');
    await this._sleep(2800);

    this._setBootPhase('complete');
    await this._sleep(260);
    this._stopBootCinematic();
  }

  _setBootLoadingText(text) {
    if (this.dom.bootLoadingText) {
      this.dom.bootLoadingText.textContent = text;
    }
  }

  async _runBootCounter(from, to, durationMs) {
    const el = this.dom.bootCounter;
    if (!el) return;
    const start = performance.now();
    while (true) {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const eased = 1 - ((1 - t) * (1 - t));
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (t >= 1) break;
      await this._sleep(16);
    }
  }

  async _loadBootSuitModel() {
    if (this._bootSuitModel) return this._bootSuitModel;
    if (this._bootSuitModelLoadPromise) return this._bootSuitModelLoadPromise;

    this._bootSuitModelLoadPromise = (async () => {
      try {
        let text = null;

        if (window.jarvis?.readAssetText) {
          text = await window.jarvis.readAssetText('assets/models/IronMan/IronMan.obj');
        }

        if (!text) {
          const candidates = [
            'assets/models/IronMan/IronMan.obj',
            './assets/models/IronMan/IronMan.obj',
            '../assets/models/IronMan/IronMan.obj',
          ];

          for (const p of candidates) {
            const resp = await fetch(p).catch(() => null);
            if (resp?.ok) {
              text = await resp.text();
              break;
            }
          }
        }

        if (!text) throw new Error('obj unavailable');
        this._bootSuitModel = this._parseObjWireframe(text);
      } catch {
        this._bootSuitModel = null;
      }
      return this._bootSuitModel;
    })();

    return this._bootSuitModelLoadPromise;
  }

  _parseObjWireframe(objText) {
    const vertices = [];
    const edgeSet = new Set();

    const lines = objText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      if (line.startsWith('v ')) {
        const p = line.split(/\s+/);
        if (p.length >= 4) {
          vertices.push([Number(p[1]), Number(p[2]), Number(p[3])]);
        }
        continue;
      }

      if (line.startsWith('f ')) {
        const p = line.split(/\s+/).slice(1);
        const idx = p.map((t) => Number((t.split('/')[0] || '0')) - 1).filter((n) => n >= 0);
        if (idx.length < 2) continue;
        for (let j = 0; j < idx.length; j += 1) {
          const a = idx[j];
          const b = idx[(j + 1) % idx.length];
          const k = a < b ? `${a}_${b}` : `${b}_${a}`;
          edgeSet.add(k);
        }
      }
    }

    if (!vertices.length || !edgeSet.size) return null;

    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let i = 0; i < vertices.length; i += 1) {
      const [x, y, z] = vertices[i];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;

    const normalized = vertices.map(([x, y, z]) => [
      (x - cx) / size,
      -(y - cy) / size,
      (z - cz) / size,
    ]);

    const edges = [];
    edgeSet.forEach((k) => {
      const [a, b] = k.split('_').map((n) => Number(n));
      edges.push([a, b]);
    });

    // Cap density for runtime stability during boot
    const maxEdges = 4200;
    if (edges.length > maxEdges) {
      const step = Math.ceil(edges.length / maxEdges);
      const sampled = [];
      for (let i = 0; i < edges.length; i += step) sampled.push(edges[i]);
      return { vertices: normalized, edges: sampled };
    }

    return { vertices: normalized, edges };
  }

  _startBootCinematic() {
    const canvas = this.dom.bootCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this._bootCanvasCtx = ctx;
    this._bootAnimStartedAt = performance.now();
    this._bootParticles = Array.from({ length: 480 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.002,
      vy: (Math.random() - 0.5) * 0.002,
      s: 0.5 + Math.random() * 2.1,
      a: 0.2 + Math.random() * 0.75,
      c: Math.random() > 0.88 ? 'magenta' : (Math.random() > 0.73 ? 'white' : 'cyan'),
    }));

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    this._bootResizeHandler = resize;
    window.addEventListener('resize', resize);

    const tick = (ts) => {
      const elapsed = (ts - this._bootAnimStartedAt) / 1000;
      this._drawBootFrame(elapsed);
      this._bootAnimRaf = requestAnimationFrame(tick);
    };

    this._bootAnimRaf = requestAnimationFrame(tick);
  }

  _stopBootCinematic() {
    if (this._bootAnimRaf) {
      cancelAnimationFrame(this._bootAnimRaf);
      this._bootAnimRaf = null;
    }
    if (this._bootResizeHandler) {
      window.removeEventListener('resize', this._bootResizeHandler);
      this._bootResizeHandler = null;
    }
  }

  _drawBootFrame(t) {
    const ctx = this._bootCanvasCtx;
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w * 0.5;
    const cy = h * 0.5;

    // Global environment: strict pure black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    if (t < 2.8) {
      this._drawIgnitionBoot(ctx, cx, cy, w, h, t);
      return;
    }

    if (t < 5.7) {
      this._drawCircularJarvisHud(ctx, cx, cy, t - 2.8);
      return;
    }

    if (t < 9.1) {
      this._drawSystemSchematics(ctx, cx, cy, w, h, t - 5.7);
      return;
    }

    this._drawArcReactorFinale(ctx, cx, cy, w, h, t - 9.1);
  }

  _drawIgnitionBoot(ctx, cx, cy, w, h, t) {
    const cyan = '#00E5FF';
    const glow = 'rgba(0,136,170,0.95)';
    const pulse = 0.7 + (Math.sin(t * 20) * 0.15) + (Math.sin(t * 42) * 0.08);

    // 1px center ignition line + strict 45° tech brackets
    ctx.strokeStyle = cyan;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 1;

    const lBreak = w * 0.33;
    const rBreak = w * 0.67;
    const rise = 20;
    const flat = 100;

    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(lBreak, cy);
    ctx.lineTo(lBreak + rise, cy - rise);
    ctx.lineTo(lBreak + rise + flat, cy - rise);
    ctx.lineTo(lBreak + (rise * 2) + flat, cy);
    ctx.lineTo(rBreak - (rise * 2) - flat, cy);
    ctx.lineTo(rBreak - rise - flat, cy - rise);
    ctx.lineTo(rBreak - rise, cy - rise);
    ctx.lineTo(rBreak, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    // Optical flare: white core + stretched blue halo
    const flareW = Math.min(420, w * 0.3);
    const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, flareW * 0.5);
    halo.addColorStop(0, `rgba(255,255,255,${Math.min(1, pulse + 0.15)})`);
    halo.addColorStop(0.14, `rgba(110,220,255,${0.75 * pulse})`);
    halo.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - flareW * 0.55, cy - 46, flareW * 1.1, 92);

    // Main header text
    ctx.shadowBlur = 18;
    ctx.fillStyle = cyan;
    ctx.font = '700 32px Orbitron, Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('INITIATING SYSTEM 1....', cx, cy - 46);

    // Loading bar with discrete blocks and non-linear fill
    const bw = Math.min(460, w * 0.42);
    const bh = 16;
    const bx = cx - (bw / 2);
    const by = cy - 30;
    ctx.strokeStyle = 'rgba(0,229,255,0.95)';
    ctx.shadowBlur = 10;
    ctx.strokeRect(bx, by, bw, bh);

    let progress = 0;
    if (t < 1.1) progress = (t / 1.1) * 0.38;
    else if (t < 1.35) progress = 0.38;
    else progress = 0.38 + ((t - 1.35) / 1.45) * 0.62;
    progress = Math.max(0, Math.min(1, progress));

    const blocks = 24;
    const gap = 2;
    const blockW = (bw - gap * (blocks + 1)) / blocks;
    const fillCount = Math.floor(progress * blocks);
    for (let i = 0; i < fillCount; i += 1) {
      const x = bx + gap + (i * (blockW + gap));
      ctx.fillStyle = 'rgba(0,229,255,0.92)';
      ctx.fillRect(x, by + 3, blockW, bh - 6);
    }

    // Subtext flashing data
    const lines = [
      'RELEASING CONFIGURATION',
      'REMOVE SYSTEM CONFIGURATION',
      'EXTEND SYSTEM MEMORY: NO',
      'REMOVE',
      'CHECKSUM: OK',
    ];
    const idx = t > 2.2 ? 4 : Math.floor(t * 12) % 4;
    ctx.textAlign = 'left';
    ctx.font = '600 11px Orbitron, Rajdhani, sans-serif';
    ctx.fillStyle = 'rgba(0,229,255,0.9)';
    ctx.fillText(lines[idx], lBreak + 24, cy + 28);
  }

  _drawCircularJarvisHud(ctx, cx, cy, t) {
    const cyan = '#00E5FF';
    const a = Math.min(1, t / 0.7);
    const z = 0.9 + (Math.min(1, t / 1.0) * 0.1);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(z, z);
    ctx.shadowColor = 'rgba(0,136,170,0.9)';
    ctx.shadowBlur = 14;

    // Ring 1 outer thick low opacity
    ctx.save();
    ctx.rotate(t * 0.22);
    ctx.strokeStyle = 'rgba(0,229,255,0.2)';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(0, 0, 260, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Ring 2 thin line
    ctx.save();
    ctx.rotate(-t * 0.55);
    ctx.strokeStyle = 'rgba(0,229,255,0.86)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 210, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Ring 3 dashed curved blocks
    ctx.save();
    ctx.rotate(t * -1.15);
    ctx.strokeStyle = 'rgba(0,229,255,0.72)';
    ctx.lineWidth = 8;
    for (let i = 0; i < 26; i += 1) {
      const s = (i / 26) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, 170, s, s + 0.12);
      ctx.stroke();
    }
    ctx.restore();

    // Ring 4 ruler ticks outward
    ctx.save();
    ctx.rotate(t * 0.9);
    ctx.strokeStyle = 'rgba(0,229,255,0.62)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 180; i += 1) {
      const ang = (i / 180) * Math.PI * 2;
      const r1 = 130;
      const r2 = 138 + (i % 5 === 0 ? 5 : 0);
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
      ctx.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2);
      ctx.stroke();
    }
    ctx.restore();

    // Ring 5 inner mechanical gear-like cutouts
    ctx.save();
    ctx.rotate(-t * 0.38);
    ctx.strokeStyle = cyan;
    ctx.lineWidth = 14;
    for (let i = 0; i < 10; i += 1) {
      const s = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, 88, s, s + 0.42);
      ctx.stroke();
    }
    ctx.restore();

    // Center text fade + slight zoom
    ctx.globalAlpha = a;
    ctx.fillStyle = cyan;
    ctx.font = '700 52px Orbitron, Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('J.A.R.V.I.S', 0, 18);

    ctx.restore();
  }

  _drawSystemSchematics(ctx, cx, cy, w, h, t) {
    // Faint 10x10 grid background
    ctx.strokeStyle = 'rgba(0,229,255,0.08)';
    ctx.lineWidth = 1;
    const cell = Math.max(60, Math.min(110, Math.round(w / 20)));
    for (let x = 0; x <= w; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += cell) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    // Left top: arc reactor blueprint
    this._drawArcBlueprint(ctx, w * 0.16, h * 0.22, 84);

    // Left bottom: miniature rotating JARVIS HUD
    ctx.save();
    ctx.translate(w * 0.2, h * 0.77);
    ctx.scale(0.34, 0.34);
    this._drawCircularJarvisHud(ctx, 0, 0, t * 1.7);
    ctx.restore();

    // Right UI schematics
    this._drawHelmetSchematic(ctx, w * 0.83, h * 0.24, 126, 80);
    this._drawGauntletSchematic(ctx, w * 0.82, h * 0.49, 134, 72);
    this._drawSuitViews(ctx, w * 0.82, h * 0.77, 170, 96);

    // Centerpiece: dark crimson wireframe model
    this._drawRotatingWireframeSuit(ctx, cx, cy + 20, 160, t);
  }

  _drawArcBlueprint(ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(0,229,255,0.72)';
    ctx.fillStyle = 'rgba(0,229,255,0.82)';
    ctx.shadowColor = 'rgba(0,136,170,0.75)';
    ctx.shadowBlur = 10;
    ctx.font = '600 10px Orbitron, Rajdhani, sans-serif';
    ctx.fillText('RELEASE REQUIREMENTS', -r, -r - 24);
    [1, 0.74, 0.52, 0.32].forEach((k) => {
      ctx.beginPath();
      ctx.arc(0, 0, r * k, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
    ctx.restore();
  }

  _drawHelmetSchematic(ctx, x, y, w, h) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(0,229,255,0.66)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-w * 0.4, -h * 0.1);
    ctx.quadraticCurveTo(-w * 0.1, -h * 0.5, w * 0.2, -h * 0.25);
    ctx.quadraticCurveTo(w * 0.45, -h * 0.05, w * 0.42, h * 0.18);
    ctx.quadraticCurveTo(w * 0.2, h * 0.38, -w * 0.1, h * 0.3);
    ctx.quadraticCurveTo(-w * 0.35, h * 0.15, -w * 0.4, -h * 0.1);
    ctx.stroke();
    ctx.restore();
  }

  _drawGauntletSchematic(ctx, x, y, w, h) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(0,229,255,0.62)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(-w * 0.45, -h * 0.25, w * 0.55, h * 0.5);
    ctx.beginPath();
    ctx.arc(w * 0.16, 0, h * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-w * 0.12, -h * 0.15);
    ctx.lineTo(w * 0.33, h * 0.15);
    ctx.stroke();
    ctx.restore();
  }

  _drawSuitViews(ctx, x, y, w, h) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(0,229,255,0.56)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-w * 0.5, -h * 0.5, w * 0.4, h);
    ctx.strokeRect(w * 0.1, -h * 0.5, w * 0.4, h);
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h * 0.5);
    ctx.lineTo(-w * 0.3, h * 0.5);
    ctx.moveTo(w * 0.3, -h * 0.5);
    ctx.lineTo(w * 0.3, h * 0.5);
    ctx.stroke();
    ctx.restore();
  }

  _drawRotatingWireframeSuit(ctx, cx, cy, scale, t) {
    if (this._bootSuitModel?.vertices?.length && this._bootSuitModel?.edges?.length) {
      const { vertices, edges } = this._bootSuitModel;
      const rotY = t * 0.9;
      const rotX = -0.12;
      const dist = 2.1;
      const projected = new Array(vertices.length);

      for (let i = 0; i < vertices.length; i += 1) {
        const [x0, y0, z0] = vertices[i];
        const x1 = (x0 * Math.cos(rotY)) + (z0 * Math.sin(rotY));
        const z1 = (-x0 * Math.sin(rotY)) + (z0 * Math.cos(rotY));
        const y2 = (y0 * Math.cos(rotX)) - (z1 * Math.sin(rotX));
        const z2 = (y0 * Math.sin(rotX)) + (z1 * Math.cos(rotX));
        const p = dist / (dist - z2);
        projected[i] = [cx + (x1 * scale * 2.25 * p), cy + (y2 * scale * 2.25 * p), z2];
      }

      ctx.save();
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = 'rgba(255,40,120,0.98)';
      ctx.shadowColor = 'rgba(255,40,120,0.92)';
      ctx.shadowBlur = 16;
      ctx.globalAlpha = 1;

      for (let i = 0; i < edges.length; i += 1) {
        const [a, b] = edges[i];
        const p1 = projected[a];
        const p2 = projected[b];
        if (!p1 || !p2) continue;
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
      }

      // reinforce silhouette points to avoid "empty" look at a glance
      ctx.fillStyle = 'rgba(255,80,150,0.9)';
      for (let i = 0; i < projected.length; i += 6) {
        const p = projected[i];
        if (!p) continue;
        ctx.fillRect(p[0], p[1], 1.8, 1.8);
      }

      // subtle accent lines
      ctx.strokeStyle = 'rgba(0,229,255,0.45)';
      ctx.lineWidth = 1.1;
      for (let i = 0; i < edges.length; i += 23) {
        const [a, b] = edges[i];
        const p1 = projected[a];
        const p2 = projected[b];
        if (!p1 || !p2) continue;
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    const pts = {
      headTop: [0, -1.15, 0], headL: [-0.17, -0.98, 0.08], headR: [0.17, -0.98, 0.08],
      neck: [0, -0.86, 0],
      shL: [-0.42, -0.72, 0.08], shR: [0.42, -0.72, 0.08],
      chestL: [-0.32, -0.4, 0.14], chestR: [0.32, -0.4, 0.14],
      waistL: [-0.24, -0.03, 0.1], waistR: [0.24, -0.03, 0.1],
      hipL: [-0.22, 0.2, 0.06], hipR: [0.22, 0.2, 0.06],
      kneeL: [-0.16, 0.62, 0.03], kneeR: [0.16, 0.62, 0.03],
      footL: [-0.14, 1.0, 0.12], footR: [0.14, 1.0, 0.12],
      elL: [-0.6, -0.28, 0.02], elR: [0.6, -0.28, 0.02],
      handL: [-0.55, 0.14, 0.08], handR: [0.55, 0.14, 0.08],
    };

    const edges = [
      ['headTop', 'headL'], ['headTop', 'headR'], ['headL', 'neck'], ['headR', 'neck'],
      ['neck', 'shL'], ['neck', 'shR'], ['shL', 'chestL'], ['shR', 'chestR'], ['chestL', 'chestR'],
      ['chestL', 'waistL'], ['chestR', 'waistR'], ['waistL', 'waistR'], ['waistL', 'hipL'], ['waistR', 'hipR'],
      ['hipL', 'kneeL'], ['hipR', 'kneeR'], ['kneeL', 'footL'], ['kneeR', 'footR'],
      ['shL', 'elL'], ['elL', 'handL'], ['shR', 'elR'], ['elR', 'handR'],
    ];

    const rot = t * 0.9;
    const dist = 2.6;
    const proj = {};
    Object.entries(pts).forEach(([k, p]) => {
      const [x, y, z] = p;
      const xr = (x * Math.cos(rot)) + (z * Math.sin(rot));
      const zr = (-x * Math.sin(rot)) + (z * Math.cos(rot));
      const persp = dist / (dist - zr);
      proj[k] = [cx + (xr * scale * persp), cy + (y * scale * persp), zr];
    });

    ctx.save();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = 'rgba(169,0,51,0.95)';
    ctx.shadowColor = 'rgba(169,0,51,0.68)';
    ctx.shadowBlur = 12;
    edges.forEach(([a, b], i) => {
      const p1 = proj[a];
      const p2 = proj[b];
      ctx.globalAlpha = 0.52 + ((Math.sin(t * 4 + i) + 1) * 0.14);
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
    });

    // faint green/yellow accents
    ctx.globalAlpha = 0.46;
    ctx.strokeStyle = 'rgba(145,255,120,0.62)';
    ctx.beginPath();
    ctx.moveTo(proj.chestL[0], proj.chestL[1]);
    ctx.lineTo(proj.waistR[0], proj.waistR[1]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,235,120,0.54)';
    ctx.beginPath();
    ctx.moveTo(proj.shL[0], proj.shL[1]);
    ctx.lineTo(proj.hipR[0], proj.hipR[1]);
    ctx.stroke();
    ctx.restore();
  }

  _drawArcReactorFinale(ctx, cx, cy, w, h, t) {
    const pulse = 0.8 + (Math.sin(t * 8.2) * 0.2);
    const r = Math.min(w, h) * 0.23;

    ctx.save();
    ctx.translate(cx, cy);

    // Outer metallic ring
    ctx.fillStyle = 'rgba(20,26,32,1)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.28, 0, Math.PI * 2);
    ctx.fill();

    // 3 structural brackets (static mechanics)
    ctx.fillStyle = 'rgba(52,64,78,0.95)';
    for (let i = 0; i < 3; i += 1) {
      const a = (-Math.PI / 2) + (i * ((Math.PI * 2) / 3));
      const bx = Math.cos(a) * r * 1.45;
      const by = Math.sin(a) * r * 1.45;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillRect(-18, -34, 36, 68);
      ctx.restore();
    }

    // Backlighting through mechanical gaps
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      const gx = Math.cos(a) * r * 1.18;
      const gy = Math.sin(a) * r * 1.18;
      ctx.fillStyle = `rgba(0,229,255,${0.08 + (pulse * 0.14)})`;
      ctx.beginPath();
      ctx.arc(gx, gy, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outer equilateral downward triangle frame
    const tri = r * 0.82;
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,229,255,0.92)';
    ctx.shadowColor = 'rgba(0,136,170,0.95)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, tri * 0.95);
    ctx.lineTo(-tri * 0.87, -tri * 0.5);
    ctx.lineTo(tri * 0.87, -tri * 0.5);
    ctx.closePath();
    ctx.stroke();

    // Cyan fill between frame and inner core
    const inner = tri * 0.52;
    const triGlow = ctx.createRadialGradient(0, 0, 10, 0, 0, tri);
    triGlow.addColorStop(0, `rgba(0,229,255,${0.6 * pulse})`);
    triGlow.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = triGlow;
    ctx.beginPath();
    ctx.moveTo(0, tri * 0.8);
    ctx.lineTo(-tri * 0.72, -tri * 0.42);
    ctx.lineTo(tri * 0.72, -tri * 0.42);
    ctx.closePath();
    ctx.fill();

    // Pure white inner triangle core pulse
    ctx.fillStyle = `rgba(255,255,255,${0.8 + (0.2 * pulse)})`;
    ctx.beginPath();
    ctx.moveTo(0, inner * 0.82);
    ctx.lineTo(-inner * 0.7, -inner * 0.4);
    ctx.lineTo(inner * 0.7, -inner * 0.4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  _drawHoloPanel(ctx, x, y, w, h, skew, title, subtitle, alpha = 0.3, warning = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1, 0, skew, 1, 0, 0);
    ctx.fillStyle = `rgba(${warning ? '70,16,20' : '8,28,50'},${alpha})`;
    ctx.strokeStyle = warning ? 'rgba(255,100,110,0.55)' : 'rgba(90,220,255,0.45)';
    ctx.lineWidth = 1.2;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeRect(0, 0, w, h);
    ctx.fillStyle = warning ? 'rgba(255,140,150,0.95)' : 'rgba(120,230,255,0.95)';
    ctx.font = '600 11px Orbitron, sans-serif';
    ctx.fillText(title, 10, 22);
    ctx.fillStyle = 'rgba(170,220,240,0.8)';
    ctx.font = '500 9px Orbitron, sans-serif';
    ctx.fillText(subtitle, 10, 40);
    ctx.restore();
  }

  _drawWireSuit(ctx, cx, cy, scale, landing) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.rotate((-0.08 + landing * 0.22));
    ctx.strokeStyle = 'rgba(100,220,255,0.95)';
    ctx.shadowColor = 'rgba(40,200,255,0.65)';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 1.6;

    const lines = [
      [-18, -90, 18, -90], [0, -90, 0, -58],
      [-26, -56, 26, -56], [-30, -56, -42, -6], [30, -56, 42, -6],
      [-22, -56, -18, 0], [22, -56, 18, 0],
      [-18, 0, 18, 0], [-18, 0, -14, 58], [18, 0, 14, 58],
      [-14, 58, -26, 108], [14, 58, 26, 108],
    ];
    lines.forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.arc(0, -104, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  _drawParticleStorm(ctx, cx, cy, swirl, opacity) {
    const list = this._bootParticles;
    if (!list.length) return;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > 1) p.vx *= -1;
      if (p.y < 0 || p.y > 1) p.vy *= -1;

      const ang = (i * 0.12) + (swirl * Math.PI * 8);
      const radius = 30 + (i % 170) * 1.8;
      const sx = cx + Math.cos(ang + p.x * 8) * radius * (0.3 + swirl) + (p.x - 0.5) * 90;
      const sy = cy + Math.sin(ang + p.y * 8) * radius * (0.2 + swirl) + (p.y - 0.5) * 60;

      const a = p.a * opacity;
      if (p.c === 'red') ctx.fillStyle = `rgba(255,110,122,${0.35 * a})`;
      else if (p.c === 'white') ctx.fillStyle = `rgba(220,240,255,${0.45 * a})`;
      else ctx.fillStyle = `rgba(76,210,255,${0.55 * a})`;

      const size = p.s * (0.8 + swirl * 0.7);
      ctx.fillRect(sx, sy, size, size);
    }
  }

  _drawConstructionRings(ctx, cx, cy, p) {
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 4; i += 1) {
      const r = 70 + i * 30;
      ctx.strokeStyle = `rgba(70,210,255,${0.35 + i * 0.1})`;
      ctx.lineWidth = 7 - i;
      ctx.beginPath();
      ctx.arc(0, 0, r, (p * Math.PI * (2 + i * 0.4)), (p * Math.PI * (4 + i * 0.5)));
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(110,230,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-150, -160 + p * 140);
    ctx.lineTo(-150, 170);
    ctx.moveTo(150, -160 + p * 140);
    ctx.lineTo(150, 170);
    ctx.stroke();
    ctx.restore();
  }

  _drawArcReactor(ctx, cx, cy, p, t) {
    const zoom = 1 + p * 0.26;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);

    // shells
    for (let i = 0; i < 5; i += 1) {
      const r = 46 + i * 24;
      ctx.strokeStyle = `rgba(${30 + i * 10},${55 + i * 10},${85 + i * 10},0.95)`;
      ctx.lineWidth = 10 - i;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // spinning light rings
    for (let i = 0; i < 3; i += 1) {
      const r = 78 + i * 26;
      const spin = t * (1.8 + i * 0.6) * (i % 2 ? -1 : 1);
      ctx.strokeStyle = `rgba(70,220,255,${0.45 + i * 0.14})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, r, spin, spin + Math.PI * 1.2);
      ctx.stroke();
    }

    // triangular core
    ctx.beginPath();
    const tri = 34;
    ctx.moveTo(0, -tri);
    ctx.lineTo(-tri * 0.88, tri * 0.65);
    ctx.lineTo(tri * 0.88, tri * 0.65);
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 70);
    g.addColorStop(0, 'rgba(180,240,255,0.95)');
    g.addColorStop(1, 'rgba(0,180,235,0.45)');
    ctx.fillStyle = g;
    ctx.fill();

    // reactor glow
    const pulse = 0.7 + (Math.sin(t * 8) * 0.3);
    ctx.shadowColor = 'rgba(0,212,255,0.95)';
    ctx.shadowBlur = 40 + pulse * 24;
    ctx.strokeStyle = `rgba(120,238,255,${0.65 + pulse * 0.3})`;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(0, 0, 52, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Set progress bar width */
  _setProgress(el, pct) {
    if (el) el.style.width = `${pct}%`;
  }

  /** Screen shake effect — feels mechanical */
  _shakeOverlay(el, intensity = 2) {
    if (!el) return;
    const px = intensity;
    el.animate([
      { transform: 'translate(0, 0)' },
      { transform: `translate(${px}px, -${px}px)` },
      { transform: `translate(-${px}px, ${px}px)` },
      { transform: `translate(${px}px, ${px * 0.5}px)` },
      { transform: 'translate(0, 0)' },
    ], { duration: 150, easing: 'ease-out' });
  }

  /** Flash the boot reactor for dramatic effect */
  _flashBootReactor() {
    const reactor = this.dom.bootReactorCore;
    if (!reactor) return;
    reactor.classList.add('reactor-flash');
    setTimeout(() => reactor.classList.remove('reactor-flash'), 600);
  }

  _speakBootLine(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-GB';
      utter.rate = 0.96;
      utter.pitch = 0.88;
      const voices = window.speechSynthesis.getVoices?.() || [];
      const british = voices.find((v) => /en-GB/i.test(v.lang)) || voices[0];
      if (british) utter.voice = british;
      window.speechSynthesis.speak(utter);
    } catch {
      // non-blocking if voice isn't available
    }
  }

  _setBootPhase(phase) {
    if (!this.dom.bootOverlay) return;
    this.dom.bootOverlay.dataset.phase = phase;
    document.body.dataset.startupPhase = phase;
    if (this.dom.hudRoot) {
      this.dom.hudRoot.dataset.startupPhase = phase;
    }
  }

  _setAiEra(era) {
    this._aiEra = era;
    document.body.dataset.aiEra = era;
    if (this.dom.hudRoot) {
      this.dom.hudRoot.dataset.aiEra = era;
    }
  }

  /** Complete boot — mechanical staggered panel reveal using Web Animations API */
  async _completeBoot() {
    this.booted = true;
    this._applyUiMode(false);
    this._setAiEra('jarvis');
    document.body.classList.remove('startup-sequence');
    delete document.body.dataset.startupPhase;

    if (this.dom.bootOverlay) {
      this.dom.bootOverlay.classList.add('hidden');
    }

    if (this.dom.hudRoot) {
      delete this.dom.hudRoot.dataset.startupPhase;
      this.dom.hudRoot.classList.add('booted');
    }

    // Staggered mechanical panel reveal — uses Web Animations API (fires ONCE, never repeats)
    const panels = [
      { el: document.querySelector('.top-bar'), delay: 0, from: { transform: 'translateY(-28px) scaleY(0.85)', opacity: 0, filter: 'brightness(2.5) blur(3px)' } },
      { el: document.querySelector('.left-panel'), delay: 90, from: { transform: 'translateX(-36px) scaleX(0.88)', opacity: 0, filter: 'brightness(2) blur(3px)' } },
      { el: document.querySelector('.center-panel'), delay: 180, from: { transform: 'scale(0.7) rotate(-2deg)', opacity: 0, filter: 'brightness(3) blur(5px) saturate(0.4)' } },
      { el: document.querySelector('.right-panel'), delay: 270, from: { transform: 'translateX(36px) scaleX(0.88)', opacity: 0, filter: 'brightness(2) blur(3px)' } },
      { el: document.querySelector('.bottom-bar'), delay: 360, from: { transform: 'translateY(28px) scaleY(0.85)', opacity: 0, filter: 'brightness(2.5) blur(3px)' } },
    ];

    const to = { transform: 'none', opacity: 1, filter: 'brightness(1) blur(0) saturate(1)' };

    for (const { el, delay, from } of panels) {
      if (!el) continue;
      if (delay > 0) await this._sleep(delay);

      // One-shot Web Animation — plays once, commits final state, done.
      el.animate([from, to], {
        duration: 360,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards',
      });
    }

    // After all panels are revealed, ensure clean state
    await this._sleep(380);
    for (const { el } of panels) {
      if (!el) continue;
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.filter = 'none';
    }
  }

  /** Wait for backend health check */
  async _waitForBackend(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const data = await resp.json();
          this.backendReady = true;
          this._updateBackendPill('online', `v${data.version || '?'}`);
          return true;
        }
      } catch {
        // Not ready yet
      }
      await this._sleep(800);
    }
    return false;
  }

  /** ── Clock ──────────────────────────────────────────────────── */
  _startClock() {
    const update = () => {
      const now = new Date();
      if (this.dom.clock) {
        this.dom.clock.textContent = now.toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      }
      if (this.dom.calendar) {
        this.dom.calendar.textContent = now.toLocaleDateString('en-GB', {
          weekday: 'short', month: 'short', day: 'numeric',
        });
      }
    };
    update();
    this._clockInterval = setInterval(update, 1000);
  }

  /** ── WebSocket ──────────────────────────────────────────────── */
  _connectWebSocket() {
    if (this.ws) {
      return;
    }

    this.ws = new JarvisSocket(WS_URL);
    this.ws.onMessage((msg) => {
      this._handleEvent(msg.event, msg.payload || {});
    });
    this.ws.onBinary((buffer) => {
      if (this.audioTransport) {
        this.audioTransport.handleBinaryChunk(buffer);
      }
    });
    this.ws.connect();
  }

  /** ── Event Router ───────────────────────────────────────────── */
  _handleEvent(event, payload) {
    switch (event) {
      // System metrics
      case 'system:metrics':
        this.gauges.update(payload);
        this._updateStressLevel(payload);
        this._updateArmorTelemetry(payload);
        this._triggerTelemetryPulse(payload);
        break;

      // Brain events
      case 'brain:routing':
        this._assistantBuffer = '';
        this._setVoiceState('thinking');
        break;
      case 'brain:thinking':
        this._setVoiceState('thinking');
        break;
      case 'brain:chunk':
        if (payload.text) {
          this._assistantBuffer += payload.text;
        }
        break;
      case 'brain:done':
        this._setModeStatus(Boolean(payload.stark_mode));
        if (this._assistantBuffer.trim()) {
          const assistantText = this._sanitizeAssistantText(this._assistantBuffer);
          this.chat.add('assistant', assistantText);
          this._speakTextReply(assistantText);
        }
        this._clearChatUnlockFailsafe();
        this._assistantBuffer = '';
        this._setVoiceState('idle');
        this._chatLocked = false;
        this._updateSendButton(false);
        if (payload.latency_ms) {
          this._lastLatency = payload.latency_ms;
          if (this.dom.latencyDisplay) {
            this.dom.latencyDisplay.textContent = `${payload.latency_ms}ms`;
          }
        }
        break;
      case 'brain:tool_call':
        if (payload.tool_name) {
          this.chat.add('tool', `⚡ Executing: ${payload.tool_name}`);
        }
        break;
      case 'brain:tool_result':
        if (payload.result) {
          const out = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result, null, 2);
          this.chat.add('tool', `✓ ${payload.tool_name}: ${out.substring(0, 300)}`);
        }
        break;
      case 'brain:mode':
        this._setModeStatus(Boolean(payload.stark_mode));
        break;

      // Voice events
      case 'voice:state':
        this._setVoiceState(payload.state || 'idle');
        break;
      case 'voice:wake_word':
        this.chat.addSystem(`Wake word: "${payload.keyword}"`);
        this._setVoiceState('listening');
        break;
      case 'voice:transcript':
        if (payload.text) {
          this.chat.add('user', payload.text);
        }
        break;
      case 'voice:reply':
        // Full reply — handled by brain:done / brain:chunk
        break;
      case 'voice:tts_done':
        this._setVoiceState('idle');
        if (this.audioTransport) this.audioTransport.handleTtsDone();
        break;
      case 'voice:error':
        this.chat.add('error', payload.error || 'Voice error');
        this._setVoiceState('error');
        break;

      // Confirmation requests
      case 'brain:confirm_request':
        this._showConfirmation(payload);
        break;

      // Socket status from JarvisSocket wrapper
      case 'socket':
        if (payload.state === 'connected') {
          this.wsConnected = true;
          this._updateWsStatus(true);
          if (!this.backendReady) {
            this.backendReady = true;
            this._updateBackendPill('online', 'connected');
          }
        } else if (payload.state === 'closed' || payload.state === 'error') {
          this.wsConnected = false;
          this._updateWsStatus(false);
        }
        break;
    }
  }

  /** ── Three.js Worker ────────────────────────────────────────── */
  _initThreeJs() {
    const canvas = this.dom.threeCanvas;
    if (!canvas) return;

    try {
      const offscreen = canvas.transferControlToOffscreen();
      this.threeWorker = new Worker(
        new URL('./workers/three-worker.js', import.meta.url),
        { type: 'module' },
      );
      this.threeWorker.postMessage(
        { type: 'init', canvas: offscreen, width: canvas.clientWidth, height: canvas.clientHeight, tier: 'medium' },
        [offscreen],
      );

      this.threeWorker.onmessage = (e) => {
        if (e.data?.type === 'fps_warning') {
          // Downgrade tier
          if (e.data.tier === 'high') this.threeWorker.postMessage({ type: 'set_tier', tier: 'medium' });
          else if (e.data.tier === 'medium') this.threeWorker.postMessage({ type: 'set_tier', tier: 'low' });
        }
      };

      // Resize observer
      const obs = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (this.threeWorker && width > 0 && height > 0) {
          this.threeWorker.postMessage({ type: 'resize', width: Math.round(width), height: Math.round(height) });
        }
      });
      obs.observe(canvas.parentElement);
    } catch {
      // OffscreenCanvas not supported — orb CSS rings still work
    }
  }

  /** ── UI Bindings ────────────────────────────────────────────── */
  _bindUI() {
    // Send message
    const sendMessage = () => {
      const input = this.dom.chatInput;
      if (!input) return;
      const text = input.value.trim();
      if (!text || this._chatLocked) return;

      if (text === '/clear') {
        this.chat.clear();
        this.chat.addSystem('Conversation cleared. Ready for a fresh command.');
        input.value = '';
        return;
      }

      this._sendChat(text);
      input.value = '';
    };

    this.dom.btnSend?.addEventListener('click', sendMessage);
    this.dom.chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    this.dom.chatQuickActions?.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const prompt = target.dataset.prompt;
      if (!prompt || this._chatLocked) return;
      if (this.dom.chatInput) {
        this.dom.chatInput.value = prompt;
      }
      sendMessage();
    });

    // Mic button
    this.dom.btnMic?.addEventListener('click', async () => {
      await this._toggleVoice();
    });

    // Text-chat voice reply toggle
    this._syncVoiceReplyToggleLabel();
    this.dom.btnToggleVoiceReply?.addEventListener('click', () => {
      this._textChatVoiceReplyEnabled = !this._textChatVoiceReplyEnabled;
      this._syncVoiceReplyToggleLabel();
      this.chat.addSystem(`Voice reply for typed chat ${this._textChatVoiceReplyEnabled ? 'enabled' : 'disabled'}.`);
    });

    // Click-through toggle
    this.dom.btnClickthrough?.addEventListener('click', () => {
      if (window.jarvis?.toggleClickThrough) {
        window.jarvis.toggleClickThrough().then((result) => {
          this._applyUiMode(Boolean(result?.clickThrough));
        }).catch(() => {
          this._applyUiMode(!this._clickthroughUi);
        });
      }
    });

    // Focus toggle
    this.dom.btnFocus?.addEventListener('click', () => {
      document.body.classList.toggle('hud-focus');
    });

    // Main-process Ctrl+K shortcut event
    if (window.jarvis?.onToggleFocusShortcut) {
      window.jarvis.onToggleFocusShortcut((payload) => {
        if (payload && typeof payload.clickThrough === 'boolean') {
          this._applyUiMode(payload.clickThrough);
          return;
        }
        this._applyUiMode(!this._clickthroughUi);
      });
    }

    // Panel collapse
    this.dom.collapseLeft?.addEventListener('click', () => {
      const panel = this.dom.collapseLeft.closest('.left-panel');
      if (panel) panel.classList.toggle('collapsed');
    });
    this.dom.collapseRight?.addEventListener('click', () => {
      const panel = this.dom.collapseRight.closest('.right-panel');
      if (panel) panel.classList.toggle('collapsed');
    });
  }

  /** ── Chat ───────────────────────────────────────────────────── */
  async _sendChat(message) {
    this._chatLocked = true;
    this._updateSendButton(true);
    this._startChatUnlockFailsafe();
    this.chat.add('user', message);

    // Send via WebSocket if connected, else REST
    if (this.wsConnected && this.ws?.isOpen?.()) {
      const sent = this.ws.send('chat', { message, prefer_cloud: false });
      if (!sent) {
        await this._sendChatViaRest(message);
      }
    } else {
      await this._sendChatViaRest(message);
    }
  }

  async _sendChatViaRest(message) {
    try {
      const resp = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, prefer_cloud: false }),
      });

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();

      let sseBuffer = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.event === 'brain:chunk' && data.payload?.text) {
                  sseBuffer += data.payload.text;
                }
              } catch { /* ignore malformed chunks */ }
            }
          }
        }
      }

      if (sseBuffer.trim()) {
        const assistantText = this._sanitizeAssistantText(sseBuffer);
        this.chat.add('assistant', assistantText);
        this._speakTextReply(assistantText);
      }
      this._clearChatUnlockFailsafe();
      this._chatLocked = false;
      this._updateSendButton(false);
    } catch (err) {
      this._clearChatUnlockFailsafe();
      this.chat.add('error', `Request failed: ${err.message}`);
      this._chatLocked = false;
      this._updateSendButton(false);
    }
  }

  _updateSendButton(disabled) {
    if (this.dom.btnSend) this.dom.btnSend.disabled = disabled;
    if (this.dom.chatInput) this.dom.chatInput.disabled = disabled;
    if (this.dom.chatQuickActions) {
      this.dom.chatQuickActions.querySelectorAll('button').forEach((btn) => {
        btn.disabled = disabled;
      });
    }
  }

  _startChatUnlockFailsafe() {
    this._clearChatUnlockFailsafe();
    this._chatUnlockTimer = setTimeout(() => {
      if (!this._chatLocked) return;
      this._chatLocked = false;
      this._updateSendButton(false);
      this.chat.add('error', 'JARVIS took too long to respond. Chat unlocked after 15s failsafe — please try again.');
    }, CHAT_UNLOCK_TIMEOUT_MS);
  }

  _clearChatUnlockFailsafe() {
    if (this._chatUnlockTimer) {
      clearTimeout(this._chatUnlockTimer);
      this._chatUnlockTimer = null;
    }
  }

  _syncVoiceReplyToggleLabel() {
    if (!this.dom.btnToggleVoiceReply) return;
    if (this._textChatVoiceReplyEnabled) {
      this.dom.btnToggleVoiceReply.textContent = '🔊 Voice Reply: ON';
      this.dom.btnToggleVoiceReply.classList.add('primary');
    } else {
      this.dom.btnToggleVoiceReply.textContent = '🔇 Voice Reply: OFF';
      this.dom.btnToggleVoiceReply.classList.remove('primary');
    }
  }

  _speakTextReply(text) {
    if (!this._textChatVoiceReplyEnabled) return;
    const spoken = String(text || '').trim();
    if (!spoken || !('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.rate = 1.0;
      utterance.pitch = 0.95;

      const voices = window.speechSynthesis.getVoices() || [];
      const preferred = voices.find((v) => /en-GB/i.test(v.lang) && /ryan|male|daniel|george|libby|sonia/i.test(v.name))
        || voices.find((v) => /en-GB/i.test(v.lang))
        || voices.find((v) => /en/i.test(v.lang));
      if (preferred) utterance.voice = preferred;

      window.speechSynthesis.speak(utterance);
    } catch {
      // noop
    }
  }

  /** ── Voice ──────────────────────────────────────────────────── */
  async _toggleVoice() {
    if (!this.voiceClient) {
      try {
        if (window.jarvis?.requestMicrophoneAccess) {
          const mic = await window.jarvis.requestMicrophoneAccess();
          if (!mic?.granted) {
            throw new Error('Microphone permission denied');
          }
        }

        if (!this.ws) {
          this._connectWebSocket();
        }
        // Wait briefly for socket to be open; avoid silent mic no-op.
        if (!(await this._waitForSocketOpen(3000))) {
          this.chat.add('error', 'Microphone could not start: backend socket is not connected.');
          return;
        }

        this.audioTransport = new AudioTransport((state) => {
          this._setVoiceState(state);
        });
        await this.audioTransport.init();

        this.voiceClient = new VoiceClient(
          this.ws,
          this.audioTransport,
          (state) => this._setVoiceState(state),
          (level) => {
            if (this.threeWorker) {
              this.threeWorker.postMessage({ type: 'set_audio_level', level });
            }
            this._audioLevelTarget = Math.max(0, Math.min(1, Number(level) || 0));
          },
        );
        await this.voiceClient.start();
        this.dom.btnMic.classList.add('primary');
        this.chat.addSystem('Voice activated. Speak naturally; JARVIS will transcribe when you pause.');
      } catch (err) {
        const msg = String(err?.message || err || 'unknown error');
        if (/permission denied|notallowederror|permission/i.test(msg)) {
          this.chat.add('error', 'Voice init failed: Microphone permission denied. Allow access in JARVIS prompt and ensure Windows > Privacy > Microphone allows desktop apps.');
        } else if (/found|device|input/i.test(msg)) {
          this.chat.add('error', 'Voice init failed: No usable microphone device was found. Check your default input device in Windows sound settings.');
        } else {
          this.chat.add('error', `Voice init failed: ${msg}`);
        }
      }
    } else {
      this.voiceClient.stop();
      this.voiceClient = null;
      this.audioTransport = null;
      this._audioLevelTarget = 0;
      this.dom.btnMic?.classList.remove('primary');
      this._setVoiceState('idle');
      this.chat.addSystem('Voice deactivated.');
    }
  }

  /** ── Weather (Open-Meteo, no key) ─────────────────────────── */
  _startWeatherLoop() {
    this._refreshWeather();
    this._weatherTimer = setInterval(() => this._refreshWeather(), 10 * 60 * 1000);
  }

  async _refreshWeather() {
    const weatherEl = document.getElementById('top-weather');
    if (!weatherEl || !navigator.geolocation) return;

    const getPos = () => new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 600000 });
    });

    try {
      const pos = await getPos();
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const resp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const temp = Math.round(data?.current?.temperature_2m ?? 0);
      const code = Number(data?.current?.weather_code ?? 0);
      const icon = this._weatherIconForCode(code);
      weatherEl.textContent = `${icon} ${temp}°C`;
    } catch {
      // Fallback to city weather (no geolocation) so top weather still works.
      await this._refreshWeatherByCity('Bengaluru', weatherEl);
    }
  }

  async _refreshWeatherByCity(city, weatherEl) {
    try {
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!geo.ok) throw new Error('geocoding_failed');
      const geoData = await geo.json();
      const loc = (geoData?.results || [])[0];
      if (!loc) throw new Error('city_not_found');

      const resp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code&timezone=auto`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) throw new Error('weather_failed');
      const data = await resp.json();
      const temp = Math.round(data?.current?.temperature_2m ?? 0);
      const code = Number(data?.current?.weather_code ?? 0);
      const icon = this._weatherIconForCode(code);
      weatherEl.textContent = `${icon} ${temp}°C`;
    } catch {
      if (!weatherEl.textContent || weatherEl.textContent.includes('--')) {
        weatherEl.textContent = '☁ --°C';
      }
    }
  }

  _sanitizeAssistantText(text) {
    if (!text) return text;
    const cleaned = String(text).trim();

    const leakedToolCall = cleaned.match(/action\s*=\s*['\"]?tool_call['\"]?.*tool_name\s*=\s*['\"]?([a-zA-Z0-9_:-]+)['\"]?/i);
    if (leakedToolCall) {
      return 'I couldn’t complete that action cleanly. Please retry once with a clearer command.';
    }

    const m = cleaned.match(/action\s*=\s*['\"]?direct_response['\"]?\s+response\s*=\s*([\s\S]+)/i);
    if (!m) return cleaned;
    let resp = m[1].trim();
    if (resp.length >= 2 && ((resp.startsWith('"') && resp.endsWith('"')) || (resp.startsWith("'") && resp.endsWith("'")))) {
      resp = resp.slice(1, -1);
    }
    return resp.trim();
  }

  _weatherIconForCode(code) {
    if (code === 0) return '☀';
    if ([1, 2].includes(code)) return '🌤';
    if ([3, 45, 48].includes(code)) return '☁';
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return '🌧';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄';
    if ([95, 96, 99].includes(code)) return '⛈';
    return '🌡';
  }

  async _waitForSocketOpen(timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.ws?.isOpen?.()) return true;
      await this._sleep(120);
    }
    return false;
  }

  /** ── Voice State Display (stable — no animation re-triggering) */
  _setVoiceState(state) {
    const el = this.dom.voiceState;
    if (!el) return;

    el.textContent = state;
    el.setAttribute('data-state', state);
    // Voice state indicator uses CSS transitions, not animation re-triggers

    if (this.threeWorker) {
      this.threeWorker.postMessage({ type: 'set_state', state });
    }
  }

  /** ── Stress Level → Three.js ────────────────────────────────── */
  _updateStressLevel(metrics) {
    const cpu = metrics.cpu_percent ?? 0;
    const ram = metrics.ram_percent ?? 0;
    const gpu = metrics.gpu_percent ?? 0;
    const stress = Math.max(cpu, ram, gpu) / 100;

    if (this.threeWorker) {
      this.threeWorker.postMessage({ type: 'set_stress_level', level: stress });
    }
  }

  _updateArmorTelemetry(metrics) {
    const clamp = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

    const cpu = clamp(metrics?.cpu_percent);
    const gpu = clamp(metrics?.gpu_percent);
    const ram = clamp(metrics?.ram_percent);
    const load = Math.max(cpu, gpu, ram);

    const thermalC = Math.round(34 + load * 0.56);
    const gpuTemp = Math.round(37 + gpu * 0.57);
    const cpuTemp = Math.round(35 + cpu * 0.54);
    const thermalState = thermalC >= 84 ? 'critical' : thermalC >= 74 ? 'combat' : thermalC >= 62 ? 'elevated' : 'nominal';
    const loadState = load >= 92 ? 'critical' : load >= 78 ? 'combat' : load >= 55 ? 'elevated' : 'nominal';
    const baseState = (thermalState === 'critical' || loadState === 'critical')
      ? 'critical'
      : (thermalState === 'combat' || loadState === 'combat')
        ? 'combat'
        : (thermalState === 'elevated' || loadState === 'elevated')
          ? 'elevated'
          : 'nominal';

    this._armorTelemetryState = baseState;
    const themeState = this._resolveArmorTheme(baseState);
    this._applyArmorTheme(themeState);

    if (this.dom.armorBusState) {
      const labels = {
        nominal: 'NOMINAL',
        elevated: 'ELEVATED',
        combat: 'COMBAT',
        critical: 'OVERDRIVE',
        degraded: 'DEGRADED',
      };
      this.dom.armorBusState.textContent = labels[themeState] || 'NOMINAL';
    }

    if (this.dom.armorGpuTemp) {
      this.dom.armorGpuTemp.textContent = `GPU - ${gpuTemp}°C`;
    }

    if (this.dom.armorCpuTemp) {
      this.dom.armorCpuTemp.textContent = `CPU - ${cpuTemp}°C`;
    }
  }

  _resolveArmorTheme(baseState) {
    if (this._armorDiagnosticsState === 'dead') return 'critical';
    if (this._armorDiagnosticsState === 'warn' && baseState === 'nominal') return 'degraded';
    return baseState;
  }

  _applyArmorTheme(theme) {
    if (!this.dom.armorModule) return;
    this.dom.armorModule.dataset.theme = theme;
  }

  /** ── Tool Confirmation ──────────────────────────────────────── */
  _showConfirmation(payload) {
    const msg = `JARVIS wants to run: ${payload.tool_name}\nArguments: ${JSON.stringify(payload.arguments)}\nReason: ${payload.reason}`;
    this.chat.add('tool', msg);

    // Auto-approve for SAFE tier, otherwise ask
    const approved = confirm(`Allow JARVIS to execute "${payload.tool_name}"?`);
    if (this.ws?.isOpen?.()) {
      this.ws.send('tool_confirm', { request_id: payload.request_id, approved });
    }
  }

  /** ── Status Helpers (NO animation re-triggering) ────────────── */
  _updateBackendPill(status, label) {
    const el = this.dom.backendStatus;
    if (!el) return;
    el.className = `status-pill ${status}`;
    el.textContent = `Backend: ${label}`;
  }

  _updateWsStatus(connected) {
    const el = this.dom.wsStatus;
    if (!el) return;
    el.style.color = connected ? 'var(--green)' : 'var(--red)';
    el.textContent = connected ? 'WS: ●' : 'WS: ○';
  }

  _setModeStatus(enabled) {
    const el = this.dom.modeStatus;
    if (!el) return;
    if (enabled) {
      el.textContent = 'MODE: STARK';
      el.classList.add('stark');
    } else {
      el.textContent = 'MODE: NORMAL';
      el.classList.remove('stark');
    }
  }

  _applyUiMode(clickthroughEnabled) {
    this._clickthroughUi = Boolean(clickthroughEnabled);
    // No animation class toggle — just swap modes. CSS transitions handle the rest.
    document.body.classList.toggle('clickthrough-ui', this._clickthroughUi);
    document.body.classList.toggle('normal-ui', !this._clickthroughUi);
  }

  /** Telemetry pulse — NO CSS animation re-triggering. Only updates AI era via CSS vars. */
  _triggerTelemetryPulse(metrics) {
    if (!this.dom.hudRoot) return;

    const cpu = Number(metrics?.cpu_percent || 0);
    const gpu = Number(metrics?.gpu_percent || 0);
    const ram = Number(metrics?.ram_percent || 0);
    const stress = Math.max(cpu, gpu, ram);

    // Update stress CSS variable for subtle reactive styling (no animations)
    this.dom.hudRoot.style.setProperty('--stress', (stress / 100).toFixed(3));

    // Update AI era based on stress (just swaps CSS variables — no animation keyframes)
    if (stress >= 90) {
      this._setAiEra('edith');
    } else if (stress >= 68) {
      this._setAiEra('friday');
    } else {
      this._setAiEra('jarvis');
    }
  }

  _initCinematicHudRig() {
    if (this.dom.particleFlow && !this.dom.particleFlow.childElementCount) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < 48; i += 1) {
        const p = document.createElement('span');
        p.className = 'p';
        p.style.setProperty('--x', `${Math.random() * 100}%`);
        p.style.setProperty('--y', `${Math.random() * 100}%`);
        p.style.setProperty('--d', `${1.8 + Math.random() * 4.6}s`);
        p.style.setProperty('--s', `${0.45 + Math.random() * 1.15}`);
        p.style.setProperty('--a', `${0.25 + Math.random() * 0.65}`);
        frag.appendChild(p);
      }
      this.dom.particleFlow.appendChild(frag);
    }

    window.addEventListener('pointermove', (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      this._nullAnchorTarget.x = nx;
      this._nullAnchorTarget.y = ny;
    });
  }

  _startExpressionRig() {
    this._exprStartTs = performance.now();
    const step = (ts) => {
      const t = (ts - this._exprStartTs) / 1000;
      this._nullAnchor.x += (this._nullAnchorTarget.x - this._nullAnchor.x) * 0.08;
      this._nullAnchor.y += (this._nullAnchorTarget.y - this._nullAnchor.y) * 0.08;
      this._audioLevel += (this._audioLevelTarget - this._audioLevel) * 0.18;

      const audioBoost = 1 + this._audioLevel * 1.9;
      const ringSpeed = (1.0 + audioBoost * 0.72).toFixed(3);
      const sweepSpeed = (1.0 + audioBoost * 0.35).toFixed(3);

      if (this.dom.hudRoot) {
        this.dom.hudRoot.style.setProperty('--expr-t', `${t.toFixed(3)}s`);
        this.dom.hudRoot.style.setProperty('--expr-ring-speed', ringSpeed);
        this.dom.hudRoot.style.setProperty('--expr-sweep-speed', sweepSpeed);
        this.dom.hudRoot.style.setProperty('--null-x', `${(this._nullAnchor.x * 16).toFixed(2)}px`);
        this.dom.hudRoot.style.setProperty('--null-y', `${(this._nullAnchor.y * 12).toFixed(2)}px`);
        this.dom.hudRoot.style.setProperty('--audio-level', this._audioLevel.toFixed(3));
      }

      this._exprRaf = requestAnimationFrame(step);
    };

    if (this._exprRaf) {
      cancelAnimationFrame(this._exprRaf);
    }
    this._exprRaf = requestAnimationFrame(step);
  }

  _randomCodeLine() {
    const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const ip = `${20 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    const pool = [
      `0x${hex} :: suit.bus.sync(${Math.floor(Math.random() * 2048)})`,
      `if(threat_score > ${(0.5 + Math.random() * 0.4).toFixed(2)}) deploy_countermeasures();`,
      `vector<float> arc = solve_reactor(${(Math.random() * 9).toFixed(3)}f);`,
      `telemetry.push({ cpu:${Math.floor(Math.random() * 100)}, gpu:${Math.floor(Math.random() * 100)} });`,
      `net.route = "${ip}"; auth.token = "${hex.toUpperCase()}";`,
      `for(auto i=0;i<${4 + Math.floor(Math.random() * 9)};++i){ lattice[i] ^= 0x${hex.slice(0, 4)}; }`,
      `def recalibrate(field): return (field * ${(1 + Math.random()).toFixed(3)}) % 97`,
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _startCodeStream() {
    if (!this.dom.codeStream) return;
    const lines = [];
    const fill = () => {
      lines.push(this._randomCodeLine());
      while (lines.length > 9) lines.shift();
      this.dom.codeStream.textContent = lines.join('\n');
    };

    fill();
    if (this._codeStreamTimer) {
      clearInterval(this._codeStreamTimer);
    }
    this._codeStreamTimer = setInterval(fill, 180);
  }

  _initMissionOverlays() {
    const contactCount = this._minimalUi ? 1 : 3;
    this._tacticalContacts = Array.from({ length: contactCount }, (_, idx) => ({
      id: `T-${idx + 1}`,
      x: 12 + Math.random() * 76,
      y: 14 + Math.random() * 68,
      vx: (Math.random() - 0.5) * 0.65,
      vy: (Math.random() - 0.5) * 0.65,
      armor: ['Light', 'Composite', 'Reactive'][Math.floor(Math.random() * 3)],
      weapon: ['Ballistic', 'Energy', 'Unknown'][Math.floor(Math.random() * 3)],
      integrity: 62 + Math.random() * 34,
      threat: 18 + Math.random() * 42,
      locked: false,
    }));

    if (!document.body.classList.contains('minimal-ui')) {
      this._initLabGestureControls();
    }
  }

  _startOverlayAmbientLoops() {
    if (this._overlayTickTimer) clearInterval(this._overlayTickTimer);
    this._overlayTickTimer = setInterval(() => {
      this._drawCommsWave(this._audioLevel, this._lastStressBand === 'critical' ? 0.95 : this._lastStressBand === 'high' ? 0.75 : 0.42);
      if (!this._minimalUi) {
        this._rotateAlertTicker();
        this._refreshSatelliteText();
      }
    }, this._minimalUi ? 1400 : 900);

    if (this._alertTickerTimer) clearInterval(this._alertTickerTimer);
    if (!this._minimalUi) {
      this._alertTickerTimer = setInterval(() => this._rotateAlertTicker(), 3200);
    }
  }

  _updateMissionOverlays(metrics) {
    const now = Date.now();
    if (now - this._lastOverlayUpdateAt < this._overlayUpdateIntervalMs) {
      return;
    }
    this._lastOverlayUpdateAt = now;

    const cpu = Number(metrics?.cpu_percent || 0);
    const gpu = Number(metrics?.gpu_percent || 0);
    const ram = Number(metrics?.ram_percent || 0);
    const stress = Math.max(cpu, gpu, ram);

    if (document.body.classList.contains('minimal-ui')) {
      this._drawCommsWave(this._audioLevel, stress / 100);
      return;
    }

    const consumption = 0.14 + (stress / 100) * 0.42;
    const recovery = stress < 44 ? 0.23 : 0.04;
    this._arcPower = Math.max(12, Math.min(100, this._arcPower - consumption + recovery));

    if (this.dom.arcPowerRing) this.dom.arcPowerRing.style.setProperty('--p', `${this._arcPower.toFixed(1)}%`);
    if (this.dom.arcPowerValue) this.dom.arcPowerValue.textContent = `${Math.round(this._arcPower)}%`;

    const temp = Math.round(34 + stress * 0.58);
    const o2 = Math.max(72, Math.round(99 - stress * 0.15));
    const mach = Math.max(0.42, (0.45 + (stress / 100) * 1.62).toFixed(2));
    const speed = Math.round(Number(mach) * 1225);
    const alt = Math.round(320 + stress * 88 + (Math.sin(Date.now() / 1400) * 120));

    if (this.dom.vitalTemp) this.dom.vitalTemp.textContent = `${temp}°C`;
    if (this.dom.vitalO2) this.dom.vitalO2.textContent = `${o2}%`;
    if (this.dom.vitalMach) this.dom.vitalMach.textContent = `${mach}`;
    if (this.dom.vitalSpeed) this.dom.vitalSpeed.textContent = `${speed} km/h`;
    if (this.dom.vitalAlt) this.dom.vitalAlt.textContent = `${alt} m`;

    if (this.dom.envO2) this.dom.envO2.textContent = `${(20.1 + (o2 - 90) * 0.03).toFixed(1)}%`;
    if (this.dom.envRad) this.dom.envRad.textContent = `${(0.12 + stress * 0.008).toFixed(2)} μSv/h`;
    if (this.dom.envTox) this.dom.envTox.textContent = `${Math.max(4, Math.round(6 + stress * 0.48))} ppm`;

    const imaging = stress > 82 ? 'THERMAL TRACK' : this._aiEra === 'edith' ? 'X-RAY SCAN' : 'SPECTRAL NORMAL';
    if (this.dom.imagingMode) this.dom.imagingMode.textContent = imaging;

    this._updateStructuralIntegrity(stress);
    this._updateTacticalContacts(stress);
    this._renderTacticalTargets();
    this._renderThreatFeed();
    this._renderTacticalMap();
    this._renderTrajectoryPaths();
    this._updateObjectIdentification();
  }

  _updateStructuralIntegrity(stress) {
    const zones = this.dom.integrityWireframe?.querySelectorAll('i') || [];
    const compromisedCount = stress >= 88 ? 3 : stress >= 72 ? 2 : stress >= 58 ? 1 : 0;
    zones.forEach((z, idx) => {
      z.classList.toggle('compromised', idx < compromisedCount);
      z.classList.toggle('critical', idx === 0 && stress >= 90);
    });
    if (this.dom.integrityLabel) {
      this.dom.integrityLabel.textContent = compromisedCount === 0
        ? 'ALL SYSTEMS NOMINAL'
        : compromisedCount === 1
          ? 'MINOR ARMOR COMPROMISE'
          : compromisedCount === 2
            ? 'MULTI-ZONE DAMAGE'
            : 'CRITICAL STRUCTURAL BREACH';
    }
  }

  _updateTacticalContacts(stress) {
    this._tacticalContacts.forEach((c) => {
      c.x += c.vx;
      c.y += c.vy;
      if (c.x < 6 || c.x > 94) c.vx *= -1;
      if (c.y < 8 || c.y > 92) c.vy *= -1;
      c.x = Math.max(6, Math.min(94, c.x));
      c.y = Math.max(8, Math.min(92, c.y));

      const volatility = (Math.random() - 0.5) * 8;
      c.threat = Math.max(5, Math.min(99, c.threat * 0.82 + (stress * 0.18) + volatility));
      c.integrity = Math.max(8, Math.min(100, c.integrity - (c.threat > 78 ? 0.65 : 0.12)));
      c.locked = c.threat > 68;
    });

    this._tacticalContacts.sort((a, b) => b.threat - a.threat);
  }

  _renderTacticalTargets() {
    if (!this.dom.tacticalTargets) return;
    const maxTargets = document.body.classList.contains('minimal-ui') ? 1 : 4;
    const html = this._tacticalContacts.slice(0, maxTargets).map((c) => {
      const threatClass = c.threat >= 82 ? 'threat-high' : c.threat >= 58 ? 'threat-mid' : 'threat-low';
      const lockClass = c.locked ? 'locked' : 'searching';
      return `<div class="target-reticle ${threatClass} ${lockClass}" style="left:${c.x}%;top:${c.y}%"><span>${c.id}</span></div>`;
    }).join('');
    this.dom.tacticalTargets.innerHTML = html;
  }

  _renderThreatFeed() {
    if (!this.dom.threatFeed) return;
    const html = this._tacticalContacts.slice(0, 3).map((c) => (
      `<div><b>${c.id}</b> ${c.weapon} / ${c.armor} · Integrity ${Math.round(c.integrity)}% · Threat ${Math.round(c.threat)}%</div>`
    )).join('');
    this.dom.threatFeed.innerHTML = html;
  }

  _renderTacticalMap() {
    if (!this.dom.tacticalMapDots) return;
    const html = this._tacticalContacts.slice(0, 6).map((c) => {
      const x = Math.max(8, Math.min(92, c.x));
      const y = Math.max(8, Math.min(92, c.y));
      const hot = c.threat >= 78 ? 'hot' : '';
      return `<i class="map-dot ${hot}" style="left:${x}%;top:${y}%"></i>`;
    }).join('');
    this.dom.tacticalMapDots.innerHTML = html;
  }

  _renderTrajectoryPaths() {
    const primary = this._tacticalContacts[0];
    if (!primary) return;

    if (this.dom.incomingTrajectory) {
      const dIn = `M 4 ${Math.max(8, primary.y - 18).toFixed(1)} Q ${(primary.x * 0.45).toFixed(1)} ${(primary.y * 0.8).toFixed(1)} ${primary.x.toFixed(1)} ${primary.y.toFixed(1)}`;
      this.dom.incomingTrajectory.setAttribute('d', dIn);
    }
    if (this.dom.outgoingTrajectory) {
      const dOut = `M 18 84 Q ${(primary.x * 0.65).toFixed(1)} ${(primary.y * 1.1).toFixed(1)} ${Math.max(12, primary.x - 2).toFixed(1)} ${Math.max(8, primary.y - 2).toFixed(1)}`;
      this.dom.outgoingTrajectory.setAttribute('d', dOut);
    }
  }

  _updateObjectIdentification() {
    if (!this.dom.objectIdentification) return;
    const primary = this._tacticalContacts[0];
    if (!primary) return;
    const dbTag = `${Math.floor(1000 + Math.random() * 9000)}-${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
    const conf = Math.round(72 + Math.min(24, primary.threat * 0.22));
    this.dom.objectIdentification.textContent = `${primary.id} // ${primary.weapon} PLATFORM // MATCH ${conf}% // DB:${dbTag}`;
  }

  _drawCommsWave(audioLevel, stressNorm) {
    const canvas = this.dom.commsWaveform;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const t = performance.now() / 380;
    const amp = 4 + (audioLevel * 18) + (stressNorm * 6);

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(118, 212, 255, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = 0; x < w; x += 2) {
      const y = h * 0.5 + Math.sin((x / 18) + t) * amp + Math.sin((x / 7) + (t * 0.6)) * (amp * 0.3);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _refreshSatelliteText() {
    const base = this._tacticalContacts[0];
    if (!base) return;
    const lat = (12.9 + ((base.y - 50) / 200)).toFixed(3);
    const lon = (77.6 + ((base.x - 50) / 200)).toFixed(3);
    const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (this.dom.satFeedA) this.dom.satFeedA.textContent = `LAT ${lat} / LON ${lon} @ ${stamp}`;
    if (this.dom.satFeedB) this.dom.satFeedB.textContent = `VECTOR ${Math.round(base.threat)}° / LOCK ${base.locked ? 'YES' : 'NO'}`;
  }

  _rotateAlertTicker() {
    if (!this.dom.alertTicker) return;
    const primary = this._tacticalContacts[0];
    const threat = primary ? Math.round(primary.threat) : 0;
    const alerts = [
      `PRIORITY // Threat envelope ${threat}% // Countermeasures standby`,
      `OPS // Structural integrity ${Math.round(this._arcPower)}% power reserve`,
      `COMMS // Multi-channel tactical uplink synchronized`,
      `ENV // Atmospheric diagnostics streaming live`,
      `LAB // Gesture delete active: throw module into TRASH zone`,
    ];
    this.dom.alertTicker.textContent = alerts[Math.floor(Math.random() * alerts.length)];
  }

  _initLabGestureControls() {
    const workspace = this.dom.holoWorkspace;
    const trash = this.dom.holoTrash;
    if (!workspace || !trash) return;

    workspace.addEventListener('pointerdown', (event) => {
      const node = event.target instanceof Element ? event.target.closest('.holo-node') : null;
      if (!node) return;

      const startX = event.clientX;
      const startY = event.clientY;
      const startedAt = performance.now();
      this._labGesture = { node, startX, startY, startedAt, lastX: startX, lastY: startY };
      node.classList.add('dragging');

      const onMove = (e) => {
        if (!this._labGesture) return;
        const dx = e.clientX - this._labGesture.startX;
        const dy = e.clientY - this._labGesture.startY;
        this._labGesture.lastX = e.clientX;
        this._labGesture.lastY = e.clientY;
        this._labGesture.node.style.transform = `translate(${dx}px, ${dy}px)`;
      };

      const onUp = (e) => {
        if (!this._labGesture) return;
        const g = this._labGesture;
        const dt = Math.max(16, performance.now() - g.startedAt);
        const vx = (e.clientX - g.startX) / dt;
        const vy = (e.clientY - g.startY) / dt;
        const thrown = Math.abs(vx) + Math.abs(vy) > 1.35;
        const trashRect = trash.getBoundingClientRect();
        const inTrash = e.clientX >= trashRect.left && e.clientX <= trashRect.right && e.clientY >= trashRect.top && e.clientY <= trashRect.bottom;

        g.node.classList.remove('dragging');
        g.node.style.transform = '';

        if (inTrash || thrown) {
          g.node.classList.add('deleted');
          setTimeout(() => {
            g.node.remove();
            if (!workspace.querySelector('.holo-node')) {
              workspace.innerHTML = '<article class="holo-node" data-node="rebuild" draggable="false"><b>NEW MODULE</b><span>Auto-generated</span></article>';
            }
          }, 180);
        }

        this._labGesture = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  _initHealthMatrix() {
    this._setHealthDot(this.dom.healthDotUi, 'ok');
    this._setHealthDot(this.dom.healthDotApi, 'warn');
    this._setHealthDot(this.dom.healthDotAi, 'warn');

    if (window.jarvis?.onServiceHealth) {
      window.jarvis.onServiceHealth((payload) => {
        this._applyServiceHealth(payload || {});
      });
    }

    if (window.jarvis?.getServiceHealth) {
      window.jarvis.getServiceHealth().then((payload) => {
        this._applyServiceHealth(payload || {});
      }).catch(() => {
        // no-op
      });
    }
  }

  _healthStateFromProbe(up, latencyMs) {
    if (!up) return 'dead';
    if (typeof latencyMs === 'number' && latencyMs > 800) return 'warn';
    return 'ok';
  }

  _setHealthDot(dotEl, state) {
    if (!dotEl) return;
    dotEl.classList.remove('ok', 'warn', 'dead');
    dotEl.classList.add(state);
    dotEl.classList.remove('dot-ping');
    void dotEl.offsetWidth;
    dotEl.classList.add('dot-ping');
  }

  _applyServiceHealth(payload) {
    const uiState = this._healthStateFromProbe(Boolean(payload?.ui?.up), payload?.ui?.latencyMs);
    const apiState = this._healthStateFromProbe(Boolean(payload?.api?.up), payload?.api?.latencyMs);
    const aiState = this._healthStateFromProbe(Boolean(payload?.ai?.up), payload?.ai?.latencyMs);

    this._setHealthDot(this.dom.healthDotUi, uiState);
    this._setHealthDot(this.dom.healthDotApi, apiState);
    this._setHealthDot(this.dom.healthDotAi, aiState);

    const states = [uiState, apiState, aiState];
    this._armorDiagnosticsState = states.includes('dead') ? 'dead' : states.includes('warn') ? 'warn' : 'ok';
    this._applyArmorTheme(this._resolveArmorTheme(this._armorTelemetryState));

    if (payload?.api?.up) {
      const detail = typeof payload?.api?.latencyMs === 'number' ? `${payload.api.latencyMs}ms` : 'online';
      this._updateBackendPill('online', detail);
    } else {
      this._updateBackendPill('error', 'offline');
    }
  }

  /** ── Utilities ──────────────────────────────────────────────── */
  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// ── Launch ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const jarvis = new JarvisApp();
  jarvis.boot();
  window.__jarvis = jarvis;
});
