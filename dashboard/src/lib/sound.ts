// Alert tones synthesized with the Web Audio API · no audio files, works offline.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Browsers require a user gesture before audio can play · call this from a click. */
export function primeAudio() {
  getCtx();
}

function tone(c: AudioContext, freq: number, t0: number, dur: number, type: OscillatorType, peak: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

/** Urgent, attention-grabbing three-tone alarm for a service going down. */
export function playDown() {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 880, t, 0.15, "square", 0.16);
  tone(c, 880, t + 0.2, 0.15, "square", 0.16);
  tone(c, 622, t + 0.42, 0.3, "square", 0.17);
}

/** Pleasant rising chime for a recovery (down → up). */
export function playUp() {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 660, t, 0.13, "sine", 0.14);
  tone(c, 990, t + 0.14, 0.22, "sine", 0.14);
}
