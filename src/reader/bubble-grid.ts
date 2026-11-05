/**
 * @file Finds the centre of every bubble on the card.
 *
 * Starting from each row's timing mark, the reader steps across the row and
 * snaps to each printed oval in turn. It then fits one tidy grid per section
 * through those positions, which irons out any oval it snapped to badly.
 */

import {
  BUBBLE_SPACING,
  FIRST_BUBBLE_OFFSET,
  ROWS_PER_SECTION,
  SECTION_COUNT,
  getBubbleCount,
} from "./card-layout.ts";
import { dot, normalize, perpendicular } from "./geometry.ts";
import type { Point, Vector } from "./geometry.ts";
import type { PreparedImage } from "./image-maps.ts";
import { solveLeastSquares } from "./statistics.ts";
import type { Triple } from "./statistics.ts";
import type { RowAnchor } from "./track-alignment.ts";

/** Times to re-centre on a bubble, so the search window settles on the oval. */
const RECENTRE_PASSES = 3;

/** Size of the search window around a predicted bubble, as shares of the bubble and mark spacing. */
const SEARCH_HALF_LENGTH_PER_BUBBLE_SPACING = 0.5;
const SEARCH_HALF_WIDTH_PER_MARK_SPACING = 0.32;

/** A traced bubble may sit at most this far off its predicted row, in mark spacings. */
const MAXIMUM_SIDEWAYS_DRIFT = 0.35;

/** How strongly each traced bubble updates the step to the next: along the row, and sideways. */
const STEP_ADJUSTMENT_ALONG = 0.5;
const STEP_ADJUSTMENT_ACROSS = 0.2;

/** In the ink centroid, printed colour counts this many times as much as darkness. */
const INK_WEIGHT = 2;

/** Background signal subtracted before weighting, so bare paper adds nothing. */
const CENTROID_NOISE_FLOOR = 0.06;

/** A search window needs at least this much total ink to count as finding a bubble. */
const MINIMUM_CENTROID_WEIGHT = 0.4;

/** Grid fitting: passes, and the distance (in mark spacings) beyond which a traced bubble is ignored. */
const GRID_FIT_PASSES = 3;
const GRID_OUTLIER_DISTANCE = 0.22;

/** Fewest traced bubbles a section needs for its own grid. */
const MINIMUM_GRID_POINTS = 12;

/** A fitted grid's bubble spacing must be within this range of the template's, or it is discarded. */
const MINIMUM_SPACING_RATIO = 0.75;
const MAXIMUM_SPACING_RATIO = 1.3;

/** The bubbles of one row. */
export interface RowBubbles {
  /** One per bubble, in order from 0. */
  centers: Point[];
  /**
   * Distance to the next bubble at each position, in pixels (the spacing
   * shrinks across a tilted photo).
   */
  bubbleSpacing: number[];
  /** Unit vector pointing along the row toward higher values. */
  alongRow: Vector;
  /** Unit vector perpendicular to the row. */
  acrossRow: Vector;
  /** The row's timing-mark spacing, in pixels. */
  markSpacing: number;
}

/**
 * The bubble layout fitted for one section.
 *
 * Every row in the section shares the same shape. A bubble's position is
 * measured from its row's timing mark:
 *
 *     offset(column) = acrossRow · acrossOffset + alongRow · (c0 + c1·column + c2·column²)
 *
 * The squared term absorbs perspective: bubbles get closer together across
 * the row when that side of the card is further from the camera.
 */
export interface SectionGrid {
  alongRow: Vector;
  acrossRow: Vector;
  acrossOffset: number;
  /** c0, c1 and c2 above. */
  alongCoefficients: Triple;
  /** True when tracing failed and the grid came straight from the template instead. */
  usedTemplate: boolean;
}

/** A traced bubble, as an offset from its row's timing mark. */
interface TracedPoint {
  column: number;
  markSpacing: number;
  offset: Vector;
}

/**
 * Finds every bubble on the card.
 *
 * @param acrossCard Unit vector from the timing marks toward the bubbles.
 */
export function locateBubbles(
  rowAnchors: RowAnchor[],
  acrossCard: Vector,
  image: PreparedImage,
): { rows: RowBubbles[]; grids: SectionGrid[] } {
  const traces = rowAnchors.map((anchor, rowIndex) =>
    traceRow(anchor, getBubbleCount(rowIndex), acrossCard, image),
  );

  const grids: SectionGrid[] = [];
  for (let sectionIndex = 0; sectionIndex < SECTION_COUNT; sectionIndex++) {
    const firstRow = sectionIndex * ROWS_PER_SECTION;
    const sectionRows = rowAnchors.slice(firstRow, firstRow + ROWS_PER_SECTION);
    const sectionTraces = traces.slice(firstRow, firstRow + ROWS_PER_SECTION);
    const markSpacing = sectionRows[0].markSpacing;

    const fitted = fitSectionGrid(sectionRows, sectionTraces);
    grids.push(
      fitted && hasPlausibleSpacing(fitted, markSpacing)
        ? fitted
        : createTemplateGrid(acrossCard, markSpacing),
    );
  }

  const rows = rowAnchors.map((anchor, rowIndex) =>
    placeRowBubbles(anchor, grids[anchor.sectionIndex], getBubbleCount(rowIndex)),
  );
  return { rows, grids };
}

/**
 * Follows a row of bubbles from its timing mark, snapping to each printed
 * oval in turn.
 *
 * Each step predicts where the next bubble is from the spacing so far, then
 * moves to the centre of the ink found there. That lets the trace follow a
 * row that is slightly tilted or squeezed by perspective.
 *
 * @returns Traced bubble centres.
 */
function traceRow(
  anchor: RowAnchor,
  bubbleCount: number,
  acrossCard: Vector,
  image: PreparedImage,
): Point[] {
  const { markSpacing } = anchor;
  const sidewaysLimit = MAXIMUM_SIDEWAYS_DRIFT * markSpacing;

  // Start from the template: the first bubble sits a fixed distance from the
  // mark. (Written out in full rather than with moveAlong(): the outlier step
  // in fitSectionGrid is sensitive enough that even the order of these
  // multiplications can move a bubble by a pixel. This order is the tested one.)
  let step: Vector = {
    x: acrossCard.x * markSpacing * BUBBLE_SPACING,
    y: acrossCard.y * markSpacing * BUBBLE_SPACING,
  };
  let predicted: Point = {
    x: anchor.x + acrossCard.x * markSpacing * FIRST_BUBBLE_OFFSET,
    y: anchor.y + acrossCard.y * markSpacing * FIRST_BUBBLE_OFFSET,
  };

  const traced: Point[] = [];
  let previous: Point | null = null;

  for (let column = 0; column < bubbleCount; column++) {
    const stepLength = Math.hypot(step.x, step.y);
    const alongRow = normalize(step);
    const acrossRow = perpendicular(alongRow);

    // Snap to the ink near the prediction, re-centring a few times.
    let found = predicted;
    for (let pass = 0; pass < RECENTRE_PASSES; pass++) {
      const centroid = findInkCentroid(
        image,
        found,
        alongRow,
        acrossRow,
        SEARCH_HALF_LENGTH_PER_BUBBLE_SPACING * stepLength,
        SEARCH_HALF_WIDTH_PER_MARK_SPACING * markSpacing,
      );
      if (!centroid) {
        break;
      }
      found = centroid;
    }

    // Don't let the trace wander onto the neighbouring row.
    const sideways = dot({ x: found.x - predicted.x, y: found.y - predicted.y }, acrossRow);
    if (Math.abs(sideways) > sidewaysLimit) {
      const excess = (Math.abs(sideways) - sidewaysLimit) * Math.sign(sideways);
      found = { x: found.x - acrossRow.x * excess, y: found.y - acrossRow.y * excess };
    }
    traced.push(found);

    // Learn from the step just taken: follow spacing changes readily, but
    // steer sideways only gently so one smudge can't pull the row off course.
    if (previous) {
      const surprise = { x: found.x - previous.x - step.x, y: found.y - previous.y - step.y };
      const surpriseAlong = dot(surprise, alongRow);
      const surpriseAcross = dot(surprise, acrossRow);
      step = {
        x:
          step.x +
          STEP_ADJUSTMENT_ALONG * surpriseAlong * alongRow.x +
          STEP_ADJUSTMENT_ACROSS * surpriseAcross * acrossRow.x,
        y:
          step.y +
          STEP_ADJUSTMENT_ALONG * surpriseAlong * alongRow.y +
          STEP_ADJUSTMENT_ACROSS * surpriseAcross * acrossRow.y,
      };
    }
    previous = found;
    predicted = { x: found.x + step.x, y: found.y + step.y };
  }
  return traced;
}

/**
 * Finds the centre of the ink inside a rectangular window. Bubble outlines
 * and digits are printed ink; the gaps between bubbles are bare paper, so
 * the centre of the ink is the centre of the bubble.
 *
 * @param center Centre of the window.
 * @param halfLength Half the window's length along the row, in pixels.
 * @param halfWidth Half the window's width across the row, in pixels.
 * @returns Null when the window holds almost no ink.
 */
function findInkCentroid(
  image: PreparedImage,
  center: Point,
  alongRow: Vector,
  acrossRow: Vector,
  halfLength: number,
  halfWidth: number,
): Point | null {
  // Sample a 13 × 7 grid of points across the window.
  const alongSteps = 6;
  const acrossSteps = 3;
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let alongIndex = -alongSteps; alongIndex <= alongSteps; alongIndex++) {
    for (let acrossIndex = -acrossSteps; acrossIndex <= acrossSteps; acrossIndex++) {
      const along = (alongIndex / alongSteps) * halfLength;
      const across = (acrossIndex / acrossSteps) * halfWidth;
      const x = center.x + alongRow.x * along + acrossRow.x * across;
      const y = center.y + alongRow.y * along + acrossRow.y * across;

      const weight =
        image.ink.sample(x, y) * INK_WEIGHT + image.darkness.sample(x, y) - CENTROID_NOISE_FLOOR;
      if (weight <= 0) {
        continue;
      }
      totalWeight += weight;
      weightedX += weight * x;
      weightedY += weight * y;
    }
  }
  return totalWeight > MINIMUM_CENTROID_WEIGHT
    ? { x: weightedX / totalWeight, y: weightedY / totalWeight }
    : null;
}

/**
 * Fits one grid through the traced bubbles of a section's five rows,
 * ignoring bubbles that sit far from the fit.
 *
 * @returns Null when too few bubbles were traced.
 */
function fitSectionGrid(sectionRows: RowAnchor[], sectionTraces: Point[][]): SectionGrid | null {
  // Every traced bubble, as an offset from its row's timing mark.
  const points: TracedPoint[] = [];
  for (let row = 0; row < sectionRows.length; row++) {
    const anchor = sectionRows[row];
    sectionTraces[row].forEach((bubble, column) => {
      points.push({
        column,
        markSpacing: anchor.markSpacing,
        offset: { x: bubble.x - anchor.x, y: bubble.y - anchor.y },
      });
    });
  }

  let isInlier: boolean[] | null = null;
  let grid: SectionGrid | null = null;

  for (let pass = 0; pass < GRID_FIT_PASSES; pass++) {
    const inliers: boolean[] | null = isInlier;
    const usable = points.filter((_, index) => !inliers || inliers[index]);
    if (usable.length < MINIMUM_GRID_POINTS) {
      return null;
    }

    // Direction of the rows: a straight-line fit of offset against column.
    let count = 0;
    let sumColumn = 0;
    let sumColumnSquared = 0;
    let sumX = 0;
    let sumY = 0;
    let sumColumnX = 0;
    let sumColumnY = 0;
    for (const { column, offset } of usable) {
      count++;
      sumColumn += column;
      sumColumnSquared += column * column;
      sumX += offset.x;
      sumY += offset.y;
      sumColumnX += column * offset.x;
      sumColumnY += column * offset.y;
    }
    const denominator = count * sumColumnSquared - sumColumn * sumColumn;
    const alongRow = normalize({
      x: (count * sumColumnX - sumColumn * sumX) / denominator,
      y: (count * sumColumnY - sumColumn * sumY) / denominator,
    });
    const acrossRow = perpendicular(alongRow);

    // How far the rows sit off their marks' line: one value for the section.
    let acrossOffset = 0;
    for (const { offset } of usable) {
      acrossOffset += dot(offset, acrossRow);
    }
    acrossOffset /= usable.length;

    // Position along the row: a quadratic in the column number.
    const alongCoefficients = solveLeastSquares(
      usable.map(({ column, offset }) => ({
        basis: [1, column, column * column],
        target: dot(offset, alongRow),
      })),
    );
    if (!alongCoefficients) {
      return null;
    }

    const currentGrid: SectionGrid = {
      alongRow,
      acrossRow,
      acrossOffset,
      alongCoefficients,
      usedTemplate: false,
    };
    grid = currentGrid;
    isInlier = points.map(({ column, markSpacing, offset }) => {
      const expected = getBubbleOffset(currentGrid, column);
      const distance = Math.hypot(offset.x - expected.x, offset.y - expected.y);
      return distance < GRID_OUTLIER_DISTANCE * markSpacing;
    });
  }
  return grid;
}

/**
 * Checks that a fitted grid's bubble spacing is close to the template's at
 * both ends of the row. A grid that fails this has latched onto the wrong
 * features.
 */
function hasPlausibleSpacing(grid: SectionGrid, markSpacing: number): boolean {
  const templateSpacing = markSpacing * BUBBLE_SPACING;
  const isPlausible = (column: number): boolean => {
    const ratio = getSpacingBetween(grid, column) / templateSpacing;
    return ratio > MINIMUM_SPACING_RATIO && ratio < MAXIMUM_SPACING_RATIO;
  };
  return isPlausible(0) && isPlausible(9);
}

/**
 * Builds a grid straight from the template, for a section whose bubbles
 * couldn't be traced.
 */
function createTemplateGrid(acrossCard: Vector, markSpacing: number): SectionGrid {
  return {
    alongRow: acrossCard,
    acrossRow: perpendicular(acrossCard),
    acrossOffset: 0,
    alongCoefficients: [markSpacing * FIRST_BUBBLE_OFFSET, markSpacing * BUBBLE_SPACING, 0],
    usedTemplate: true,
  };
}

/**
 * Returns where a bubble sits relative to its row's timing mark.
 *
 * @param column Bubble number, from 0.
 */
function getBubbleOffset(grid: SectionGrid, column: number): Vector {
  const [c0, c1, c2] = grid.alongCoefficients;
  const along = c0 + c1 * column + c2 * column * column;
  return {
    x: grid.acrossRow.x * grid.acrossOffset + grid.alongRow.x * along,
    y: grid.acrossRow.y * grid.acrossOffset + grid.alongRow.y * along,
  };
}

/**
 * Returns the distance from one bubble to the next, in pixels.
 *
 * @param column Bubble number, from 0.
 */
function getSpacingBetween(grid: SectionGrid, column: number): number {
  const [, c1, c2] = grid.alongCoefficients;
  return c1 + (2 * column + 1) * c2;
}

/**
 * Returns the local bubble spacing at a bubble (the slope of the fitted
 * curve), in pixels.
 *
 * @param column Bubble number, from 0.
 */
function getSpacingAt(grid: SectionGrid, column: number): number {
  const [, c1, c2] = grid.alongCoefficients;
  return c1 + 2 * column * c2;
}

/** Places a row's bubbles using its section's grid. */
function placeRowBubbles(anchor: RowAnchor, grid: SectionGrid, bubbleCount: number): RowBubbles {
  const centers: Point[] = [];
  const bubbleSpacing: number[] = [];
  for (let column = 0; column < bubbleCount; column++) {
    const offset = getBubbleOffset(grid, column);
    centers.push({ x: anchor.x + offset.x, y: anchor.y + offset.y });
    bubbleSpacing.push(getSpacingAt(grid, column));
  }
  return {
    centers,
    bubbleSpacing,
    alongRow: grid.alongRow,
    acrossRow: grid.acrossRow,
    markSpacing: anchor.markSpacing,
  };
}
