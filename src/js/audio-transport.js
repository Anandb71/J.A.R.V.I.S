export class AudioTransport {
  constructor(onStateChange) {
    this.onStateChange = onStateChange;
    this.context = null;
    this.worklet = null;
    this.state = 'idle';
    this.supportsSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
  }

  async init() {
    this.context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.context.audioWorklet.addModule(new URL('./workers/ring-buffer-processor.js', import.meta.url));
    this.worklet = new AudioWorkletNode(this.context, 'ring-buffer-processor');
    this.worklet.connect(this.context.destination);
    this.onStateChange?.('idle');
  }

  async playPcm16(arrayBuffer) {
    if (!this.context) await this.init();
    const pcm = new Int16Array(arrayBuffer);
    const floats = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) {
      floats[i] = Math.max(-1, Math.min(1, pcm[i] / 32768));
    }
    const audioBuffer = this.context.createBuffer(1, floats.length, 16000);
    audioBuffer.copyToChannel(floats, 0);
    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.context.destination);
    source.onended = () => this.onStateChange?.('idle');
    this.onStateChange?.('speaking');
    source.start();
    return source;
  }

  stop() {
    this.onStateChange?.('idle');
    this.context?.close();
    this.context = null;
  }
}
