/**
 * Procedural geometry toolkit for the cat.
 *
 * The body is built from smoothly swept tubes and "blob-sculpted" ellipsoids
 * rather than primitives, then covered in fur. Every helper shares the same
 * surface language so parts merge visually under the coat.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  SphereGeometry,
  Vector3,
  Quaternion,
} from 'three';

const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

function makeGeometry(positions, normals, uvs, indices) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (normals) geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (uvs) geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  if (indices) geo.setIndex(indices);
  if (!normals) geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------ blob ellipsoids */

/**
 * A sphere shaped by radial "blobs". Each blob pushes the surface outward
 * around a direction, which is enough to sculpt a muzzle, cheek pads, a brow
 * ridge and a flattened skull without a modelling package.
 */
export function createBlobEllipsoid({
  scale,
  blobs = [],
  widthSegments = 64,
  heightSegments = 44,
  warp,
}) {
  const source = new SphereGeometry(1, widthSegments, heightSegments);
  const src = source.attributes.position.array;
  const count = source.attributes.position.count;

  const dirs = blobs.map((blob) => ({
    d: new Vector3(blob.dir[0], blob.dir[1], blob.dir[2]).normalize(),
    amp: blob.amp,
    k: blob.k ?? 6,
  }));

  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  for (let i = 0; i < count; i += 1) {
    const ix = i * 3;
    _v.set(src[ix], src[ix + 1], src[ix + 2]).normalize();

    let r = 1;
    for (let b = 0; b < dirs.length; b += 1) {
      const blob = dirs[b];
      const d = Math.max(0, _v.dot(blob.d));
      r += blob.amp * Math.pow(d, blob.k);
    }

    let px = _v.x * scale[0] * r;
    let py = _v.y * scale[1] * r;
    let pz = _v.z * scale[2] * r;

    if (warp) {
      const shifted = warp(_v.x, _v.y, _v.z, px, py, pz);
      if (shifted) {
        px = shifted[0];
        py = shifted[1];
        pz = shifted[2];
      }
    }

    positions[ix] = px;
    positions[ix + 1] = py;
    positions[ix + 2] = pz;

    uvs[i * 2] = Math.atan2(pz, px) / (Math.PI * 2) + 0.5;
    uvs[i * 2 + 1] = py / Math.max(scale[1], 1e-4) / 2 + 0.5;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(new BufferAttribute(new Uint16Array(source.index.array), 1));
  source.dispose();
  geo.computeVertexNormals();
  return geo;
}

/* --------------------------------------------------------------- sweeps */

function computeFrames(curve, segments, up) {
  const frames = [];
  const worldUp = new Vector3(up[0], up[1], up[2]).normalize();
  const fallbackA = new Vector3(0, 0, 1);
  const fallbackB = new Vector3(1, 0, 0);
  let previousSide = null;

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const tangent = curve.getTangentAt(t).normalize();

    let side = new Vector3().crossVectors(tangent, worldUp);
    if (side.lengthSq() < 0.0025) side = new Vector3().crossVectors(tangent, fallbackA);
    if (side.lengthSq() < 0.0025) side = new Vector3().crossVectors(tangent, fallbackB);
    side.normalize();

    if (previousSide && side.dot(previousSide) < 0) side.negate();
    previousSide = side.clone();

    const other = new Vector3().crossVectors(side, tangent).normalize();
    frames.push({ tangent, side, other });
  }
  return frames;
}

function addCap(positions, normals, uvs, indices, ringStart, radialSegments, center, outward, flip) {
  const centerIndex = positions.length / 3;
  positions.push(center.x, center.y, center.z);
  normals.push(outward.x, outward.y, outward.z);
  uvs.push(0.5, 0.5);

  for (let j = 0; j < radialSegments; j += 1) {
    const a = ringStart + j;
    const b = ringStart + j + 1;
    if (flip) indices.push(centerIndex, b, a);
    else indices.push(centerIndex, a, b);
  }
}

/**
 * Sweeps a varying ellipse along a curve. The cross-section frame comes from an
 * explicit `up` reference so ring axes stay predictable; normals are computed
 * analytically, which keeps the seam at j = 0 invisible under smooth shading.
 *
 * @param {object}   opts
 * @param {Vector3[]} opts.points          spine control points
 * @param {number}   opts.tubularSegments
 * @param {number}   opts.radialSegments
 * @param {number[]} opts.up               reference up vector
 * @param {Function} opts.profile          (t) => { rx, ry, os?, oo? }
 * @param {boolean}  opts.cap              round the ends
 * @param {Function} [opts.post]           (x, y, z, t, angle) => [x, y, z]
 */
export function createSweep({
  points,
  tubularSegments = 48,
  radialSegments = 20,
  up = [0, 0, 1],
  profile,
  cap = true,
  tension = 0.5,
  post,
}) {
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', tension);
  const frames = computeFrames(curve, tubularSegments, up);

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const ringStart = [];

  for (let i = 0; i <= tubularSegments; i += 1) {
    const t = i / tubularSegments;
    const p = curve.getPointAt(t);
    const frame = frames[i];
    const prof = profile(t);
    const rx = Math.max(prof.rx, 1e-5);
    const ry = Math.max(prof.ry, 1e-5);
    const os = prof.os || 0;
    const oo = prof.oo || 0;

    ringStart.push(positions.length / 3);

    for (let j = 0; j <= radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);

      _a.copy(frame.side).multiplyScalar(rx * ca);
      _b.copy(frame.other).multiplyScalar(ry * sa);
      _v.copy(p).add(_a).add(_b);
      if (os) _v.addScaledVector(frame.side, os);
      if (oo) _v.addScaledVector(frame.other, oo);

      let x = _v.x;
      let y = _v.y;
      let z = _v.z;
      if (post) {
        const moved = post(x, y, z, t, angle);
        x = moved[0]; y = moved[1]; z = moved[2];
      }

      positions.push(x, y, z);

      _c.copy(frame.side)
        .multiplyScalar(ca / rx)
        .addScaledVector(frame.other, sa / ry)
        .normalize();
      normals.push(_c.x, _c.y, _c.z);

      uvs.push(j / radialSegments, t);
    }
  }

  for (let i = 0; i < tubularSegments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  if (cap) {
    const profEnd = profile(1);
    const rEnd = (Math.abs(profEnd.rx) + Math.abs(profEnd.ry)) * 0.5;
    const endTangent = frames[tubularSegments].tangent;
    const endCenter = curve
      .getPointAt(1)
      .clone()
      .addScaledVector(endTangent, rEnd * 0.62);
    addCap(
      positions, normals, uvs, indices,
      ringStart[tubularSegments], radialSegments,
      endCenter, endTangent, true
    );

    const profStart = profile(0);
    const rStart = (Math.abs(profStart.rx) + Math.abs(profStart.ry)) * 0.5;
    const startTangent = frames[0].tangent;
    const startCenter = curve
      .getPointAt(0)
      .clone()
      .addScaledVector(startTangent, -rStart * 0.62);
    addCap(
      positions, normals, uvs, indices,
      ringStart[0], radialSegments,
      startCenter, startTangent.clone().negate(), false
    );
  }

  return makeGeometry(positions, normals, uvs, indices);
}

/** A swept tube whose radius shrinks to a point - whiskers, tail segments. */
export function createTaperedTube({
  points,
  radius,
  tubularSegments = 14,
  radialSegments = 5,
  up = [0, 1, 0],
  tipFade = 0.94,
}) {
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const radiusAt = typeof radius === 'function' ? radius : () => radius;
  const spaced = curve.getSpacedPoints(tubularSegments);

  return createSweep({
    points: spaced,
    tubularSegments,
    radialSegments,
    up,
    cap: false,
    profile: (t) => {
      const r = radiusAt(t) * (1 - Math.pow(t, 2.2) * tipFade);
      return { rx: Math.max(r, 0.0004), ry: Math.max(r, 0.0004) };
    },
  });
}
/**
 * An ear: a thin, curved shell with a soft rim. Built as a swept "leaf" so it
 * can curl forward and inward the way a cat's ear does.
 */
export function createEarShell({ height, width, thickness, curl, tilt = 0 }) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rows = 18;
  const cols = 12;

  for (let i = 0; i <= rows; i += 1) {
    const v = i / rows;
    // leaf outline: broad base tapering to a soft point
    const halfWidth = width * (0.5 + 0.5 * Math.cos(Math.PI * v)) * (1 - v * 0.16) + 0.004;
    for (let j = 0; j <= cols; j += 1) {
      const u = j / cols;
      const across = (u - 0.5) * 2;
      const x = across * halfWidth;
      const y = v * height;
      const z = -curl * v * v * height * 0.4 + curl * across * across * halfWidth * 0.55;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const a = i * (cols + 1) + j;
      const b = a + cols + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const front = makeGeometry(positions, null, uvs, indices);
  front.computeVertexNormals();

  // Thin the shell: a reversed copy pushed back by `thickness`.
  const backPositions = positions.slice();
  for (let i = 0; i < backPositions.length; i += 3) {
    backPositions[i + 2] -= thickness;
  }
  const backIndices = indices.slice();
  for (let i = 0; i < backIndices.length; i += 3) {
    const tmp = backIndices[i + 1];
    backIndices[i + 1] = backIndices[i + 2];
    backIndices[i + 2] = tmp;
  }
  const back = makeGeometry(backPositions, null, uvs, backIndices);
  back.computeVertexNormals();

  let merged = mergeGeometries([front, back]);
  if (tilt) {
    merged.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt));
  }
  merged.computeBoundingSphere();
  return merged;
}

/** Concatenates geometries that share position/normal/uv attributes. */
export function mergeGeometries(list) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geo of list) {
    vertexCount += geo.attributes.position.count;
    indexCount += geo.index ? geo.index.count : geo.attributes.position.count;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const index = new Uint32Array(indexCount);

  let vOffset = 0;
  let iOffset = 0;

  for (const geo of list) {
    const p = geo.attributes.position.array;
    const n = geo.attributes.normal ? geo.attributes.normal.array : null;
    const t = geo.attributes.uv ? geo.attributes.uv.array : null;
    const count = geo.attributes.position.count;

    position.set(p, vOffset * 3);
    if (n) normal.set(n, vOffset * 3);
    if (t) uv.set(t, vOffset * 2);

    if (geo.index) {
      const idx = geo.index.array;
      for (let i = 0; i < idx.length; i += 1) index[iOffset + i] = idx[i] + vOffset;
      iOffset += idx.length;
    } else {
      for (let i = 0; i < count; i += 1) index[iOffset + i] = i + vOffset;
      iOffset += count;
    }
    vOffset += count;
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(position, 3));
  out.setAttribute('normal', new BufferAttribute(normal, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** Shifts a geometry in place (used to re-parent parts around a pivot). */
export function translateGeometry(geometry, x, y, z) {
  const attr = geometry.attributes.position;
  const array = attr.array;
  for (let i = 0; i < array.length; i += 3) {
    array[i] += x;
    array[i + 1] += y;
    array[i + 2] += z;
  }
  attr.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/** Total surface area, used to distribute fur evenly across the body. */
export function geometrySurfaceArea(geometry) {
  const pos = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  let area = 0;

  for (let i = 0; i < count; i += 3) {
    const i0 = (index ? index[i] : i) * 3;
    const i1 = (index ? index[i + 1] : i + 1) * 3;
    const i2 = (index ? index[i + 2] : i + 2) * 3;
    _a.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
    _b.set(pos[i1], pos[i1 + 1], pos[i1 + 2]);
    _c.set(pos[i2], pos[i2 + 1], pos[i2 + 2]);
    _b.sub(_a);
    _c.sub(_a);
    area += _b.cross(_c).length() * 0.5;
  }
  return area;
}

/**
 * Area-weighted surface sampling. Fills `outPositions` / `outNormals` starting
 * at `offset` sample slots and returns the number written.
 */
export function sampleSurface(geometry, count, random, outPositions, outNormals, offset = 0) {
  const pos = geometry.attributes.position.array;
  const nrm = geometry.attributes.normal.array;
  const index = geometry.index ? geometry.index.array : null;
  const triCount = Math.floor((index ? index.count : geometry.attributes.position.count) / 3);
  if (triCount <= 0) return 0;

  const cumulative = new Float32Array(triCount);
  let total = 0;

  for (let t = 0; t < triCount; t += 1) {
    const i0 = (index ? index[t * 3] : t * 3) * 3;
    const i1 = (index ? index[t * 3 + 1] : t * 3 + 1) * 3;
    const i2 = (index ? index[t * 3 + 2] : t * 3 + 2) * 3;
    _a.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
    _b.set(pos[i1], pos[i1 + 1], pos[i1 + 2]);
    _c.set(pos[i2], pos[i2 + 1], pos[i2 + 2]);
    _b.sub(_a);
    _c.sub(_a);
    total += _b.cross(_c).length() * 0.5;
    cumulative[t] = total;
  }

  if (total <= 0) return 0;

  let written = 0;
  for (let s = 0; s < count; s += 1) {
    const target = random() * total;
    let lo = 0;
    let hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }

    const i0 = (index ? index[lo * 3] : lo * 3) * 3;
    const i1 = (index ? index[lo * 3 + 1] : lo * 3 + 1) * 3;
    const i2 = (index ? index[lo * 3 + 2] : lo * 3 + 2) * 3;

    let u = random();
    let v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    const px = pos[i0] * w + pos[i1] * u + pos[i2] * v;
    const py = pos[i0 + 1] * w + pos[i1 + 1] * u + pos[i2 + 1] * v;
    const pz = pos[i0 + 2] * w + pos[i1 + 2] * u + pos[i2 + 2] * v;

    let nx = nrm[i0] * w + nrm[i1] * u + nrm[i2] * v;
    let ny = nrm[i0 + 1] * w + nrm[i1 + 1] * u + nrm[i2 + 1] * v;
    let nz = nrm[i0 + 2] * w + nrm[i1 + 2] * u + nrm[i2 + 2] * v;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;

    const o = (offset + written) * 3;
    outPositions[o] = px;
    outPositions[o + 1] = py;
    outPositions[o + 2] = pz;
    outNormals[o] = nx;
    outNormals[o + 1] = ny;
    outNormals[o + 2] = nz;
    written += 1;
  }

  return written;
}

const UNIT_Y = new Vector3(0, 1, 0);

/** Orients an object so its local +Y axis points along `direction`. */
export function orientAlong(object3d, direction) {
  object3d.quaternion.setFromUnitVectors(UNIT_Y, _v.copy(direction).normalize());
  return object3d;
}

export { Vector3, Quaternion, Vector3 as Vec3 };
