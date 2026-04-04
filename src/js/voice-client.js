/**
 * Full-duplex voice client.
 *
 * Capture: @ricky0123/vad-web (Silero VAD in AudioWorklet)
 * Playback: Delegated to AudioTransport (MSE audio/mpeg)
 *
 * Architecture:
 *   Mic → getUserMedia(AEC+NS) → MicVAD → onSpeechEnd → PCM16 → WS binary
 *   Barge-in: onSpeechStart during speaking → send voice:interrupt
 */

export class VoiceClient {
  constructor(socket, audioTransport, onStateChange, onMicLevel) {
    this.socket = socket;
    this.audioTransport = audioTransport;
    this.onStateChange = onStateChange;
    this.onMicLevel = onMicLevel;
    this.vad = null;
    this.stream = null;
    this.isActive = false;
    this.audioCtx = null;
    this.analyser = null;
    this.micLevelRaf = null;
    this.levelData = null;
  }

  async start() {
    if (this.isActive) return;

    try {
      // 1. Mic capture with echo/noise suppression
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });

      // 2. Silero VAD via @ricky0123/vad-web
      const { MicVAD } = await import('@ricky0123/vad-web');

      this.vad = await MicVAD.new({
        stream: this.stream,
        onSpeechStart: () => this._onSpeechStart(),
        onSpeechEnd: (audio) => this._onSpeechEnd(audio),
        positiveSpeechThreshold: 0.8,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: 8,
        preSpeechPadFrames: 1,
        minSpeechFrames: 3,
      });

      this.vad.start();
      this._startMicLevelTracking();
      this.isActive = true;
      this.onStateChange?.('listening');
    } catch (error) {
      this.vad?.destroy?.();
      this.vad = null;
      this._stopMicLevelTracking();
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      this.isActive = false;
      throw error;
    }
  }

  async _onSpeechStart() {
    await this.audioTransport?.prepareForNextStream?.();

    // BARGE-IN: if TTS is currently playing, interrupt it.
    if (this.audioTransport?.isPlaying) {
      this.audioTransport.stop();
      this.socket.send('voice:interrupt', {});
    }
    this.onStateChange?.('listening');
  }

  _onSpeechEnd(audioFloat32) {
    if (!audioFloat32 || audioFloat32.length === 0) return;

    // Convert Float32 [-1, 1] -> PCM16
    const pcm16 = new Int16Array(audioFloat32.length);
    for (let i = 0; i < audioFloat32.length; i += 1) {
      const s = Math.max(-1, Math.min(1, audioFloat32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Send raw audio bytes as binary frame
    this.socket.sendBinary(pcm16.buffer);
    // Signal utterance boundary
    this.socket.send('voice:speech_end', {});
    this.onStateChange?.('processing');
  }

  _startMicLevelTracking() {
    if (!this.stream || this.audioCtx) return;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.levelData = new Uint8Array(this.analyser.fftSize);
    source.connect(this.analyser);

    const tick = () => {
      if (!this.analyser || !this.levelData) return;
      this.analyser.getByteTimeDomainData(this.levelData);
      let sum = 0;
      for (let i = 0; i < this.levelData.length; i += 1) {
        const centered = (this.levelData[i] - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / this.levelData.length);
      const normalized = Math.min(1, rms * 4);
      this.onMicLevel?.(normalized);
      this.micLevelRaf = requestAnimationFrame(tick);
    };

    tick();
  }

  _stopMicLevelTracking() {
    if (this.micLevelRaf) {
      cancelAnimationFrame(this.micLevelRaf);
      this.micLevelRaf = null;
    }
    this.onMicLevel?.(0);
    this.levelData = null;
    this.analyser = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {
        // noop
      });
      this.audioCtx = null;
    }
  }

  stop() {
    this.vad?.destroy?.();
    this.vad = null;
    this._stopMicLevelTracking();

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.isActive = false;
    this.onStateChange?.('idle');
  }
}
