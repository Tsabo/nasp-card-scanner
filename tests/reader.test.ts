import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import jpeg from "jpeg-js";

import { analyzeCard } from "../src/reader/analyze-card.ts";
import { solveLinearSystem3x3 } from "../src/reader/statistics.ts";

/**
 * The sample card's arrows, as the archer meant them. End 3, arrow 4 (index
 * 13) is a 9, but a stray 6 is filled in too, so the reader should flag it.
 */
const SAMPLE_CARD_SCORES = [
  9, 8, 10, 7, 9, 8, 9, 9, 6, 10, 10, 8, 7, 9, 8, 7, 9, 8, 8, 6, 9, 7, 10, 8, 7, 8, 6, 9, 9, 7,
];
const SAMPLE_CARD_SHOOTER_NUMBER = "40712";
const DOUBLE_MARKED_ARROW = 13;

/** A decoded photo. */
interface Photo {
  /** RGBA bytes. */
  pixels: Uint8Array;
  width: number;
  height: number;
}

function loadSampleCard(): Photo {
  const file = readFileSync(new URL("../assets/sample-card.jpg", import.meta.url));
  const decoded = jpeg.decode(file, { useTArray: true });
  return { pixels: decoded.data, width: decoded.width, height: decoded.height };
}

/** Rotates a photo a quarter turn clockwise. */
function rotateClockwise(photo: Photo): Photo {
  const { pixels, width, height } = photo;
  const rotated = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = (x * height + (height - 1 - y)) * 4;
      rotated.set(pixels.subarray(from, from + 4), to);
    }
  }
  return { pixels: rotated, width: height, height: width };
}

/** Reads a photo and checks it gives the sample card's scores. */
function assertReadsSampleCard(photo: Photo): void {
  const result = analyzeCard(photo.pixels, photo.width, photo.height);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.deepEqual(
    result.scores.map((arrow) => arrow.value),
    // With two bubbles filled, the reader picks the darker one (here the
    // stray 6) and flags the arrow so the coach can correct it.
    SAMPLE_CARD_SCORES.map((score, index) => (index === DOUBLE_MARKED_ARROW ? 6 : score)),
  );
  assert.equal(result.shooter.map((digit) => digit.value).join(""), SAMPLE_CARD_SHOOTER_NUMBER);

  const flagged = result.scores.flatMap((arrow, index) => (arrow.flag ? [index] : []));
  assert.deepEqual(flagged, [DOUBLE_MARKED_ARROW]);
  assert.match(result.scores[DOUBLE_MARKED_ARROW].flag ?? "", /Two bubbles marked \(6 and 9\)/);
}

describe("analyzeCard", () => {
  const sample = loadSampleCard();

  it("reads the sample card", () => {
    assertReadsSampleCard(sample);
  });

  it("reads the card sideways", () => {
    assertReadsSampleCard(rotateClockwise(sample));
  });

  it("reads the card upside down", () => {
    assertReadsSampleCard(rotateClockwise(rotateClockwise(sample)));
  });

  it("explains when there is no card in the photo", () => {
    const blank = new Uint8Array(400 * 300 * 4).fill(255);
    const result = analyzeCard(blank, 400, 300);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /timing marks/);
  });
});

describe("solveLinearSystem3x3", () => {
  it("solves a system that needs row swaps", () => {
    const solution = solveLinearSystem3x3(
      [
        [0, 2, 1],
        [1, 1, 1],
        [2, 0, 3],
      ],
      [7, 6, 11],
    );
    assert.ok(solution);
    [1, 2, 3].forEach((expected, index) => assert.ok(Math.abs(solution[index] - expected) < 1e-9));
  });

  it("returns null for a singular system", () => {
    assert.equal(
      solveLinearSystem3x3(
        [
          [1, 2, 3],
          [2, 4, 6],
          [1, 1, 1],
        ],
        [1, 2, 3],
      ),
      null,
    );
  });
});
