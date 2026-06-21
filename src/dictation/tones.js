// @ts-check

/**
 * Web Audio tones for dictation start/stop. The AudioContext is created lazily
 * on first use so we don't trip the browser's autoplay policy (which requires
 * a user gesture for audio). On platforms that have no Web Audio (e.g. some
 * test environments), the play functions are silent no-ops.
 *
 * @typedef {Object} ToneHandle
 * @property {(ctx: AudioContext) => void} playStart
 * @property {(ctx: AudioContext) => void} playStop
 */

/** @type {AudioContext | null} */
let sharedContext = null;

/**
 * Lazily create or resume the shared AudioContext. Returns null when Web Audio
 * is unavailable.
 *
 * @returns {AudioContext | null}
 */
export function getToneContext() {
  if (typeof globalThis.AudioContext === "undefined" && typeof globalThis.webkitAudioContext === "undefined") {
    return null;
  }
  if (sharedContext) {
    if (sharedContext.state === "suspended") {
      void sharedContext.resume().catch(() => undefined);
    }
    return sharedContext;
  }
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  sharedContext = new Ctor();
  return sharedContext;
}

function envelopeBlip(ctx, frequency, startOffset) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  const now = ctx.currentTime + startOffset;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

/**
 * Rising chirp played when recording starts.
 *
 * @param {AudioContext} ctx
 */
export function playStartTone(ctx) {
  envelopeBlip(ctx, 880, 0);
}

/**
 * Falling chirp played when recording stops.
 *
 * @param {AudioContext} ctx
 */
export function playStopTone(ctx) {
  envelopeBlip(ctx, 440, 0);
}
