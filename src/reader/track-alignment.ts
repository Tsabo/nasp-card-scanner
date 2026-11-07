/**
 * @file Works out which detected timing mark is which, by matching the
 * marks' spacing against the card's known pattern.
 *
 * The card's marks are evenly spaced within each section, with wider gaps
 * between sections and a much wider gap between Round 3 and Round 4. That
 * pattern only fits one way round, so matching it also tells the reader
 * which end of the track is the top of the card. Marks hidden by a finger
 * or a clip are filled in from the fitted pattern.
 */

import {
  ROW_COUNT,
  TEMPLATE_MARK_PITCH,
  TEMPLATE_MIDPOINT,
  TIMING_MARK_POSITIONS,
  getTimingMarkIndex,
} from "./card-layout.ts";
import { directionBetween, moveAlong } from "./geometry.ts";
import type { Point, Vector } from "./geometry.ts";
import { findNearestIndex, solveLeastSquares } from "./statistics.ts";
import type { Triple } from "./statistics.ts";
import type { TimingTrack, TrackMark } from "./timing-track.ts";

/** Fewest of the card's 36 marks that must line up for the match to be trusted. */
const MINIMUM_MATCHED_MARKS = 22;

/** A detected mark matches a template mark when it is within this share of a mark spacing. */
const MATCH_TOLERANCE = 0.3;

/** Rounds of refitting after the first match. */
const REFINEMENT_ROUNDS = 3;

/** Where a row's timing mark is in the photo. */
export interface RowAnchor extends Point {
  /** False when the mark was hidden and its position was filled in from the pattern. */
  wasDetected: boolean;
}

/**
 * A point in homogeneous coordinates: the photo position is (x / w, y / w).
 * Perspective is a straight-line (linear) formula in this form, which is what
 * lets the bubble grid extend the track's fit across the card.
 */
export interface HomogeneousPoint {
  x: number;
  y: number;
  w: number;
}

/** The card's orientation and row positions in the photo. */
export interface TrackAlignment {
  /** One per row, 35 in all, in card order. */
  rowAnchors: RowAnchor[];
  /** Unit vector pointing from Round 1 toward Shooter #. */
  downCard: Vector;
  /** Unit vector pointing from the timing marks toward the bubbles. */
  acrossCard: Vector;
  /**
   * Where a position on the template's timing-mark column lands in the photo,
   * from the fit through all the detected marks.
   *
   * @param templatePosition Distance down the card, in template pixels.
   */
  markAt: (templatePosition: number) => HomogeneousPoint;
}

/**
 * Matches the detected marks to the card's mark pattern.
 *
 * @returns Null when the marks don't fit the pattern.
 */
export function alignTrackToCard(track: TimingTrack): TrackAlignment | null {
  const detectedPositions = track.marks.map((mark) => mark.position);

  const firstMatch = searchForBestMatch(detectedPositions);
  if (!firstMatch || firstMatch.matchedCount < MINIMUM_MATCHED_MARKS) {
    return null;
  }
  const bestMatch = refineMatch(firstMatch, detectedPositions);

  const rowAnchors = placeRowAnchors(track, bestMatch);
  const downCard = directionBetween(rowAnchors[0], rowAnchors[ROW_COUNT - 1]);
  // Photos are never mirrored, so the bubbles are always on the card's right
  // of the track. In image coordinates (y down), turning "down the card" a
  // quarter turn anticlockwise points right.
  const acrossCard = { x: downCard.y, y: -downCard.x };

  const markAt = (templatePosition: number): HomogeneousPoint =>
    bestMatch.projection.toPhoto(templatePosition, track);

  return { rowAnchors, downCard, acrossCard, markAt };
}

/** A template position paired with a detected position along the track. */
interface PositionPair {
  templatePosition: number;
  detectedPosition: number;
}

/**
 * Maps a position on the card template to a position along the detected
 * track.
 *
 * A camera can tilt the card away from the lens, which squeezes the marks
 * closer together at the far end. A straight line photographed at an angle
 * follows a one-dimensional projective transform:
 *
 *     trackPosition = (a·u + b) / (c·u + 1),   u = (templatePosition − 900) / 900
 *
 * where a, b and c depend on the camera angle.
 */
class TrackProjection {
  /** The a, b and c above. */
  readonly coefficients: Triple;

  constructor(coefficients: Triple) {
    this.coefficients = coefficients;
  }

  /**
   * Fits the projection to pairs of template and detected positions.
   *
   * Rearranging the formula gives `a·u + b − c·u·t = t`, which is linear in
   * a, b and c, so it can be solved by least squares.
   */
  static fit(pairs: PositionPair[]): TrackProjection | null {
    const coefficients = solveLeastSquares(
      pairs.map(({ templatePosition, detectedPosition }) => {
        const u = normalizeTemplatePosition(templatePosition);
        return { basis: [u, 1, -u * detectedPosition], target: detectedPosition };
      }),
    );
    return coefficients ? new TrackProjection(coefficients) : null;
  }

  /** Returns the position along the detected track, in pixels. */
  map(templatePosition: number): number {
    const [a, b, c] = this.coefficients;
    const u = normalizeTemplatePosition(templatePosition);
    return (a * u + b) / (c * u + 1);
  }

  /**
   * Returns where a template position lands in the photo. Writing the track
   * position as a fraction turns moving along the track into a linear formula.
   */
  toPhoto(templatePosition: number, track: TimingTrack): HomogeneousPoint {
    const [a, b, c] = this.coefficients;
    const u = normalizeTemplatePosition(templatePosition);
    const w = c * u + 1;
    const distanceTimesW = a * u + b;
    return {
      x: track.center.x * w + track.direction.x * distanceTimesW,
      y: track.center.y * w + track.direction.y * distanceTimesW,
      w,
    };
  }

  /**
   * Returns the photo's spacing between neighboring marks near a point on
   * the template, in pixels. Negative when the track runs backward.
   */
  markSpacingAt(templatePosition: number): number {
    const halfPitch = TEMPLATE_MARK_PITCH / 2;
    return this.map(templatePosition + halfPitch) - this.map(templatePosition - halfPitch);
  }

  /**
   * A real camera can't fold the card back on itself, so the mapping must
   * move steadily in one direction from the first mark to the last.
   */
  isMonotonic(): boolean {
    const start = this.map(TIMING_MARK_POSITIONS[0]);
    const middle = this.map(TEMPLATE_MIDPOINT);
    const end = this.map(TIMING_MARK_POSITIONS[TIMING_MARK_POSITIONS.length - 1]);
    return (middle - start) * (end - middle) > 0;
  }
}

function normalizeTemplatePosition(templatePosition: number): number {
  return (templatePosition - TEMPLATE_MIDPOINT) / TEMPLATE_MIDPOINT;
}

/** A pairing of a template mark with a detected mark. */
interface MarkMatch {
  /** Index into {@link TIMING_MARK_POSITIONS}. */
  templateIndex: number;
  /** Index into the track's marks. */
  detectedIndex: number;
}

/** How well a projection lines the template up with the detected marks. */
interface MatchResult {
  projection: TrackProjection;
  /** Template marks with a detected mark close by. */
  matchedCount: number;
  /**
   * Sum of the matched marks' misalignments, each as a share of the
   * tolerance. Breaks ties between equal counts.
   */
  totalError: number;
  matches: MarkMatch[];
}

/**
 * Lines the template up against the detected marks under a projection.
 *
 * @param detectedPositions Ascending.
 */
function scoreProjection(projection: TrackProjection, detectedPositions: number[]): MatchResult {
  const matches: MarkMatch[] = [];
  let totalError = 0;

  for (let templateIndex = 0; templateIndex < TIMING_MARK_POSITIONS.length; templateIndex++) {
    const templatePosition = TIMING_MARK_POSITIONS[templateIndex];
    const expected = projection.map(templatePosition);
    if (!Number.isFinite(expected)) {
      return { projection, matchedCount: -1, totalError: 0, matches: [] };
    }
    const detectedIndex = findNearestIndex(detectedPositions, expected);
    const error = Math.abs(detectedPositions[detectedIndex] - expected);
    const tolerance = MATCH_TOLERANCE * Math.abs(projection.markSpacingAt(templatePosition));
    if (error < tolerance) {
      matches.push({ templateIndex, detectedIndex });
      totalError += error / tolerance;
    }
  }
  return { projection, matchedCount: matches.length, totalError, matches };
}

/** Tells whether one match result is better than another. */
function isBetterMatch(candidate: MatchResult, currentBest: MatchResult | null): boolean {
  if (!currentBest) {
    return true;
  }
  return (
    candidate.matchedCount > currentBest.matchedCount ||
    (candidate.matchedCount === currentBest.matchedCount &&
      candidate.totalError < currentBest.totalError)
  );
}

/**
 * Tries many ways of pairing three detected marks with three template marks
 * and keeps the projection that lines up the most marks overall.
 *
 * The three detected marks are taken from near the start, middle and end of
 * the track. Their template partners come from near the top, the middle
 * section and the bottom of the card, in both orders (the photo may show
 * the card upside down). Three pairs fix a projection exactly.
 *
 * @param detectedPositions Ascending.
 */
function searchForBestMatch(detectedPositions: number[]): MatchResult | null {
  const detectedCount = detectedPositions.length;
  const templateCount = TIMING_MARK_POSITIONS.length;
  const detectedMiddle = detectedCount >> 1;

  // Which detected marks to try at the start of the track.
  const startChoices = range(0, Math.min(4, detectedCount));
  // Template marks to try: the first six, Round 3 to Round 5 for the middle, the last six.
  const templateStartChoices = range(0, 6);
  const templateMiddleChoices = range(13, 24);
  const templateEndChoices = range(templateCount - 6, templateCount);

  let bestMatch: MatchResult | null = null;

  for (const startIndex of startChoices) {
    for (const endIndex of range(Math.max(detectedCount - 4, startIndex + 2), detectedCount)) {
      const middleChoices = range(
        Math.max(startIndex + 1, detectedMiddle - 1),
        Math.min(endIndex - 1, detectedMiddle + 1) + 1,
      );
      for (const middleIndex of middleChoices) {
        for (const templateStart of templateStartChoices) {
          for (const templateEnd of templateEndChoices) {
            for (const templateMiddle of templateMiddleChoices) {
              for (const cardIsUpsideDown of [false, true]) {
                const templateForStart = cardIsUpsideDown ? templateEnd : templateStart;
                const templateForEnd = cardIsUpsideDown ? templateStart : templateEnd;

                const projection = TrackProjection.fit([
                  pair(templateForStart, startIndex, detectedPositions),
                  pair(templateMiddle, middleIndex, detectedPositions),
                  pair(templateForEnd, endIndex, detectedPositions),
                ]);
                if (!projection || !projection.isMonotonic()) {
                  continue;
                }

                const result = scoreProjection(projection, detectedPositions);
                if (isBetterMatch(result, bestMatch)) {
                  bestMatch = result;
                }
              }
            }
          }
        }
      }
    }
  }
  return bestMatch;
}

/**
 * Refits the projection to every matched mark, which smooths out errors in
 * the three marks the search started from. Stops if a refit loses matches.
 */
function refineMatch(match: MatchResult, detectedPositions: number[]): MatchResult {
  let current = match;
  for (let round = 0; round < REFINEMENT_ROUNDS; round++) {
    const projection = TrackProjection.fit(
      current.matches.map(({ templateIndex, detectedIndex }) =>
        pair(templateIndex, detectedIndex, detectedPositions),
      ),
    );
    if (!projection) {
      break;
    }
    const refined = scoreProjection(projection, detectedPositions);
    if (refined.matchedCount < current.matches.length) {
      break;
    }
    current = refined;
  }
  return current;
}

/**
 * Places every row's timing mark in the photo: the detected mark where one
 * matched, otherwise the projected position along the track.
 */
function placeRowAnchors(track: TimingTrack, match: MatchResult): RowAnchor[] {
  const detectedByTemplateIndex = new Map<number, TrackMark>();
  for (const { templateIndex, detectedIndex } of match.matches) {
    detectedByTemplateIndex.set(templateIndex, track.marks[detectedIndex]);
  }

  const markPositions: RowAnchor[] = [];
  for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex++) {
    const templateIndex = getTimingMarkIndex(rowIndex);
    const detected = detectedByTemplateIndex.get(templateIndex);
    if (detected) {
      markPositions.push({ x: detected.x, y: detected.y, wasDetected: true });
    } else {
      const trackPosition = match.projection.map(TIMING_MARK_POSITIONS[templateIndex]);
      markPositions.push({
        ...moveAlong(track.center, track.direction, trackPosition),
        wasDetected: false,
      });
    }
  }

  return markPositions;
}

function pair(
  templateIndex: number,
  detectedIndex: number,
  detectedPositions: number[],
): PositionPair {
  return {
    templatePosition: TIMING_MARK_POSITIONS[templateIndex],
    detectedPosition: detectedPositions[detectedIndex],
  };
}

/** Returns the whole numbers from `start` up to, but not including, `end`. */
function range(start: number, end: number): number[] {
  const numbers: number[] = [];
  for (let value = start; value < end; value++) {
    numbers.push(value);
  }
  return numbers;
}
