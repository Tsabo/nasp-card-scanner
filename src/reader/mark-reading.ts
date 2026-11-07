/**
 * @file Decides which bubble is filled in on each row.
 *
 * Measuring darkness alone isn't enough: empty bubbles aren't equally dark
 * (a printed "10" has more ink than a "1"), and pencil pressure varies from
 * archer to archer. So the reader learns both from the card itself before
 * deciding: what an empty bubble in each column looks like, and how dark
 * this archer's fills typically are.
 */

import type { RowBubbles } from "./bubble-grid.ts";
import { SCORE_BUBBLES_PER_ROW, SCORE_ROW_COUNT } from "./card-layout.ts";
import type { Point } from "./geometry.ts";
import type { ImageMap } from "./image-maps.ts";
import { lowerQuartile, median } from "./statistics.ts";

/** Size of the oval sampled inside each bubble, as shares of the bubble and mark spacing. */
const FILL_HALF_LENGTH_PER_BUBBLE_SPACING = 0.26;
const FILL_HALF_WIDTH_PER_MARK_SPACING = 0.2;

/**
 * Share of each oval's samples, lightest first, that are averaged into its
 * fill. An empty bubble always has bare paper between the strokes of its
 * printed digit, and a filled one doesn't. Measuring only the lightest samples
 * ignores the digit, so a printed "10" doesn't look half filled.
 */
const LIGHTEST_SAMPLE_SHARE = 0.4;

/** No real fill is fainter than this, however light the card's marks are. */
const ABSOLUTE_MINIMUM_FILL = 0.09;

/** Assumed fill darkness when a card has no clear marks to learn from. */
const DEFAULT_TYPICAL_FILL = 0.3;

/** A bubble counts as filled when it's at least this share of the card's typical fill. */
const FILLED_SHARE_OF_TYPICAL = 0.5;

/** A fill fainter than this share of typical (or {@link ABSOLUTE_LIGHT_FILL}) is flagged as light. */
const LIGHT_SHARE_OF_TYPICAL = 0.65;
const ABSOLUTE_LIGHT_FILL = 0.16;

/** A second filled bubble at least this share as dark as the first is flagged as a double mark. */
const DOUBLE_MARK_SHARE = 0.55;

/** Flag messages shown to the coach. */
export const FLAG_MESSAGES = Object.freeze({
  noMark: "No bubble marked",
  lightMark: "Light mark; please confirm",
  doubleMark: (chosen: number, other: number): string =>
    `Two bubbles marked (${chosen} and ${other}); picked the darker one`,
});

/** The reader's decision for one row. */
export interface RowReading {
  /** The filled bubble's number, or null when none is filled. */
  value: number | null;
  /** Why the row needs a person to check it, or null. */
  flag: string | null;
}

/**
 * Measures how dark the inside of each bubble is.
 *
 * @returns One value per bubble, 0 (paper) to 1 (black).
 */
export function measureBubbleFills(row: RowBubbles, darkness: ImageMap): number[] {
  return row.centers.map((center, column) =>
    measureOval(
      darkness,
      center,
      row,
      FILL_HALF_LENGTH_PER_BUBBLE_SPACING * row.bubbleSpacing[column],
      FILL_HALF_WIDTH_PER_MARK_SPACING * row.markSpacing,
    ),
  );
}

/**
 * Measures how dark the paper inside a bubble is, ignoring its printed digit.
 *
 * @param row Supplies the row's directions.
 * @param halfLength Half the oval's length along the row, in pixels.
 * @param halfWidth Half the oval's width across the row, in pixels.
 */
function measureOval(
  darkness: ImageMap,
  center: Point,
  row: RowBubbles,
  halfLength: number,
  halfWidth: number,
): number {
  const { alongRow, acrossRow } = row;
  const samples: number[] = [];
  // A 9 x 7 grid of points, keeping those inside the oval.
  for (let alongIndex = -4; alongIndex <= 4; alongIndex++) {
    for (let acrossIndex = -3; acrossIndex <= 3; acrossIndex++) {
      const along = alongIndex / 4;
      const across = acrossIndex / 3;
      if (along * along + across * across > 1.05) {
        continue;
      }
      samples.push(
        darkness.sample(
          center.x + alongRow.x * along * halfLength + acrossRow.x * across * halfWidth,
          center.y + alongRow.y * along * halfLength + acrossRow.y * across * halfWidth,
        ),
      );
    }
  }
  samples.sort((first, second) => first - second);
  const lightestCount = Math.ceil(samples.length * LIGHTEST_SAMPLE_SHARE);
  let total = 0;
  for (let index = 0; index < lightestCount; index++) {
    total += samples[index];
  }
  return total / lightestCount;
}

/**
 * Decides every row's value from the measured fills.
 *
 * @param fillsByRow Output of {@link measureBubbleFills} for all 35 rows.
 */
export function readRows(fillsByRow: number[][]): RowReading[] {
  const lifts = measureLiftAboveEmpty(fillsByRow);

  // Learn this card's typical fill from the rows with a clear mark.
  const clearMarks = lifts
    .map((rowLifts) => Math.max(...rowLifts))
    .filter((lift) => lift >= ABSOLUTE_MINIMUM_FILL);
  const typicalFill = clearMarks.length > 0 ? median(clearMarks) : DEFAULT_TYPICAL_FILL;
  const filledThreshold = Math.max(ABSOLUTE_MINIMUM_FILL, FILLED_SHARE_OF_TYPICAL * typicalFill);
  const lightThreshold = Math.max(ABSOLUTE_LIGHT_FILL, LIGHT_SHARE_OF_TYPICAL * typicalFill);

  return lifts.map((rowLifts) => decideRow(rowLifts, filledThreshold, lightThreshold));
}

/**
 * Converts raw fill darkness into "how much darker than an empty bubble in
 * the same column".
 *
 * First, each row's median is subtracted; most bubbles in a row are empty,
 * so this removes row-to-row lighting differences. Then, for each column,
 * the lower quartile across all rows is taken as that column's empty level
 * and subtracted too. Arrow rows and shooter-number rows have different
 * printed digits, so they learn their column levels separately.
 */
function measureLiftAboveEmpty(fillsByRow: number[][]): number[][] {
  const relativeToRow = fillsByRow.map((fills) => {
    const rowMedian = median(fills);
    return fills.map((fill) => fill - rowMedian);
  });

  const scoreColumnLevels = learnColumnLevels(relativeToRow.slice(0, SCORE_ROW_COUNT));
  const shooterColumnLevels = learnColumnLevels(relativeToRow.slice(SCORE_ROW_COUNT));

  return relativeToRow.map((rowValues, rowIndex) => {
    const columnLevels = rowIndex < SCORE_ROW_COUNT ? scoreColumnLevels : shooterColumnLevels;
    return rowValues.map((value, column) => value - columnLevels[column]);
  });
}

/** Finds the typical level of an empty bubble in each column. */
function learnColumnLevels(rows: number[][]): number[] {
  const levels: number[] = [];
  for (let column = 0; column < SCORE_BUBBLES_PER_ROW; column++) {
    const valuesInColumn = rows.filter((row) => row.length > column).map((row) => row[column]);
    levels.push(valuesInColumn.length > 0 ? lowerQuartile(valuesInColumn) : 0);
  }
  return levels;
}

/**
 * Picks the filled bubble in one row and flags anything a person should check.
 *
 * @param lifts How much darker than empty each bubble is.
 */
function decideRow(lifts: number[], filledThreshold: number, lightThreshold: number): RowReading {
  const columnsDarkestFirst = lifts
    .map((_, column) => column)
    .sort((first, second) => lifts[second] - lifts[first]);
  const darkestColumn = columnsDarkestFirst[0];
  const runnerUpColumn = columnsDarkestFirst[1];
  const darkest = lifts[darkestColumn];
  const runnerUp = lifts[runnerUpColumn];

  if (darkest < filledThreshold) {
    return { value: null, flag: FLAG_MESSAGES.noMark };
  }
  if (runnerUp >= filledThreshold && runnerUp > DOUBLE_MARK_SHARE * darkest) {
    return { value: darkestColumn, flag: FLAG_MESSAGES.doubleMark(darkestColumn, runnerUpColumn) };
  }
  if (darkest < lightThreshold) {
    return { value: darkestColumn, flag: FLAG_MESSAGES.lightMark };
  }
  return { value: darkestColumn, flag: null };
}
