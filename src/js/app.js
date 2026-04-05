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
  }

  /** ── Boot Sequence ──────────────────────────────────────────── */
  async boot() {
    this._cacheDOM();
    this._startClock();

    // Initialize sub-systems
    this.chat = new ChatPanel(this.dom.chatPanel);
    this.gauges = new SystemGauges();

    this.gauges.init();
    this._initThreeJs();

    // Start WebSocket
    this._connectWebSocket();

    // Complete boot
    this._completeBoot();
    this._bindUI();
    this._startWeatherLoop();
    this.chat.addSystem('J.A.R.V.I.S. is online. At your service.');
  }

  /** Cache DOM references */
  _cacheDOM() {
    this.dom = {
      bootOverlay: document.getElementById('boot-overlay'),
      bootLog: document.getElementById('boot-log'),
      hudRoot: document.getElementById('hud-root'),
      clock: document.getElementById('clock'),
      calendar: document.getElementById('calendar'),
      chatPanel: document.getElementById('chat-panel'),
      chatInput: document.getElementById('chat-input'),
      btnSend: document.getElementById('btn-send'),
      btnMic: document.getElementById('btn-mic'),
      btnToggleVoiceReply: document.getElementById('btn-toggle-voice-reply'),
      btnClickthrough: document.getElementById('btn-toggle-clickthrough'),
      btnFocus: document.getElementById('btn-toggle-hud'),
      brandPill: document.getElementById('brand-pill'),
      backendStatus: document.getElementById('backend-status'),
      voiceState: document.getElementById('voice-state'),
      wsStatus: document.getElementById('ws-status'),
      latencyDisplay: document.getElementById('latency-display'),
      threeCanvas: document.getElementById('three-canvas'),
      collapseLeft: document.getElementById('btn-collapse-left'),
      collapseRight: document.getElementById('btn-collapse-right'),
    };
  }

  /** Update boot overlay log */
  _bootLog(msg) {
    if (this.dom.bootLog) {
      this.dom.bootLog.textContent = msg;
    }
  }

  /** Complete boot — hide overlay, show HUD */
  _completeBoot() {
    this.booted = true;
    if (this.dom.bootOverlay) {
      this.dom.bootOverlay.classList.add('hidden');
    }
    if (this.dom.hudRoot) {
      this.dom.hudRoot.classList.add('booted');
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
        window.jarvis.toggleClickThrough();
      }
    });

    // Focus toggle
    this.dom.btnFocus?.addEventListener('click', () => {
      document.body.classList.toggle('hud-focus');
    });

    // Main-process Ctrl+K shortcut event
    if (window.jarvis?.onToggleFocusShortcut) {
      window.jarvis.onToggleFocusShortcut(() => {
        document.body.classList.toggle('hud-focus');
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
          },
        );
        await this.voiceClient.start();
        this.dom.btnMic.classList.add('primary');
        this.chat.addSystem('Voice activated. Speak naturally; JARVIS will transcribe when you pause.');
      } catch (err) {
        const msg = String(err?.message || err || 'unknown error');
        if (/permission denied|notallowederror|permission/i.test(msg)) {
          this.chat.add('error', 'Voice init failed: Microphone permission denied. Enable Windows Microphone access for desktop apps, then restart JARVIS.');
        } else {
          this.chat.add('error', `Voice init failed: ${msg}`);
        }
      }
    } else {
      this.voiceClient.stop();
      this.voiceClient = null;
      this.audioTransport = null;
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
      const tool = leakedToolCall[1] || 'requested tool';
      return `I attempted to run ${tool}, but the model response format leaked internal markup. Please retry the request once.`;
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

  /** ── Voice State Display ────────────────────────────────────── */
  _setVoiceState(state) {
    const el = this.dom.voiceState;
    if (!el) return;

    el.textContent = state;
    el.setAttribute('data-state', state);

    // Update Three.js worker
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

  /** ── Status Helpers ─────────────────────────────────────────── */
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
