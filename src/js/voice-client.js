/**
 * Full-duplex voice client (new approach).
 *
 * This implementation intentionally avoids third-party VAD worklets and instead
 * uses a lightweight RMS-based speech detector with Web Audio.
 *
 * Flow:
 *   getUserMedia -> ScriptProcessor RMS VAD -> utterance buffer -> PCM16 chunks -> WS binary
 *   then voice:speech_end control event.
 *
 * Important backend compatibility:
 * - Backend drops binary frames > 64KB.
 * - We therefore chunk PCM frames to 16KB before send.
 */

export class VoiceClient {
  constructor(socket, audioTransport, onStateChange, onMicLevel) {
    this.socket = socket;
    this.audioTransport = audioTransport;
    this.onStateChange = onStateChange;
    this.onMicLevel = onMicLevel;
    this.stream = null;
    this.isActive = false;
    this.audioCtx = null;
    this.sourceNode = null;
    this.processorNode = null;

    // VAD state
    this.speaking = false;
    this.speechChunks = [];
    this.speechSamples = 0;
    this.lastVoiceAtMs = 0;
    this.lastStateEmitMs = 0;

    // Tunables
    this.voiceThreshold = 0.02;
    this.endSilenceMs = 520;
    this.minSpeechMs = 180;
    this.maxSpeechMs = 10000;
    this.targetSampleRate = 16000;

    // Smoothing
    this._levelSmoothed = 0;
  }

  async start() {
    if (this.isActive) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });

      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.targetSampleRate,
      });

      this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);
      this.processorNode = this.audioCtx.createScriptProcessor(2048, 1, 1);
      this.processorNode.onaudioprocess = (event) => this._onAudioProcess(event);

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioCtx.destination);

      this.isActive = true;
      this.onStateChange?.('listening');
    } catch (error) {
      this.stop();
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

  _onAudioProcess(event) {
    if (!this.isActive) return;

    const input = event.inputBuffer.getChannelData(0);
    if (!input || input.length === 0) return;

    const now = performance.now();

    let sumSq = 0;
    for (let i = 0; i < input.length; i += 1) {
      const v = input[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / input.length);

    // Smoothing for UI level
    this._levelSmoothed = this._levelSmoothed * 0.8 + rms * 0.2;
    this.onMicLevel?.(Math.min(1, this._levelSmoothed * 8));

    const voiceDetected = rms >= this.voiceThreshold;

    if (voiceDetected) {
      this.lastVoiceAtMs = now;
      if (!this.speaking) {
        this.speaking = true;
        this.speechChunks = [];
        this.speechSamples = 0;
        void this._onSpeechStart();
      }
    }

    if (this.speaking) {
      // Copy chunk because input buffer is reused by browser
      this.speechChunks.push(new Float32Array(input));
      this.speechSamples += input.length;

      const elapsedMs = (this.speechSamples / this.targetSampleRate) * 1000;
      const silentLongEnough = !voiceDetected && (now - this.lastVoiceAtMs >= this.endSilenceMs);
      const forceFlush = elapsedMs >= this.maxSpeechMs;

      if (silentLongEnough || forceFlush) {
        void this._flushSpeech();
      }
    }

    // Avoid excessive state spam
    if (now - this.lastStateEmitMs > 800 && !this.speaking) {
      this.lastStateEmitMs = now;
      this.onStateChange?.('listening');
    }
  }

  _concatFloatChunks(chunks, totalSamples) {
    const out = new Float32Array(totalSamples);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  _toPcm16Buffer(float32) {
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i += 1) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return new Uint8Array(pcm16.buffer);
  }

  _sendChunkedPcm(uint8Data) {
    // Keep comfortably below backend 64KB frame guard.
    const MAX_CHUNK_BYTES = 16 * 1024;
    for (let i = 0; i < uint8Data.length; i += MAX_CHUNK_BYTES) {
      const end = Math.min(i + MAX_CHUNK_BYTES, uint8Data.length);
      const chunk = uint8Data.slice(i, end);
      this.socket.sendBinary(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
    }
  }

  async _flushSpeech() {
    if (!this.speaking) return;

    const totalSamples = this.speechSamples;
    const utteranceMs = (totalSamples / this.targetSampleRate) * 1000;

    const chunks = this.speechChunks;

    this.speaking = false;
    this.speechChunks = [];
    this.speechSamples = 0;

    if (!chunks.length || utteranceMs < this.minSpeechMs) {
      this.onStateChange?.('listening');
      return;
    }

    const floatAudio = this._concatFloatChunks(chunks, totalSamples);
    const pcmBytes = this._toPcm16Buffer(floatAudio);
    this._sendChunkedPcm(pcmBytes);
    this.socket.send('voice:speech_end', {});
    this.onStateChange?.('processing');
  }

  stop() {
    this.speaking = false;
    this.speechChunks = [];
    this.speechSamples = 0;

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {
        // noop
      });
      this.audioCtx = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.onMicLevel?.(0);
    this.isActive = false;
    this.onStateChange?.('idle');
  }
}
