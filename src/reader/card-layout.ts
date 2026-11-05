/**
 * @file The fixed geometry of the NASP "Official Score Card".
 *
 * Every number here was measured from the official card (the AccuScan /
 * DataLink 1200 form). The reader never assumes the card's size or position
 * in a photo; it finds the black timing marks down the card's edge and
 * measures everything else relative to the spacing between those marks.
 *
 * Card structure, top to bottom:
 *
 *   one lone "corner" timing mark
 *   Round 1 .. Round 3   (10 meters)   5 rows each, bubbles 0..10
 *   Round 4 .. Round 6   (15 meters)   5 rows each, bubbles 0..10
 *   Shooter #                          5 rows (one per digit), bubbles 0..9
 *
 * Each row of bubbles has its own timing mark at the left edge of the card.
 */

/**
 * Where each timing mark sits along the card's edge, in pixels, measured on
 * the official card rendered at 200 dpi. Only the relative spacing matters:
 * the uneven gaps between groups of marks form a pattern that identifies
 * which detected mark is which, and which way up the card is.
 *
 * Index 0 is the corner mark. Indexes 1 to 35 are the row marks, in row
 * order (Round 1 row 1 first, Shooter # digit 5 last).
 */
export const TIMING_MARK_POSITIONS: readonly number[] = Object.freeze([
  52.5, 232.5, 272.5, 312.5, 352.6, 393.0, 443.5, 483.5, 523.5, 563.5, 603.5, 654.0, 694.0, 733.0,
  773.0, 813.1, 913.1, 953.2, 993.5, 1033.3, 1073.2, 1123.5, 1163.5, 1203.7, 1243.9, 1283.9, 1334.0,
  1374.0, 1414.0, 1454.3, 1494.5, 1547.7, 1588.0, 1628.1, 1668.0, 1708.1,
]);

/** Number of timing marks that come before the first row's mark. */
export const MARKS_BEFORE_FIRST_ROW = 1;

/** Distance between neighbouring row marks within a section, in template pixels. */
export const TEMPLATE_MARK_PITCH = 40;

/**
 * Roughly the middle of {@link TIMING_MARK_POSITIONS}. Positions are measured
 * relative to it when fitting, which keeps the arithmetic well conditioned.
 */
export const TEMPLATE_MIDPOINT = 900;

/** Sections on the card: six rounds plus the shooter number. */
export const SECTION_COUNT = 7;

/** Rows in every section: five arrows per round, or five shooter-number digits. */
export const ROWS_PER_SECTION = 5;

/** Total rows of bubbles on the card. */
export const ROW_COUNT = SECTION_COUNT * ROWS_PER_SECTION;

/** Rows that hold arrow scores (the six rounds). The rest hold shooter-number digits. */
export const SCORE_ROW_COUNT = 30;

/** Bubbles in an arrow row: 0 through 10. */
export const SCORE_BUBBLES_PER_ROW = 11;

/** Bubbles in a shooter-number row: 0 through 9. */
export const SHOOTER_BUBBLES_PER_ROW = 10;

/**
 * Distance from a row's timing mark to the centre of its "0" bubble,
 * measured in units of the spacing between neighbouring timing marks.
 */
export const FIRST_BUBBLE_OFFSET = 4.01;

/**
 * Distance between the centres of neighbouring bubbles in a row, measured in
 * units of the spacing between neighbouring timing marks.
 */
export const BUBBLE_SPACING = 1.503;

/**
 * Returns how many bubbles a row has: 11 for arrow rows, 10 for
 * shooter-number rows.
 *
 * @param rowIndex Row number from 0 (Round 1, arrow 1) to 34 (last shooter digit).
 */
export function getBubbleCount(rowIndex: number): number {
  return isScoreRow(rowIndex) ? SCORE_BUBBLES_PER_ROW : SHOOTER_BUBBLES_PER_ROW;
}

/**
 * Tells whether a row holds an arrow score rather than a shooter-number digit.
 *
 * @param rowIndex Row number from 0 to 34.
 */
export function isScoreRow(rowIndex: number): boolean {
  return rowIndex < SCORE_ROW_COUNT;
}

/**
 * Returns which section a row belongs to: 0 to 5 for Round 1 to 6, 6 for Shooter #.
 *
 * @param rowIndex Row number from 0 to 34.
 */
export function getSectionIndex(rowIndex: number): number {
  return Math.floor(rowIndex / ROWS_PER_SECTION);
}

/**
 * Returns the index into {@link TIMING_MARK_POSITIONS} of a row's timing mark.
 *
 * @param rowIndex Row number from 0 to 34.
 */
export function getTimingMarkIndex(rowIndex: number): number {
  return MARKS_BEFORE_FIRST_ROW + rowIndex;
}
