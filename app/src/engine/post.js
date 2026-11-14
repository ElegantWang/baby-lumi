// HDR post-processing: depth of field -> bloom -> tone mapping and grade.
// The scene is drawn once into a multisampled half-float target; everything
// after that is a handful of small full-screen passes.
import * as THREE from 'three';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fsGeometry = new THREE.BufferGeometry();
fsGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

class Pass {
  constructor(fragmentShader, uniforms) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.u = this.material.uniforms;
    this.mesh = new THREE.Mesh(fsGeometry, this.material);
    this.mesh.frustumCulled = false;
  }
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, fsCamera);
  }
}

const DEPTH_FN = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uFocus;      // focus distance (view units)
uniform float uFocusRange; // distance behind the subject over which blur ramps up
uniform float uNearRange;  // same, in front of the subject
float viewDist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float ndc = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}
float cocAt(vec2 uv) {
  float z = viewDist(uv);
  float far = clamp((z - uFocus - 0.55) / uFocusRange, 0.0, 1.0);
  float near = clamp((uFocus - 0.9 - z) / uNearRange, 0.0, 1.0);
  return max(far, near * 0.85);
}`;

// half-res: colour + circle of confusion
const DOF_PREFILTER = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
${DEPTH_FN}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  gl_FragColor = vec4(min(c, vec3(24.0)), cocAt(vUv));
}`;

// half-res: disc blur whose taps are weighted by their own blurriness, so the
// in-focus character never smears into the background
const DOF_BLUR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tHalf;
uniform vec2 uTexel;
uniform float uMaxRadius;
uniform float uSpin;
const int TAPS = 32;
void main() {
  vec4 center = texture2D(tHalf, vUv);
  float radius = center.a * uMaxRadius;
  // rotate the tap spiral per pixel so its pattern dissolves into fine noise
  float spin = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853 + uSpin;
  vec3 acc = center.rgb * 0.5;
  float wsum = 0.5;
  float cocSum = center.a * 0.5;
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(TAPS));
    float a = fi * 2.399963 + spin;
    vec2 off = vec2(cos(a), sin(a)) * r * radius * uTexel;
    vec4 s = texture2D(tHalf, vUv + off);
    float w = smoothstep(0.0, 0.25, s.a) + 0.02;
    // gently favour bright taps so highlights bloom into round bokeh
    w *= 1.0 + dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)) * 0.35;
    acc += s.rgb * w;
    wsum += w;
    cocSum += s.a * w;
  }
  gl_FragColor = vec4(acc / wsum, center.a);
}`;

const DOF_COMPOSITE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBlur;
uniform float uAmount;
${DEPTH_FN}
void main() {
  vec3 sharp = texture2D(tScene, vUv).rgb;
  vec3 blur = texture2D(tBlur, vUv).rgb;
  float coc = cocAt(vUv);
  gl_FragColor = vec4(mix(sharp, blur, smoothstep(0.0, 0.55, coc) * uAmount), 1.0);
}`;

const COPY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
void main() { gl_FragColor = vec4(texture2D(tScene, vUv).rgb, 1.0); }`;

const BLOOM_PREFILTER = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
vec3 pick(vec2 uv) {
  vec3 c = min(texture2D(tInput, uv).rgb, vec3(16.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
void main() {
  vec3 c = pick(vUv + uTexel * vec2(-1.0, -1.0)) + pick(vUv + uTexel * vec2(1.0, -1.0))
         + pick(vUv + uTexel * vec2(-1.0, 1.0)) + pick(vUv + uTexel * vec2(1.0, 1.0));
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const BLOOM_DOWN = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 4.0;
  c += texture2D(tInput, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tInput, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tInput, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tInput, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

const BLOOM_UP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tInput;   // smaller level
uniform sampler2D tBase;    // this level
uniform vec2 uTexel;        // texel of the smaller level
uniform float uSpread;
void main() {
  vec2 o = uTexel * 0.5;
  vec3 c = texture2D(tInput, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tInput, vUv + vec2(o.x * 2.0, 0.0)).rgb
         + texture2D(tInput, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tInput, vUv + vec2(0.0, o.y * 2.0)).rgb;
  c += 2.0 * (texture2D(tInput, vUv + vec2(-o.x, o.y)).rgb + texture2D(tInput, vUv + vec2(o.x, o.y)).rgb
            + texture2D(tInput, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tInput, vUv + vec2(o.x, -o.y)).rgb);
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + c / 12.0 * uSpread, 1.0);
}`;

const FINAL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform vec3 uTint;
uniform float uFade;       // 0 = normal, 1 = faded to uFadeColor (sleepy-time dimming)
uniform vec3 uFadeColor;
uniform float uTime;

// Khronos PBR Neutral: keeps colours honest and rolls highlights off softly
vec3 neutral(vec3 color) {
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c *= uExposure * uTint;
  // vignette in scene-linear light so it feels like lens falloff
  vec2 q = vUv - 0.5;
  float vig = 1.0 - uVignette * smoothstep(0.25, 0.95, dot(q, q) * 2.2);
  c *= vig;
  c = neutral(c);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSaturation);
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c = mix(c, uFadeColor, uFade);
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

export class PostFX {
  constructor(renderer, { dof = true, bloom = true, samples = 4 } = {}) {
    this.renderer = renderer;
    this.dofEnabled = dof;
    this.bloomEnabled = bloom;
    this.samples = samples;
    this.width = 0;
    this.height = 0;
    this.bloomMips = [];

    this.depthUniforms = () => ({
      tDepth: { value: null },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uFocus: { value: 4 },
      uFocusRange: { value: 9 },
      uNearRange: { value: 1.6 },
    });
    this.dofPrefilter = new Pass(DOF_PREFILTER, { tScene: { value: null }, ...this.depthUniforms() });
    this.dofBlur = new Pass(DOF_BLUR, { tHalf: { value: null }, uTexel: { value: new THREE.Vector2() }, uMaxRadius: { value: 14 }, uSpin: { value: 0 } });
    this.dofComposite = new Pass(DOF_COMPOSITE, { tScene: { value: null }, tBlur: { value: null }, uAmount: { value: 1 }, ...this.depthUniforms() });
    this.copy = new Pass(COPY, { tScene: { value: null } });
    this.bloomPrefilter = new Pass(BLOOM_PREFILTER, {
      tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.95 }, uKnee: { value: 0.4 },
    });
    this.bloomDown = new Pass(BLOOM_DOWN, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.bloomUp = new Pass(BLOOM_UP, {
      tInput: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 1 },
    });
    this.final = new Pass(FINAL, {
      tScene: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.11 },
      uExposure: { value: 1 },
      uSaturation: { value: 1.08 },
      uContrast: { value: 0.22 },
      uVignette: { value: 0.3 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uFade: { value: 0 },
      uFadeColor: { value: new THREE.Color(0.02, 0.03, 0.08) },
      uTime: { value: 0 },
    });
    this.grade = this.final.u;
  }

  setSize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.dispose();
    // HDR targets where the GPU can render to them; plain 8-bit otherwise (bloom is then gentler)
    const ext = this.renderer.extensions;
    const float = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    const hdr = { type: float ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };

    this.sceneRT = new THREE.WebGLRenderTarget(width, height, { ...hdr, depthBuffer: true, samples: this.samples });
    this.sceneRT.depthTexture = new THREE.DepthTexture(width, height);
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;
    this.sceneRT.depthTexture.minFilter = THREE.NearestFilter;
    this.sceneRT.depthTexture.magFilter = THREE.NearestFilter;

    const hw = Math.max(2, width >> 1), hh = Math.max(2, height >> 1);
    this.halfA = new THREE.WebGLRenderTarget(hw, hh, hdr);
    this.halfB = new THREE.WebGLRenderTarget(hw, hh, hdr);
    this.compositeRT = new THREE.WebGLRenderTarget(width, height, hdr);

    this.bloomMips = [];
    let w = hw, h = hh;
    for (let i = 0; i < 6 && w >= 8 && h >= 8; i++) {
      this.bloomMips.push({ down: new THREE.WebGLRenderTarget(w, h, hdr), up: new THREE.WebGLRenderTarget(w, h, hdr), w, h });
      w >>= 1;
      h >>= 1;
    }
  }

  dispose() {
    for (const rt of [this.sceneRT, this.halfA, this.halfB, this.compositeRT]) rt?.dispose();
    this.sceneRT?.depthTexture?.dispose();
    for (const m of this.bloomMips) {
      m.down.dispose();
      m.up.dispose();
    }
    this.bloomMips = [];
  }

  /**
   * @param scene
   * @param camera
   * @param {{focus:number, time:number}} opts focus = distance from camera to the subject
   */
  render(scene, camera, opts) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);

    let hdrTex = this.sceneRT.texture;
    if (this.dofEnabled) {
      for (const p of [this.dofPrefilter, this.dofComposite]) {
        p.u.tDepth.value = this.sceneRT.depthTexture;
        p.u.uNear.value = camera.near;
        p.u.uFar.value = camera.far;
        p.u.uFocus.value = opts.focus;
      }
      this.dofPrefilter.u.tScene.value = this.sceneRT.texture;
      this.dofPrefilter.render(r, this.halfA);
      this.dofBlur.u.uTexel.value.set(1 / this.halfA.width, 1 / this.halfA.height);
      this.dofBlur.u.uMaxRadius.value = Math.max(6, this.height / 95);
      this.dofBlur.u.tHalf.value = this.halfA.texture;
      this.dofBlur.u.uSpin.value = 0;
      this.dofBlur.render(r, this.halfB);
      // second, tighter pass fills the gaps between taps
      this.dofBlur.u.uMaxRadius.value *= 0.3;
      this.dofBlur.u.uSpin.value = 1.7;
      this.dofBlur.u.tHalf.value = this.halfB.texture;
      this.dofBlur.render(r, this.halfA);
      this.dofComposite.u.tScene.value = this.sceneRT.texture;
      this.dofComposite.u.tBlur.value = this.halfA.texture;
      this.dofComposite.render(r, this.compositeRT);
      hdrTex = this.compositeRT.texture;
    }

    let bloomTex = null;
    if (this.bloomEnabled && this.bloomMips.length > 1) {
      const mips = this.bloomMips;
      this.bloomPrefilter.u.tInput.value = hdrTex;
      this.bloomPrefilter.u.uTexel.value.set(0.5 / mips[0].w, 0.5 / mips[0].h);
      this.bloomPrefilter.render(r, mips[0].down);
      for (let i = 1; i < mips.length; i++) {
        this.bloomDown.u.tInput.value = mips[i - 1].down.texture;
        this.bloomDown.u.uTexel.value.set(1 / mips[i - 1].w, 1 / mips[i - 1].h);
        this.bloomDown.render(r, mips[i].down);
      }
      let smaller = mips[mips.length - 1].down;
      let smallerSize = mips[mips.length - 1];
      for (let i = mips.length - 2; i >= 0; i--) {
        this.bloomUp.u.tInput.value = smaller.texture;
        this.bloomUp.u.tBase.value = mips[i].down.texture;
        this.bloomUp.u.uTexel.value.set(1 / smallerSize.w, 1 / smallerSize.h);
        this.bloomUp.render(r, mips[i].up);
        smaller = mips[i].up;
        smallerSize = mips[i];
      }
      bloomTex = smaller.texture;
    }

    this.final.u.tScene.value = hdrTex;
    this.final.u.tBloom.value = bloomTex;
    this.final.u.uTime.value = opts.time;
    this.final.render(r, null);
  }
}
