/**
 * @file The reader's entry point: photo pixels in, scores out.
 *
 * The reader is a classic optical mark reader (the same idea as the
 * machines that grade bubble tests), built to work from a phone photo
 * rather than a flatbed scanner:
 *
 * 1. {@link prepareImage}: remove lighting and paper colour.
 * 2. {@link findMarkCandidates}: find every small dark bar.
 * 3. {@link findTimingTrack}: pick out the column of timing marks.
 * 4. {@link alignTrackToCard}: work out which mark is which row, and which way up the card is.
 * 5. {@link locateBubbles}: find every bubble's centre.
 * 6. {@link measureBubbleFills} and {@link readRows}: decide which bubble is filled on each row.
 *
 * Everything runs locally. Nothing here touches the page or the network,
 * so the reader also runs in Node.js for tests.
 */

import { locateBubbles } from "./bubble-grid.ts";
import { BUBBLE_SPACING, ROW_COUNT, ROWS_PER_SECTION, SCORE_ROW_COUNT } from "./card-layout.ts";
import type { Point } from "./geometry.ts";
import { prepareImage } from "./image-maps.ts";
import { findMarkCandidates } from "./mark-candidates.ts";
import { measureBubbleFills, readRows } from "./mark-reading.ts";
import { findTimingTrack } from "./timing-track.ts";
import { alignTrackToCard } from "./track-alignment.ts";

/** Shown when the photo has no recognisable timing marks. */
export const NO_TIMING_MARKS_MESSAGE =
  "Couldn't find the black timing marks along the card's edge.";

/** One row of bubbles as the reader saw it. */
export interface RowResult {
  /**
   * The filled bubble (0 to 10 for arrows, 0 to 9 for shooter digits), or
   * null when none is filled.
   */
  value: number | null;
  /** Why a person should check this row, or null. */
  flag: string | null;
  /** Where each bubble is in the photo. */
  centers: Point[];
  /** How dark each bubble is, 0 to 1. */
  fills: number[];
}

/** A timing mark's position in the photo. */
export interface TimingMarkResult extends Point {
  /** False when it was hidden and filled in from the pattern. */
  wasDetected: boolean;
}

/** A successful read. */
export interface CardReadSuccess {
  ok: true;
  /** The 30 arrows, Round 1 arrow 1 first. */
  scores: RowResult[];
  /** The 5 shooter-number digits, first digit first. */
  shooter: RowResult[];
  /** One per row. */
  timingMarks: TimingMarkResult[];
  /** For troubleshooting. */
  diagnostics: {
    /** The bubble spacing found compared with the template (1 = exact). */
    spacingScale: number;
    /** How many sections fell back to the template grid. */
    sectionsFromTemplate: number;
  };
}

/** A failed read. */
export interface CardReadFailure {
  ok: false;
  /** What went wrong, in plain words. */
  error: string;
  /** Any timing marks found, for display. */
  timingMarks: TimingMarkResult[];
}

/**
 * The result of reading a card. Check `ok` to tell which kind it is, like a
 * discriminated union in F# or a Result type in C#.
 */
export type CardReadResult = CardReadSuccess | CardReadFailure;

/**
 * Reads a photographed NASP score card.
 *
 * @param rgba Pixels as red, green, blue, alpha bytes, row by row (the
 *   layout of `ImageData.data`).
 */
export function analyzeCard(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): CardReadResult {
  const image = prepareImage(rgba, width, height);

  const track = findTimingTrack(findMarkCandidates(image.darkness));
  if (!track) {
    return { ok: false, error: NO_TIMING_MARKS_MESSAGE, timingMarks: [] };
  }

  const alignment = alignTrackToCard(track);
  if (!alignment) {
    return {
      ok: false,
      error: `Found ${track.marks.length} timing marks but they don't match the scorecard's pattern.`,
      timingMarks: track.marks.map((mark) => ({ x: mark.x, y: mark.y, wasDetected: true })),
    };
  }

  const { rows, grids } = locateBubbles(alignment.rowAnchors, alignment.acrossCard, image);
  const fillsByRow = rows.map((row) => measureBubbleFills(row, image.darkness));
  const readings = readRows(fillsByRow);

  const results: RowResult[] = readings.map((reading, rowIndex) => ({
    value: reading.value,
    flag: reading.flag,
    centers: rows[rowIndex].centers,
    fills: fillsByRow[rowIndex],
  }));

  let spacingScaleSum = 0;
  grids.forEach((grid, sectionIndex) => {
    const markSpacing = alignment.rowAnchors[sectionIndex * ROWS_PER_SECTION].markSpacing;
    spacingScaleSum += grid.alongCoefficients[1] / (markSpacing * BUBBLE_SPACING);
  });

  return {
    ok: true,
    scores: results.slice(0, SCORE_ROW_COUNT),
    shooter: results.slice(SCORE_ROW_COUNT, ROW_COUNT),
    timingMarks: alignment.rowAnchors.map(({ x, y, wasDetected }) => ({ x, y, wasDetected })),
    diagnostics: {
      spacingScale: spacingScaleSum / grids.length,
      sectionsFromTemplate: grids.filter((grid) => grid.usedTemplate).length,
    },
  };
}
