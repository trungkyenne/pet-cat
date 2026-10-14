/**
 * Cat eyes.
 *
 * The eyeball is a single sphere whose whole appearance - sclera, iris fibres,
 * slit pupil, wet highlights and the animated eyelids - is drawn in the
 * fragment shader. Animating a blink is then just a uniform, which is far
 * smoother than moving geometry.
 */

import { Color, ShaderMaterial, SphereGeometry, Vector2 } from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uOpen;         // 1 = wide open, 0 = shut
  uniform float uSquint;       // soft lower-lid raise for happy/petted expressions
  uniform vec2  uGaze;         // -1..1 pupil offset toward the cursor
  uniform float uPupil;        // pupil dilation 0..1
  uniform vec3  uIris;
  uniform vec3  uIrisDeep;
  uniform vec3  uLimbal;
  uniform vec3  uLidColor;
  uniform vec3  uLidShade;
  uniform float uWetness;

  varying vec3 vLocal;

  float hash(float x) {
    return fract(sin(x * 12.9898) * 43758.5453);
  }

  void main() {
    vec3 n = normalize(vLocal);

    // Build a tangent frame around the gaze direction so the slit pupil can be
    // drawn as an ellipse rather than a circle.
    vec3 g = normalize(vec3(uGaze.x * 0.42, -uGaze.y * 0.42, 1.0));
    vec3 t1 = normalize(cross(g, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
    vec3 t2 = normalize(cross(g, t1));

    vec3 v = n - g * dot(n, g);
    vec2 local = vec2(dot(v, t1), dot(v, t2));
    float r = length(local);

    // --------------------------------------------------------------- iris
    float irisRadius = 0.80;
    float irisMask = 1.0 - smoothstep(irisRadius - 0.035, irisRadius + 0.012, r);

    float angle = atan(local.y, local.x);
    float sector = floor(angle * 34.0);
    float fibre = 0.72 + 0.5 * hash(sector * 1.7 + 5.0);
    fibre *= 0.85 + 0.3 * hash(floor(r * 46.0) * 3.1 + sector);

    vec3 irisColor = mix(uIrisDeep, uIris, smoothstep(0.12, 0.72, r));
    irisColor *= mix(0.82, 1.16, fibre);
    // darker at the outer edge, luminous around the pupil
    irisColor *= mix(1.12, 0.78, smoothstep(0.35, irisRadius, r));

    // -------------------------------------------------------------- pupil
    float dilate = mix(0.085, 0.20, uPupil);
    float pupilA = dilate;
    float pupilB = 0.52 + uPupil * 0.06;
    float pd = length(vec2(local.x / pupilA, local.y / pupilB));
    float pupilMask = 1.0 - smoothstep(0.86, 1.06, pd);

    // -------------------------------------------------------------- limbal
    float limbal = smoothstep(irisRadius - 0.11, irisRadius - 0.005, r)
                 * (1.0 - smoothstep(irisRadius, irisRadius + 0.02, r));

    // -------------------------------------------------------------- sclera
    vec3 sclera = vec3(0.90, 0.87, 0.85);
    float vein = smoothstep(0.55, 1.0, hash(sector * 0.7 + 21.0));
    sclera = mix(sclera, vec3(0.86, 0.62, 0.60), vein * 0.35 * smoothstep(0.7, 1.0, r));

    vec3 eye = sclera;
    eye = mix(eye, irisColor, irisMask);
    eye = mix(eye, uLimbal, limbal * 0.9);
    eye = mix(eye, vec3(0.012, 0.014, 0.02), pupilMask);

    // ------------------------------------------------- corneal highlights
    vec2 hc = local - vec2(uGaze.x * 0.18, -uGaze.y * 0.18);
    float high1 = 1.0 - smoothstep(0.10, 0.20, length(hc - vec2(-0.26, 0.30)));
    float high2 = 1.0 - smoothstep(0.045, 0.10, length(hc - vec2(0.19, -0.20)));
    float rim = pow(1.0 - clamp(dot(n, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 4.0);
    eye += vec3(1.0, 0.98, 0.94) * high1 * 0.85 * uWetness;
    eye += vec3(1.0, 0.99, 0.96) * high2 * 0.6 * uWetness;
    eye += vec3(0.9, 0.94, 1.0) * rim * 0.18;

    // --------------------------------------------------------------- lids
    float lidTop = mix(-1.30, 1.02, uOpen);
    float lidBottom = mix(-2.00, -0.86 + uSquint * 0.30, uOpen);

    float upper = smoothstep(lidTop - 0.05, lidTop + 0.05, n.y);
    float lower = 1.0 - smoothstep(lidBottom - 0.05, lidBottom + 0.05, n.y);
    float lid = clamp(max(upper, lower), 0.0, 1.0);

    vec3 lidSurface = mix(uLidShade, uLidColor, smoothstep(-0.6, 0.8, n.y));
    // a soft crease where the lid meets the eye
    float crease = exp(-pow((n.y - lidTop) / 0.055, 2.0)) * (1.0 - smoothstep(0.98, 1.0, uOpen));
    lidSurface *= 1.0 - crease * 0.35;

    vec3 colour = mix(eye, lidSurface, lid);

    gl_FragColor = vec4(colour, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createEyeMaterial(breed) {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uOpen: { value: 1 },
      uSquint: { value: 0 },
      uGaze: { value: new Vector2(0, 0) },
      uPupil: { value: 0.35 },
      uIris: { value: breed.eyes.iris.clone() },
      uIrisDeep: { value: breed.eyes.irisDeep.clone() },
      uLimbal: { value: breed.eyes.limbal.clone() },
      uLidColor: { value: new Color('#e7c9a6') },
      uLidShade: { value: new Color('#a8805c') },
      uWetness: { value: 1 },
    },
  });
}

/** A shared hi-res sphere keeps every eyeball identical. */
let sharedEyeGeometry = null;
export function getEyeGeometry() {
  if (!sharedEyeGeometry) {
    sharedEyeGeometry = new SphereGeometry(1, 40, 28);
  }
  return sharedEyeGeometry;
}
