// lighting-webgl.js — WebGL post-process lighting (safer version)
// Usage: const lit = initLighting(glCanvas, W, H); lit.render(sceneCanvas, lights, ambient);

export function initLighting(glCanvas, W, H) {
  const gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: false });
  if (!gl) throw new Error('WebGL not supported');

  // State setup for a post-process pass
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);

  // Resize helper
  function resize(w, h) {
    glCanvas.width = w;
    glCanvas.height = h;
    gl.viewport(0, 0, w, h);
  }
  resize(W, H);

  // Log useful caps (once)
  const caps = {
    MAX_TEXTURE_SIZE: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    MAX_TEXTURE_IMAGE_UNITS: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    MAX_FRAGMENT_UNIFORM_VECTORS: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
  };
  console.log('[lighting] caps', caps);

  // Keep lights well below uniform limits
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
    uniform float uAmbient;
    const int MAX_LIGHTS = ${MAX_LIGHTS};
    uniform int uLightCount;
    uniform vec3 uLightPos[MAX_LIGHTS]; // (x,y,r)
    uniform vec3 uLightCol[MAX_LIGHTS]; // (r,g,b)

    void main() {
     vec2 fragPxGL = vUV * uResolution;                 // GL-style (0,0 bottom-left)
vec2 fragPx   = vec2(fragPxGL.x, uResolution.y - fragPxGL.y); // convert to top-left
vec3 base = texture2D(uScene, vUV).rgb;


      // start with ambient darkness
      float bright = 1.0 - clamp(uAmbient, 0.0, 1.0);

      // accumulate point lights (tight falloff)
      for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i >= uLightCount) break;
        vec2 L = uLightPos[i].xy - fragPx;
        float r = max(1.0, uLightPos[i].z);
        float d = length(L);

        // intensity: crisp core, quick falloff
        float core = smoothstep(r * 0.60, r, d);   // 0 center -> 1 edge
        float intensity = pow(1.0 - core, 2.0);

        base += uLightCol[i] * intensity * 0.20;   // subtle warm add
        bright += intensity * 0.85;
      }

      float k = clamp(bright, 0.0, 1.0);
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

  // Fullscreen quad (pos, uv)
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

  // Scene texture
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

  // Pre-allocated arrays
  const lpos = new Float32Array(MAX_LIGHTS * 3);
  const lcol = new Float32Array(MAX_LIGHTS * 3);

  function render(sceneCanvas, lights, ambient) {
    const w = glCanvas.width, h = glCanvas.height;

    // Upload scene bitmap to texture unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
// Upload scene bitmap to texture unit 0
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, sceneTex);

// Add this line (can be set once after context creation too):
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);

    // Fill light uniforms
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
    // Zero out the rest (keeps drivers happy)
    for (let i = n; i < MAX_LIGHTS; i++) {
      lpos[i*3 + 0] = lpos[i*3 + 1] = lpos[i*3 + 2] = 0;
      lcol[i*3 + 0] = lcol[i*3 + 1] = lcol[i*3 + 2] = 0;
    }

    gl.useProgram(prog);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uResLoc, w, h);
    gl.uniform1f(uAmbientLoc, ambient);
    gl.uniform1i(uLCntLoc, n);
    gl.uniform3fv(uLPosLoc, lpos);
    gl.uniform3fv(uLColLoc, lcol);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return { render, resize, MAX_LIGHTS };
}
