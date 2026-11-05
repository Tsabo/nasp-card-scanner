import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COLUMN_HEADINGS,
  createCsv,
  createTabSeparatedText,
  parseCsv,
  readScorecardsFromCsv,
  UnrecognizedCsvError,
} from "../src/app/csv.ts";
import type { Scorecard } from "../src/app/scorecard.ts";

const SCORECARD: Scorecard = {
  id: "scorecard-1",
  date: "2026-11-04",
  archer: 'Ryan "R.B." Brown, Jr.',
  shooterNumber: "10201",
  // One line per round. The last arrow is blank.
  arrowScores: [
    [1, 2, 5, 10, 0],
    [8, 4, 2, 1, 1],
    [4, 4, 5, 5, 6],
    [9, 8, 0, 2, 0],
    [8, 7, 4, 3, 2],
    [10, 8, 7, 0, null],
  ].flat(),
  createdAt: 1,
};

describe("createCsv", () => {
  it("writes a heading row, totals and every arrow", () => {
    const rows = parseCsv(createCsv([SCORECARD]));
    assert.deepEqual(rows[0], COLUMN_HEADINGS);
    assert.equal(rows.length, 2);
    const cells = Object.fromEntries(
      COLUMN_HEADINGS.map((heading, index) => [heading, rows[1][index]]),
    );
    assert.equal(cells["Archer"], SCORECARD.archer);
    assert.equal(cells["Round 1"], "18");
    assert.equal(cells["Total"], "126");
    assert.equal(cells["10s"], "2");
    assert.equal(cells["R1A4"], "10");
    assert.equal(cells["R6A5"], "");
  });

  it("starts with a byte-order mark so Excel reads it as UTF-8", () => {
    assert.ok(createCsv([]).startsWith("﻿"));
  });
});

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes, line breaks and blank lines", () => {
    const text = 'a,"b, c","say ""hi"""\r\n\r\n"two\nlines",x,\n';
    assert.deepEqual(parseCsv(text), [
      ["a", "b, c", 'say "hi"'],
      ["two\nlines", "x", ""],
    ]);
  });
});

describe("readScorecardsFromCsv", () => {
  it("reads back exactly what createCsv wrote", () => {
    const { scorecards, unreadableRowCount } = readScorecardsFromCsv(createCsv([SCORECARD]));
    assert.equal(unreadableRowCount, 0);
    assert.equal(scorecards.length, 1);
    assert.equal(scorecards[0].date, SCORECARD.date);
    assert.equal(scorecards[0].archer, SCORECARD.archer);
    assert.equal(scorecards[0].shooterNumber, SCORECARD.shooterNumber);
    assert.deepEqual(scorecards[0].arrowScores, SCORECARD.arrowScores);
  });

  it("reads files exported with the older E1A1 arrow headings", () => {
    const [headingRow, ...dataRows] = parseCsv(createCsv([SCORECARD]));
    const legacyHeadings = headingRow.map((heading) =>
      /^R\dA\d$/.test(heading) ? `E${heading.slice(1)}` : heading,
    );
    const text = [legacyHeadings, ...dataRows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const { scorecards } = readScorecardsFromCsv(text);
    assert.deepEqual(scorecards[0].arrowScores, SCORECARD.arrowScores);
  });

  it("skips rows with an impossible score", () => {
    const rows = parseCsv(createCsv([SCORECARD]));
    rows[1][COLUMN_HEADINGS.indexOf("R2A1")] = "11";
    const text = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const { scorecards, unreadableRowCount } = readScorecardsFromCsv(text);
    assert.equal(scorecards.length, 0);
    assert.equal(unreadableRowCount, 1);
  });

  it("rejects a CSV that this app didn't export", () => {
    assert.throws(() => readScorecardsFromCsv("Name,Score\nRyan,282\n"), UnrecognizedCsvError);
  });
});

describe("createTabSeparatedText", () => {
  it("uses tabs between cells and keeps tabs out of the values", () => {
    const text = createTabSeparatedText([{ ...SCORECARD, archer: "Tab\there" }]);
    const [headingLine, dataLine] = text.split("\n");
    assert.equal(headingLine.split("\t").length, COLUMN_HEADINGS.length);
    assert.equal(dataLine.split("\t")[1], "Tab here");
  });
});
