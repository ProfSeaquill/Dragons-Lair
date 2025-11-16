// lighting-webgl.js — WebGL post-process lighting (with context-loss guards & tunables)
// Usage: const lit = initLighting(glCanvas, W, H); lit.render(sceneCanvas, lights, ambient);

export function initLighting(glCanvas, W, H) {
  const gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: false });
  if (!gl) throw new Error('WebGL not supported');

  // --- Context loss / restore (no-op restore since we re-init per page load) ---
  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('[lighting] WebGL context lost');
  }, false);

  // --- Fixed GL state for a full-screen post pass ---
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  // --- Resize helper (keeps your 1:1 logical pixels) ---
  function resize(w, h) {
    glCanvas.width = w;
    glCanvas.height = h;
    gl.viewport(0, 0, w, h);
  }
  resize(W, H);

  // One-time caps log
  console.log('[lighting] caps', {
    MAX_TEXTURE_SIZE: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    MAX_TEXTURE_IMAGE_UNITS: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    MAX_FRAGMENT_UNIFORM_VECTORS: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
  });

  // Keep well below uniform-array limits
  const MAX_LIGHTS = 64;

  const vsSrc = `
    attribute vec2 aPos;
    attribute vec2 aUV;
    varying vec2 vUV;
    void main() {
      vUV = aUV;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const fsSrc = `
    precision mediump float;
    varying vec2 vUV;
    uniform sampler2D uScene;
    uniform vec2 uResolution;
    uniform float uAmbient;   // 0..1 (0 = bright map, 1 = dark)
    uniform float uFalloff;   // >1; 2 = default, higher = tighter lights

    const int MAX_LIGHTS = ${MAX_LIGHTS};
    uniform int uLightCount;
    uniform vec3 uLightPos[MAX_LIGHTS]; // (x,y,r)
    uniform vec3 uLightCol[MAX_LIGHTS]; // (r,g,b)

     // Stomp ripple (screen-space distortion)
    uniform int   uRippleActive;
    uniform vec2  uRippleCenter;      // pixels, top-left origin
    uniform float uRippleProgress;    // 0..1
    uniform float uRippleMaxRadius;   // pixels
    uniform float uRippleStrengthPx;  // max pixel offset at ring
    uniform float uRippleBandWidthPx; // thickness of active band (pixels)

    // soft knee to keep near-black detail
    float softKnee(float x) {
      // x in [0,1]; gentle S-curve
      return smoothstep(0.0, 1.0, x);
    }

   void main() {
      // vUV is bottom-left origin; we want top-left pixel coords for lights:
      vec2 fragPxGL = vUV * uResolution;
      vec2 fragPx   = vec2(fragPxGL.x, uResolution.y - fragPxGL.y);

      // Base UV, possibly warped by stomp ripple
      vec2 sampleUV = vUV;

      if (uRippleActive == 1) {
        float radius   = uRippleMaxRadius * clamp(uRippleProgress, 0.0, 1.0);
        float dist     = distance(fragPx, uRippleCenter);

        if (radius > 0.0 && uRippleBandWidthPx > 0.0) {
          float delta = dist - radius;
          float m = 1.0 - clamp(abs(delta) / uRippleBandWidthPx, 0.0, 1.0);

          if (m > 0.0 && uRippleStrengthPx != 0.0 && dist > 0.0001) {
            // subtle sinusoidal wobble for “liquid” look
            float wobble = sin(dist * 0.08 - uRippleProgress * 10.0);
            float offsetMagPx = uRippleStrengthPx * m * wobble;

            if (abs(offsetMagPx) > 0.1) {
              vec2 dir = (fragPx - uRippleCenter) / dist; // normalized
              vec2 offsetUV = (dir * offsetMagPx) / uResolution;
              sampleUV += offsetUV;
            }
          }
        }
      }

      vec3 base = texture2D(uScene, vUV).rgb;

      // Start with ambient darkness (your convention: lower ambient = brighter map)
      float bright = 1.0 - clamp(uAmbient, 0.0, 1.0);

      // Accumulate point lights
      for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i >= uLightCount) break;
        vec2 L = uLightPos[i].xy - fragPx;
        float r = max(1.0, uLightPos[i].z);
        float d = length(L);

        // radial intensity: 1 at center, 0 at/after radius
        float t = clamp(1.0 - d / r, 0.0, 1.0);
        // exponent falloff (uFalloff=2 is crisp-ish; 3+ gets tighter)
        float intensity = pow(t, uFalloff);

        // additive color — gentle to avoid blowing out
        base += uLightCol[i] * intensity * 0.20;
        bright += intensity * 0.85;
      }

      // Soft knee to avoid banding/crushing in darks
      float k = softKnee(clamp(bright, 0.0, 1.0));
      gl_FragColor = vec4(base * k, 1.0);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || 'Shader compile failed';
      console.error('[lighting] shader compile error:', log, '\nSource:\n', src);
      throw new Error(log);
    }
    return sh;
  }

  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'Program link failed';
    console.error('[lighting] program link error:', log);
    throw new Error(log);
  }
  gl.useProgram(prog);

  // Fullscreen quad (pos, uv interleaved)
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  0, 0,
     1, -1,  1, 0,
    -1,  1,  0, 1,
     1,  1,  1, 1,
  ]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aUV  = gl.getAttribLocation(prog, 'aUV');
  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);

  // Scene texture (NEAREST preserves your pixel-art look)
  const sceneTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Uniforms
  const uSceneLoc   = gl.getUniformLocation(prog, 'uScene');
  const uResLoc     = gl.getUniformLocation(prog, 'uResolution');
  const uAmbientLoc = gl.getUniformLocation(prog, 'uAmbient');
  const uFalloffLoc = gl.getUniformLocation(prog, 'uFalloff');
  const uLCntLoc    = gl.getUniformLocation(prog, 'uLightCount');
  const uLPosLoc    = gl.getUniformLocation(prog, 'uLightPos[0]');
  const uLColLoc    = gl.getUniformLocation(prog, 'uLightCol[0]');
  // Ripple
  const uRippleActiveLoc      = gl.getUniformLocation(prog, 'uRippleActive');
  const uRippleCenterLoc      = gl.getUniformLocation(prog, 'uRippleCenter');
  const uRippleProgressLoc    = gl.getUniformLocation(prog, 'uRippleProgress');
  const uRippleMaxRadiusLoc   = gl.getUniformLocation(prog, 'uRippleMaxRadius');
  const uRippleStrengthPxLoc  = gl.getUniformLocation(prog, 'uRippleStrengthPx');
  const uRippleBandWidthPxLoc = gl.getUniformLocation(prog, 'uRippleBandWidthPx');

  gl.uniform1i(uSceneLoc, 0);
  gl.uniform2f(uResLoc, W, H);
  gl.uniform1f(uFalloffLoc, 2.0); // default look; tweakable via setFalloff()
  gl.uniform1i(uRippleActiveLoc, 0);


  // Pre-allocated arrays
  const lpos = new Float32Array(MAX_LIGHTS * 3);
  const lcol = new Float32Array(MAX_LIGHTS * 3);

  function render(sceneCanvas, lights, ambient) {
    const w = glCanvas.width, h = glCanvas.height;

    // Upload scene bitmap
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);

    // Pack lights
    const n = Math.min((lights?.length || 0), MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      lpos[i*3 + 0] = L.x;
      lpos[i*3 + 1] = L.y;
      lpos[i*3 + 2] = Math.max(1, L.r);
      lcol[i*3 + 0] = (L.color?.[0] ?? 1.0);
      lcol[i*3 + 1] = (L.color?.[1] ?? 0.8);
      lcol[i*3 + 2] = (L.color?.[2] ?? 0.5);
    }
    // Zero the rest
    for (let i = n; i < MAX_LIGHTS; i++) {
      lpos[i*3 + 0] = lpos[i*3 + 1] = lpos[i*3 + 2] = 0;
      lcol[i*3 + 0] = lcol[i*3 + 1] = lcol[i*3 + 2] = 0;
    }

    gl.useProgram(prog);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uResLoc, w, h);
    gl.uniform1f(uAmbientLoc, Math.max(0, Math.min(1, ambient ?? 0.65))); // safe clamp
    gl.uniform1i(uLCntLoc, n);
    gl.uniform3fv(uLPosLoc, lpos);
    gl.uniform3fv(uLColLoc, lcol);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

    function setRipple(desc) {
    gl.useProgram(prog);

    if (!desc || !desc.active) {
      gl.uniform1i(uRippleActiveLoc, 0);
      return;
    }

    const x = desc.x || 0;
    const y = desc.y || 0;
    const p = Math.max(0, Math.min(1, desc.progress ?? 0));
    const maxR = Math.max(0, desc.maxRadius || 0);
    const strength = desc.strengthPx ?? 0;
    const band = Math.max(0.0001, desc.bandWidthPx || 1);

    gl.uniform1i(uRippleActiveLoc, 1);
    gl.uniform2f(uRippleCenterLoc, x, y);
    gl.uniform1f(uRippleProgressLoc, p);
    gl.uniform1f(uRippleMaxRadiusLoc, maxR);
    gl.uniform1f(uRippleStrengthPxLoc, strength);
    gl.uniform1f(uRippleBandWidthPxLoc, band);
  }

  // Optional knobs you can call from main if you want:
  function setFalloff(exp = 2.0) {
    gl.useProgram(prog);
    gl.uniform1f(uFalloffLoc, Math.max(0.5, exp));
  }

  return { render, resize, setRipple, setFalloff, MAX_LIGHTS };
}
