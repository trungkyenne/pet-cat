/**
 * Breed definitions: colour recipes, fur length/density and the procedural
 * pattern functions that paint each cat's coat onto every fur strand.
 *
 * A pattern function receives the strand's position in cat-local space plus the
 * name of the body part it grew from, and writes a colour into `out`.
 */

import { Color } from 'three';
import { fbm3, ridged3, noise3 } from '../utils/noise.js';
import { clamp01, lerp, smoothstep } from '../utils/math.js';

const c = (hex) => new Color(hex);

/** Reusable scratch to keep the generation loop allocation free. */
export const scratch = {
  mid: new Color(),
  root: new Color(),
  tip: new Color(),
  tmp: new Color(),
};

function shade(base, amount, out) {
  out.copy(base);
  if (amount >= 0) {
    out.r = lerp(out.r, 1, amount);
    out.g = lerp(out.g, 1, amount);
    out.b = lerp(out.b, 1, amount);
  } else {
    const k = 1 + amount;
    out.r *= k;
    out.g *= k;
    out.b *= k;
  }
  return out;
}

/* --------------------------------------------------------------- patterns */

/** Uniform coat with a gentle gradient from back to belly. */
function solidPattern(base, { bellyLightness = 0.16 } = {}) {
  return (x, y, z, part, out) => {
    out.copy(base);
    const n = fbm3(x * 4.2, y * 4.4, z * 4.0, 3);
    shade(out, n * 0.05, out);
    if (part === 'belly' || part === 'chest' || part === 'chin') {
      shade(out, bellyLightness, out);
    }
    if (part === 'paw') shade(out, 0.08, out);
    return out;
  };
}

/**
 * Classic mackerel tabby: bands across the torso, rings down the tail, an "M"
 * on the forehead and white gloves on the chest, chin and paws.
 */
function tabbyPattern({ base, stripe, white, whiteAmount = 1 }) {
  return (x, y, z, part, out) => {
    const wob = fbm3(x * 1.6 + 13.1, y * 1.4, z * 1.9 + 4.2, 3);
    const grain = noise3(x * 9, y * 9.5, z * 9, 1) * 0.5;

    out.copy(base);

    // Torso and haunches: bands stacked up the spine of the sitting cat.
    if (part === 'torso' || part === 'neck' || part === 'legFront' || part === 'legBack') {
      const band = Math.sin((y * 15.5 + wob * 1.35 + z * 0.6) * Math.PI);
      const mask = smoothstep(0.42, 0.92, Math.abs(band) + grain * 0.16);
      out.lerp(stripe, mask * 0.72);
      const spine = smoothstep(0.3, 0.95, 1 - Math.abs(x) * 6.5);
      out.lerp(stripe, spine * 0.22);
    }

    // Tail: rings that drift as they wrap.
    if (part === 'tail') {
      const ring = Math.sin((x * 2.2 + y * 20.5 + wob * 1.1) * Math.PI);
      const mask = smoothstep(0.3, 0.95, Math.abs(ring));
      out.lerp(stripe, mask * 0.78);
    }

    // Head: faint forehead "M" plus cheek stripes.
    if (part === 'head') {
      const brow = smoothstep(1.02, 1.22, y) * smoothstep(-0.02, 0.16, z);
      const lines = smoothstep(0.35, 0.9, Math.abs(Math.sin((x * 26 + wob) * Math.PI)));
      out.lerp(stripe, brow * lines * 0.5);
      const cheek = smoothstep(0.1, 0.22, Math.abs(x)) * smoothstep(0.05, 0.2, z);
      const cheekLines = smoothstep(0.5, 0.95, Math.abs(Math.cos((y * 30 + wob * 2) * Math.PI)));
      out.lerp(stripe, cheek * cheekLines * 0.4);
    }

    // White chest, chin, muzzle, gloves and booties.
    let whiteMask = 0;
    if (part === 'muzzle' || part === 'chin') {
      whiteMask = 1;
    } else if (part === 'chest') {
      whiteMask = smoothstep(-0.36, 0.16, z) * 0.95;
    } else if (part === 'belly') {
      whiteMask = 0.55;
    } else if (part === 'paw') {
      whiteMask = 0.95;
    } else if (part === 'legFront') {
      whiteMask = smoothstep(0.34, 0.05, y) * 0.95;
    } else if (part === 'legBack') {
      whiteMask = smoothstep(0.3, 0.02, y) * 0.85;
    } else if (part === 'head') {
      whiteMask = smoothstep(0.02, 0.2, z) * smoothstep(0.12, 0.0, Math.abs(y - 1.03)) * 0.6;
    }

    if (whiteMask > 0) {
      const soft = whiteMask * whiteAmount * (0.88 + fbm3(x * 5, y * 5, z * 5, 2) * 0.12);
      out.lerp(white, clamp01(soft));
    }

    const n = fbm3(x * 5.5 + 30, y * 5.5, z * 5.5, 3);
    shade(out, n * 0.05, out);
    return out;
  };
}

/** Tricolour: mostly cream/white with orange and charcoal patches. */
function calicoPattern({ base, patchA, patchB }) {
  return (x, y, z, part, out) => {
    const fa = fbm3(x * 1.55 + 21, y * 1.25, z * 1.5 + 7, 3);
    const fb = fbm3(x * 1.4 - 9, y * 1.35 + 3, z * 1.6 - 4, 3) + y * 0.45;

    out.copy(base);

    const aMask = smoothstep(0.1, 0.44, fa);
    if (aMask > 0) out.lerp(patchA, aMask);

    const bMask = smoothstep(0.18, 0.52, fb);
    if (bMask > 0) out.lerp(patchB, bMask * 0.92);

    // Tail tip goes dark regardless - a calico signature.
    if (part === 'tail') {
      const tipMask = clamp01(
        smoothstep(-0.42, -0.78, y) + smoothstep(0.34, 0.62, z)
      );
      out.lerp(patchB, tipMask * 0.85);
    }

    if (part === 'muzzle' || part === 'chin') out.lerp(base, 0.85);
    if (part === 'chest' || part === 'belly' || part === 'paw') out.lerp(base, 0.55);

    const n = fbm3(x * 5.2, y * 5.2, z * 5.2, 3);
    shade(out, n * 0.05, out);
    return out;
  };
}

/** Charcoal coat with a cool, almost metallic sheen in the tips. */
function blackPattern(base) {
  return (x, y, z, part, out) => {
    out.copy(base);
    const sheen = ridged3(x * 3.4 + 5, y * 3.1, z * 3.6, 3);
    out.lerp(scratch.tmp.setRGB(0.16, 0.19, 0.27), sheen * 0.35);
    if (part === 'chin' || part === 'muzzle') shade(out, 0.1, out);
    const n = fbm3(x * 6, y * 6, z * 6, 2);
    shade(out, n * 0.05, out);
    return out;
  };
}

/* ------------------------------------------------------------------ breeds */

const ORANGE_BASE = c('#d4883f');
const ORANGE_STRIPE = c('#9a5522');

const BSH_BASE = c('#8b93a1');
const BSH_BACK = c('#767e8c');
const BSH_PALE = c('#b9bec7');
const BSH_BELLY = c('#a6acb7');

function bshPattern(x, y, z, part, out) {
  out.copy(BSH_BASE);
  const back = smoothstep(0.5, 1.15, y);
  out.lerp(BSH_BACK, back * 0.55);
  if (part === 'chin' || part === 'muzzle' || part === 'paw') out.lerp(BSH_PALE, 0.5);
  if (part === 'belly' || part === 'chest') out.lerp(BSH_BELLY, 0.35);
  const n = fbm3(x * 5, y * 5, z * 5, 3);
  shade(out, n * 0.045, out);
  return out;
}

export const BREEDS = [
  {
    id: 'orange-tabby',
    name: 'Mochi',
    note: 'Orange tabby',
    swatch: 'radial-gradient(120% 120% at 30% 25%, #f6c78f 0%, #d4883f 48%, #a95f27 100%)',
    tint: '#e6b988',
    coat: {
      length: 1.0,
      density: 1.0,
      fluff: 1.0,
      root: c('#8c5120'),
      tip: c('#f7d3a1'),
      roughness: 0.86,
      sheen: 0.14,
    },
    pattern: tabbyPattern({ base: ORANGE_BASE, stripe: ORANGE_STRIPE, white: c('#fbf3e6') }),
    eyes: {
      iris: c('#e8a83a'),
      irisDeep: c('#a86b1c'),
      limbal: c('#6b4413'),
      pupil: 'slit',
    },
    nose: c('#e29a90'),
    pad: c('#dd9a90'),
    innerEar: c('#e7a99c'),
  },
  {
    id: 'cream-white',
    name: 'Nimbus',
    note: 'Fluffy white',
    swatch: 'radial-gradient(120% 120% at 30% 25%, #ffffff 0%, #f3e8da 55%, #d9c9b6 100%)',
    tint: '#efe4d6',
    coat: {
      length: 1.62,
      density: 1.16,
      fluff: 1.36,
      root: c('#ddcdba'),
      tip: c('#fffdf8'),
      roughness: 0.94,
      sheen: 0.08,
    },
    pattern: solidPattern(c('#f4ead9'), { bellyLightness: 0.1 }),
    eyes: {
      iris: c('#7db0d8'),
      irisDeep: c('#3f7ba6'),
      limbal: c('#2a5878'),
      pupil: 'slit',
    },
    nose: c('#eaa9a4'),
    pad: c('#eeb2ab'),
    innerEar: c('#f0b4ac'),
  },
  {
    id: 'gray-bsh',
    name: 'Pebble',
    note: 'Gray British Shorthair',
    swatch: 'radial-gradient(120% 120% at 30% 25%, #b9bfc9 0%, #868d9c 55%, #5c6270 100%)',
    tint: '#a7adb9',
    coat: {
      length: 0.74,
      density: 1.42,
      fluff: 1.12,
      root: c('#565c69'),
      tip: c('#c3c8d1'),
      roughness: 0.9,
      sheen: 0.2,
    },
    pattern: bshPattern,
    eyes: {
      iris: c('#d5903a'),
      irisDeep: c('#9c5f18'),
      limbal: c('#5c3a10'),
      pupil: 'slit',
    },
    nose: c('#9b99a6'),
    pad: c('#6f7381'),
    innerEar: c('#c9a09c'),
  },
  {
    id: 'black',
    name: 'Soot',
    note: 'Black cat',
    swatch: 'radial-gradient(120% 120% at 30% 25%, #3d4354 0%, #20242e 52%, #0d0f14 100%)',
    tint: '#2a2f3b',
    coat: {
      length: 0.86,
      density: 1.12,
      fluff: 0.96,
      root: c('#0c0e13'),
      tip: c('#5a6478'),
      roughness: 0.66,
      sheen: 0.48,
    },
    pattern: blackPattern(c('#171a22')),
    eyes: {
      iris: c('#9ac262'),
      irisDeep: c('#5d8f36'),
      limbal: c('#2f4a1c'),
      pupil: 'slit',
    },
    nose: c('#4b4550'),
    pad: c('#2c2e36'),
    innerEar: c('#8d7a80'),
  },
  {
    id: 'calico',
    name: 'Marble',
    note: 'Calico',
    swatch:
      'conic-gradient(from 200deg, #f8f2e8 0deg 130deg, #d4883f 130deg 226deg, #262a33 226deg 360deg)',
    tint: '#e9dcc9',
    coat: {
      length: 1.14,
      density: 1.06,
      fluff: 1.18,
      root: c('#c9bda9'),
      tip: c('#fdf8ef'),
      roughness: 0.9,
      sheen: 0.12,
    },
    pattern: calicoPattern({
      base: c('#f8f1e5'),
      patchA: c('#d4883f'),
      patchB: c('#24282f'),
    }),
    eyes: {
      iris: c('#cdb04c'),
      irisDeep: c('#8e7526'),
      limbal: c('#544413'),
      pupil: 'slit',
    },
    nose: c('#e79b93'),
    pad: c('#d9978e'),
    innerEar: c('#e9a99f'),
  },
];

const BREED_BY_ID = new Map(BREEDS.map((b) => [b.id, b]));

export const DEFAULT_BREED_ID = 'orange-tabby';

export function getBreed(id) {
  return BREED_BY_ID.get(id) || BREED_BY_ID.get(DEFAULT_BREED_ID);
}

/**
 * Resolves the three coat colours for a single fur strand.
 * `out` must be `{ mid, root, tip }`.
 */
export function resolveFurColors(breed, x, y, z, part, variation, out) {
  breed.pattern(x, y, z, part, out.mid);

  // Undercoat: darker and slightly desaturated, still influenced by the patch
  // colour so black patches keep black roots and orange patches keep warm ones.
  out.root.copy(breed.coat.root).lerp(out.mid, 0.34);
  out.tip.copy(breed.coat.tip).lerp(out.mid, 0.42);

  const v = 1 + variation * 0.16;
  out.mid.multiplyScalar(v);
  out.root.multiplyScalar(1 + variation * 0.1);
  out.tip.multiplyScalar(1 + variation * 0.12);

  return out;
}
