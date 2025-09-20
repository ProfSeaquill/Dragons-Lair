// lighting-webgl.js — post-process lighting for a 2D canvas frame.
// Usage:
//   const lit = initLighting(glCanvas, width, height);
//   lit.render(sceneCanvas, lightsArray, ambient);
//
// lightsArray = [{ x, y, r, color:[r,g,b] }, ...]  (pixels, pixels, pixels, 0..1)

export function initLighting(glCanvas, W, H) {
  const gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: false });
  if (!gl) throw new Error('WebGL not supported');

  // Resize helper (call if your logical size changes)
  function resize(w, h) {
    glCanvas.width = w;
    glCanvas.height = h;
    gl.viewport(0, 0, w, h);
  }
  resize(W, H);

  // --- Shaders ---
  const vsSrc = `
    attribute vec2 aPos;
    attribute vec2 aUV;
    varying vec2 vUV;
    void main() {
      vUV = aUV;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  // NOTE: This is a single-pass, no-normals light. It keeps colors crisp.
  // We darken by ambient and add back brightness from point lights.
  const fsSrc = `
    precision mediump float;
    varying vec2 vUV;
    uniform sampler2D uScene;
    uniform vec2 uResolution;
    uniform float uAmbient;
    const int MAX_LIGHTS = 64;
    uniform int uLightCount;
    uniform vec3 uLightPos[MAX_LIGHTS]; // (x,y,r)
    uniform vec3 uLightCol[MAX_LIGHTS]; // (r,g,b)

    void main() {
      vec2 fragPx = vUV * uResolution;
      vec3 base = texture2D(uScene, vUV).rgb;

      // start with ambient darkness (keep base color, then scale brightness)
      float bright = 1.0 - clamp(uAmbient, 0.0, 1.0);

      // accumulate small torch points (tight falloff)
      for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i >= uLightCount) break;
        vec2 L = uLightPos[i].xy - fragPx;
        float r = max(1.0, uLightPos[i].z);

        // smooth, small light: intensity ~ (1 - smoothstep(0.6r, r, d))^2
        float d = length(L);
        float core = smoothstep(r*0.60, r, d);     // 0 at center -> 1 at edge
        float intensity = pow(1.0 - core, 2.0);    // crisp center, fast falloff

        // color add (very subtle), and brighten factor
        base += uLightCol[i] * intensity * 0.20;
        bright += intensity * 0.85;
      }

      // clamp brightness and output
      float k = clamp(bright, 0.0, 1.0);
      gl_FragColor = vec4(base * k, 1.0);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || 'Shader compile failed');
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
    throw new Error(gl.getProgramInfoLog(prog) || 'Program link failed');
  }
  gl.useProgram(prog);

  // Fullscreen quad
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  // pos (x,y), uv (u,v)
  const verts = new Float32Array([
    -1, -1,  0, 0,
     1, -1,  1, 0,
    -1,  1,  0, 1,
     1,  1,  1, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aUV  = gl.getAttribLocation(prog, 'aUV');
  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);

  // Scene texture (we upload the offscreen 2D canvas here each frame)
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
  const uLCntLoc    = gl.getUniformLocation(prog, 'uLightCount');
  const uLPosLoc    = gl.getUniformLocation(prog, 'uLightPos[0]');
  const uLColLoc    = gl.getUniformLocation(prog, 'uLightCol[0]');

  gl.uniform1i(uSceneLoc, 0);
  gl.uniform2f(uResLoc, W, H);

  // Pre-allocate light arrays (max 64)
  const MAX = 64;
  const lpos = new Float32Array(MAX * 3);
  const lcol = new Float32Array(MAX * 3);

  function render(sceneCanvas, lights, ambient) {
    const w = glCanvas.width, h = glCanvas.height;

    // Upload scene to texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);

    // Fill lights
    const n = Math.min(lights?.length || 0, MAX);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      lpos[i*3 + 0] = L.x;
      lpos[i*3 + 1] = L.y;
      lpos[i*3 + 2] = Math.max(1, L.r);
      lcol[i*3 + 0] = L.color?.[0] ?? 1.0;
      lcol[i*3 + 1] = L.color?.[1] ?? 0.8;
      lcol[i*3 + 2] = L.color?.[2] ?? 0.5;
    }

    gl.useProgram(prog);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uResLoc, w, h);
    gl.uniform1f(uAmbientLoc, ambient);
    gl.uniform1i(uLightCountLoc(gl, uLCntLoc, n), n); // helper handles ANGLE quirk
    gl.uniform3fv(uLPosLoc, lpos);
    gl.uniform3fv(uLColLoc, lcol);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Some WebGLs need explicit uniform1iv wrapper for int arrays / ANGLE
  function uLightCountLoc(gl, loc, n) {
    gl.uniform1i(loc, n);
    return loc;
  }

  return { render, resize };
}
