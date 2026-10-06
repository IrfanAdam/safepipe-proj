/* Safepipe Ops 3D — src/ops3d/post.js · cheap hand-rolled composite post chain.
 * createPost(renderer, scene, camera) → {render, setSize, dispose, fx}
 * NO EffectComposer (lean by design). Cost: 1 extra scene render + small blurs.
 *
 * Chain: scene → color RT → bright-pass (½ res) → 9-tap separable blur
 * ping-pong (¼ res, H+V) → composite to screen:
 *   base + bloom·0.55, 2px radial chromatic aberration, ±0.02 film
 *   grain, 0.35 vignette. All RTs UnsignedByteType, Safari-safe GLSL1.
 *
 * TUNING KNOBS (live via returned `fx` object):
 *   fx.threshold (0.3) — bright-pass cutoff; red luminance is low (~0.3),
 *     so the cutoff must sit at/below it for critical faults to bloom
 *   fx.bloom     (0.7) — bloom add strength in composite
 *   fx.ca        (1.0)  — CA scale; 1.0 ≈ 2px max at frame edges, 0 = off
 *   fx.grain     (0.02) — grain amplitude (±); 0 = off
 *   fx.vignette  (0.35) — edge darkening; 0 = off
 *   fx.enabled   (true) — false = raw renderer.render (debug/perf escape hatch)
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(uThreshold, uThreshold + 0.25, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

// 9-tap separable gaussian (sigma ~2): 0.227 + 2*(0.194+0.121+0.054+0.016) ≈ 1.0
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec2 o = uDir * uTexel;
  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
  c += texture2D(tDiffuse, vUv + o * 1.0).rgb * 0.1945946;
  c += texture2D(tDiffuse, vUv - o * 1.0).rgb * 0.1945946;
  c += texture2D(tDiffuse, vUv + o * 2.0).rgb * 0.1216216;
  c += texture2D(tDiffuse, vUv - o * 2.0).rgb * 0.1216216;
  c += texture2D(tDiffuse, vUv + o * 3.0).rgb * 0.0540541;
  c += texture2D(tDiffuse, vUv - o * 3.0).rgb * 0.0540541;
  c += texture2D(tDiffuse, vUv + o * 4.0).rgb * 0.0162162;
  c += texture2D(tDiffuse, vUv - o * 4.0).rgb * 0.0162162;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMP_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uBloom;
uniform float uCa;
uniform float uGrain;
uniform float uVig;
varying vec2 vUv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 13.0) * 43758.5453);
}
void main() {
  // Lateral chromatic aberration: ~2px max at frame corners when uCa = 1.
  vec2 dir = vUv - vec2(0.5);
  float r2 = dot(dir, dir);
  vec2 off = dir * r2 * 3.0 * (vec2(2.0) / uRes) * uCa;
  vec3 base;
  base.r = texture2D(tDiffuse, vUv + off).r;
  base.g = texture2D(tDiffuse, vUv).g;
  base.b = texture2D(tDiffuse, vUv - off).b;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  vec3 col = base + bloom * uBloom;
  // Vignette.
  float d = distance(vUv, vec2(0.5));
  col *= 1.0 - uVig * smoothstep(0.35, 0.75, d);
  // Film grain (time-based hash).
  col += (hash(vUv * uRes) - 0.5) * 2.0 * uGrain;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function createPost(renderer, scene, camera) {
  if (!renderer) throw new Error('createPost: renderer required');
  if (!scene) throw new Error('createPost: scene required');
  if (!camera) throw new Error('createPost: camera required');

  const fx = {
    threshold: 0.3,
    bloom: 0.7,
    ca: 1.0,
    grain: 0.02,
    vignette: 0.35,
    enabled: true,
  };

  const rtOpts = { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false };
  const rtScene = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  const rtBright = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts });
  const rtBlurA = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts });
  const rtBlurB = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts });

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uThreshold: { value: fx.threshold } },
    vertexShader: VERT,
    fragmentShader: BRIGHT_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uDir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tBloom: { value: null },
      uRes: { value: new THREE.Vector2(2, 2) },
      uTime: { value: 0 },
      uBloom: { value: fx.bloom },
      uCa: { value: fx.ca },
      uGrain: { value: fx.grain },
      uVig: { value: fx.vignette },
    },
    vertexShader: VERT,
    fragmentShader: COMP_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsScene = new THREE.Scene();
  const fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), brightMat);
  fsMesh.frustumCulled = false;
  fsScene.add(fsMesh);

  const blit = (mat, target) => {
    fsMesh.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCam);
  };

  let w = 2;
  let h = 2;

  function setSize(nw, nh) {
    w = Math.max(2, Math.floor(nw) || 2);
    h = Math.max(2, Math.floor(nh) || 2);
    const bw = Math.max(1, w >> 1);
    const bh = Math.max(1, h >> 1);
    const qw = Math.max(1, w >> 2);
    const qh = Math.max(1, h >> 2);
    rtScene.setSize(w, h);
    rtBright.setSize(bw, bh);
    rtBlurA.setSize(qw, qh);
    rtBlurB.setSize(qw, qh);
    compMat.uniforms.uRes.value.set(w, h);
  }

  // Seed from the renderer's current drawing buffer so the chain works
  // even if the owner never calls setSize.
  try {
    const dbSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    setSize(dbSize.x, dbSize.y);
  } catch {
    setSize(2, 2);
  }

  function render(t) {
    if (!fx.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    const time = typeof t === 'number' ? t : 0;

    // 1. Scene → color RT.
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);

    // 2. Bright-pass at half res (threshold ~0.55: only amber/red/bright dots).
    brightMat.uniforms.tDiffuse.value = rtScene.texture;
    brightMat.uniforms.uThreshold.value = fx.threshold;
    blit(brightMat, rtBright);

    // 3. 9-tap separable blur ping-pong at quarter res (H then V).
    const bw = Math.max(1, w >> 1);
    const bh = Math.max(1, h >> 1);
    blurMat.uniforms.tDiffuse.value = rtBright.texture;
    blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    blurMat.uniforms.uDir.value.set(1, 0);
    blit(blurMat, rtBlurA);

    const qw = Math.max(1, w >> 2);
    const qh = Math.max(1, h >> 2);
    blurMat.uniforms.tDiffuse.value = rtBlurA.texture;
    blurMat.uniforms.uTexel.value.set(1 / qw, 1 / qh);
    blurMat.uniforms.uDir.value.set(0, 1);
    blit(blurMat, rtBlurB);

    // 4. Composite to screen: base + bloom·0.55, CA, grain, vignette.
    compMat.uniforms.tDiffuse.value = rtScene.texture;
    compMat.uniforms.tBloom.value = rtBlurB.texture;
    compMat.uniforms.uTime.value = time;
    compMat.uniforms.uBloom.value = fx.bloom;
    compMat.uniforms.uCa.value = fx.ca;
    compMat.uniforms.uGrain.value = fx.grain;
    compMat.uniforms.uVig.value = fx.vignette;
    blit(compMat, null);
  }

  function dispose() {
    rtScene.dispose();
    rtBright.dispose();
    rtBlurA.dispose();
    rtBlurB.dispose();
    fsMesh.geometry.dispose();
    brightMat.dispose();
    blurMat.dispose();
    compMat.dispose();
  }

  return { render, setSize, dispose, fx };
}
