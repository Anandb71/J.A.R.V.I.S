class RingBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel += 1) {
      output[channel].fill(0);
    }
    return true;
  }
}

registerProcessor('ring-buffer-processor', RingBufferProcessor);
