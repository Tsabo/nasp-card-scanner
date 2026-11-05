/**
 * @file Finds every small, solid, dark rectangle in the photo. The card's
 * black timing marks are among them, along with assorted noise (letters,
 * pencil strokes, edges) that later steps filter out.
 */

import type { ImageMap } from "./image-maps.ts";

/** Darkness (0 to 255) a pixel needs to count as part of a timing mark. */
const MARK_DARKNESS_THRESHOLD = 125;

/** Smallest blob, in pixels, that could be a timing mark. */
const MINIMUM_MARK_AREA = 6;

/** Smallest blob thickness, in pixels. */
const MINIMUM_MARK_THICKNESS = 2;

/** Allowed length-to-thickness ratio. Timing marks are short bars, about 3:1. */
const MINIMUM_ASPECT_RATIO = 1.5;
const MAXIMUM_ASPECT_RATIO = 6;

/** Share of its bounding box a blob must fill; timing marks are solid. */
const MINIMUM_FILL_RATIO = 0.6;

/** Longest a mark may be, as a share of the photo's larger side. */
const MAXIMUM_LENGTH_RATIO = 0.06;

/** Keep only this many of the largest candidates, to bound later work. */
const MAXIMUM_CANDIDATES = 700;

/** A blob that might be a timing mark. */
export interface MarkCandidate {
  /** Centre, in pixels. */
  x: number;
  /** Centre, in pixels. */
  y: number;
  /** Bounding-box width, in pixels. */
  width: number;
  /** Bounding-box height, in pixels. */
  height: number;
  /** Pixel count. */
  area: number;
  /** True when the blob is wider than it is tall. */
  isHorizontal: boolean;
}

/**
 * Finds solid dark bars the size and shape of timing marks.
 *
 * Groups neighbouring dark pixels into blobs (connected-component labelling
 * with a flood fill), then keeps blobs with the right size and shape.
 */
export function findMarkCandidates(darkness: ImageMap): MarkCandidate[] {
  const { width, height, values } = darkness;
  const pixelCount = width * height;
  const isDark = (pixel: number): boolean => values[pixel] >= MARK_DARKNESS_THRESHOLD;

  // blobNumber[pixel] is 0 until the pixel has been assigned to a blob.
  const blobNumber = new Int32Array(pixelCount);
  const pixelsToVisit = new Int32Array(pixelCount);
  let blobCount = 0;

  const candidates: MarkCandidate[] = [];

  for (let startPixel = 0; startPixel < pixelCount; startPixel++) {
    if (!isDark(startPixel) || blobNumber[startPixel] !== 0) {
      continue;
    }

    // Flood-fill a new blob from this pixel, measuring it as we go.
    blobCount++;
    let stackSize = 0;
    pixelsToVisit[stackSize++] = startPixel;
    blobNumber[startPixel] = blobCount;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minimumX = width;
    let maximumX = 0;
    let minimumY = height;
    let maximumY = 0;

    /** Adds a neighbouring pixel to the blob if it is dark and unclaimed. */
    const visitIfDark = (neighbour: number): void => {
      if (blobNumber[neighbour] === 0 && isDark(neighbour)) {
        blobNumber[neighbour] = blobCount;
        pixelsToVisit[stackSize++] = neighbour;
      }
    };

    while (stackSize > 0) {
      const pixel = pixelsToVisit[--stackSize];
      const x = pixel % width;
      const y = Math.floor(pixel / width);

      area++;
      sumX += x;
      sumY += y;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);

      if (x > 0) visitIfDark(pixel - 1);
      if (x < width - 1) visitIfDark(pixel + 1);
      if (y > 0) visitIfDark(pixel - width);
      if (y < height - 1) visitIfDark(pixel + width);
    }

    const blobWidth = maximumX - minimumX + 1;
    const blobHeight = maximumY - minimumY + 1;
    const thickness = Math.min(blobWidth, blobHeight);
    const length = Math.max(blobWidth, blobHeight);
    const aspectRatio = length / thickness;

    const looksLikeMark =
      area >= MINIMUM_MARK_AREA &&
      thickness >= MINIMUM_MARK_THICKNESS &&
      aspectRatio >= MINIMUM_ASPECT_RATIO &&
      aspectRatio <= MAXIMUM_ASPECT_RATIO &&
      area / (blobWidth * blobHeight) >= MINIMUM_FILL_RATIO &&
      length <= Math.max(width, height) * MAXIMUM_LENGTH_RATIO;

    if (looksLikeMark) {
      candidates.push({
        x: sumX / area,
        y: sumY / area,
        width: blobWidth,
        height: blobHeight,
        area,
        isHorizontal: blobWidth >= blobHeight,
      });
    }
  }

  if (candidates.length > MAXIMUM_CANDIDATES) {
    candidates.sort((first, second) => second.area - first.area);
    candidates.length = MAXIMUM_CANDIDATES;
  }
  return candidates;
}
