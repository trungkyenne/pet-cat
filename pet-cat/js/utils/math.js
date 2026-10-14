/**
 * Small numeric helpers shared by the cat rig, camera and interaction code.
 * Everything here is allocation-free so it can run inside the frame loop.
 */

export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 * `lambda` is roughly "how many e-foldings per second".
 */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Critically-damped spring step, returns [position, velocity]. */
export function spring(current, velocity, target, stiffness, damping, dt) {
  const force = (target - current) * stiffness;
  const dampForce = velocity * damping;
  const accel = force - dampForce;
  const nextVelocity = velocity + accel * dt;
  return [current + nextVelocity * dt, nextVelocity];
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Shortest signed angular difference between two angles, in radians. */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Deterministic 32-bit PRNG (mulberry32) so the cat looks identical on reload. */
export function createRandom(seed = 1337) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random source with a gaussian-ish falloff. Natural motion needs the bulk of
 * values near the middle with occasional excursions.
 */
export function createGaussian(random) {
  return function gaussian() {
    const u = 1 - random();
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
}

/** Maps a normalised value onto a "living" range with soft saturation. */
export function softSaturate(x, knee = 1) {
  const k = Math.max(knee, 1e-4);
  return (x * k) / (k + Math.abs(x) - Math.min(Math.abs(x), k) * 0);
}

/** Polynomial ease used for the eyelid; slower at the ends than the middle. */
export function blinkCurve(t) {
  const x = clamp01(t);
  return 1 - Math.sin(Math.PI * x) ** 0.65;
}
