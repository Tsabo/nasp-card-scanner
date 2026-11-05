/**
 * @file NASP scorecard scoring rules: 6 rounds of 5 arrows, scored 0 to 10.
 * Rounds 1 to 3 are shot from 10 meters and rounds 4 to 6 from 15 meters.
 *
 * Pure functions only, so they're easy to test.
 */

export const ROUND_COUNT = 6;
export const ARROWS_PER_ROUND = 5;
export const ARROW_COUNT = ROUND_COUNT * ARROWS_PER_ROUND;
export const MAXIMUM_ARROW_SCORE = 10;
export const MAXIMUM_SCORECARD_SCORE = ARROW_COUNT * MAXIMUM_ARROW_SCORE;

/** Rounds shot from 10 meters; the rest are from 15 meters. */
export const TEN_METER_ROUND_COUNT = 3;

/** One arrow's score, or null when it hasn't been entered. */
export type ArrowScore = number | null;

/** The totals for a scorecard. */
export interface ScorecardSummary {
  /** One per round. Blank arrows count as 0. */
  roundTotals: number[];
  /** Rounds 1 to 3. */
  tenMeterTotal: number;
  /** Rounds 4 to 6. */
  fifteenMeterTotal: number;
  /** Out of 300. */
  total: number;
  /** Arrows that scored 10. */
  tensCount: number;
  /** Arrows that aren't blank. */
  arrowsEntered: number;
}

/**
 * Totals a scorecard.
 *
 * @param arrowScores Every arrow in card order (Round 1 arrow 1 first).
 */
export function summarizeScorecard(arrowScores: readonly ArrowScore[]): ScorecardSummary {
  const roundTotals: number[] = [];
  for (let roundIndex = 0; roundIndex < ROUND_COUNT; roundIndex++) {
    roundTotals.push(sumScores(getRoundScores(arrowScores, roundIndex)));
  }
  const tenMeterTotal = sumScores(roundTotals.slice(0, TEN_METER_ROUND_COUNT));
  const fifteenMeterTotal = sumScores(roundTotals.slice(TEN_METER_ROUND_COUNT));

  return {
    roundTotals,
    tenMeterTotal,
    fifteenMeterTotal,
    total: tenMeterTotal + fifteenMeterTotal,
    tensCount: arrowScores.filter((score) => score === MAXIMUM_ARROW_SCORE).length,
    arrowsEntered: arrowScores.filter((score) => score !== null).length,
  };
}

/**
 * Returns the five arrow scores of one round.
 *
 * @param roundIndex 0 for Round 1.
 */
export function getRoundScores(
  arrowScores: readonly ArrowScore[],
  roundIndex: number,
): ArrowScore[] {
  const first = roundIndex * ARROWS_PER_ROUND;
  return arrowScores.slice(first, first + ARROWS_PER_ROUND);
}

/**
 * Tells whether a round still has blank arrows.
 *
 * @param roundIndex 0 for Round 1.
 */
export function isRoundIncomplete(arrowScores: readonly ArrowScore[], roundIndex: number): boolean {
  return getRoundScores(arrowScores, roundIndex).some((score) => score === null);
}

/**
 * Describes an arrow's position for people, such as "Round 3 · arrow 4".
 *
 * @param arrowIndex 0 to 29.
 */
export function describeArrow(arrowIndex: number): string {
  const roundNumber = Math.floor(arrowIndex / ARROWS_PER_ROUND) + 1;
  const arrowNumber = (arrowIndex % ARROWS_PER_ROUND) + 1;
  return `Round ${roundNumber} · arrow ${arrowNumber}`;
}

/** Returns a scorecard with every arrow blank. */
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
