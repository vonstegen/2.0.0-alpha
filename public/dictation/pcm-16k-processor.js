// AudioWorklet processor for the dictation engine. Receives audio from the
// mic via an AudioContext MediaStreamSource, copies the first channel into a
// SharedArrayBuffer ring the main thread can read, and posts each completed
// chunk back as a transferable Float32Array.
//
// Served same-origin from `/dictation/pcm-16k-processor.js` so it complies
// with the document's `script-src 'self'` CSP — inline `blob:` and `data:`
// worklet URLs are blocked under CSP and under COOP/COEP cross-origin
// isolation. Same-origin files satisfy both.

class PCM16kProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._sab = null;
    this._view = null;
    this._samplesWritten = 0;
    this._bufferCapacity = 0;
    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg && msg.type === "configure" && msg.sab) {
        this._sab = msg.sab;
        this._view = new Float32Array(this._sab);
        this._bufferCapacity = this._view.length;
        this._samplesWritten = 0;
      } else if (msg && msg.type === "stop") {
        this._flush();
      }
    };
  }

  _flush() {
    if (this._samplesWritten === 0 || !this._view) return;
    const out = new Float32Array(this._samplesWritten);
    out.set(this._view.subarray(0, this._samplesWritten));
    this.port.postMessage({ type: "chunk", samples: out }, [out.buffer]);
    this._samplesWritten = 0;
  }

  process(inputs) {
    if (!this._view) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    const n = channel.length;
    if (this._samplesWritten + n > this._bufferCapacity) {
      this._flush();
    }
    this._view.set(channel, this._samplesWritten);
    this._samplesWritten += n;
    return true;
  }
}

registerProcessor("pcm-16k-processor", PCM16kProcessor);
