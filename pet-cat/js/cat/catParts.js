/**
 * The anatomy of the cat, expressed as data.
 *
 * Every part is described in cat-local space (origin on the floor between the
 * front paws, the cat facing +Z) so the fur generator, the raycasting regions
 * and the animation rig all share one coordinate system.
 */

import {
  BufferGeometry,
  CatmullRomCurve3,
  Quaternion,
  Vector3,
} from 'three';
import {
  createBlobEllipsoid,
  createEarShell,
  createSweep,
  createTaperedTube,
  mergeGeometries,
  translateGeometry,
} from './geometry.js';
import { clamp01, lerp } from '../utils/math.js';

/* --------------------------------------------------------------- helpers */

/** Catmull-Rom sampling of a table of scalar keys - smooth ring profiles. */
export function sampleTable(values, t) {
  const n = values.length;
  const x = clamp01(t) * (n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const f = x - i;
  const p0 = values[Math.max(i - 1, 0)];
  const p1 = values[i];
  const p2 = values[i + 1];
  const p3 = values[Math.min(i + 2, n - 1)];
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
      (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
  );
}

function straightTube({ length, radius, radialSegments = 16, tubularSegments = 8 }) {
  const radiusAt = typeof radius === 'function' ? radius : () => radius;
  return createSweep({
    points: [new Vector3(0, 0, 0), new Vector3(0, length * 0.5, 0), new Vector3(0, length, 0)],
    tubularSegments,
    radialSegments,
    up: [0, 0, 1],
    profile: (t) => {
      const r = radiusAt(t);
      return { rx: r, ry: r };
    },
    cap: false,
  });
}

/* ------------------------------------------------------------- constants */

export const PIVOTS = {
  body: new Vector3(0, 0, 0),
  head: new Vector3(0, 0.955, 0.075),
  whiskers: new Vector3(0, 1.004, 0.315),
};

const HEAD_CENTER = new Vector3(0, 1.082, 0.19);

export const CAT_BOUNDS = {
  min: new Vector3(-0.62, 0, -0.72),
  max: new Vector3(0.7, 1.42, 0.52),
  center: new Vector3(0, 0.72, -0.02),
  eyeHeight: 1.1,
};

/* ------------------------------------------------------------ body parts */

/** The trunk: a swept trunk from the rump up to the neck. */
const TRUNK_POINTS = [
  new Vector3(0, 0.07, -0.14),
  new Vector3(0, 0.17, -0.235),
  new Vector3(0, 0.33, -0.235),
  new Vector3(0, 0.51, -0.16),
  new Vector3(0, 0.67, -0.055),
  new Vector3(0, 0.81, 0.045),
  new Vector3(0, 0.9, 0.115),
];

const TRUNK_RX = [0.265, 0.3, 0.312, 0.295, 0.258, 0.205, 0.142];
const TRUNK_RY = [0.29, 0.35, 0.345, 0.3, 0.252, 0.208, 0.152];
const TRUNK_OO = [0.02, 0.01, 0.015, 0.02, 0.005, -0.01, -0.015];

function buildTrunk() {
  return createSweep({
    points: TRUNK_POINTS,
    tubularSegments: 46,
    radialSegments: 26,
    up: [0, 0, 1],
    profile: (t) => ({
      rx: sampleTable(TRUNK_RX, t),
      ry: sampleTable(TRUNK_RY, t),
      oo: sampleTable(TRUNK_OO, t),
    }),
    cap: true,
  });
}

function buildFrontLeg(side) {
  const x0 = 0.138 * side;
  const x1 = 0.148 * side;
  return createSweep({
    points: [
      new Vector3(x0, 0.6, 0.155),
      new Vector3(x0 * 1.02, 0.44, 0.19),
      new Vector3(x1, 0.26, 0.225),
      new Vector3(x1, 0.1, 0.245),
      new Vector3(x1, 0.045, 0.26),
    ],
    tubularSegments: 22,
    radialSegments: 18,
    up: [0, 1, 0],
    profile: (t) => {
      const r = lerp(0.086, 0.052, clamp01(t * 1.15));
      return { rx: r, ry: r * 1.06 };
    },
    cap: true,
  });
}

function buildFrontPaw(side) {
  return createBlobEllipsoid({
    scale: [0.072, 0.042, 0.104],
    blobs: [{ dir: [0, 0.3, 1], amp: 0.1, k: 3 }],
    widthSegments: 26,
    heightSegments: 18,
    warp: (dx, dy, dz, px, py, pz) => [
      px + 0.148 * side,
      py,
      pz + 0.272,
    ],
  });
}

function buildRearPaw(side) {
  return createBlobEllipsoid({
    scale: [0.068, 0.04, 0.112],
    blobs: [{ dir: [0, 0.25, 1], amp: 0.12, k: 3 }],
    widthSegments: 24,
    heightSegments: 16,
    warp: (dx, dy, dz, px, py, pz) => [px + 0.232 * side, py, pz - 0.085],
  });
}

function buildHaunch(side) {
  return createBlobEllipsoid({
    scale: [0.142, 0.205, 0.24],
    blobs: [
      { dir: [side, 0.1, 0.5], amp: 0.1, k: 3 },
      { dir: [side, -0.6, -0.4], amp: 0.08, k: 3 },
    ],
    widthSegments: 30,
    heightSegments: 22,
    warp: (dx, dy, dz, px, py, pz) => [px + 0.245 * side, py + 0.215, pz - 0.29],
  });
}

function buildChestRuff() {
  return createBlobEllipsoid({
    scale: [0.175, 0.205, 0.14],
    blobs: [{ dir: [0, -0.2, 1], amp: 0.14, k: 3 }],
    widthSegments: 28,
    heightSegments: 20,
    warp: (dx, dy, dz, px, py, pz) => [px, py + 0.6, pz + 0.105],
  });
}
/* ------------------------------------------------------------ head parts */

function buildHead() {
  return createBlobEllipsoid({
    scale: [0.204, 0.196, 0.216],
    blobs: [
      { dir: [0, -0.3, 0.95], amp: 0.27, k: 4.2 },     // muzzle push
      { dir: [0, 0.06, 1.0], amp: 0.1, k: 7 },         // nose bridge
      { dir: [0.78, -0.42, 0.46], amp: 0.15, k: 5.5 }, // cheek pad
      { dir: [-0.78, -0.42, 0.46], amp: 0.15, k: 5.5 },
      { dir: [0.42, 0.6, 0.68], amp: 0.07, k: 7 },     // brow ridge
      { dir: [-0.42, 0.6, 0.68], amp: 0.07, k: 7 },
      { dir: [0, 0.8, 0.58], amp: 0.045, k: 5 },       // forehead
      { dir: [0, -0.92, 0.34], amp: 0.085, k: 5 },     // jaw
      { dir: [0, 0.66, -0.76], amp: -0.05, k: 4 },     // flatten the crown
      { dir: [0, -0.15, -1.0], amp: 0.035, k: 4 },     // occiput
    ],
    widthSegments: 64,
    heightSegments: 46,
    warp: (dx, dy, dz, px, py, pz) => [
      px + HEAD_CENTER.x,
      py + HEAD_CENTER.y,
      pz + HEAD_CENTER.z,
    ],
  });
}

function buildMuzzle() {
  return createBlobEllipsoid({
    scale: [0.092, 0.064, 0.066],
    blobs: [
      { dir: [0, 0, 1], amp: 0.09, k: 3 },
      { dir: [0, -1, 0.35], amp: 0.07, k: 3 },
    ],
    widthSegments: 30,
    heightSegments: 22,
    warp: (dx, dy, dz, px, py, pz) => [px, py + 1.004, pz + 0.338],
  });
}

function buildChin() {
  return createBlobEllipsoid({
    scale: [0.057, 0.032, 0.05],
    blobs: [{ dir: [0, -1, 0.5], amp: 0.08, k: 3 }],
    widthSegments: 22,
    heightSegments: 16,
    warp: (dx, dy, dz, px, py, pz) => [px, py + 0.976, pz + 0.3],
  });
}

/** Ear shells, angled outward and tilted forward the way an alert cat holds them. */
export function buildEar(side) {
  const geometry = createEarShell({
    height: 0.163,
    width: 0.128,
    thickness: 0.011,
    curl: 0.55,
    tilt: -0.1,
  });

  const euler = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.52 * side);
  euler.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.3));
  euler.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.2 * side));
  geometry.applyQuaternion(euler);
  translateGeometry(geometry, 0.128 * side, 1.16, 0.148);
  return geometry;
}

/** The pink inner surface of an ear, slightly proud of the outer shell. */
export function buildEarInner(side) {
  const geometry = createEarShell({
    height: 0.128,
    width: 0.096,
    thickness: 0.004,
    curl: 0.62,
    tilt: -0.08,
  });

  const euler = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.52 * side);
  euler.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.3));
  euler.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.2 * side));
  geometry.applyQuaternion(euler);
  translateGeometry(geometry, 0.128 * side, 1.168, 0.163);
  return geometry;
}

function buildNose() {
  return createBlobEllipsoid({
    scale: [0.037, 0.03, 0.022],
    blobs: [
      { dir: [0, 0, 1], amp: 0.12, k: 2.5 },
      { dir: [0, 1, 0], amp: -0.1, k: 3 },
    ],
    widthSegments: 22,
    heightSegments: 16,
    warp: (dx, dy, dz, px, py, pz) => [px, py + 1.026, pz + 0.392],
  });
}

function buildNostrils() {
  const parts = [];
  for (const side of [-1, 1]) {
    parts.push(
      createBlobEllipsoid({
        scale: [0.011, 0.014, 0.009],
        widthSegments: 14,
        heightSegments: 10,
        warp: (dx, dy, dz, px, py, pz) => [px + 0.016 * side, py + 1.021, pz + 0.4],
      })
    );
  }
  return mergeGeometries(parts);
}

/* ------------------------------------------------------------ paw pads */

export function buildPawPads(side, front) {
  const parts = [];
  const baseX = (front ? 0.148 : 0.232) * side;
  const baseZ = front ? 0.272 : -0.085;
  const scale = front ? 1 : 0.94;

  const pad = (dx, dy, dz, rx, ry, rz) =>
    createBlobEllipsoid({
      scale: [rx * scale, ry * scale, rz * scale],
      widthSegments: 14,
      heightSegments: 10,
      warp: (a, b, c, px, py, pz) => [px + baseX + dx, py + dy, pz + baseZ + dz],
    });

  // one main pad plus four toes
  parts.push(pad(0, 0.004, -0.012, 0.032, 0.014, 0.03));
  for (let i = 0; i < 4; i += 1) {
    const spread = -0.03 + i * 0.02;
    parts.push(pad(spread, 0.004, 0.055 + Math.abs(spread) * 0.1, 0.012, 0.011, 0.014));
  }

  return mergeGeometries(parts);
}

/* -------------------------------------------------------------- whiskers */

function whiskerStrand(root, direction, length, arc, curl) {
  const d = direction.clone().normalize();
  const up = new Vector3(0, 1, 0);
  const side = new Vector3().crossVectors(d, up).normalize();
  if (side.lengthSq() < 1e-5) side.set(1, 0, 0);

  const points = [];
  for (let i = 0; i <= 5; i += 1) {
    const t = i / 5;
    points.push(
      root
        .clone()
        .addScaledVector(d, length * t)
        .addScaledVector(up, -arc * Math.sin(Math.PI * t) * length * 0.4 + t * t * length * 0.14)
        .addScaledVector(side, curl * Math.sin(t * Math.PI) * length * 0.05)
    );
  }

  return createTaperedTube({
    points,
    radius: (t) => lerp(0.0034, 0.0006, t),
    tubularSegments: 12,
    radialSegments: 4,
    up: [0, 1, 0],
    tipFade: 0.6,
  });
}

/** Muzzle and eyebrow whiskers, merged into one geometry for a single draw. */
export function buildWhiskers() {
  const parts = [];

  const muzzleRows = [
    { root: [0.062, 1.024, 0.352], dir: [0.92, 0.18, 0.4], len: 0.3, arc: 0.85, curl: 1 },
    { root: [0.072, 1.016, 0.358], dir: [0.97, 0.03, 0.3], len: 0.34, arc: 0.7, curl: 0.6 },
    { root: [0.079, 1.007, 0.362], dir: [1.0, -0.13, 0.2], len: 0.36, arc: 0.55, curl: 0.2 },
    { root: [0.076, 0.998, 0.36], dir: [0.95, -0.27, 0.12], len: 0.32, arc: 0.45, curl: -0.3 },
    { root: [0.068, 0.991, 0.354], dir: [0.86, -0.4, 0.04], len: 0.27, arc: 0.4, curl: -0.7 },
    { root: [0.057, 0.985, 0.346], dir: [0.72, -0.52, -0.04], len: 0.23, arc: 0.35, curl: -1 },
  ];

  for (const side of [-1, 1]) {
    for (const row of muzzleRows) {
      const root = new Vector3(row.root[0] * side, row.root[1], row.root[2]);
      const dir = new Vector3(row.dir[0] * side, row.dir[1], row.dir[2]);
      parts.push(whiskerStrand(root, dir, row.len, row.arc, row.curl * side));
    }

    for (let i = 0; i < 4; i += 1) {
      const root = new Vector3((0.055 + i * 0.014) * side, 1.152 - i * 0.005, 0.29 + i * 0.004);
      const dir = new Vector3((0.34 + i * 0.16) * side, 0.9, 0.34);
      parts.push(whiskerStrand(root, dir, 0.125 + i * 0.016, -0.5, 0.3 * side));
    }
  }

  return mergeGeometries(parts);
}
