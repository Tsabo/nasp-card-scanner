import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import jpeg from "jpeg-js";

import { analyzeCard } from "../src/reader/analyze-card.ts";
import { solveLinearSystem3x3 } from "../src/reader/statistics.ts";

/**
 * The sample card's arrows, as the archer meant them. Round 3, arrow 4 (index
 * 13) is a 9, but a stray 6 is filled in too, so the reader should flag it.
 */
const SAMPLE_CARD_SCORES = [
  9, 8, 10, 7, 9, 8, 9, 9, 6, 10, 10, 8, 7, 9, 8, 7, 9, 8, 8, 6, 9, 7, 10, 8, 7, 8, 6, 9, 9, 7,
];
const SAMPLE_CARD_SHOOTER_NUMBER = "40712";
const DOUBLE_MARKED_ARROW = 13;

/**
 * A real photo of an official card: tilted away from the camera, with a thumb
 * over three timing marks, pencil sums beside the track, and the corner mark
 * out of frame. The shooter number was left blank.
 */
const THUMB_PHOTO_SCORES = [
  10, 10, 9, 9, 8, 10, 9, 9, 8, 8, 10, 10, 10, 9, 8, 10, 10, 10, 10, 9, 10, 8, 8, 8, 7, 9, 9, 9, 7,
  7,
];

/** A decoded photo. */
interface Photo {
  /** RGBA bytes. */
  pixels: Uint8Array;
  width: number;
  height: number;
}

function loadSampleCard(): Photo {
  return loadPhoto("../assets/sample-card.jpg");
}

function loadPhoto(relativePath: string): Photo {
  const file = readFileSync(new URL(relativePath, import.meta.url));
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

/** Shrinks a photo by averaging blocks of pixels, as a browser does. */
function shrink(photo: Photo, factor: number): Photo {
  const { pixels, width, height } = photo;
  const newWidth = Math.floor(width / factor);
  const newHeight = Math.floor(height / factor);
  const totals = new Float64Array(newWidth * newHeight * 3);
  for (let y = 0; y < newHeight * factor; y++) {
    for (let x = 0; x < newWidth * factor; x++) {
      const to = (Math.floor(y / factor) * newWidth + Math.floor(x / factor)) * 3;
      const from = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        totals[to + channel] += pixels[from + channel];
      }
    }
  }
  const shrunk = new Uint8Array(newWidth * newHeight * 4);
  for (let pixel = 0; pixel < newWidth * newHeight; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      shrunk[pixel * 4 + channel] = totals[pixel * 3 + channel] / (factor * factor);
    }
    shrunk[pixel * 4 + 3] = 255;
  }
  return { pixels: shrunk, width: newWidth, height: newHeight };
}

/**
 * Re-photographs a photo from a different angle.
 *
 * @param leanSideways How far the left or right side recedes.
 * @param leanForward How far the top or bottom recedes.
 */
function tilt(photo: Photo, leanSideways: number, leanForward: number): Photo {
  const { pixels, width, height } = photo;
  const tilted = new Uint8Array(pixels.length);
  const reach = Math.max(width, height) / 2;
  const zoomOut = 0.85;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const across = (x - width / 2) / reach;
      const down = (y - height / 2) / reach;
      const depth = (1 + leanSideways * across + leanForward * down) * zoomOut;
      const fromX = Math.round((across / depth) * reach + width / 2);
      const fromY = Math.round((down / depth) * reach + height / 2);
      const to = (y * width + x) * 4;
      if (fromX >= 0 && fromY >= 0 && fromX < width && fromY < height) {
        const from = (fromY * width + fromX) * 4;
        tilted.set(pixels.subarray(from, from + 4), to);
      } else {
        tilted.set([150, 120, 85, 255], to);
      }
    }
  }
  return { pixels: tilted, width, height };
}

/** Paints over part of a photo, with each edge given as a share of the photo's size. */
function cover(photo: Photo, left: number, top: number, right: number, bottom: number): Photo {
  const { width, height } = photo;
  const covered = photo.pixels.slice();
  for (let y = Math.round(top * height); y < bottom * height; y++) {
    for (let x = Math.round(left * width); x < right * width; x++) {
      covered.set([200, 150, 130, 255], (y * width + x) * 4);
    }
  }
  return { pixels: covered, width, height };
}

/** Reads a photo and checks it gives the thumb photo's scores, with no arrow flagged. */
function assertReadsThumbPhoto(photo: Photo): void {
  const result = analyzeCard(photo.pixels, photo.width, photo.height);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.deepEqual(
    result.scores.map((arrow) => arrow.value),
    THUMB_PHOTO_SCORES,
  );
  assert.deepEqual(
    result.scores.flatMap((arrow, index) => (arrow.flag ? [index] : [])),
    [],
  );
  assert.deepEqual(
    result.shooter.map((digit) => digit.value),
    [null, null, null, null, null],
  );
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

  it("reads a card tilted steeply away from the camera", () => {
    assertReadsSampleCard(tilt(sample, 0.1, 0.25));
    assertReadsSampleCard(tilt(sample, -0.12, -0.15));
  });

  it("reads the card with a thumb over the timing marks", () => {
    assertReadsSampleCard(cover(sample, 0, 0.3, 0.31, 0.45));
  });

  describe("real photo with a thumb over the track", () => {
    const thumbPhoto = loadPhoto("./fixtures/thumb-over-track.jpg");

    it("reads every arrow", () => {
      assertReadsThumbPhoto(thumbPhoto);
    });

    it("gives the same answer at a lower resolution", () => {
      assertReadsThumbPhoto(shrink(thumbPhoto, 2));
    });

    it("reads every arrow from other camera angles", () => {
      assertReadsThumbPhoto(tilt(thumbPhoto, 0.1, 0.1));
      assertReadsThumbPhoto(tilt(thumbPhoto, 0, -0.15));
    });

    it("refuses to make up scores when the marks have no bubbles beside them", () => {
      const firstBlankColumn = Math.round(thumbPhoto.width * 0.2);
      const blanked = thumbPhoto.pixels.slice();
      for (let y = 0; y < thumbPhoto.height; y++) {
        for (let x = firstBlankColumn; x < thumbPhoto.width; x++) {
          blanked.set([235, 235, 225, 255], (y * thumbPhoto.width + x) * 4);
        }
      }
      const result = analyzeCard(blanked, thumbPhoto.width, thumbPhoto.height);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, /line up the bubbles/);
    });
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
