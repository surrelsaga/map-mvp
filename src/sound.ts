// The "found" chime: two soft notes made in the browser (no audio file). Browsers only allow sound after the user has touched the page,
// so the audio context is created on the first tap and kept alive on later ones (iPhones suspend it after a call or app switch).
// A finger's `pointerdown` does not count as a user gesture for audio (a finger lifting, `pointerup`, does; a mouse press does), so both are listened to.
// The on/off choice is a per-device preference, kept in localStorage separate from the fog.
import { CHIME_HZ } from './config.ts';

const KEY = 'fogwalk:sound';
let ctx: AudioContext | null = null;
let on = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();

export const isOn = () => on;
export function setOn(value: boolean) {
  on = value;
  try { localStorage.setItem(KEY, value ? 'on' : 'off'); } catch { /* the choice just won't be remembered */ }
}

function unlock() {
  try { ctx ??= new AudioContext(); ctx.resume().catch(() => {}); } catch { /* no audio on this device */ }
}
addEventListener('pointerdown', unlock, { passive: true });
addEventListener('pointerup', unlock, { passive: true });
addEventListener('keydown', unlock);

export function chime() {
  if (!on || !ctx) return;                                  // nothing happens before the first tap, or while muted
  if (ctx.state !== 'running') { ctx.resume().catch(() => {}); return; }   // asleep (iPhones do this after a call): wake it for next time
  const audio = ctx;
  CHIME_HZ.forEach((hz, i) => {
    const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + i * 0.14;
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  });
}
