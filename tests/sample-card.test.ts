import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import jpeg from "jpeg-js";

import { analyzeCard } from "../src/reader/analyze-card.ts";
import { createBlankReading, readBlankCardLayout } from "../src/app/sample-card.ts";

/**
 * How far the stored positions may be from where the reader finds them, as a
 * share of the space between bubbles. A tenth is far too little to see, but
 * catches anything misplaced, like a row off by a bubble.
 */
const ALLOWED_DRIFT_SHARE = 0.1;

function loadAsset(name: string): Buffer {
  return readFileSync(new URL(`../assets/${name}`, import.meta.url));
}

const LAYOUT = readBlankCardLayout(JSON.parse(loadAsset("sample-card-blank.json").toString()));

describe("the blank sample card", () => {
  it("has its bubbles where the reader finds them", () => {
    const photo = jpeg.decode(loadAsset("sample-card-blank.jpg"), { useTArray: true });
    assert.equal(photo.width, LAYOUT.width);
    assert.equal(photo.height, LAYOUT.height);

    const result = analyzeCard(photo.data, photo.width, photo.height);
    assert.ok(result.ok, result.ok ? "" : result.error);
    const [firstBubble, secondBubble] = LAYOUT.rows[0];
    const allowedDrift =
      ALLOWED_DRIFT_SHARE *
      Math.hypot(secondBubble.x - firstBubble.x, secondBubble.y - firstBubble.y);
    const foundRows = [...result.scores, ...result.shooter];
    LAYOUT.rows.forEach((centers, rowIndex) => {
      centers.forEach((center, bubbleIndex) => {
        const found = foundRows[rowIndex].centers[bubbleIndex];
        const drift = Math.hypot(found.x - center.x, found.y - center.y);
        assert.ok(
          drift <= allowedDrift,
          `row ${rowIndex}, bubble ${bubbleIndex} is ${drift.toFixed(1)} px off`,
        );
      });
    });
  });

  it("reads as a card with nothing filled in", () => {
    const photo = jpeg.decode(loadAsset("sample-card-blank.jpg"), { useTArray: true });
    const result = analyzeCard(photo.data, photo.width, photo.height);
    assert.ok(result.ok);
    assert.deepEqual(
      [...result.scores, ...result.shooter].map((row) => row.value),
      new Array(35).fill(null),
    );
  });
});

describe("createBlankReading", () => {
  it("places every row's bubbles and timing mark, scaled to the photo as shown", () => {
    const reading = createBlankReading(LAYOUT, 0.5);
    assert.equal(reading.scores.length, 30);
    assert.equal(reading.shooter.length, 5);
    assert.equal(reading.scores[0].centers.length, 11);
    assert.equal(reading.shooter[0].centers.length, 10);
    assert.deepEqual(reading.scores[0].centers[0], {
      x: LAYOUT.rows[0][0].x / 2,
      y: LAYOUT.rows[0][0].y / 2,
    });
    assert.deepEqual(reading.timingMarks[34], {
      x: LAYOUT.timingMarks[34].x / 2,
      y: LAYOUT.timingMarks[34].y / 2,
      wasDetected: true,
    });
  });

  it("finds nothing filled in", () => {
    const reading = createBlankReading(LAYOUT, 1);
    for (const row of [...reading.scores, ...reading.shooter]) {
      assert.equal(row.value, null);
      assert.equal(row.flag, null);
    }
  });
});

describe("readBlankCardLayout", () => {
  it("refuses data that isn't a card's layout", () => {
    assert.throws(() => readBlankCardLayout({ width: 10, height: 10, timingMarks: [], rows: [] }));
    assert.throws(() => readBlankCardLayout("not a layout"));
  });
});
