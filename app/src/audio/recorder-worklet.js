// Runs on the audio thread: hands microphone samples to the main thread in
// ~20 ms blocks. Nothing is stored or sent anywhere.
class LumiRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1024);
    this.fill = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const n = Math.min(ch.length - i, this.block.length - this.fill);
        this.block.set(ch.subarray(i, i + n), this.fill);
        this.fill += n;
        i += n;
        if (this.fill === this.block.length) {
          this.port.postMessage(this.block.slice(0));
          this.fill = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('lumi-recorder', LumiRecorder);
