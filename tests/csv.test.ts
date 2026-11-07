import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BULLSEYE_COLUMN_HEADINGS,
  THREE_D_COLUMN_HEADINGS,
  createCsv,
  createExportTable,
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
  format: "bullseye",
  side: null,
  firstAnimal: null,
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

const THREE_D_SCORECARD: Scorecard = {
  ...SCORECARD,
  id: "scorecard-2",
  format: "3d",
  side: "left",
  firstAnimal: "Pronghorn Antelope",
};

/** Rebuilds CSV text from edited rows. */
function toCsvText(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}

describe("createCsv", () => {
  it("writes a heading row, totals and every arrow", () => {
    const rows = parseCsv(createCsv("bullseye", [SCORECARD]));
    assert.deepEqual(rows[0], BULLSEYE_COLUMN_HEADINGS);
    assert.equal(rows.length, 2);
    const cells = Object.fromEntries(
      BULLSEYE_COLUMN_HEADINGS.map((heading, index) => [heading, rows[1][index]]),
    );
    assert.equal(cells["Archer"], SCORECARD.archer);
    assert.equal(cells["Round 1"], "18");
    assert.equal(cells["Total"], "126");
    assert.equal(cells["10s"], "2");
    assert.equal(cells["R1A4"], "10");
    assert.equal(cells["R6A5"], "");
  });

  it("keeps the Bullseye columns as they were before formats existed", () => {
    const headings = BULLSEYE_COLUMN_HEADINGS.slice(0, 13);
    assert.deepEqual(headings, [
      "Date",
      "Archer",
      "Shooter #",
      "Round 1",
      "Round 2",
      "Round 3",
      "Round 4",
      "Round 5",
      "Round 6",
      "10 m",
      "15 m",
      "Total",
      "10s",
    ]);
    assert.equal(BULLSEYE_COLUMN_HEADINGS[13], "R1A1");
  });

  it("writes each 3D round's animal beside its total, with no distance totals", () => {
    const rows = parseCsv(createCsv("3d", [THREE_D_SCORECARD]));
    assert.deepEqual(rows[0].slice(0, 10), [
      "Date",
      "Archer",
      "Shooter #",
      "Format",
      "Side",
      "First animal",
      "Round 1",
      "Round 1 animal",
      "Round 2",
      "Round 2 animal",
    ]);
    assert.ok(!rows[0].includes("10 m"));
    assert.ok(!rows[0].includes("15 m"));
    const cells = Object.fromEntries(
      THREE_D_COLUMN_HEADINGS.map((heading, index) => [heading, rows[1][index]]),
    );
    assert.equal(cells["Format"], "3D");
    assert.equal(cells["Side"], "Left");
    assert.equal(cells["First animal"], "Pronghorn Antelope");
    assert.equal(cells["Round 1"], "18");
    assert.equal(cells["Round 1 animal"], "Pronghorn Antelope");
    assert.equal(cells["Round 4 animal"], "Alert Turkey");
    assert.equal(cells["Round 6 animal"], "Cinnamon Bear / Black Bear");
    assert.equal(cells["Total"], "126");
  });

  it("writes the round animals in reverse for the right side", () => {
    const rows = parseCsv(createCsv("3d", [{ ...THREE_D_SCORECARD, side: "right" }]));
    const cells = Object.fromEntries(
      THREE_D_COLUMN_HEADINGS.map((heading, index) => [heading, rows[1][index]]),
    );
    assert.equal(cells["Side"], "Right");
    assert.equal(cells["Round 1 animal"], "Pronghorn Antelope");
    assert.equal(cells["Round 2 animal"], "Cinnamon Bear / Black Bear");
    assert.equal(cells["Round 6 animal"], "Alert Deer / White-tailed Deer");
  });

  it("leaves out scorecards in the other format", () => {
    const scorecards = [SCORECARD, THREE_D_SCORECARD];
    assert.equal(createExportTable("bullseye", scorecards).rows.length, 1);
    assert.equal(createExportTable("3d", scorecards).rows.length, 1);
    assert.equal(parseCsv(createCsv("3d", [SCORECARD])).length, 1);
  });

  it("starts with a byte-order mark so Excel reads it as UTF-8", () => {
    assert.ok(createCsv("bullseye", []).startsWith("﻿"));
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
    const { scorecards, unreadableRowCount } = readScorecardsFromCsv(
      createCsv("bullseye", [SCORECARD]),
    );
    assert.equal(unreadableRowCount, 0);
    assert.equal(scorecards.length, 1);
    assert.equal(scorecards[0].date, SCORECARD.date);
    assert.equal(scorecards[0].archer, SCORECARD.archer);
    assert.equal(scorecards[0].shooterNumber, SCORECARD.shooterNumber);
    assert.deepEqual(scorecards[0].arrowScores, SCORECARD.arrowScores);
    assert.equal(scorecards[0].format, "bullseye");
    assert.equal(scorecards[0].side, null);
    assert.equal(scorecards[0].firstAnimal, null);
  });

  it("reads back a 3D scorecard, including its first animal", () => {
    const { scorecards, unreadableRowCount } = readScorecardsFromCsv(
      createCsv("3d", [THREE_D_SCORECARD]),
    );
    assert.equal(unreadableRowCount, 0);
    assert.equal(scorecards[0].format, "3d");
    assert.equal(scorecards[0].firstAnimal, "Pronghorn Antelope");
    assert.deepEqual(scorecards[0].arrowScores, THREE_D_SCORECARD.arrowScores);
  });

  it("reads back a 3D scorecard's side", () => {
    const { scorecards } = readScorecardsFromCsv(
      createCsv("3d", [{ ...THREE_D_SCORECARD, side: "right" }]),
    );
    assert.equal(scorecards[0].side, "right");
  });

  it("reads back a 3D scorecard that was saved without a first animal", () => {
    const { scorecards, unreadableRowCount } = readScorecardsFromCsv(
      createCsv("3d", [{ ...THREE_D_SCORECARD, firstAnimal: null }]),
    );
    assert.equal(unreadableRowCount, 0);
    assert.equal(scorecards[0].firstAnimal, null);
  });

  it("reads back a file a US spreadsheet re-saved", () => {
    const rows = parseCsv(createCsv("bullseye", [{ ...SCORECARD, shooterNumber: "00123" }]));
    rows[1][BULLSEYE_COLUMN_HEADINGS.indexOf("Date")] = "11/4/2026";
    rows[1][BULLSEYE_COLUMN_HEADINGS.indexOf("Shooter #")] = "123";
    const { scorecards, unreadableRowCount } = readScorecardsFromCsv(toCsvText(rows));
    assert.equal(unreadableRowCount, 0);
    assert.equal(scorecards[0].date, "2026-11-04");
    assert.equal(scorecards[0].shooterNumber, "00123");
  });

  it("reads files exported with the older E1A1 arrow headings", () => {
    const [headingRow, ...dataRows] = parseCsv(createCsv("bullseye", [SCORECARD]));
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
    const rows = parseCsv(createCsv("bullseye", [SCORECARD]));
    rows[1][BULLSEYE_COLUMN_HEADINGS.indexOf("R2A1")] = "11";
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
    const text = createTabSeparatedText("bullseye", [{ ...SCORECARD, archer: "Tab\there" }]);
    const [headingLine, dataLine] = text.split("\n");
    assert.equal(headingLine.split("\t").length, BULLSEYE_COLUMN_HEADINGS.length);
    assert.equal(dataLine.split("\t")[1], "Tab here");
  });
});
