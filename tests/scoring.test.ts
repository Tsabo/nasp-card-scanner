import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeArrow, isRoundIncomplete, summarizeScorecard } from "../src/app/scoring.ts";
import type { ArrowScore } from "../src/app/scoring.ts";

/** Tonight's practice card: rounds of 48, 49, 50, 47, 45 and 43. */
const PRACTICE_SCORECARD: ArrowScore[] = [
  [10, 10, 10, 9, 9],
  [10, 10, 10, 10, 9],
  [10, 10, 10, 10, 10],
  [10, 10, 10, 9, 8],
  [10, 10, 9, 8, 8],
  [10, 10, 9, 8, 6],
].flat();

describe("summarizeScorecard", () => {
  it("totals each round, each distance and the scorecard", () => {
    const summary = summarizeScorecard(PRACTICE_SCORECARD);
    assert.deepEqual(summary.roundTotals, [48, 49, 50, 47, 45, 43]);
    assert.equal(summary.tenMeterTotal, 147);
    assert.equal(summary.fifteenMeterTotal, 135);
    assert.equal(summary.total, 282);
    assert.equal(summary.tensCount, 19);
    assert.equal(summary.arrowsEntered, 30);
  });

  it("counts blank arrows as 0 and reports how many were entered", () => {
    const scores = [...PRACTICE_SCORECARD];
    scores[0] = null;
    scores[29] = null;
    const summary = summarizeScorecard(scores);
    assert.equal(summary.total, 282 - 10 - 6);
    assert.equal(summary.arrowsEntered, 28);
  });
});

describe("isRoundIncomplete", () => {
  it("is true only for rounds with a blank arrow", () => {
    const scores = [...PRACTICE_SCORECARD];
    scores[7] = null;
    assert.equal(isRoundIncomplete(scores, 0), false);
    assert.equal(isRoundIncomplete(scores, 1), true);
  });
});

describe("describeArrow", () => {
  it("numbers rounds and arrows from 1", () => {
    assert.equal(describeArrow(0), "Round 1 · arrow 1");
    assert.equal(describeArrow(13), "Round 3 · arrow 4");
    assert.equal(describeArrow(29), "Round 6 · arrow 5");
  });
});
