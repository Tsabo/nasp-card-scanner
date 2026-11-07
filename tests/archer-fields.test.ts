import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ArcherDirectory,
  BLANK_ARCHER_FIELDS,
  applyScannedNumber,
  changeArcher,
  changeShooterNumber,
  findMismatchedNumber,
  isShooterNumberFlagged,
  readShooterNumber,
} from "../src/app/archer-fields.ts";
import type { Scorecard } from "../src/app/scorecard.ts";
import { createBlankScores } from "../src/app/scoring.ts";

const JANE_NUMBER = "12828";
const BEN_NUMBER = "00123";
const UNKNOWN_NUMBER = "55555";

function createScorecard(
  archer: string,
  shooterNumber: string,
  date = "2026-10-01",
  createdAt = 0,
): Scorecard {
  return {
    id: `${archer}-${shooterNumber}-${date}-${createdAt}`,
    date,
    archer,
    shooterNumber,
    format: "bullseye",
    side: null,
    firstAnimal: null,
    arrowScores: createBlankScores(),
    createdAt,
  };
}

const DIRECTORY = new ArcherDirectory([
  createScorecard("Jane Doe", JANE_NUMBER),
  createScorecard("Ben Ray", BEN_NUMBER),
  createScorecard("Sam Lee", ""),
]);

describe("readShooterNumber", () => {
  const clean = (value: number) => ({ value, flag: null });
  const blank = { value: null, flag: "No mark found" };

  it("reads a clean number with its leading zeros", () => {
    assert.deepEqual(readShooterNumber([clean(0), clean(0), clean(1), clean(2), clean(3)]), {
      shooterNumber: "00123",
      needsReview: false,
    });
  });

  it("doesn't ask for a look when the whole section is blank", () => {
    assert.deepEqual(readShooterNumber([blank, blank, blank, blank, blank]), {
      shooterNumber: "",
      needsReview: false,
    });
  });

  it("asks for a look at a partly blank section", () => {
    assert.deepEqual(readShooterNumber([clean(1), blank, clean(3), clean(4), clean(5)]), {
      shooterNumber: "1345",
      needsReview: true,
    });
  });

  it("asks for a look at a complete number with a doubtful digit", () => {
    const doubleMark = { value: 7, flag: "Two bubbles filled" };
    assert.deepEqual(readShooterNumber([clean(1), clean(0), doubleMark, clean(9), clean(8)]), {
      shooterNumber: "10798",
      needsReview: true,
    });
  });
});

describe("ArcherDirectory", () => {
  it("uses the latest scorecard, by date and then by save time", () => {
    const directory = new ArcherDirectory([
      createScorecard("Jane Doe", "11111", "2026-10-01", 5),
      createScorecard("Jane Doe", "22222", "2026-10-02", 1),
      createScorecard("Jane Doe", "33333", "2026-10-02", 2),
    ]);
    assert.equal(directory.findShooterNumber("Jane Doe"), "33333");
  });

  it("ignores case and stray spaces in names", () => {
    assert.equal(DIRECTORY.findShooterNumber("  jane doe "), JANE_NUMBER);
  });

  it("skips newer scorecards with no complete number", () => {
    const directory = new ArcherDirectory([
      createScorecard("Jane Doe", JANE_NUMBER, "2026-10-01"),
      createScorecard("Jane Doe", "", "2026-10-02"),
      createScorecard("Jane Doe", "123", "2026-10-03"),
    ]);
    assert.equal(directory.findShooterNumber("Jane Doe"), JANE_NUMBER);
  });

  it("never links a partial number to a name", () => {
    const directory = new ArcherDirectory([createScorecard("Jane Doe", "123")]);
    assert.equal(directory.findShooterNumber("Jane Doe"), null);
    assert.equal(directory.findArcher("123"), null);
  });

  it("finds the latest name that goes with a number", () => {
    const directory = new ArcherDirectory([
      createScorecard("Old Name", JANE_NUMBER, "2026-10-01"),
      createScorecard("New Name", JANE_NUMBER, "2026-10-02"),
      createScorecard("", JANE_NUMBER, "2026-10-03"),
    ]);
    assert.equal(directory.findArcher(JANE_NUMBER), "New Name");
  });
});

describe("ArcherDirectory.getNames", () => {
  it("lists every name once, alphabetically", () => {
    const directory = new ArcherDirectory([
      createScorecard("Sam Lee", "", "2026-10-01"),
      createScorecard("Ben Ray", BEN_NUMBER, "2026-10-01"),
      createScorecard("Jane Doe", "123", "2026-10-01"),
      createScorecard("Ben Ray", BEN_NUMBER, "2026-10-02"),
    ]);
    assert.deepEqual(directory.getNames(), ["Ben Ray", "Jane Doe", "Sam Lee"]);
  });

  it("treats names that differ only in capitalization or spaces as one, in the latest spelling", () => {
    const directory = new ArcherDirectory([
      createScorecard("Sam Lee", "", "2026-10-01", 1),
      createScorecard(" sam lee ", "", "2026-10-02", 1),
      createScorecard("SAM LEE", "", "2026-10-02", 0),
    ]);
    assert.deepEqual(directory.getNames(), ["sam lee"]);
  });

  it("leaves out scorecards with no name", () => {
    const directory = new ArcherDirectory([createScorecard("", JANE_NUMBER)]);
    assert.deepEqual(directory.getNames(), []);
  });
});

describe("changeArcher", () => {
  it("fills a blank number from a known name", () => {
    const fields = changeArcher(BLANK_ARCHER_FIELDS, "jane doe", DIRECTORY);
    assert.equal(fields.shooterNumber, JANE_NUMBER);
  });

  it("leaves a blank number alone when the name has none on record", () => {
    const fields = changeArcher(BLANK_ARCHER_FIELDS, "Sam Lee", DIRECTORY);
    assert.equal(fields.shooterNumber, "");
  });

  it("replaces a partial scan and clears its review flag", () => {
    const scanned = applyScannedNumber(
      BLANK_ARCHER_FIELDS,
      { shooterNumber: "128", needsReview: true },
      DIRECTORY,
    );
    const fields = changeArcher(scanned, "Jane Doe", DIRECTORY);
    assert.equal(fields.shooterNumber, JANE_NUMBER);
    assert.equal(isShooterNumberFlagged(fields), false);
  });

  it("replaces a complete but flagged scan", () => {
    const scanned = applyScannedNumber(
      BLANK_ARCHER_FIELDS,
      { shooterNumber: "12928", needsReview: true },
      DIRECTORY,
    );
    assert.equal(changeArcher(scanned, "Jane Doe", DIRECTORY).shooterNumber, JANE_NUMBER);
  });

  it("replaces a number filled in by an earlier name", () => {
    const jane = changeArcher(BLANK_ARCHER_FIELDS, "Jane Doe", DIRECTORY);
    assert.equal(changeArcher(jane, "Ben Ray", DIRECTORY).shooterNumber, BEN_NUMBER);
  });

  it("keeps a clean scan and points out the mismatch", () => {
    const scanned = applyScannedNumber(
      BLANK_ARCHER_FIELDS,
      { shooterNumber: UNKNOWN_NUMBER, needsReview: false },
      DIRECTORY,
    );
    const fields = changeArcher(scanned, "Jane Doe", DIRECTORY);
    assert.equal(fields.shooterNumber, UNKNOWN_NUMBER);
    assert.equal(findMismatchedNumber(fields, DIRECTORY), JANE_NUMBER);
  });

  it("keeps a typed number, even a partial one", () => {
    const complete = changeShooterNumber(BLANK_ARCHER_FIELDS, UNKNOWN_NUMBER, DIRECTORY);
    assert.equal(changeArcher(complete, "Jane Doe", DIRECTORY).shooterNumber, UNKNOWN_NUMBER);
    const partial = changeShooterNumber(BLANK_ARCHER_FIELDS, "123", DIRECTORY);
    assert.equal(changeArcher(partial, "Jane Doe", DIRECTORY).shooterNumber, "123");
  });

  it("clears a filled-in number when the new name has none on record", () => {
    const jane = changeArcher(BLANK_ARCHER_FIELDS, "Jane Doe", DIRECTORY);
    assert.equal(changeArcher(jane, "Sam Lee", DIRECTORY).shooterNumber, "");
  });

  it("restores a flagged scan when typing continues past a known name", () => {
    const scanned = applyScannedNumber(
      BLANK_ARCHER_FIELDS,
      { shooterNumber: "128", needsReview: true },
      DIRECTORY,
    );
    const jane = changeArcher(scanned, "Jane Doe", DIRECTORY);
    const janet = changeArcher(jane, "Jane Doe-Smith", DIRECTORY);
    assert.equal(janet.shooterNumber, "128");
    assert.equal(isShooterNumberFlagged(janet), true);
  });
});

describe("changeShooterNumber", () => {
  it("fills a blank name from a known number", () => {
    const fields = changeShooterNumber(BLANK_ARCHER_FIELDS, BEN_NUMBER, DIRECTORY);
    assert.equal(fields.archer, "Ben Ray");
  });

  it("doesn't look up a number until it's complete", () => {
    assert.equal(changeShooterNumber(BLANK_ARCHER_FIELDS, "00", DIRECTORY).archer, "");
  });

  it("never overwrites a name a person entered", () => {
    const named = changeArcher(BLANK_ARCHER_FIELDS, "Sam Lee", DIRECTORY);
    assert.equal(changeShooterNumber(named, JANE_NUMBER, DIRECTORY).archer, "Sam Lee");
  });

  it("moves a filled-in name to the corrected number's archer", () => {
    const jane = changeShooterNumber(BLANK_ARCHER_FIELDS, JANE_NUMBER, DIRECTORY);
    assert.equal(changeShooterNumber(jane, BEN_NUMBER, DIRECTORY).archer, "Ben Ray");
  });

  it("clears a filled-in name when the number stops matching", () => {
    const jane = changeShooterNumber(BLANK_ARCHER_FIELDS, JANE_NUMBER, DIRECTORY);
    assert.equal(changeShooterNumber(jane, UNKNOWN_NUMBER, DIRECTORY).archer, "");
    assert.equal(changeShooterNumber(jane, "1282", DIRECTORY).archer, "");
  });

  it("clears a scan's review flag", () => {
    const scanned = applyScannedNumber(
      BLANK_ARCHER_FIELDS,
      { shooterNumber: "128", needsReview: true },
      DIRECTORY,
    );
    assert.equal(isShooterNumberFlagged(changeShooterNumber(scanned, "1282", DIRECTORY)), false);
  });

  it("points out a typed number that differs from the chosen archer's", () => {
    const jane = changeArcher(BLANK_ARCHER_FIELDS, "Jane Doe", DIRECTORY);
    const fields = changeShooterNumber(jane, UNKNOWN_NUMBER, DIRECTORY);
    assert.equal(findMismatchedNumber(fields, DIRECTORY), JANE_NUMBER);
  });
});

describe("applyScannedNumber", () => {
  it("fills a blank name from a clean scan", () => {
    const fields = applyScannedNumber(
      BLANK_ARCHER_FIELDS,
      { shooterNumber: JANE_NUMBER, needsReview: false },
      DIRECTORY,
    );
    assert.equal(fields.archer, "Jane Doe");
    assert.equal(fields.isArcherFilled, true);
  });

  it("doesn't fill a name from a flagged scan until someone edits it", () => {
    const scanned = applyScannedNumber(
      BLANK_ARCHER_FIELDS,
      { shooterNumber: JANE_NUMBER, needsReview: true },
      DIRECTORY,
    );
    assert.equal(scanned.archer, "");
    assert.equal(changeShooterNumber(scanned, JANE_NUMBER, DIRECTORY).archer, "Jane Doe");
  });
});

describe("findMismatchedNumber", () => {
  it("is null when the number matches, is partial, or the archer is unknown", () => {
    const jane = changeArcher(BLANK_ARCHER_FIELDS, "Jane Doe", DIRECTORY);
    assert.equal(findMismatchedNumber(jane, DIRECTORY), null);
    assert.equal(
      findMismatchedNumber(changeShooterNumber(jane, "123", DIRECTORY), DIRECTORY),
      null,
    );
    const stranger = changeArcher(BLANK_ARCHER_FIELDS, "Stranger", DIRECTORY);
    assert.equal(
      findMismatchedNumber(changeShooterNumber(stranger, UNKNOWN_NUMBER, DIRECTORY), DIRECTORY),
      null,
    );
  });
});
