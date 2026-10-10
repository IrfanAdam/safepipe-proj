/* Shared WebGL shader-precision probe (src/glprecision.js).
 * Safari on some GPUs returns null from getShaderPrecisionFormat() for
 * valid enums. three.js dereferences the result unguarded
 * (getMaxPrecision: `....precision > 0`) and dies at renderer creation —
 * the whole tab goes black with one TypeError. Probe here with guards and
 * hand three an explicit `precision` so it never queries blind.
 * Returns 'highp' | 'mediump' | 'lowp'. Never throws.
 */
export function pickGLPrecision() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'lowp';
    const q = (shader, type) => {
      try {
        return gl.getShaderPrecisionFormat(shader, type)?.precision ?? 0;
      } catch {
        return 0;
      }
    };
    const hi =
      q(gl.VERTEX_SHADER, gl.HIGH_FLOAT) > 0 &&
      q(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) > 0;
    const med =
      q(gl.VERTEX_SHADER, gl.MEDIUM_FLOAT) > 0 &&
      q(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT) > 0;
    // Release the probe context: Safari caps live contexts per page and
    // every tab here already owns several.
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* release is best-effort */
    }
    if (hi) return 'highp';
    if (med) return 'mediump';
    return 'lowp';
  } catch {
    return 'lowp';
  }
}
