import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COLUMN_HEADINGS,
  createCsv,
  createTabSeparatedText,
  parseCsv,
  readRoundsFromCsv,
  UnrecognizedCsvError,
} from "../src/app/csv.ts";
import type { PracticeRound } from "../src/app/practice-round.ts";

const ROUND: PracticeRound = {
  id: "round-1",
  date: "2026-11-04",
  archer: 'Ryan "R.B." Brown, Jr.',
  shooterNumber: "10201",
  // One line per end. The last arrow is blank.
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
    const rows = parseCsv(createCsv([ROUND]));
    assert.deepEqual(rows[0], COLUMN_HEADINGS);
    assert.equal(rows.length, 2);
    const cells = Object.fromEntries(
      COLUMN_HEADINGS.map((heading, index) => [heading, rows[1][index]]),
    );
    assert.equal(cells["Archer"], ROUND.archer);
    assert.equal(cells["End 1"], "18");
    assert.equal(cells["Total"], "126");
    assert.equal(cells["10s"], "2");
    assert.equal(cells["E1A4"], "10");
    assert.equal(cells["E6A5"], "");
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

describe("readRoundsFromCsv", () => {
  it("reads back exactly what createCsv wrote", () => {
    const { rounds, unreadableRowCount } = readRoundsFromCsv(createCsv([ROUND]));
    assert.equal(unreadableRowCount, 0);
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].date, ROUND.date);
    assert.equal(rounds[0].archer, ROUND.archer);
    assert.equal(rounds[0].shooterNumber, ROUND.shooterNumber);
    assert.deepEqual(rounds[0].arrowScores, ROUND.arrowScores);
  });

  it("skips rows with an impossible score", () => {
    const rows = parseCsv(createCsv([ROUND]));
    rows[1][COLUMN_HEADINGS.indexOf("E2A1")] = "11";
    const text = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const { rounds, unreadableRowCount } = readRoundsFromCsv(text);
    assert.equal(rounds.length, 0);
    assert.equal(unreadableRowCount, 1);
  });

  it("rejects a CSV that this app didn't export", () => {
    assert.throws(() => readRoundsFromCsv("Name,Score\nRyan,282\n"), UnrecognizedCsvError);
  });
});

describe("createTabSeparatedText", () => {
  it("uses tabs between cells and keeps tabs out of the values", () => {
    const text = createTabSeparatedText([{ ...ROUND, archer: "Tab\there" }]);
    const [headingLine, dataLine] = text.split("\n");
    assert.equal(headingLine.split("\t").length, COLUMN_HEADINGS.length);
    assert.equal(dataLine.split("\t")[1], "Tab here");
  });
});
