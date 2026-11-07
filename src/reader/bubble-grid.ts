/**
 * @file Finds the center of every bubble on the card.
 *
 * A flat card in a photo follows one perspective transform (a homography), so
 * the whole grid of bubbles can be described by a few numbers rather than
 * traced bubble by bubble. The timing marks already fix the transform along
 * the card's edge. That leaves three unknowns for the direction across the
 * card:
 *
 *     image(X, Y) = mark(Y) + (X / TEMPLATE_MIDPOINT) · Q     (homogeneous coordinates)
 *
 * where X and Y are template positions and Q holds the unknowns: the angle of
 * the rows, the bubble scale, and how much the card recedes sideways.
 *
 * The reader searches those three numbers for the placement that puts the
 * most printed ink where bubbles should be and the least where the paper
 * between them should be, working from a blurred copy of the photo to the
 * sharp one. Every bubble on the card votes, so a thumb, a smudge or pencil
 * notes can't drag the grid off course. Each section then gets a small nudge
 * of its own, for a card that isn't perfectly flat.
 */

import {
  BUBBLE_SPACING,
  FIRST_BUBBLE_OFFSET,
  ROW_COUNT,
  ROWS_PER_SECTION,
  SECTION_COUNT,
  TEMPLATE_MARK_PITCH,
  TEMPLATE_MIDPOINT,
  TIMING_MARK_POSITIONS,
  getBubbleCount,
  getTimingMarkIndex,
} from "./card-layout.ts";
import { dot, normalize, perpendicular } from "./geometry.ts";
import type { Point, Vector } from "./geometry.ts";
import type { PreparedImage } from "./image-maps.ts";
import type { HomogeneousPoint, TrackAlignment } from "./track-alignment.ts";

/** In the search signal, printed color counts this many times as much as darkness. */
const INK_WEIGHT = 2;

/** Mark spacing, in pixels, of the blurred copies the search runs on: coarse, then medium. */
const COARSE_MARK_SPACING = 10;
const MEDIUM_MARK_SPACING = 20;

/** Largest angle, in degrees, of the rows away from square with the track. */
const MAXIMUM_ROW_ANGLE = 10;

/** Range of the bubble scale, compared with the scale the marks suggest. */
const MINIMUM_SCALE_RATIO = 0.75;
const MAXIMUM_SCALE_RATIO = 1.3;

/** Largest sideways foreshortening: the change in scale per template midpoint of X. */
const MAXIMUM_RECEDE = 0.3;

/**
 * Grid steps of the coarse search. Each is small enough that the worst-placed
 * bubble moves about a fifth of a row or bubble spacing between grid points,
 * which the blurred signal still registers.
 */
const ROW_ANGLE_STEP = 0.6;
const SCALE_STEP = 0.015;
const RECEDE_STEP = 0.05;

/** How many of the coarse search's best placements are refined. */
const PLACEMENTS_TO_REFINE = 6;

/** Times the refinement step is halved at each level of detail. */
const REFINEMENT_ROUNDS = 5;

/** Half the size of a printed oval, in template pixels. */
const OVAL_HALF_LENGTH = 21;
const OVAL_HALF_HEIGHT = 11;

/** Points sampled around each printed oval. */
const OVAL_OUTLINE_POINTS = 8;

/** How far above and below a bubble's center the bare paper is, in template pixels. */
const PAPER_OFFSET_ACROSS_ROW = 15;

/** Largest nudge given to one section, as shares of the bubble and row spacing. */
const NUDGE_LIMIT_ALONG = 0.25;
const NUDGE_LIMIT_ACROSS = 0.3;

/** Largest change in a section's bubble spacing during its nudge, as a share. */
const NUDGE_LIMIT_STRETCH = 0.02;

/** Candidate values tried either side of zero for each part of a nudge. */
const NUDGE_STEPS = 4;
const STRETCH_STEPS = 2;

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
  /** Distance between neighboring rows here, in pixels. */
  markSpacing: number;
}

/** The result of placing the bubble grid on a photo. */
export interface BubbleLayout {
  /** One per row, 35 in all, in card order. */
  rows: RowBubbles[];
  /**
   * How much more ink sits on the bubbles than between them. Printed outlines
   * never cover every sample, so real cards score well below 1; near zero
   * means the grid isn't on a card's bubbles at all.
   */
  fitScore: number;
}

/** The three unknowns of the card's perspective transform. */
interface CardPlacement {
  /** Angle of the rows away from square with the track, in degrees. */
  rowAngle: number;
  /** Bubble scale, compared with what the marks suggest. */
  scaleRatio: number;
  /** Sideways foreshortening. */
  recede: number;
}

/** A blurred copy of the search signal. */
class SignalLevel {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
  /** Photo pixels per pixel of this copy. */
  readonly shrink: number;

  constructor(width: number, height: number, values: Float32Array, shrink: number) {
    this.width = width;
    this.height = height;
    this.values = values;
    this.shrink = shrink;
  }

  /** Reads the signal at a photo position, blending the four nearest pixels; 0 outside. */
  sample(photoX: number, photoY: number): number {
    const x = (photoX + 0.5) / this.shrink - 0.5;
    const y = (photoY + 0.5) / this.shrink - 0.5;
    if (!(x >= 0 && y >= 0 && x < this.width - 1 && y < this.height - 1)) {
      return 0;
    }
    const left = x | 0;
    const top = y | 0;
    const rightWeight = x - left;
    const bottomWeight = y - top;
    const index = top * this.width + left;
    const { values, width } = this;
    return (
      (values[index] * (1 - rightWeight) + values[index + 1] * rightWeight) * (1 - bottomWeight) +
      (values[index + width] * (1 - rightWeight) + values[index + width + 1] * rightWeight) *
        bottomWeight
    );
  }
}

/**
 * A list of points on the card, each with a weight: positive where printed
 * ink belongs and negative where bare paper belongs. Stored in flat arrays
 * because the search scores thousands of placements.
 */
class ProbeSet {
  /** The point's X position, as a share of the template midpoint. */
  readonly across: Float64Array;
  /** The point's mark on the track, in homogeneous coordinates. */
  readonly markX: Float64Array;
  readonly markY: Float64Array;
  readonly markW: Float64Array;
  readonly weights: Float64Array;
  /** Weights are scaled so a perfect score is 1 for this many bubbles. */
  readonly bubbleCount: number;

  constructor(probes: readonly Probe[], bubbleCount: number) {
    this.across = Float64Array.from(probes, (probe) => probe.across);
    this.markX = Float64Array.from(probes, (probe) => probe.mark.x);
    this.markY = Float64Array.from(probes, (probe) => probe.mark.y);
    this.markW = Float64Array.from(probes, (probe) => probe.mark.w);
    this.weights = Float64Array.from(probes, (probe) => probe.weight);
    this.bubbleCount = bubbleCount;
  }
}

/** One point of a {@link ProbeSet}. */
interface Probe {
  across: number;
  mark: HomogeneousPoint;
  weight: number;
}

/**
 * Places the bubble grid on the photo.
 *
 * @param alignment Where the timing marks are.
 */
export function locateBubbles(alignment: TrackAlignment, image: PreparedImage): BubbleLayout {
  const markSpacing = measureMiddleMarkSpacing(alignment);
  const fullSignal = buildSignal(image);
  const coarse = shrinkSignal(fullSignal, Math.round(markSpacing / COARSE_MARK_SPACING));
  const medium = shrinkSignal(fullSignal, Math.round(markSpacing / MEDIUM_MARK_SPACING));

  const allRows = createRange(0, ROW_COUNT);
  const coarseProbes = buildProbes(alignment, allRows, false);
  const detailedProbes = buildProbes(alignment, allRows, true);
  const context: SearchContext = { alignment, markSpacing };

  const starts = searchPlacements(context, coarse, coarseProbes);
  let best: CardPlacement = starts[0];
  let bestScore = -Infinity;
  for (const start of starts) {
    const onCoarse = refinePlacement(context, start, coarse, coarseProbes, 1);
    const onMedium = refinePlacement(context, onCoarse, medium, detailedProbes, 0.5);
    const placement = refinePlacement(context, onMedium, fullSignal, detailedProbes, 0.25);
    const score = scorePlacement(context, placement, fullSignal, detailedProbes);
    if (score > bestScore) {
      bestScore = score;
      best = placement;
    }
  }

  const rows: RowBubbles[] = [];
  for (let sectionIndex = 0; sectionIndex < SECTION_COUNT; sectionIndex++) {
    const firstRow = sectionIndex * ROWS_PER_SECTION;
    const sectionRows = createRange(firstRow, firstRow + ROWS_PER_SECTION);
    rows.push(...placeSection(context, best, sectionRows, fullSignal));
  }

  return { rows, fitScore: Math.max(0, bestScore) };
}

/** What every placement in a search has in common. */
interface SearchContext {
  alignment: TrackAlignment;
  /** Distance between rows at the middle of the card, in pixels. */
  markSpacing: number;
}

/** Combines printed color and darkness into the signal the search looks at, 0 to 1. */
function buildSignal(image: PreparedImage): SignalLevel {
  const { width, height, ink, darkness } = image;
  const values = new Float32Array(width * height);
  for (let pixel = 0; pixel < values.length; pixel++) {
    values[pixel] = Math.min(255, ink.values[pixel] * INK_WEIGHT + darkness.values[pixel]) / 255;
  }
  return new SignalLevel(width, height, values, 1);
}

/** Makes a blurred copy of the signal by averaging square blocks of pixels. */
function shrinkSignal(signal: SignalLevel, requestedShrink: number): SignalLevel {
  const shrink = Math.max(1, requestedShrink);
  if (shrink === 1) {
    return signal;
  }
  const width = Math.floor(signal.width / shrink);
  const height = Math.floor(signal.height / shrink);
  const values = new Float32Array(width * height);
  for (let y = 0; y < height * shrink; y++) {
    const targetRow = Math.floor(y / shrink) * width;
    const sourceRow = y * signal.width;
    for (let x = 0; x < width * shrink; x++) {
      values[targetRow + Math.floor(x / shrink)] += signal.values[sourceRow + x];
    }
  }
  const blockArea = shrink * shrink;
  for (let pixel = 0; pixel < values.length; pixel++) {
    values[pixel] /= blockArea;
  }
  return new SignalLevel(width, height, values, shrink);
}

/** Returns the distance between neighboring rows at the middle of the card, in pixels. */
function measureMiddleMarkSpacing(alignment: TrackAlignment): number {
  const halfPitch = TEMPLATE_MARK_PITCH / 2;
  const above = projectMark(alignment.markAt(TEMPLATE_MIDPOINT - halfPitch));
  const below = projectMark(alignment.markAt(TEMPLATE_MIDPOINT + halfPitch));
  return Math.hypot(below.x - above.x, below.y - above.y);
}

function projectMark(mark: HomogeneousPoint): Point {
  return { x: mark.x / mark.w, y: mark.y / mark.w };
}

/**
 * Lists the points to check for a set of rows.
 *
 * @param isDetailed When true, samples each oval's outline and the paper
 *   around it. When false, compares just a bubble's center with the gaps
 *   beside it, which is all a blurred copy can show.
 */
function buildProbes(
  alignment: TrackAlignment,
  rowIndexes: readonly number[],
  isDetailed: boolean,
): ProbeSet {
  const probes: Probe[] = [];
  let bubbleCount = 0;
  const bubbleGap = BUBBLE_SPACING * TEMPLATE_MARK_PITCH;

  for (const rowIndex of rowIndexes) {
    const rowPosition = TIMING_MARK_POSITIONS[getTimingMarkIndex(rowIndex)];
    for (let column = 0; column < getBubbleCount(rowIndex); column++) {
      bubbleCount++;
      const bubbleX = getBubbleX(column);
      const add = (offsetX: number, offsetY: number, weight: number): void => {
        probes.push({
          across: (bubbleX + offsetX) / TEMPLATE_MIDPOINT,
          mark: alignment.markAt(rowPosition + offsetY),
          weight,
        });
      };

      add(-bubbleGap / 2, 0, -0.25);
      add(bubbleGap / 2, 0, -0.25);
      if (isDetailed) {
        add(0, -PAPER_OFFSET_ACROSS_ROW, -0.25);
        add(0, PAPER_OFFSET_ACROSS_ROW, -0.25);
        add(0, 0, 1 / (OVAL_OUTLINE_POINTS + 1));
        for (let point = 0; point < OVAL_OUTLINE_POINTS; point++) {
          const angle = (2 * Math.PI * point) / OVAL_OUTLINE_POINTS;
          add(
            Math.cos(angle) * OVAL_HALF_LENGTH,
            Math.sin(angle) * OVAL_HALF_HEIGHT,
            1 / (OVAL_OUTLINE_POINTS + 1),
          );
        }
      } else {
        add(0, 0, 0.5);
      }
    }
  }
  return new ProbeSet(probes, bubbleCount);
}

/** Returns a bubble's X position on the template: its distance from the timing marks. */
function getBubbleX(column: number): number {
  return (FIRST_BUBBLE_OFFSET + BUBBLE_SPACING * column) * TEMPLATE_MARK_PITCH;
}

/**
 * Works out the transform's across-the-card column from a placement.
 *
 * The scale is defined at the middle bubble, and foreshortening pivots about
 * the middle of the track, so changing how much the card recedes hardly moves
 * the middle of the grid. That keeps the three unknowns nearly independent.
 */
function getAcrossColumn(context: SearchContext, placement: CardPlacement): HomogeneousPoint {
  const { alignment, markSpacing } = context;
  const pivot = alignment.markAt(TEMPLATE_MIDPOINT);
  const pivotAcross = getBubbleX(5) / TEMPLATE_MIDPOINT;

  const angle = (placement.rowAngle * Math.PI) / 180;
  const unitsPerAcross = (markSpacing / TEMPLATE_MARK_PITCH) * TEMPLATE_MIDPOINT;
  const scale = unitsPerAcross * placement.scaleRatio * (1 + pivotAcross * placement.recede);
  const { acrossCard } = alignment;
  const directionX = acrossCard.x * Math.cos(angle) - acrossCard.y * Math.sin(angle);
  const directionY = acrossCard.x * Math.sin(angle) + acrossCard.y * Math.cos(angle);

  return {
    x: directionX * scale + (placement.recede * pivot.x) / pivot.w,
    y: directionY * scale + (placement.recede * pivot.y) / pivot.w,
    w: placement.recede,
  };
}

/** Adds up the signal at a set of probes under a placement; higher is a better fit. */
function scorePlacement(
  context: SearchContext,
  placement: CardPlacement,
  signal: SignalLevel,
  probes: ProbeSet,
): number {
  const column = getAcrossColumn(context, placement);
  const { across, markX, markY, markW, weights } = probes;
  let total = 0;
  for (let index = 0; index < weights.length; index++) {
    const w = markW[index] + across[index] * column.w;
    total +=
      weights[index] *
      signal.sample(
        (markX[index] + across[index] * column.x) / w,
        (markY[index] + across[index] * column.y) / w,
      );
  }
  return total / probes.bubbleCount;
}

/**
 * Tries a coarse grid of placements.
 *
 * @returns The best-scoring ones, best first, keeping only one from each
 *   neighborhood so the refinement sees real alternatives.
 */
function searchPlacements(
  context: SearchContext,
  signal: SignalLevel,
  probes: ProbeSet,
): CardPlacement[] {
  const scored: Array<{ placement: CardPlacement; score: number }> = [];
  for (
    let rowAngle = -MAXIMUM_ROW_ANGLE;
    rowAngle <= MAXIMUM_ROW_ANGLE;
    rowAngle += ROW_ANGLE_STEP
  ) {
    for (
      let scaleRatio = MINIMUM_SCALE_RATIO;
      scaleRatio <= MAXIMUM_SCALE_RATIO;
      scaleRatio *= 1 + SCALE_STEP
    ) {
      for (let recede = -MAXIMUM_RECEDE; recede <= MAXIMUM_RECEDE; recede += RECEDE_STEP) {
        const placement = { rowAngle, scaleRatio, recede };
        scored.push({ placement, score: scorePlacement(context, placement, signal, probes) });
      }
    }
  }
  scored.sort((first, second) => second.score - first.score);

  const chosen: CardPlacement[] = [];
  for (const { placement } of scored) {
    const isNewNeighborhood = chosen.every(
      (other) =>
        Math.abs(other.rowAngle - placement.rowAngle) > 2 * ROW_ANGLE_STEP ||
        Math.abs(other.scaleRatio / placement.scaleRatio - 1) > 2 * SCALE_STEP ||
        Math.abs(other.recede - placement.recede) > 2 * RECEDE_STEP,
    );
    if (isNewNeighborhood) {
      chosen.push(placement);
      if (chosen.length === PLACEMENTS_TO_REFINE) {
        break;
      }
    }
  }
  return chosen;
}

/**
 * Improves a placement by trying a step either way on each unknown in turn,
 * halving the steps each round.
 *
 * @param startingStep The first step, as a share of the coarse grid's steps.
 */
function refinePlacement(
  context: SearchContext,
  start: CardPlacement,
  signal: SignalLevel,
  probes: ProbeSet,
  startingStep: number,
): CardPlacement {
  let best = start;
  let bestScore = scorePlacement(context, best, signal, probes);
  let step = startingStep;

  for (let round = 0; round < REFINEMENT_ROUNDS; round++) {
    const moves: CardPlacement[] = [
      { ...best, rowAngle: best.rowAngle + ROW_ANGLE_STEP * step },
      { ...best, rowAngle: best.rowAngle - ROW_ANGLE_STEP * step },
      { ...best, scaleRatio: best.scaleRatio * (1 + SCALE_STEP * step) },
      { ...best, scaleRatio: best.scaleRatio * (1 - SCALE_STEP * step) },
      { ...best, recede: best.recede + RECEDE_STEP * step },
      { ...best, recede: best.recede - RECEDE_STEP * step },
    ];
    for (const move of moves) {
      const score = scorePlacement(context, move, signal, probes);
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    step /= 2;
  }
  return best;
}

/**
 * Places one section's bubbles, nudging the section to fit its own printed
 * ovals. A card held in a hand isn't perfectly flat, and the nudge takes up
 * what a single flat transform can't.
 */
function placeSection(
  context: SearchContext,
  placement: CardPlacement,
  sectionRows: readonly number[],
  signal: SignalLevel,
): RowBubbles[] {
  const column = getAcrossColumn(context, placement);
  const { alignment } = context;

  /** Returns where a template position lands in the photo. */
  const project = (templateX: number, templateY: number): Point => {
    const mark = alignment.markAt(templateY);
    const across = templateX / TEMPLATE_MIDPOINT;
    const w = mark.w + across * column.w;
    return { x: (mark.x + across * column.x) / w, y: (mark.y + across * column.y) / w };
  };

  const middleRow = sectionRows[2];
  const middleY = TIMING_MARK_POSITIONS[getTimingMarkIndex(middleRow)];
  const middleLeft = project(getBubbleX(0), middleY);
  const middleRight = project(getBubbleX(10), middleY);
  const alongRow = normalize({ x: middleRight.x - middleLeft.x, y: middleRight.y - middleLeft.y });
  const acrossRow = perpendicular(alongRow);
  const bubbleSpacing = Math.hypot(middleRight.x - middleLeft.x, middleRight.y - middleLeft.y) / 10;
  const centerColumn = 5;
  const rowAbove = project(getBubbleX(centerColumn), middleY - TEMPLATE_MARK_PITCH / 2);
  const rowBelow = project(getBubbleX(centerColumn), middleY + TEMPLATE_MARK_PITCH / 2);
  const rowSpacing = Math.abs(
    dot({ x: rowBelow.x - rowAbove.x, y: rowBelow.y - rowAbove.y }, acrossRow),
  );

  // Every probe's position under the flat transform, with its column.
  const probes = buildProbes(alignment, sectionRows, true);
  const probeCount = probes.weights.length;
  const baseX = new Float64Array(probeCount);
  const baseY = new Float64Array(probeCount);
  const columnOffset = new Float64Array(probeCount);
  for (let index = 0; index < probeCount; index++) {
    const across = probes.across[index];
    const w = probes.markW[index] + across * column.w;
    baseX[index] = (probes.markX[index] + across * column.x) / w;
    baseY[index] = (probes.markY[index] + across * column.y) / w;
    columnOffset[index] =
      (across * TEMPLATE_MIDPOINT - getBubbleX(centerColumn)) /
      (BUBBLE_SPACING * TEMPLATE_MARK_PITCH);
  }

  let bestNudge = { along: 0, across: 0, stretch: 0 };
  let bestScore = -Infinity;
  for (let stretchStep = -STRETCH_STEPS; stretchStep <= STRETCH_STEPS; stretchStep++) {
    const stretch = (stretchStep / STRETCH_STEPS) * NUDGE_LIMIT_STRETCH * bubbleSpacing;
    for (let alongStep = -NUDGE_STEPS; alongStep <= NUDGE_STEPS; alongStep++) {
      const along = (alongStep / NUDGE_STEPS) * NUDGE_LIMIT_ALONG * bubbleSpacing;
      for (let acrossStep = -NUDGE_STEPS; acrossStep <= NUDGE_STEPS; acrossStep++) {
        const across = (acrossStep / NUDGE_STEPS) * NUDGE_LIMIT_ACROSS * rowSpacing;
        let score = 0;
        for (let index = 0; index < probeCount; index++) {
          const shiftAlong = along + stretch * columnOffset[index];
          score +=
            probes.weights[index] *
            signal.sample(
              baseX[index] + alongRow.x * shiftAlong + acrossRow.x * across,
              baseY[index] + alongRow.y * shiftAlong + acrossRow.y * across,
            );
        }
        if (score > bestScore) {
          bestScore = score;
          bestNudge = { along, across, stretch };
        }
      }
    }
  }

  return sectionRows.map((rowIndex) => {
    const rowY = TIMING_MARK_POSITIONS[getTimingMarkIndex(rowIndex)];
    const bubbleTotal = getBubbleCount(rowIndex);
    const centers: Point[] = [];
    for (let bubble = 0; bubble < bubbleTotal; bubble++) {
      const flat = project(getBubbleX(bubble), rowY);
      const shiftAlong = bestNudge.along + bestNudge.stretch * (bubble - centerColumn);
      centers.push({
        x: flat.x + alongRow.x * shiftAlong + acrossRow.x * bestNudge.across,
        y: flat.y + alongRow.y * shiftAlong + acrossRow.y * bestNudge.across,
      });
    }
    const spacings = centers.map((center, bubble) => {
      const neighbor = centers[bubble + 1] ?? centers[bubble - 1];
      return Math.hypot(neighbor.x - center.x, neighbor.y - center.y);
    });
    return {
      centers,
      bubbleSpacing: spacings,
      alongRow,
      acrossRow,
      markSpacing: rowSpacing,
    };
  });
}

/** Returns the whole numbers from `start` up to, but not including, `end`. */
function createRange(start: number, end: number): number[] {
  const numbers: number[] = [];
  for (let value = start; value < end; value++) {
    numbers.push(value);
  }
  return numbers;
}
