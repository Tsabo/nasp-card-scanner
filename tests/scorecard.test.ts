import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getTodayAsIsoDate } from "../src/app/dates.ts";
import {
  findSaveProblem,
  getScorecardIdentity,
  isCompleteShooterNumber,
  isPartialShooterNumber,
  normalizeStoredScorecard,
  readImportedScorecard,
} from "../src/app/scorecard.ts";
import type { ImportedCells, NewScorecard } from "../src/app/scorecard.ts";

/** A score sheet that can be saved: Bullseye, all 30 arrows scored 9. */
const SAVABLE: Omit<NewScorecard, "createdAt"> = {
  date: "2026-11-04",
  archer: "Kyle",
  shooterNumber: "10798",
  format: "bullseye",
  side: null,
  firstAnimal: null,
  arrowScores: new Array(30).fill(9),
};

const SAVABLE_THREE_D: Omit<NewScorecard, "createdAt"> = {
  ...SAVABLE,
  format: "3d",
  side: "left",
  firstAnimal: "Coyote",
};

describe("Shooter # completeness", () => {
  it("counts leading zeros as digits", () => {
    assert.equal(isCompleteShooterNumber("00123"), true);
    assert.equal(isPartialShooterNumber("00123"), false);
  });

  it("treats 1 to 4 digits as partial, and blank as neither", () => {
    assert.equal(isCompleteShooterNumber("123"), false);
    assert.equal(isPartialShooterNumber("123"), true);
    assert.equal(isCompleteShooterNumber(""), false);
    assert.equal(isPartialShooterNumber(""), false);
  });
});

describe("findSaveProblem", () => {
  const cases: Array<[string, Omit<NewScorecard, "createdAt">, string | null]> = [
    ["a complete Bullseye scorecard", SAVABLE, null],
    ["a complete 3D scorecard", SAVABLE_THREE_D, null],
    ["a name with no Shooter #", { ...SAVABLE, shooterNumber: "" }, null],
    ["a Shooter # with no name", { ...SAVABLE, archer: "" }, null],
    ["some blank arrows", { ...SAVABLE, arrowScores: [10, ...new Array(29).fill(null)] }, null],
    ["no name and no Shooter #", { ...SAVABLE, archer: "", shooterNumber: "" }, "no-archer"],
    ["a name of only spaces", { ...SAVABLE, archer: "  ", shooterNumber: "" }, "no-archer"],
    ["a Shooter # missing digits", { ...SAVABLE, shooterNumber: "123" }, "partial-shooter-number"],
    ["3D with no side", { ...SAVABLE_THREE_D, side: null }, "no-side"],
    ["3D with no first animal", { ...SAVABLE_THREE_D, firstAnimal: null }, "no-first-animal"],
    ["every arrow blank", { ...SAVABLE, arrowScores: new Array(30).fill(null) }, "no-scores"],
    [
      "several problems, reporting the first",
      { ...SAVABLE_THREE_D, archer: "", shooterNumber: "", side: null, firstAnimal: null },
      "no-archer",
    ],
    [
      "3D missing both side and animal, reporting the side",
      { ...SAVABLE_THREE_D, side: null, firstAnimal: null },
      "no-side",
    ],
  ];
  for (const [description, scorecard, expected] of cases) {
    it(`returns ${expected ?? "nothing"} for ${description}`, () => {
      assert.equal(findSaveProblem(scorecard), expected);
    });
  }
});

describe("readImportedScorecard", () => {
  const ROW: ImportedCells = {
    date: "2026-11-04",
    archer: "Kyle",
    shooterNumber: "10798",
    format: "",
    side: "",
    firstAnimal: "",
    arrows: new Array(30).fill("9"),
  };
  const THREE_D_ROW: ImportedCells = {
    ...ROW,
    format: "3D",
    side: "Right",
    firstAnimal: "Coyote",
  };
  const read = (cells: ImportedCells): NewScorecard | null => readImportedScorecard(cells, 7);

  it("reads a Bullseye row", () => {
    assert.deepEqual(read(ROW), {
      date: "2026-11-04",
      archer: "Kyle",
      shooterNumber: "10798",
      format: "bullseye",
      side: null,
      firstAnimal: null,
      arrowScores: new Array(30).fill(9),
      createdAt: 7,
    });
  });

  it("reads a 3D row's side and first animal, ignoring capitalization", () => {
    const scorecard = read({ ...THREE_D_ROW, format: "3d", firstAnimal: "coyote" });
    assert.equal(scorecard?.format, "3d");
    assert.equal(scorecard?.side, "right");
    assert.equal(scorecard?.firstAnimal, "Coyote");
  });

  it("reads blank arrow cells as blank arrows", () => {
    const arrows = ["10", ...new Array(29).fill("")];
    assert.deepEqual(read({ ...ROW, arrows })?.arrowScores, [10, ...new Array(29).fill(null)]);
  });

  it("trims stray spaces from every cell", () => {
    const scorecard = read({
      ...ROW,
      archer: " Kyle ",
      shooterNumber: " 10798 ",
      date: " 2026-11-04 ",
    });
    assert.equal(scorecard?.archer, "Kyle");
    assert.equal(scorecard?.shooterNumber, "10798");
    assert.equal(scorecard?.date, "2026-11-04");
  });

  describe("fills in what a spreadsheet may have changed or left out", () => {
    const cases: Array<[string, ImportedCells, Partial<NewScorecard>]> = [
      [
        "a Shooter # that lost its leading zeros",
        { ...ROW, shooterNumber: "123" },
        { shooterNumber: "00123" },
      ],
      ["a one-digit Shooter #", { ...ROW, shooterNumber: "7" }, { shooterNumber: "00007" }],
      ["a US date", { ...ROW, date: "11/4/2026" }, { date: "2026-11-04" }],
      ["a US date with leading zeros", { ...ROW, date: "01/09/2026" }, { date: "2026-01-09" }],
      ["a blank date, as today", { ...ROW, date: "" }, { date: getTodayAsIsoDate() }],
      ["no Format, as Bullseye", { ...ROW, format: "" }, { format: "bullseye" }],
      ["a 3D row with no side, as the left side", { ...THREE_D_ROW, side: "" }, { side: "left" }],
      ["a 3D row with no first animal", { ...THREE_D_ROW, firstAnimal: "" }, { firstAnimal: null }],
      ["a name with no Shooter #", { ...ROW, shooterNumber: "" }, { shooterNumber: "" }],
      ["a Shooter # with no name", { ...ROW, archer: "" }, { archer: "" }],
      ["a Bullseye row with a side, ignoring it", { ...ROW, side: "Left" }, { side: null }],
    ];
    for (const [description, cells, expected] of cases) {
      it(`reads ${description}`, () => {
        const scorecard = read(cells);
        assert.ok(scorecard, "should be readable");
        assert.deepEqual({ ...scorecard, ...expected }, scorecard);
      });
    }
  });

  describe("refuses rows that aren't a scorecard", () => {
    const cases: Array<[string, ImportedCells]> = [
      ["no name and no Shooter #", { ...ROW, archer: "", shooterNumber: "" }],
      ["every arrow blank", { ...ROW, arrows: new Array(30).fill("") }],
      ["a score above 10", { ...ROW, arrows: ["11", ...ROW.arrows.slice(1)] }],
      ["a negative score", { ...ROW, arrows: ["-1", ...ROW.arrows.slice(1)] }],
      ["a fractional score", { ...ROW, arrows: ["1.5", ...ROW.arrows.slice(1)] }],
      ["a score that isn't a number", { ...ROW, arrows: ["X", ...ROW.arrows.slice(1)] }],
      ["fewer than 30 arrows", { ...ROW, arrows: ROW.arrows.slice(1) }],
      ["a Shooter # with six digits", { ...ROW, shooterNumber: "123456" }],
      ["a Shooter # with letters", { ...ROW, shooterNumber: "12a45" }],
      ["an unknown format", { ...ROW, format: "Field" }],
      ["an unknown side", { ...THREE_D_ROW, side: "Middle" }],
      ["an unknown first animal", { ...THREE_D_ROW, firstAnimal: "Black Bear" }],
      ["a date in another form", { ...ROW, date: "Nov 4, 2026" }],
      ["a date that doesn't exist", { ...ROW, date: "2026-02-30" }],
      ["a US date that doesn't exist", { ...ROW, date: "13/4/2026" }],
    ];
    for (const [description, cells] of cases) {
      it(`refuses ${description}`, () => {
        assert.equal(read(cells), null);
      });
    }
  });
});

describe("normalizeStoredScorecard", () => {
  const STORED = { ...SAVABLE, id: "scorecard-1", createdAt: 5 };

  it("reads a stored scorecard unchanged", () => {
    assert.deepEqual(normalizeStoredScorecard(STORED), STORED);
  });

  it("keeps a record with no arrows, with every arrow blank", () => {
    const { arrowScores: _arrowScores, ...withoutArrows } = STORED;
    assert.deepEqual(
      normalizeStoredScorecard(withoutArrows)?.arrowScores,
      new Array(30).fill(null),
    );
  });

  it("fills a short arrow list to 30 with blanks", () => {
    const scorecard = normalizeStoredScorecard({ ...STORED, arrowScores: [10, 9] });
    assert.deepEqual(scorecard?.arrowScores, [10, 9, ...new Array(28).fill(null)]);
  });

  it("drops arrows past the 30th", () => {
    const scorecard = normalizeStoredScorecard({ ...STORED, arrowScores: new Array(35).fill(8) });
    assert.deepEqual(scorecard?.arrowScores, new Array(30).fill(8));
  });

  it("blanks scores that can't be right", () => {
    const arrowScores = [11, -1, 1.5, "9", null, ...new Array(25).fill(7)];
    const scorecard = normalizeStoredScorecard({ ...STORED, arrowScores });
    assert.deepEqual(scorecard?.arrowScores, [
      null,
      null,
      null,
      null,
      null,
      ...new Array(25).fill(7),
    ]);
  });

  it("converts a US date saved by an earlier import", () => {
    assert.equal(normalizeStoredScorecard({ ...STORED, date: "11/4/2026" })?.date, "2026-11-04");
  });

  it("leaves any other date as it is", () => {
    assert.equal(normalizeStoredScorecard({ ...STORED, date: "Nov 4" })?.date, "Nov 4");
  });

  it("keeps a 3D scorecard with no first animal", () => {
    const scorecard = normalizeStoredScorecard({
      ...STORED,
      ...SAVABLE_THREE_D,
      firstAnimal: null,
    });
    assert.equal(scorecard?.format, "3d");
    assert.equal(scorecard?.firstAnimal, null);
  });

  it("keeps a partial Shooter # as it was saved", () => {
    assert.equal(
      normalizeStoredScorecard({ ...STORED, shooterNumber: "123" })?.shooterNumber,
      "123",
    );
  });

  it("drops anything that isn't a record", () => {
    for (const stored of [null, 42, "scorecard", [1, 2]]) {
      assert.equal(normalizeStoredScorecard(stored), null);
    }
  });
});

describe("getScorecardIdentity", () => {
  const SCORECARD: NewScorecard = { ...SAVABLE, createdAt: 1 };

  it("matches a Shooter # with and without its leading zeros", () => {
    assert.equal(
      getScorecardIdentity({ ...SCORECARD, shooterNumber: "123" }),
      getScorecardIdentity({ ...SCORECARD, shooterNumber: "00123" }),
    );
  });

  it("matches names that differ only in capitalization or stray spaces", () => {
    for (const archer of ["kyle", " Kyle ", "KYLE"]) {
      assert.equal(getScorecardIdentity({ ...SCORECARD, archer }), getScorecardIdentity(SCORECARD));
    }
  });

  it("tells apart different Shooter #s", () => {
    assert.notEqual(
      getScorecardIdentity({ ...SCORECARD, shooterNumber: "00123" }),
      getScorecardIdentity({ ...SCORECARD, shooterNumber: "00124" }),
    );
  });
});
