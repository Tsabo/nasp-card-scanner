/**
 * @file NASP round scoring rules: 6 ends of 5 arrows, scored 0 to 10.
 * Ends 1 to 3 are shot from 10 meters and ends 4 to 6 from 15 meters.
 *
 * Pure functions only, so they're easy to test.
 */

export const END_COUNT = 6;
export const ARROWS_PER_END = 5;
export const ARROW_COUNT = END_COUNT * ARROWS_PER_END;
export const MAXIMUM_ARROW_SCORE = 10;
export const MAXIMUM_ROUND_SCORE = ARROW_COUNT * MAXIMUM_ARROW_SCORE;

/** Ends shot from 10 meters; the rest are from 15 meters. */
export const TEN_METER_END_COUNT = 3;

/** One arrow's score, or null when it hasn't been entered. */
export type ArrowScore = number | null;

/** The totals for a round. */
export interface RoundSummary {
  /** One per end. Blank arrows count as 0. */
  endTotals: number[];
  /** Ends 1 to 3. */
  tenMeterTotal: number;
  /** Ends 4 to 6. */
  fifteenMeterTotal: number;
  /** Out of 300. */
  total: number;
  /** Arrows that scored 10. */
  tensCount: number;
  /** Arrows that aren't blank. */
  arrowsEntered: number;
}

/**
 * Totals a round.
 *
 * @param arrowScores Every arrow in card order (End 1 arrow 1 first).
 */
export function summarizeRound(arrowScores: readonly ArrowScore[]): RoundSummary {
  const endTotals: number[] = [];
  for (let endIndex = 0; endIndex < END_COUNT; endIndex++) {
    endTotals.push(sumScores(getEndScores(arrowScores, endIndex)));
  }
  const tenMeterTotal = sumScores(endTotals.slice(0, TEN_METER_END_COUNT));
  const fifteenMeterTotal = sumScores(endTotals.slice(TEN_METER_END_COUNT));

  return {
    endTotals,
    tenMeterTotal,
    fifteenMeterTotal,
    total: tenMeterTotal + fifteenMeterTotal,
    tensCount: arrowScores.filter((score) => score === MAXIMUM_ARROW_SCORE).length,
    arrowsEntered: arrowScores.filter((score) => score !== null).length,
  };
}

/**
 * Returns the five arrow scores of one end.
 *
 * @param endIndex 0 for End 1.
 */
export function getEndScores(arrowScores: readonly ArrowScore[], endIndex: number): ArrowScore[] {
  const first = endIndex * ARROWS_PER_END;
  return arrowScores.slice(first, first + ARROWS_PER_END);
}

/**
 * Tells whether an end still has blank arrows.
 *
 * @param endIndex 0 for End 1.
 */
export function isEndIncomplete(arrowScores: readonly ArrowScore[], endIndex: number): boolean {
  return getEndScores(arrowScores, endIndex).some((score) => score === null);
}

/**
 * Describes an arrow's position for people, such as "End 3 · arrow 4".
 *
 * @param arrowIndex 0 to 29.
 */
export function describeArrow(arrowIndex: number): string {
  const endNumber = Math.floor(arrowIndex / ARROWS_PER_END) + 1;
  const arrowNumber = (arrowIndex % ARROWS_PER_END) + 1;
  return `End ${endNumber} · arrow ${arrowNumber}`;
}

/** Returns a round with every arrow blank. */
export function createBlankScores(): ArrowScore[] {
  return new Array<ArrowScore>(ARROW_COUNT).fill(null);
}

/** Adds up scores, treating blanks as 0. */
function sumScores(scores: readonly ArrowScore[]): number {
  let sum = 0;
  for (const score of scores) {
    sum += score ?? 0;
  }
  return sum;
}
