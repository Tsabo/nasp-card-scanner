import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeArrow, isEndIncomplete, summarizeRound } from "../src/app/scoring.ts";
import type { ArrowScore } from "../src/app/scoring.ts";

/** Tonight's practice card: ends of 48, 49, 50, 47, 45 and 43. */
const PRACTICE_ROUND: ArrowScore[] = [
  [10, 10, 10, 9, 9],
  [10, 10, 10, 10, 9],
  [10, 10, 10, 10, 10],
  [10, 10, 10, 9, 8],
  [10, 10, 9, 8, 8],
  [10, 10, 9, 8, 6],
].flat();

describe("summarizeRound", () => {
  it("totals each end, each distance and the round", () => {
    const summary = summarizeRound(PRACTICE_ROUND);
    assert.deepEqual(summary.endTotals, [48, 49, 50, 47, 45, 43]);
    assert.equal(summary.tenMeterTotal, 147);
    assert.equal(summary.fifteenMeterTotal, 135);
    assert.equal(summary.total, 282);
    assert.equal(summary.tensCount, 19);
    assert.equal(summary.arrowsEntered, 30);
  });

  it("counts blank arrows as 0 and reports how many were entered", () => {
    const scores = [...PRACTICE_ROUND];
    scores[0] = null;
    scores[29] = null;
    const summary = summarizeRound(scores);
    assert.equal(summary.total, 282 - 10 - 6);
    assert.equal(summary.arrowsEntered, 28);
  });
});

describe("isEndIncomplete", () => {
  it("is true only for ends with a blank arrow", () => {
    const scores = [...PRACTICE_ROUND];
    scores[7] = null;
    assert.equal(isEndIncomplete(scores, 0), false);
    assert.equal(isEndIncomplete(scores, 1), true);
  });
});

describe("describeArrow", () => {
  it("numbers ends and arrows from 1", () => {
    assert.equal(describeArrow(0), "End 1 · arrow 1");
    assert.equal(describeArrow(13), "End 3 · arrow 4");
    assert.equal(describeArrow(29), "End 6 · arrow 5");
  });
});
