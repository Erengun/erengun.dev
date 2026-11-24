/** software rasterisers (no usable GPU, or a blocklisted driver): a few frames a second at best */
export const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;

let name: string | undefined;
/** the GPU's name as WebGL reports it ('' when there is no WebGL); asked once, on a throwaway context */
export function probeGpu(): string {
  if (name !== undefined) return name;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return (name = '');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    name = '';
  }
  return name;
}
