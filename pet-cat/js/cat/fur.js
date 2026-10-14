/**
 * Fur generation.
 *
 * Strands are grown from area-weighted samples of each part's surface. Every
 * strand is one instance of a small ribbon; all the variety (length, curl,
 * colour, sway phase, occlusion) lives in instanced attributes, so an entire
 * coat costs one draw call per animated group.
 */

import {
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Sphere,
  Vector3,
} from 'three';
import { geometrySurfaceArea, sampleSurface } from './geometry.js';
import { resolveFurColors } from './palettes.js';
import { STRAND_COLS, STRAND_SEGMENTS } from './furMaterial.js';
import { createGaussian, clamp, clamp01, smoothstep } from '../utils/math.js';
import { fbm3, noise3 } from '../utils/noise.js';

/** Strands per square unit of skin, per quality tier. */
export const FUR_DENSITY = {
  ultra: 13500,
  high: 11000,
  medium: 6400,
  low: 3400,
};

/** Base strand length by body part, in cat units. */
const LENGTH_BY_PART = {
  torso: 0.078,
  neck: 0.062,
  chest: 0.098,
  belly: 0.07,
  haunch: 0.098,
  legFront: 0.056,
  legBack: 0.062,
  frontPaw: 0.036,
  rearPaw: 0.034,
  head: 0.052,
  cheek: 0.078,
  muzzle: 0.026,
  chin: 0.03,
  ear: 0.024,
  tail: 0.084,
  tailTip: 0.105,
};

const FACE_PARTS = new Set(['head', 'cheek', 'muzzle', 'chin', 'ear']);

const _dir = new Vector3();
const _lean = new Vector3();
const _normal = new Vector3();
const _point = new Vector3();
const _colors = { mid: new Color(), root: new Color(), tip: new Color() };
const _scratch = { mid: new Color(), root: new Color(), tip: new Color() };

/** The unit ribbon every strand instance reuses. */
function createStrandGeometry() {
  const positions = [];
  const indices = [];
  const rowCount = STRAND_SEGMENTS + 1;

  for (let i = 0; i < rowCount; i += 1) {
    const t = i / STRAND_SEGMENTS;
    const profile = 0.14 + 0.86 * Math.pow(1 - t, 0.7);
    for (let j = 0; j < STRAND_COLS; j += 1) {
      const across = j / (STRAND_COLS - 1) - 0.5;
      positions.push(across * profile, t, 0);
    }
  }

  for (let i = 0; i < STRAND_SEGMENTS; i += 1) {
    for (let j = 0; j < STRAND_COLS - 1; j += 1) {
      const a = i * STRAND_COLS + j;
      const b = a + STRAND_COLS;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.boundingSphere = new Sphere(new Vector3(0, 0.7, 0), 1.8);
  return geometry;
}
/* ------------------------------------------------------------ occluders */

/**
 * A cheap axis-aligned ellipsoid used to (a) stop strands growing inside
 * neighbouring parts and (b) bake a little ambient occlusion into each strand.
 */
export function makeOccluder(part, center, radii) {
  return {
    part,
    cx: center[0],
    cy: center[1],
    cz: center[2],
    rx: Math.max(radii[0], 1e-3),
    ry: Math.max(radii[1], 1e-3),
    rz: Math.max(radii[2], 1e-3),
  };
}

/** Normalised squared distance to an occluder (1.0 == exactly on its shell). */
function occluderDistanceSq(o, x, y, z) {
  const dx = (x - o.cx) / o.rx;
  const dy = (y - o.cy) / o.ry;
  const dz = (z - o.cz) / o.rz;
  return dx * dx + dy * dy + dz * dz;
}

/* ---------------------------------------------------------- flow field */

/**
 * The direction fur lies in, before the surface normal is blended in. Cats'
 * coats run from the nose toward the tail, so the trunk leans down-and-back
 * while the face leans forward.
 */
function computeFlow(part, x, out) {
  if (FACE_PARTS.has(part)) out.set(x * 0.22, -0.48, 0.86);
  else out.set(x * 0.5, -0.85, -0.36);
  return out.normalize();
}

/* ------------------------------------------------------------- builder */

/**
 * Grows a coat over the supplied part geometries.
 *
 * @returns a handle with the mesh, its material, the derived count and a
 *          `refreshColors(breed)` used when the user switches cats.
 */
export function buildFurGroup({
  sources,
  occluders = [],
  breed,
  density,
  random,
  material,
  maxStrands = 120000,
}) {
  const gaussian = createGaussian(random);

  // 1. area-weighted budget -------------------------------------------------
  let totalArea = 0;
  const areas = sources.map((source) => {
    const area = geometrySurfaceArea(source.geometry);
    totalArea += area;
    return area;
  });

  if (totalArea <= 0) return null;

  const desired = Math.min(density * totalArea, maxStrands);
  const counts = areas.map((area) => Math.max(1, Math.round((desired * area) / totalArea)));
  const total = counts.reduce((sum, n) => sum + n, 0);

  // 2. sample the surfaces --------------------------------------------------
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const partsOf = new Uint8Array(total);
  const partNames = sources.map((s) => s.part);

  let cursor = 0;
  sources.forEach((source, i) => {
    const n = counts[i];
    sampleSurface(source.geometry, n, random, positions, normals, cursor);
    partsOf.fill(i, cursor, cursor + n);
    cursor += n;
  });

  // 3. shuffled slots so an adaptive quality cut thins the coat evenly ------
  const slots = new Uint32Array(total);
  for (let i = 0; i < total; i += 1) slots[i] = i;
  for (let i = total - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = slots[i];
    slots[i] = slots[j];
    slots[j] = tmp;
  }

  // 4. instanced attributes -------------------------------------------------
  const aRoot = new Float32Array(total * 3);
  const aNormal = new Float32Array(total * 3);
  const aDir = new Float32Array(total * 3);
  const aParams = new Float32Array(total * 4);
  const aColorRoot = new Float32Array(total * 3);
  const aColorMid = new Float32Array(total * 3);
  const aColorTip = new Float32Array(total * 3);
  const aBend = new Float32Array(total * 2);
  const aMisc = new Float32Array(total * 2);
  const variations = new Float32Array(total);
  const rootX = new Float32Array(total);
  const rootY = new Float32Array(total);
  const rootZ = new Float32Array(total);
  const partSlot = new Uint8Array(total);

  let written = 0;

  for (let i = 0; i < total; i += 1) {
    const s = slots[i];
    const px = positions[s * 3];
    const py = positions[s * 3 + 1];
    const pz = positions[s * 3 + 2];

    const partIndex = partsOf[s];
    const part = partNames[partIndex];

    // ---- cull strands that would grow inside a neighbouring part
    let hidden = false;
    let ao = 1;
    for (let o = 0; o < occluders.length; o += 1) {
      const occ = occluders[o];
      if (occ.part === part) continue;
      const d2 = occluderDistanceSq(occ, px, py, pz);
      if (d2 < 0.82) {
        hidden = true;
        break;
      }
      if (d2 < 2.1) {
        ao *= 0.5 + 0.5 * smoothstep(0.9, 1.45, Math.sqrt(d2));
      }
    }
    if (hidden) continue;
    if (py < -0.004) continue;

    ao *= 0.8 + 0.2 * smoothstep(0.0, 0.36, py);

    _normal.set(normals[s * 3], normals[s * 3 + 1], normals[s * 3 + 2]).normalize();
    computeFlow(part, px, _lean);

    _dir.copy(_normal)
      .multiplyScalar(0.82)
      .addScaledVector(_lean, 0.46)
      .add(_scratchDir.set(gaussian() * 0.12, gaussian() * 0.1, gaussian() * 0.12))
      .normalize();

    const baseLength = LENGTH_BY_PART[part] ?? 0.07;
    const clump = 1 + 0.34 * fbm3(px * 6.5, py * 6.5, pz * 6.5, 2);
    const variation = gaussian() * 0.5;

    let length = baseLength * clump * (1 + variation * 0.3) * breed.coat.length;
    let width = clamp(length * 0.21, 0.0042, 0.019) * breed.coat.fluff;

    // occasional longer guard hairs break up the uniformity
    if (random() < 0.055) {
      length *= 1.55;
      width *= 0.66;
    }

    const out = written * 3;
    aRoot[out] = px + _normal.x * 0.0016;
    aRoot[out + 1] = py + _normal.y * 0.0016;
    aRoot[out + 2] = pz + _normal.z * 0.0016;
    aNormal[out] = _normal.x;
    aNormal[out + 1] = _normal.y;
    aNormal[out + 2] = _normal.z;
    aDir[out] = _dir.x;
    aDir[out + 1] = _dir.y;
    aDir[out + 2] = _dir.z;

    const pOut = written * 4;
    aParams[pOut] = length;
    aParams[pOut + 1] = width;
    aParams[pOut + 2] = random();
    aParams[pOut + 3] = clamp01(ao);

    const bOut = written * 2;
    aBend[bOut] = gaussian() * length * 0.62;
    aBend[bOut + 1] = gaussian() * length * 0.34 - length * 0.1;

    aMisc[bOut] = random();
    aMisc[bOut + 1] = 0.15 + random() * 0.85;

    variations[written] = variation;
    rootX[written] = px;
    rootY[written] = py;
    rootZ[written] = pz;
    partSlot[written] = partIndex;

    written += 1;
  }

  // 5. geometry -------------------------------------------------------------
  const geometry = createStrandGeometry();

  const attach = (name, array, itemSize) => {
    const attribute = new InstancedBufferAttribute(array, itemSize);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    return attribute;
  };

  const attrs = {
    root: attach('aRoot', aRoot, 3),
    normal: attach('aNormal', aNormal, 3),
    dir: attach('aDir', aDir, 3),
    params: attach('aParams', aParams, 4),
    colorRoot: attach('aColorRoot', aColorRoot, 3),
    colorMid: attach('aColorMid', aColorMid, 3),
    colorTip: attach('aColorTip', aColorTip, 3),
    bend: attach('aBend', aBend, 2),
    misc: attach('aMisc', aMisc, 2),
  };

  geometry.instanceCount = written;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = true;

  const paint = (nextBreed) => {
    const count = geometry.instanceCount;
    for (let i = 0; i < count; i += 1) {
      const part = partNames[partSlot[i]];
      resolveFurColors(
        nextBreed,
        rootX[i],
        rootY[i],
        rootZ[i],
        part,
        variations[i],
        _colors
      );
      const o = i * 3;
      aColorRoot[o] = _colors.root.r;
      aColorRoot[o + 1] = _colors.root.g;
      aColorRoot[o + 2] = _colors.root.b;
      aColorMid[o] = _colors.mid.r;
      aColorMid[o + 1] = _colors.mid.g;
      aColorMid[o + 2] = _colors.mid.b;
      aColorTip[o] = _colors.tip.r;
      aColorTip[o + 1] = _colors.tip.g;
      aColorTip[o + 2] = _colors.tip.b;
    }
    attrs.colorRoot.needsUpdate = true;
    attrs.colorMid.needsUpdate = true;
    attrs.colorTip.needsUpdate = true;
  };

  paint(breed);

  return {
    mesh,
    material,
    geometry,
    partNames,
    /** Total strands generated (the ceiling for adaptive quality). */
    capacity: written,
    /** Recolours the coat in place - used when switching breeds. */
    refreshColors: paint,
    /** Drops the drawn instance count for weaker frames. */
    setDetail(scale) {
      geometry.instanceCount = Math.max(600, Math.floor(written * clamp(scale, 0.2, 1)));
    },
  };
}

const _scratchDir = new Vector3();
