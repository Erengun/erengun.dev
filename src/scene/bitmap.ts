/**
 * Image textures as ImageBitmaps.
 *
 * Uploading an <img> to a texture converts it on the main thread at the moment of the upload (flip, alpha,
 * colour space): 45–75 ms for a 2016×1200 slide on a phone-class CPU, once per slide, while the journey is on
 * screen. An ImageBitmap decoded from the file's bytes already has the layout the GPU wants, so the upload is a
 * plain copy: measured ~10× faster in Chromium and Firefox. WebKit shows no gain (its bitmap uploads cost as much
 * as its <img> uploads), so Safari keeps the <img> path.
 *
 * The bitmap is flipped at decode time (WebGL ignores UNPACK_FLIP_Y for ImageBitmaps), so textures made from it
 * must have flipY = false.
 */
export const BITMAP_TEXTURES =
  typeof createImageBitmap === 'function' &&
  typeof fetch === 'function' &&
  !/^((?!chrome|chromium|android|firefox).)*safari/i.test(navigator.userAgent);

/** the image's bytes; a later <img> or fetch of the same URL is served from the HTTP cache */
export async function fetchBlob(url: string): Promise<Blob> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.blob();
}

/** decoded off the main thread, ready to upload as-is; use with texture.flipY = false */
export function textureBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
