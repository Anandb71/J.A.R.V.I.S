export class ThreeEngine {
  constructor(canvasElement, options = {}) {
    this.canvasElement = canvasElement;
    this.worker = new Worker(new URL('./workers/three-worker.js', import.meta.url), { type: 'module' });
    this.ready = false;
    this.pendingState = 'idle';
    this.pendingAudioLevel = 0;
    this.pendingTier = this._detectTier();

    const rect = canvasElement.getBoundingClientRect();
    const offscreen = canvasElement.transferControlToOffscreen();

    this.worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'ready') {
        this.ready = true;
        this._flushPending();
      }
      if (message.type === 'fps_warning' && options.onFpsWarning) {
        options.onFpsWarning(message);
      }
      if (message.type === 'log' && options.onLog) {
        options.onLog(message);
      }
    };

    this.worker.postMessage(
      {
        type: 'init',
        canvas: offscreen,
        width: rect.width,
        height: rect.height,
        tier: this.pendingTier,
      },
      [offscreen],
    );

    this._resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      this.worker.postMessage({ type: 'resize', width, height });
    });
    this._resizeObserver.observe(canvasElement);

    ['pointerdown', 'pointermove', 'pointerup'].forEach((type) => {
      canvasElement.addEventListener(type, (event) => {
        this.worker.postMessage({
          type: 'pointer',
          event: {
            type,
            clientX: event.clientX,
            clientY: event.clientY,
            buttons: event.buttons,
          },
        });
      });
    });
  }

  setState(state) {
    this.pendingState = state;
    this._send({ type: 'set_state', state });
  }

  setAudioLevel(level) {
    this.pendingAudioLevel = level;
    this._send({ type: 'set_audio_level', level });
  }

  setTier(tier) {
    this.pendingTier = tier;
    this._send({ type: 'set_tier', tier });
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this.worker?.terminate();
  }

  _send(message) {
    if (!this.ready && message.type !== 'init') return;
    this.worker.postMessage(message);
  }

  _flushPending() {
    this.worker.postMessage({ type: 'set_tier', tier: this.pendingTier });
    this.worker.postMessage({ type: 'set_state', state: this.pendingState });
    this.worker.postMessage({ type: 'set_audio_level', level: this.pendingAudioLevel });
  }

  _detectTier() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    if (cores >= 8 && mem >= 8) return 'high';
    if (cores >= 4 && mem >= 4) return 'medium';
    return 'low';
  }
}
