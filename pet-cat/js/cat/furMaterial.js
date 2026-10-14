/**
 * The fur shader.
 *
 * Each fur strand is a short instanced ribbon. The vertex stage grows the
 * ribbon from its root along the strand direction, bends it, sways it with a
 * cheap wind field, and billboards it around its own axis so it always presents
 * a face to the camera. The fragment stage shades it with wrapped diffuse
 * (which is what makes fur read as fur rather than plastic), a strong rim term
 * and a filament sheen.
 *
 * Lighting is supplied as explicit uniforms rather than read from three's
 * uniform library, so the fur can be lit slightly more flatteringly than the
 * rest of the scene without fighting it.
 */

import { Color, DoubleSide, ShaderMaterial, Vector3, Vector2, AdditiveBlending } from 'three';

const vertexShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uSway;
  uniform float uGravity;
  uniform float uLengthScale;
  uniform float uWidthScale;
  uniform float uTipLift;

  uniform vec3  uPetPos;
  uniform vec3  uPetDir;
  uniform float uPetStrength;
  uniform float uPetRadius;

  attribute vec3 aRoot;
  attribute vec3 aNormal;
  attribute vec3 aDir;
  attribute vec4 aParams;   // x: length, y: half width, z: seed, w: ambient occlusion
  attribute vec3 aColorRoot;
  attribute vec3 aColorMid;
  attribute vec3 aColorTip;
  attribute vec2 aBend;     // x: sideways curl, y: along-strand curl
  attribute vec2 aMisc;     // x: sway phase, y: stiffness

  varying vec3  vColorRoot;
  varying vec3  vColorMid;
  varying vec3  vColorTip;
  varying float vT;
  varying float vAlpha;
  varying float vAo;
  varying vec3  vNrm;
  varying vec3  vRight;
  varying vec3  vWorldPos;

  void main() {
    float t = position.y;
    float edge = abs(position.x) * 2.0;      // 0 at centre, 1 at the rim
    float edgeAlpha = 1.0 - edge;

    float seed = aParams.z;
    float ao = aParams.w;

    vec3 dir = normalize(aDir);
    vec3 nrm = normalize(aNormal);

    // ---------------------------------------------------------- petting
    vec3 toPet = aRoot - uPetPos;
    float petDist = length(toPet);
    float petFall = 1.0 - smoothstep(0.0, uPetRadius, petDist);
    petFall = petFall * petFall * uPetStrength;

    // ------------------------------------------------------------ bend
    vec3 sideAxis = cross(dir, vec3(0.0, 1.0, 0.0));
    if (dot(sideAxis, sideAxis) < 1e-4) sideAxis = cross(dir, vec3(0.0, 0.0, 1.0));
    sideAxis = normalize(sideAxis);

    float curl = aBend.x * t * t;
    vec3 bend = sideAxis * curl;
    bend += dir * (aBend.y * t * t);
    bend.y -= uGravity * t * t * (0.7 + aMisc.y * 0.6);

    // ------------------------------------------------------------ sway
    float phase = aMisc.x * 6.2831 + seed * 3.1;
    float amp = uSway * (0.45 + aMisc.y * 0.9) * (0.25 + t * 1.5);
    vec3 sway = vec3(
      sin(uTime * 1.35 + phase) * amp,
      sin(uTime * 1.9 + phase * 1.7) * amp * 0.55,
      cos(uTime * 1.05 + phase * 0.8) * amp
    );

    // -------------------------------------------------------- petting push
    vec3 pushDir = normalize(uPetDir + vec3(0.0, 0.55, 0.0));
    vec3 petPush = pushDir * petFall * 0.075;
    petPush += nrm * petFall * 0.02;

    // ------------------------------------------------------- strand point
    float len = aParams.x * uLengthScale * (1.0 - petFall * 0.42);
    vec3 localPos = aRoot
      + dir * (len * t)
      + bend
      + sway
      + petPush;

    // a light upward flick at the very tip keeps the silhouette alive
    localPos.y += uTipLift * pow(t, 3.0) * (0.4 + aMisc.y);

    vec4 worldPos = modelMatrix * vec4(localPos, 1.0);

    // ---------------------------------------------- cylindrical billboard
    vec3 strandWorldDir = normalize((modelMatrix * vec4(dir, 0.0)).xyz);
    vec3 viewVec = normalize(cameraPosition - worldPos.xyz);
    vec3 right = cross(strandWorldDir, viewVec);
    if (dot(right, right) < 1e-5) {
      right = cross(strandWorldDir, vec3(0.0, 0.0, 1.0));
      if (dot(right, right) < 1e-5) right = vec3(1.0, 0.0, 0.0);
    }
    right = normalize(right);

    float halfWidth = aParams.y * uWidthScale * (1.0 - petFall * 0.35);
    worldPos.xyz += right * (position.x * 2.0 * halfWidth);

    vT = t;
    vAo = mix(1.0, ao, 1.0);
    vColorRoot = aColorRoot;
    vColorMid = aColorMid;
    vColorTip = aColorTip;
    vNrm = normalize((modelMatrix * vec4(mix(nrm, dir, 0.55), 0.0)).xyz);
    vRight = right;
    vWorldPos = worldPos.xyz;

    float tipFade = 1.0 - smoothstep(0.82, 1.0, t) * 0.7;
    vAlpha = clamp(edgeAlpha, 0.0, 1.0) * tipFade;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3  uKeyDir;
  uniform vec3  uKeyColor;
  uniform vec3  uFillDir;
  uniform vec3  uFillColor;
  uniform vec3  uRimDir;
  uniform vec3  uRimColor;
  uniform vec3  uSkyColor;
  uniform vec3  uGroundColor;
  uniform float uSheen;
  uniform float uOpacity;

  varying vec3  vColorRoot;
  varying vec3  vColorMid;
  varying vec3  vColorTip;
  varying float vT;
  varying float vAlpha;
  varying float vAo;
  varying vec3  vNrm;
  varying vec3  vRight;
  varying vec3  vWorldPos;

  void main() {
    if (vAlpha < 0.012) discard;

    // three-stop ramp: undercoat -> body colour -> sun-lit tip
    vec3 base = vT < 0.5
      ? mix(vColorRoot, vColorMid, vT * 2.0)
      : mix(vColorMid, vColorTip, (vT - 0.5) * 2.0);

    vec3 N = normalize(vNrm);
    vec3 V = normalize(cameraPosition - vWorldPos);

    // Cylindrical shading: blend the surface normal with the ribbon-facing
    // normal so strands catch light individually.
    vec3 R = normalize(vRight);
    N = normalize(N * 0.62 + R * 0.72);

    float keyNdL = dot(N, uKeyDir);
    float keyWrap = keyNdL * 0.5 + 0.5;
    vec3 key = uKeyColor * (max(keyNdL, 0.0) * 0.6 + keyWrap * keyWrap * 0.68);

    float fillNdL = dot(N, uFillDir);
    vec3 fill = uFillColor * (max(fillNdL, 0.0) * 0.55 + 0.45);

    vec3 hemi = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);

    // Rim light loves fur: it separates individual strands from the body.
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    vec3 rim = uRimColor * fres * (0.75 + vT * 1.05);

    // Filament sheen along the strand.
    vec3 H = normalize(uKeyDir + V);
    float spec = pow(max(dot(N, H), 0.0), 34.0) * uSheen * (0.35 + vT * 1.4);

    vec3 lit = base * (hemi + key + fill) + rim * base * 1.5 + vec3(spec);
    lit *= vAo;

    gl_FragColor = vec4(lit, vAlpha * uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * @param {object} opts
 * @param {number} opts.sheen   strength of the filament highlight
 */
export function createFurMaterial({ sheen = 0.35, opacity = 1 } = {}) {
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: DoubleSide,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    alphaTest: 0.02,
    uniforms: {
      uTime: { value: 0 },
      uSway: { value: 0.006 },
      uGravity: { value: 0.0055 },
      uLengthScale: { value: 1 },
      uWidthScale: { value: 1 },
      uTipLift: { value: 0.004 },

      uPetPos: { value: new Vector3(0, -99, 0) },
      uPetDir: { value: new Vector3(0, 0, 0) },
      uPetStrength: { value: 0 },
      uPetRadius: { value: 0.16 },

      uKeyDir: { value: new Vector3(0.5, 0.8, 0.6).normalize() },
      uKeyColor: { value: new Color('#ffe6c4') },
      uFillDir: { value: new Vector3(-0.6, 0.15, 0.7).normalize() },
      uFillColor: { value: new Color('#c8d8f0') },
      uRimDir: { value: new Vector3(-0.4, 0.5, -0.8).normalize() },
      uRimColor: { value: new Color('#ffb877') },
      uSkyColor: { value: new Color('#fff3e2') },
      uGroundColor: { value: new Color('#c9ab89') },

      uSheen: { value: sheen },
      uOpacity: { value: opacity },
    },
  });

  material.extensions = { derivatives: false };
  return material;
}

/** The ribbon used by every strand: cols across the width, rows along it. */
export const STRAND_COLS = 3;
export const STRAND_SEGMENTS = 3;
