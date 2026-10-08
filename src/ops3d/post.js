/* Safepipe Ops 3D — src/ops3d/post.js · cheap hand-rolled composite post chain.
 * createPost(renderer, scene, camera) → {render, setSize, dispose, fx}
 * NO EffectComposer (lean by design). Cost: 1 extra scene render + small blurs.
 *
 * Chain: scene → color+depth RT → bright-pass (½ res) → 9-tap separable
 * blur ping-pong (¼ res, H+V) → composite to screen:
 *   base + bloom·0.5, 2px radial chromatic aberration, ±0.006 film
 *   grain, 0.28 vignette, thin-lens depth-of-field from the real depth
 *   buffer. All RTs UnsignedByteType, Safari-safe GLSL1.
 *
 * DoF is real optics, not a screen blur band: per-pixel circle-of-confusion
 * from the thin-lens formula (see lensCocPx in camera.js) with the actual
 * scene depth, so focus lands on whatever is under the cursor/selection.
 * TUNING KNOBS (live via returned `fx` object):
 *   fx.threshold (0.3) — bright-pass cutoff; red luminance is low (~0.3),
 *     so the cutoff must sit at/below it for critical faults to bloom
 *   fx.bloom     (0.5) — bloom add strength in composite
 *   fx.ca        (1.0)  — CA scale; 1.0 ≈ 2px max at frame edges, 0 = off
 *   fx.grain     (0.006) — grain amplitude (±); 0 = off
 *   fx.vignette  (0.28) — edge darkening; 0 = off
 *   fx.dof       (1) — DoF master switch (1 = on, 0 = off); twin leaves it
 *     on at every level unless the user forces it off in the camera panel
 *   fx.fstop    (5.6) — aperture: 1.4 melts the background, 16 is deep focus
 *   fx.focalMm   (32) — focal length driving the CoC term (twin also sets
 *     the real camera FOV from it, so this is genuine zoom)
 *   fx.focusDist (10) — focus distance in world units (1 unit = 1 m); twin
 *     autofocuses this to the hovered/clicked point every frame
 *   fx.maxCoc    (14) — CoC clamp in px (perf + taste guard)
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
uniform sampler2D tDepth;
uniform float uDof;
uniform float uFstop;
uniform float uFocalMm;
uniform float uFocusDist;
uniform float uMaxCoc;
uniform float uNear;
uniform float uFar;
uniform float uFov;
uniform vec2 uRes;
uniform float uTime;
uniform float uBloom;
uniform float uCa;
uniform float uGrain;
uniform float uScan;
uniform float uVig;
varying vec2 vUv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 13.0) * 43758.5453);
}
// Thin-lens CoC in px from real depth: f²/(N·(S−f)) · |1 − S/D|,
// projected through screen height + fov. 1 world unit = 1 m.
float cocPx(float depth01) {
  float viewZ = (uNear * uFar) / ((uFar - uNear) * depth01 - uFar);
  float subj = max(-viewZ, 0.001);
  float f = clamp(uFocalMm, 8.0, 200.0) / 1000.0;
  float cocM = (f * f) / (max(uFstop, 0.1) * max(uFocusDist - f, 0.000001))
    * abs(1.0 - uFocusDist / subj);
  float fovTan = tan(radians(uFov) * 0.5);
  return min(cocM * (uRes.y / (2.0 * fovTan * subj)), uMaxCoc);
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
  // Depth-driven DoF: golden-angle spiral gather scaled by the CoC radius.
  // Sharp exactly on the focus plane, melting with real distance each side.
  if (uDof > 0.001) {
    float coc = cocPx(texture2D(tDepth, vUv).x) * uDof;
    if (coc > 0.5) {
      vec2 px = vec2(1.0) / uRes;
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float a = fi * 2.39996;
        float r = (mod(fi, 3.0) + 1.0) / 3.0 * coc;
        vec2 o = vec2(cos(a), sin(a)) * r * px;
        // Cheap tent weight: centre tap dominates, ringing stays low.
        float w = 1.0 - r / (coc + 0.001) * 0.5;
        acc += texture2D(tDiffuse, vUv + o).rgb * w;
        wsum += w;
      }
      vec3 soft = acc / wsum + bloom * uBloom * 0.5;
      // Feather the blend over ~2px so the sharp/soft boundary never bands.
      col = mix(col, soft, clamp((coc - 0.5) / 2.0, 0.0, 1.0));
    }
  }
  // Vignette.
  float d = distance(vUv, vec2(0.5));
  col *= 1.0 - uVig * smoothstep(0.35, 0.75, d);
  // Film grain (time-based hash).
  col += (hash(vUv * uRes) - 0.5) * 2.0 * uGrain;
  // Projection scanlines: faint horizontal raster sells the hologram table.
  col *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// Auto aperture by semantic view: readable DoF at every level — TOP keeps
// near-deep focus so the map stays legible, drilled-in levels open up so
// the focus plane visibly melts the background. Pure + unit-tested.
export function autoFstop(levelName) {
  if (levelName === 'asset') return 1.4;
  if (levelName === 'segment') return 2.2;
  return 6.5;
}

export function createPost(renderer, scene, camera) {
  if (!renderer) throw new Error('createPost: renderer required');
  if (!scene) throw new Error('createPost: scene required');
  if (!camera) throw new Error('createPost: camera required');

  const fx = {
    threshold: 0.36,
    bloom: 0.4, // faults stay brightest; terrain glow sits underneath
    ca: 1.0,
    grain: 0.006,
    scan: 0.05,
    vignette: 0.28,
    dof: 1,
    fstop: 5.6,
    focalMm: 32,
    focusDist: 10,
    maxCoc: 18, // wider blur span so drilled-in DoF is unmistakable
    enabled: true,
  };

  // Auto aperture by semantic view: deep focus on the TOP map, fast glass
  // drilled in. Pure + unit-tested; twin.js owns the manual override.

  const rtOpts = { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false };
  const rtScene = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  // Real depth for the thin-lens CoC — no extra scene pass, this just
  // exposes the buffer rtScene already renders.
  rtScene.depthTexture = new THREE.DepthTexture(2, 2);
  rtScene.depthTexture.type = THREE.UnsignedIntType;
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
      tDepth: { value: null },
      uDof: { value: 1 },
      uFstop: { value: fx.fstop },
      uFocalMm: { value: fx.focalMm },
      uFocusDist: { value: fx.focusDist },
      uMaxCoc: { value: fx.maxCoc },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uFov: { value: camera.fov },
      uRes: { value: new THREE.Vector2(2, 2) },
      uTime: { value: 0 },
      uBloom: { value: fx.bloom },
      uCa: { value: fx.ca },
      uGrain: { value: fx.grain },
      uScan: { value: fx.scan },
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

    // 4. Composite to screen: base + bloom·0.5, CA, grain, vignette,
    // thin-lens DoF from the real depth buffer.
    compMat.uniforms.tDiffuse.value = rtScene.texture;
    compMat.uniforms.tBloom.value = rtBlurB.texture;
    compMat.uniforms.tDepth.value = rtScene.depthTexture;
    compMat.uniforms.uDof.value = fx.dof;
    compMat.uniforms.uFstop.value = fx.fstop;
    compMat.uniforms.uFocalMm.value = fx.focalMm;
    compMat.uniforms.uFocusDist.value = fx.focusDist;
    compMat.uniforms.uMaxCoc.value = fx.maxCoc;
    compMat.uniforms.uNear.value = camera.near;
    compMat.uniforms.uFar.value = camera.far;
    compMat.uniforms.uFov.value = camera.fov;
    compMat.uniforms.uTime.value = time;
    compMat.uniforms.uBloom.value = fx.bloom;
    compMat.uniforms.uCa.value = fx.ca;
    compMat.uniforms.uGrain.value = fx.grain;
    compMat.uniforms.uScan.value = fx.scan;
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
