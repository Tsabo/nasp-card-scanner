/**
 * @file Opens photo files and scales them for the reader.
 */

/**
 * Photos are scaled down so their longer side is at most this many pixels.
 * The reader needs about 1000 pixels; more only makes it slower.
 */
const MAXIMUM_PHOTO_SIDE = 2000;

/** File extensions accepted when the browser doesn't report a file type. */
const IMAGE_FILE_EXTENSIONS = /\.(jpe?g|png|heic|heif|webp)$/i;

/** A photo the browser has decoded and can draw. */
export type DecodedImage = ImageBitmap | HTMLImageElement;

/** Tells whether a file looks like a photo. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_FILE_EXTENSIONS.test(file.name);
}

/**
 * Decodes a photo file, applying the rotation recorded by the camera so the
 * picture is the right way up.
 *
 * @throws When the browser can't decode the file.
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older browsers lack createImageBitmap options; fall back to an <img>.
    return loadImageFromUrl(URL.createObjectURL(file));
  }
}

/** Loads an image from a URL. */
export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Couldn't load the image at ${url}.`));
    image.src = url;
  });
}

/** Draws an image onto a new canvas, scaled down if it is very large. */
export function drawScaledCopy(image: DecodedImage): HTMLCanvasElement {
  const scale = Math.min(1, MAXIMUM_PHOTO_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("This browser can't draw images.");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
