/**
 * @file Turns a colour photo into the two greyscale maps the reader works
 * from, with lighting and paper colour removed:
 *
 * - **Darkness**: how much darker each pixel is than the paper around it.
 *   Pencil marks and the black timing marks are dark; paper is near zero.
 *   Printed coloured ink (the bubble outlines) is mostly ignored, because the
 *   brightest colour channel stays high for green, red and blue ink alike.
 *
 * - **Ink**: how colourful each pixel is compared with the paper. The
 *   printed bubble outlines and digits stand out; pencil, paper and black
 *   marks are near zero. Used to find where the printed rows actually are.
 */

/** Side length, in pixels, of the blocks used to estimate paper brightness. */
const PAPER_BLOCK_SIZE = 32;

/** Within each block, this fraction of pixels is assumed to be darker than bare paper. */
const PAPER_BRIGHTNESS_PERCENTILE = 0.9;

/** Lowest paper brightness allowed, so very dark backgrounds don't divide by zero. */
const MINIMUM_PAPER_BRIGHTNESS = 50;

/** Pixels below this darkness (0 to 255) count as bare paper when measuring paper tint. */
const PAPER_DARKNESS_LIMIT = 20;

/** Share of paper pixels whose colourfulness is treated as paper tint. */
const PAPER_TINT_PERCENTILE = 0.6;

/** Extra colourfulness, beyond the paper's tint, removed as noise. */
const PAPER_TINT_MARGIN = 6;

/** A single-channel image holding values from 0 to 255. */
export class ImageMap {
  readonly width: number;
  readonly height: number;
  /** One value per pixel, row by row. */
  readonly values: Uint8Array;

  constructor(width: number, height: number, values: Uint8Array = new Uint8Array(width * height)) {
    this.width = width;
    this.height = height;
    this.values = values;
  }

  /**
   * Reads the map at a sub-pixel position, blending the four surrounding
   * pixels (bilinear interpolation).
   *
   * @returns The value scaled to 0..1, or 0 outside the image.
   */
  sample(x: number, y: number): number {
    const { width, height, values } = this;
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
      return 0;
    }
    const left = Math.floor(x);
    const top = Math.floor(y);
    const rightWeight = x - left;
    const bottomWeight = y - top;
    const topLeft = top * width + left;

    const topRow = values[topLeft] * (1 - rightWeight) + values[topLeft + 1] * rightWeight;
    const bottomRow =
      values[topLeft + width] * (1 - rightWeight) + values[topLeft + width + 1] * rightWeight;
    return (topRow * (1 - bottomWeight) + bottomRow * bottomWeight) / 255;
  }
}

/** The prepared maps for one photo. */
export interface PreparedImage {
  width: number;
  height: number;
  /** How much darker than the local paper each pixel is. */
  darkness: ImageMap;
  /** How much more colourful than the paper each pixel is. */
  ink: ImageMap;
}

/**
 * Builds the darkness and ink maps for a photo.
 *
 * @param rgba Pixels as red, green, blue, alpha bytes, row by row (the
 *   layout of `ImageData.data`).
 */
export function prepareImage(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): PreparedImage {
  const { brightness, colourfulness } = splitBrightnessAndColour(rgba, width * height);
  const paper = estimatePaperBrightness(brightness, width, height);
  const darkness = measureDarkness(brightness, paper, width, height);
  removePaperTint(colourfulness, darkness);
  return {
    width,
    height,
    darkness: new ImageMap(width, height, darkness),
    ink: new ImageMap(width, height, colourfulness),
  };
}

/**
 * For every pixel, records its brightest channel and its colourfulness
 * (brightest channel minus darkest channel).
 *
 * Using the brightest channel as "brightness" makes printed coloured ink
 * look almost as light as paper, while pencil and black stay dark.
 */
function splitBrightnessAndColour(
  rgba: ArrayLike<number>,
  pixelCount: number,
): { brightness: Uint8Array; colourfulness: Uint8Array } {
  const brightness = new Uint8Array(pixelCount);
  const colourfulness = new Uint8Array(pixelCount);
  for (let pixel = 0, byte = 0; pixel < pixelCount; pixel++, byte += 4) {
    const red = rgba[byte];
    const green = rgba[byte + 1];
    const blue = rgba[byte + 2];
    const brightest = Math.max(red, green, blue);
    const dimmest = Math.min(red, green, blue);
    brightness[pixel] = brightest;
    colourfulness[pixel] = brightest - dimmest;
  }
  return { brightness, colourfulness };
}

/** A coarse grid of paper-brightness estimates covering the photo. */
interface PaperBrightnessGrid {
  /** Blocks across. */
  columns: number;
  /** Blocks down. */
  rows: number;
  /** One estimate per block, row by row. */
  values: Float32Array;
}

/**
 * Estimates how bright bare paper is across the photo, so shadows and uneven
 * light can be removed.
 *
 * The photo is split into blocks. In each block, bare paper is taken to be
 * the 90th-percentile brightness (most of a card is paper). Each block then
 * takes the brightest estimate among itself and its neighbours, so a block
 * that is mostly pencil or timing mark still finds real paper nearby.
 */
function estimatePaperBrightness(
  brightness: Uint8Array,
  width: number,
  height: number,
): PaperBrightnessGrid {
  const columns = Math.ceil(width / PAPER_BLOCK_SIZE);
  const rows = Math.ceil(height / PAPER_BLOCK_SIZE);

  // Percentile brightness of each block. Every second pixel is enough.
  const blockEstimates = new Float32Array(columns * rows);
  const histogram = new Uint32Array(256);
  for (let blockRow = 0; blockRow < rows; blockRow++) {
    for (let blockColumn = 0; blockColumn < columns; blockColumn++) {
      histogram.fill(0);
      let sampleCount = 0;
      const left = blockColumn * PAPER_BLOCK_SIZE;
      const top = blockRow * PAPER_BLOCK_SIZE;
      const right = Math.min(width, left + PAPER_BLOCK_SIZE);
      const bottom = Math.min(height, top + PAPER_BLOCK_SIZE);
      for (let y = top; y < bottom; y += 2) {
        for (let x = left; x < right; x += 2) {
          histogram[brightness[y * width + x]]++;
          sampleCount++;
        }
      }
      blockEstimates[blockRow * columns + blockColumn] = findPercentile(
        histogram,
        sampleCount * PAPER_BRIGHTNESS_PERCENTILE,
      );
    }
  }

  // Take the brightest estimate in each 3×3 neighbourhood of blocks.
  const values = new Float32Array(columns * rows);
  for (let blockRow = 0; blockRow < rows; blockRow++) {
    for (let blockColumn = 0; blockColumn < columns; blockColumn++) {
      let brightest = 0;
      for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
          const neighbourRow = blockRow + rowOffset;
          const neighbourColumn = blockColumn + columnOffset;
          const isInside =
            neighbourRow >= 0 &&
            neighbourRow < rows &&
            neighbourColumn >= 0 &&
            neighbourColumn < columns;
          if (isInside) {
            brightest = Math.max(
              brightest,
              blockEstimates[neighbourRow * columns + neighbourColumn],
            );
          }
        }
      }
      values[blockRow * columns + blockColumn] = Math.max(brightest, MINIMUM_PAPER_BRIGHTNESS);
    }
  }
  return { columns, rows, values };
}

/**
 * Returns the smallest value whose cumulative count in a histogram reaches
 * `targetCount`.
 *
 * @param histogram Counts for values 0..255.
 */
function findPercentile(histogram: Uint32Array, targetCount: number): number {
  let runningCount = 0;
  let value = 0;
  for (; value < 256; value++) {
    runningCount += histogram[value];
    if (runningCount >= targetCount) {
      break;
    }
  }
  return value;
}

/**
 * Measures how much darker each pixel is than the paper around it.
 *
 * @returns 0 for paper-white up to 255 for black.
 */
function measureDarkness(
  brightness: Uint8Array,
  paper: PaperBrightnessGrid,
  width: number,
  height: number,
): Uint8Array {
  const darkness = new Uint8Array(width * height);
  const block = (row: number, column: number): number => paper.values[row * paper.columns + column];

  for (let y = 0; y < height; y++) {
    // Position of this pixel row on the block grid, measured between block centres.
    const gridY = clamp((y + 0.5) / PAPER_BLOCK_SIZE - 0.5, 0, paper.rows - 1);
    const topBlock = Math.floor(gridY);
    const bottomBlock = Math.min(paper.rows - 1, topBlock + 1);
    const bottomWeight = gridY - topBlock;

    for (let x = 0; x < width; x++) {
      const gridX = clamp((x + 0.5) / PAPER_BLOCK_SIZE - 0.5, 0, paper.columns - 1);
      const leftBlock = Math.floor(gridX);
      const rightBlock = Math.min(paper.columns - 1, leftBlock + 1);
      const rightWeight = gridX - leftBlock;

      // Blend the four nearest block estimates.
      const paperBrightness =
        (block(topBlock, leftBlock) * (1 - rightWeight) +
          block(topBlock, rightBlock) * rightWeight) *
          (1 - bottomWeight) +
        (block(bottomBlock, leftBlock) * (1 - rightWeight) +
          block(bottomBlock, rightBlock) * rightWeight) *
          bottomWeight;

      const relativeDarkness = clamp(1 - brightness[y * width + x] / paperBrightness, 0, 1);
      // Storing into a Uint8Array drops the fraction.
      darkness[y * width + x] = relativeDarkness * 255;
    }
  }
  return darkness;
}

/**
 * Removes the paper's own colour cast from the colourfulness map, in place.
 *
 * Warm indoor light makes white paper look slightly orange, which would
 * otherwise read as faint ink everywhere. The typical colourfulness of bare
 * paper (pixels that are not dark) is subtracted from every pixel.
 */
function removePaperTint(colourfulness: Uint8Array, darkness: Uint8Array): void {
  const histogram = new Uint32Array(256);
  let paperSampleCount = 0;
  // Every seventh pixel gives a large enough sample.
  for (let pixel = 0; pixel < darkness.length; pixel += 7) {
    if (darkness[pixel] < PAPER_DARKNESS_LIMIT) {
      histogram[colourfulness[pixel]]++;
      paperSampleCount++;
    }
  }

  let runningCount = 0;
  let paperTint = 0;
  for (; paperTint < 255; paperTint++) {
    runningCount += histogram[paperTint];
    if (runningCount >= paperSampleCount * PAPER_TINT_PERCENTILE) {
      break;
    }
  }

  const offset = paperTint + PAPER_TINT_MARGIN;
  for (let pixel = 0; pixel < colourfulness.length; pixel++) {
    colourfulness[pixel] = Math.max(0, colourfulness[pixel] - offset);
  }
}

/** Limits a value to a range. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
