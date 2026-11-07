/**
 * @file Picks out the column of timing marks running down the card's edge
 * from all the dark rectangles found in the photo.
 *
 * The timing marks are the only large set of same-sized bars that line up
 * in a straight row, so the reader looks for the straight line that passes
 * through the most similar-looking candidates.
 */

import type { Point, Vector } from "./geometry.ts";
import type { MarkCandidate } from "./mark-candidates.ts";

/** Fewest marks a line needs before it can be the timing track (the card has 36). */
const MINIMUM_TRACK_MARKS = 22;

/** Two candidates are "similar" when their areas differ by less than this factor. */
const PAIR_AREA_RATIO_LIMIT = 1.8;

/** Members of the track may differ from the average mark area by up to this factor. */
const TRACK_AREA_RATIO_LIMIT = 2.2;

/**
 * Marks sit side by side across their long edge. The line through two marks
 * must run at least this many times further across the bars than along them.
 */
const MINIMUM_ACROSS_TO_ALONG_RATIO = 2.5;

/** How far a mark's centre may sit off the line, as a share of the mark thickness. */
const LINE_TOLERANCE_PER_THICKNESS = 0.9;

/** Never accept less than this tolerance, in pixels. */
const MINIMUM_LINE_TOLERANCE = 2;

/** Detections closer together than this, in mark thicknesses, are one broken mark. */
const DUPLICATE_SPACING_PER_THICKNESS = 1.2;

/** A timing mark found on the track. */
export interface TrackMark extends MarkCandidate {
  /** Distance along the track from its centre point, in pixels. */
  position: number;
}

/** The column of timing marks found in the photo. */
export interface TimingTrack {
  /** Ordered by `position`. */
  marks: TrackMark[];
  /** Average position of the marks. */
  center: Point;
  /**
   * Unit vector along the track. Its sign is arbitrary here; it is settled
   * once the marks are matched to the card.
   */
  direction: Vector;
}

/** A candidate line through two marks. */
interface CandidateLine {
  /** One of the two marks the line passes through. */
  anchor: MarkCandidate;
  /** Unit vector along the line. */
  direction: Vector;
  /** Allowed distance from the line, in pixels. */
  tolerance: number;
  /** Typical mark area for this line. */
  averageArea: number;
  /** Orientation of the marks on this line. */
  isHorizontal: boolean;
  /** Candidates that fit this line. */
  markCount: number;
}

/**
 * Finds the line of timing marks.
 *
 * @returns Null when no line has enough marks.
 */
export function findTimingTrack(candidates: MarkCandidate[]): TimingTrack | null {
  const line = findBestLine(candidates);
  if (!line || line.markCount < MINIMUM_TRACK_MARKS) {
    return null;
  }

  const members = candidates.filter((candidate) => isOnLine(candidate, line));
  const { center, direction } = fitLineThroughMarks(members);

  const marksAlongTrack: TrackMark[] = members
    .map((mark) => ({
      ...mark,
      position: (mark.x - center.x) * direction.x + (mark.y - center.y) * direction.y,
    }))
    .sort((first, second) => first.position - second.position);

  return { marks: mergeBrokenMarks(marksAlongTrack), center, direction };
}

/**
 * Tries a line through every pair of similar candidates and keeps the line
 * that the most candidates fit.
 */
function findBestLine(candidates: MarkCandidate[]): CandidateLine | null {
  let bestLine: CandidateLine | null = null;

  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex++) {
    const first = candidates[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex++) {
      const second = candidates[secondIndex];
      if (first.isHorizontal !== second.isHorizontal) {
        continue;
      }
      const areaRatio = first.area / second.area;
      if (areaRatio > PAIR_AREA_RATIO_LIMIT || areaRatio < 1 / PAIR_AREA_RATIO_LIMIT) {
        continue;
      }

      // Marks stack across their long edge: horizontal bars stack vertically.
      const offsetX = second.x - first.x;
      const offsetY = second.y - first.y;
      const isStackedAcrossBars = first.isHorizontal
        ? Math.abs(offsetY) >= MINIMUM_ACROSS_TO_ALONG_RATIO * Math.abs(offsetX)
        : Math.abs(offsetX) >= MINIMUM_ACROSS_TO_ALONG_RATIO * Math.abs(offsetY);
      if (!isStackedAcrossBars) {
        continue;
      }
      const separation = Math.hypot(offsetX, offsetY);
      if (separation < 1) {
        continue;
      }

      const averageThickness =
        (Math.min(first.width, first.height) + Math.min(second.width, second.height)) / 2;
      const line: CandidateLine = {
        anchor: first,
        direction: { x: offsetX / separation, y: offsetY / separation },
        tolerance: Math.max(
          MINIMUM_LINE_TOLERANCE,
          LINE_TOLERANCE_PER_THICKNESS * averageThickness,
        ),
        averageArea: (first.area + second.area) / 2,
        isHorizontal: first.isHorizontal,
        markCount: 0,
      };
      // A plain loop rather than filter(): this runs for every pair, so it avoids
      // creating a throwaway array each time.
      for (const candidate of candidates) {
        if (isOnLine(candidate, line)) {
          line.markCount++;
        }
      }

      if (!bestLine || line.markCount > bestLine.markCount) {
        bestLine = line;
      }
    }
  }
  return bestLine;
}

/** Tells whether a candidate matches a line's marks and lies on the line. */
function isOnLine(candidate: MarkCandidate, line: CandidateLine): boolean {
  if (candidate.isHorizontal !== line.isHorizontal) {
    return false;
  }
  if (
    candidate.area > line.averageArea * TRACK_AREA_RATIO_LIMIT ||
    candidate.area < line.averageArea / TRACK_AREA_RATIO_LIMIT
  ) {
    return false;
  }
  // Perpendicular distance from the line (2D cross product).
  const distanceFromLine = Math.abs(
    (candidate.x - line.anchor.x) * line.direction.y -
      (candidate.y - line.anchor.y) * line.direction.x,
  );
  return distanceFromLine < line.tolerance;
}

/**
 * Fits the best straight line through a set of marks (principal component
 * analysis: the direction in which the marks are most spread out).
 */
function fitLineThroughMarks(marks: MarkCandidate[]): { center: Point; direction: Vector } {
  let centerX = 0;
  let centerY = 0;
  for (const mark of marks) {
    centerX += mark.x;
    centerY += mark.y;
  }
  centerX /= marks.length;
  centerY /= marks.length;

  let spreadXX = 0;
  let spreadYY = 0;
  let spreadXY = 0;
  for (const mark of marks) {
    const offsetX = mark.x - centerX;
    const offsetY = mark.y - centerY;
    spreadXX += offsetX * offsetX;
    spreadYY += offsetY * offsetY;
    spreadXY += offsetX * offsetY;
  }
  const angle = 0.5 * Math.atan2(2 * spreadXY, spreadXX - spreadYY);

  return {
    center: { x: centerX, y: centerY },
    direction: { x: Math.cos(angle), y: Math.sin(angle) },
  };
}

/**
 * A timing mark can be detected as two pieces when a pencil line or glare
 * crosses it. Pieces closer together than a real mark spacing are merged,
 * keeping the larger piece.
 *
 * @param marks Ordered by position.
 */
function mergeBrokenMarks(marks: TrackMark[]): TrackMark[] {
  const thinnest = Math.min(...marks.map((mark) => Math.min(mark.width, mark.height)));
  const minimumSpacing = thinnest * DUPLICATE_SPACING_PER_THICKNESS;

  const merged: TrackMark[] = [];
  for (const mark of marks) {
    const previous = merged.at(-1);
    if (previous && mark.position - previous.position < minimumSpacing) {
      if (mark.area > previous.area) {
        merged[merged.length - 1] = mark;
      }
    } else {
      merged.push(mark);
    }
  }
  return merged;
}
