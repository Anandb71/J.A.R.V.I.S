/**
 * Audio playback using MediaSource Extensions (MSE).
 *
 * Critical finding: decodeAudioData cannot stream partial audio chunks.
 * It requires the complete file. MSE is the only reliable way to buffer
 * streaming MP3 chunks from server TTS.
 *
 * Architecture:
 *   Server sends MP3 chunk → handleBinaryChunk() → sourceBuffer.appendBuffer()
 *   SourceBuffer.updateend event → drain pending queue
 *   mediaSource.endOfStream() when server sends voice:tts_done event
 *   <audio> element auto-plays when buffer fills
 */
export class AudioTransport {
  constructor(onStateChange) {
    this.onStateChange = onStateChange;
    this.audioEl = null;
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.isPlaying = false;
    this._pendingBuffers = [];
    this._streamGeneration = 0;
  }

  /**
   * Initialize audio playback infrastructure.
   * Must be called before first MP3 chunk arrives.
   */
  async init() {
    if (this.audioEl) return; // Already initialized

    this.audioEl = document.getElementById('tts-audio') || document.createElement('audio');
    this.audioEl.autoplay = true;
    if (!this.audioEl.isConnected) {
      document.body.appendChild(this.audioEl);
    }

    this.audioEl.addEventListener('play', () => {
      this.isPlaying = true;
      this.onStateChange?.('speaking');
    });

    this.audioEl.addEventListener('ended', () => {
      this.isPlaying = false;
      this.onStateChange?.('idle');
    });

    this._initMSE();
  }

  /**
   * Create fresh MediaSource + SourceBuffer for MP3 streaming.
   * Called once on init(), then again after each TTS playback finishes.
   */
  _initMSE() {
    if (!this.audioEl) return;

    this._streamGeneration += 1;
    const generation = this._streamGeneration;

    this.mediaSource = new MediaSource();
    this.audioEl.src = URL.createObjectURL(this.mediaSource);
    this._pendingBuffers = [];

    this.mediaSource.addEventListener('sourceopen', () => {
      if (generation !== this._streamGeneration) return;
      // Create SourceBuffer for MP3 (audio/mpeg)
      if (!this.sourceBuffer) {
        this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');

        // Drain pending queue when updateend fires
        this.sourceBuffer.addEventListener('updateend', () => {
          if (this._pendingBuffers.length > 0 && !this.sourceBuffer.updating) {
            const next = this._pendingBuffers.shift();
            this.sourceBuffer.appendBuffer(next);
          }
        });
      }
    });
  }

  /**
   * Reset MediaSource when playback ends.
   */
  _resetMSE() {
    this.mediaSource = null;
    this.sourceBuffer = null;
    this._pendingBuffers = [];
  }

  async prepareForNextStream() {
    if (!this.audioEl) {
      await this.init();
      return;
    }
    this._resetMSE();
    this._initMSE();
  }

  /**
   * Receive MP3 chunk from server TTS stream.
   * Queues if sourceBuffer is busy updating.
   */
  async handleBinaryChunk(arrayBuffer) {
    if (!this.audioEl) await this.init();

    // MSE not ready, queue for later
    if (!this.sourceBuffer || this.sourceBuffer.updating) {
      this._pendingBuffers.push(arrayBuffer);
      return;
    }

    // Safe to append immediately
    this.sourceBuffer.appendBuffer(arrayBuffer);
    this.audioEl.play().catch(() => {
      // Ignore autoplay failures; next user interaction can resume playback.
    });
  }

  /**
   * Server signals end of TTS stream.
   * Finalizes MediaSource so playback can end cleanly.
   */
  handleTtsDone() {
    if (!this.mediaSource || this.mediaSource.readyState !== 'open') {
      return;
    }

    // Wait for any pending appends to finish before ending stream
    const tryEnd = () => {
      if (!this.sourceBuffer || !this.sourceBuffer.updating) {
        if (this.mediaSource && this.mediaSource.readyState === 'open') {
          this.mediaSource.endOfStream();
        }
      } else {
        this.sourceBuffer.addEventListener('updateend', tryEnd, { once: true });
      }
    };

    tryEnd();
  }

  /**
   * Manual stop.
   */
  stop() {
    this.isPlaying = false;
    this.onStateChange?.('idle');

    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
    }

    this._resetMSE();
  }
}
