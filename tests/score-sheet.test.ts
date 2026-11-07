import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CardReadResult, RowResult } from "../src/reader/analyze-card.ts";
import { ScoreSheet } from "../src/app/score-sheet.ts";
import type { SheetField } from "../src/app/score-sheet.ts";
import type { NewScorecard } from "../src/app/scorecard.ts";

const CLOCK = { today: () => "2026-11-07", now: () => 42 };

/** A row the reader found, with made-up bubble positions. */
function createRow(value: number | null, flag: string | null, bubbleCount: number): RowResult {
  return {
    value,
    flag,
    centers: Array.from({ length: bubbleCount }, (_, bubble) => ({ x: bubble * 10, y: 0 })),
    fills: new Array<number>(bubbleCount).fill(0),
  };
}

/** A successful read: every arrow 9 unless given, and a Shooter # of 10798. */
function createReading({
  arrows = new Array<number | null>(30).fill(9),
  arrowFlags = new Array<string | null>(30).fill(null),
  shooterDigits = [1, 0, 7, 9, 8],
  shooterFlags = new Array<string | null>(5).fill(null),
}: {
  arrows?: Array<number | null>;
  arrowFlags?: Array<string | null>;
  shooterDigits?: Array<number | null>;
  shooterFlags?: Array<string | null>;
} = {}): CardReadResult {
  return {
    ok: true,
    scores: arrows.map((value, index) => createRow(value, arrowFlags[index], 11)),
    shooter: shooterDigits.map((value, index) => createRow(value, shooterFlags[index], 10)),
    timingMarks: [],
    diagnostics: { fitScore: 0.2 },
  };
}

const FAILED_READING: CardReadResult = {
  ok: false,
  error: "Couldn't find the black timing marks along the card's edge.",
  timingMarks: [],
};

/** A log with one scorecard for Jane Doe, Shooter # 10798. */
const JANE: NewScorecard & { id: string } = {
  id: "scorecard-1",
  date: "2026-11-01",
  archer: "Jane Doe",
  shooterNumber: "10798",
  format: "bullseye",
  side: null,
  firstAnimal: null,
  arrowScores: new Array(30).fill(8),
  createdAt: 1,
};

function createSheet(format: "bullseye" | "3d" = "bullseye"): ScoreSheet<string> {
  return new ScoreSheet<string>({ format, clock: CLOCK });
}

/** A promise that the test resolves when it chooses. */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

describe("ScoreSheet: a new sheet", () => {
  it("starts blank, dated today, waiting for the sample card", () => {
    const state = createSheet("3d").getState();
    assert.deepEqual(state.arrowScores, new Array(30).fill(null));
    assert.equal(state.date, "2026-11-07");
    assert.equal(state.format, "3d");
    assert.equal(state.archer, "");
    assert.equal(state.photo, null);
    assert.deepEqual(state.status, {
      badge: "sample",
      text: "Reading the sample card…",
      isProblem: false,
    });
  });
});

describe("ScoreSheet: reading a photo", () => {
  it("says it's reading until the reader finishes", () => {
    const sheet = createSheet();
    void sheet.readPhoto(createDeferred<{ image: string; reading: CardReadResult }>().promise);
    assert.equal(sheet.getState().status.text, "Reading the card…");
  });

  it("puts the reading on the sheet", async () => {
    const sheet = createSheet();
    await sheet.readPhoto(Promise.resolve({ image: "photo", reading: createReading() }));
    const state = sheet.getState();
    assert.deepEqual(state.arrowScores, new Array(30).fill(9));
    assert.equal(state.shooterNumber, "10798");
    assert.equal(state.summary.total, 270);
    assert.equal(state.photo?.image, "photo");
    assert.deepEqual(state.status, {
      badge: "read",
      text: "Read all 30 arrows. Check the sheet against the card, then save.",
      isProblem: false,
    });
  });

  it("counts the spots that need a look", async () => {
    const sheet = createSheet();
    const arrowFlags = new Array<string | null>(30).fill(null);
    arrowFlags[4] = "Two bubbles filled";
    await sheet.readPhoto(
      Promise.resolve({ image: "photo", reading: createReading({ arrowFlags }) }),
    );
    const state = sheet.getState();
    assert.equal(state.status.text, "Read all 30 arrows. One spot needs a look before you save.");
    assert.deepEqual(
      state.reviewItems.map(({ label, message, field }) => ({ label, message, field })),
      [{ label: "Round 1 · arrow 5", message: "Two bubbles filled", field: 4 }],
    );
  });

  it("forgets the last card's archer, Side and First animal", async () => {
    const sheet = createSheet("3d");
    sheet.setLog([JANE]);
    sheet.edit("archer", "Ben Ray");
    sheet.edit("side", "left");
    sheet.edit("firstAnimal", "Coyote");
    await sheet.readPhoto(Promise.resolve({ image: "photo", reading: createReading() }));
    const state = sheet.getState();
    assert.equal(state.archer, "Jane Doe", "filled in from the scanned Shooter #");
    assert.equal(state.side, null);
    assert.equal(state.firstAnimal, null);
  });

  it("blanks the sheet and explains when the card can't be read", async () => {
    const sheet = createSheet();
    sheet.edit("archer", "Ben Ray");
    sheet.edit(0, "10");
    await sheet.readPhoto(Promise.resolve({ image: "photo", reading: FAILED_READING }));
    const state = sheet.getState();
    assert.equal(state.arrowScores[0], null);
    assert.equal(state.archer, "");
    assert.deepEqual(state.status, {
      badge: "error",
      text:
        "Couldn't find the black timing marks along the card's edge. Retake it with the whole " +
        "card in frame, flat and evenly lit, or enter the scores by hand.",
      isProblem: true,
    });
  });

  it("shows the newest photo when two are read at once", async () => {
    const sheet = createSheet();
    const first = createDeferred<{ image: string; reading: CardReadResult }>();
    const firstRead = sheet.readPhoto(first.promise);
    await sheet.readPhoto(Promise.resolve({ image: "second", reading: createReading() }));
    first.resolve({ image: "first", reading: createReading() });
    await firstRead;
    assert.equal(sheet.getState().photo?.image, "second");
  });

  it("explains a file that isn't a photo, or won't open", () => {
    const sheet = createSheet();
    sheet.showPhotoProblem("not-an-image");
    assert.deepEqual(sheet.getState().status, {
      badge: "sample",
      text: "That file isn't an image. Choose a photo of the score card.",
      isProblem: true,
    });
    sheet.showPhotoProblem("cannot-open");
    assert.equal(
      sheet.getState().status.text,
      "This browser couldn't open that image. Try a JPEG or PNG.",
    );
  });
});

describe("ScoreSheet: the sample card", () => {
  const SAMPLE = { image: "sample", reading: createReading() };

  it("shows the sample and what to do next", async () => {
    const sheet = createSheet();
    await sheet.readSample(Promise.resolve(SAMPLE));
    assert.equal(sheet.getState().photo?.image, "sample");
    assert.deepEqual(sheet.getState().status, {
      badge: "sample",
      text: "This is a sample card with one double-marked arrow. Take a photo of one of yours to start.",
      isProblem: false,
    });
  });

  it("asks for a photo when the sample won't load", async () => {
    const sheet = createSheet();
    await sheet.readSample(Promise.reject(new Error("offline")));
    assert.equal(sheet.getState().status.text, "Take a photo of a score card to start.");
  });

  const takeovers: Array<[string, (sheet: ScoreSheet<string>) => Promise<void> | void]> = [
    [
      "a photo",
      (sheet) => sheet.readPhoto(Promise.resolve({ image: "photo", reading: createReading() })),
    ],
    ["entering by hand", (sheet) => sheet.enterByHand()],
    ["a file that won't open", (sheet) => sheet.showPhotoProblem("cannot-open")],
  ];
  for (const [description, takeOver] of takeovers) {
    it(`is ignored once the coach chose ${description}`, async () => {
      const sheet = createSheet();
      const sample = createDeferred<{ image: string; reading: CardReadResult }>();
      const sampleRead = sheet.readSample(sample.promise);
      await takeOver(sheet);
      const before = sheet.getState();
      sample.resolve(SAMPLE);
      await sampleRead;
      assert.equal(sheet.getState(), before);
    });
  }
});

describe("ScoreSheet: entering by hand", () => {
  it("blanks the sheet, hides the photo, and moves to the first arrow", async () => {
    const sheet = createSheet("3d");
    await sheet.readPhoto(Promise.resolve({ image: "photo", reading: createReading() }));
    sheet.edit("side", "left");
    sheet.enterByHand();
    const state = sheet.getState();
    assert.deepEqual(state.arrowScores, new Array(30).fill(null));
    assert.equal(state.shooterNumber, "");
    assert.equal(state.archer, "");
    assert.equal(state.side, null);
    // The photo is of another card than the one being typed in.
    assert.equal(state.photo, null);
    assert.deepEqual(state.status, {
      badge: "manual",
      text: "Enter each arrow on the score sheet.",
      isProblem: false,
    });
    assert.equal(state.focusRequest, 0);
  });
});

describe("ScoreSheet: edits", () => {
  it("scores an arrow, clears its review flag and updates the totals", async () => {
    const sheet = createSheet();
    const arrowFlags = new Array<string | null>(30).fill(null);
    arrowFlags[0] = "Faint mark";
    await sheet.readPhoto(
      Promise.resolve({ image: "photo", reading: createReading({ arrowFlags }) }),
    );
    sheet.edit(0, "10");
    const state = sheet.getState();
    assert.equal(state.arrowScores[0], 10);
    assert.equal(state.arrowFlags[0], null);
    assert.equal(state.summary.total, 271);
    assert.deepEqual(state.reviewItems, []);
  });

  it("blanks an arrow and marks its round incomplete", () => {
    const sheet = createSheet();
    sheet.edit(7, "6");
    sheet.edit(7, "");
    assert.equal(sheet.getState().arrowScores[7], null);
    assert.deepEqual(sheet.getState().roundIncomplete, new Array(6).fill(true));
  });

  it("ignores a value that isn't a score, and refuses an arrow that doesn't exist", () => {
    const sheet = createSheet();
    const before = sheet.getState();
    sheet.edit(0, "11");
    assert.equal(sheet.getState(), before);
    assert.throws(() => sheet.edit(30, "5"), RangeError);
  });

  it("keeps only the digits of a Shooter #, up to five", () => {
    const sheet = createSheet();
    sheet.edit("shooterNumber", "12-34a567");
    assert.equal(sheet.getState().shooterNumber, "12345");
  });

  it("points out an unfinished Shooter # only once the coach leaves the field", () => {
    const sheet = createSheet();
    sheet.edit("shooterNumber", "123");
    assert.equal(sheet.getState().shooterNumberProblem, null);
    sheet.finishShooterNumber();
    assert.equal(
      sheet.getState().shooterNumberProblem,
      "3 of 5 digits entered. Add any leading zeros.",
    );
    assert.equal(sheet.getState().shooterNumberNeedsReview, true);
    sheet.edit("shooterNumber", "1234");
    assert.equal(sheet.getState().shooterNumberProblem, null);
  });

  it("fills in the name from a known Shooter #", () => {
    const sheet = createSheet();
    sheet.setLog([JANE]);
    sheet.edit("shooterNumber", "10798");
    assert.equal(sheet.getState().archer, "Jane Doe");
  });

  it("keeps a filled-in name when the log changes", () => {
    const sheet = createSheet();
    sheet.setLog([JANE]);
    sheet.edit("shooterNumber", "10798");
    sheet.setLog([]);
    assert.equal(sheet.getState().archer, "Jane Doe");
  });

  it("asks for a look when the archer's last scorecard used another number", () => {
    const sheet = createSheet();
    sheet.setLog([JANE]);
    sheet.edit("archer", "Jane Doe");
    sheet.edit("shooterNumber", "55555");
    assert.deepEqual(
      sheet.getState().reviewItems.map(({ message }) => message),
      ["Jane Doe's last scorecard used 10798"],
    );
  });

  it("suggests the names in the log", () => {
    const sheet = createSheet();
    sheet.setLog([JANE, { ...JANE, id: "scorecard-2", archer: "Ben Ray" }]);
    assert.deepEqual(sheet.getState().archerNames, ["Ben Ray", "Jane Doe"]);
  });

  it("names each 3D round's animal once Side and First animal are chosen", () => {
    const sheet = createSheet("3d");
    sheet.edit("side", "right");
    assert.equal(sheet.getState().roundLabels[0], "Round 1");
    sheet.edit("firstAnimal", "Coyote");
    assert.deepEqual(sheet.getState().roundLabels.slice(0, 2), [
      "Round 1 · Coyote",
      "Round 2 · Alert Turkey",
    ]);
  });

  it("reports a change of format, and ignores an unknown one", () => {
    const sheet = createSheet();
    const formats: string[] = [];
    sheet.onFormatChange((format) => formats.push(format));
    sheet.edit("format", "3d");
    sheet.edit("format", "field");
    assert.equal(sheet.getState().format, "3d");
    assert.deepEqual(formats, ["3d"]);
  });

  it("tells listeners once after each change", () => {
    const sheet = createSheet();
    let calls = 0;
    sheet.subscribe(() => calls++);
    sheet.edit("archer", "Kyle");
    sheet.edit(0, "9");
    assert.equal(calls, 2);
  });
});

describe("ScoreSheet: saving", () => {
  /** A sheet that can be saved: Kyle, every arrow 9 but the last, which is blank. */
  function createSavableSheet(format: "bullseye" | "3d" = "bullseye"): ScoreSheet<string> {
    const sheet = createSheet(format);
    sheet.edit("archer", "  Kyle ");
    for (let arrowIndex = 0; arrowIndex < 29; arrowIndex++) {
      sheet.edit(arrowIndex, "9");
    }
    return sheet;
  }

  it("hands the scorecard to the log and says what was saved", () => {
    const sheet = createSavableSheet();
    const stored: NewScorecard[] = [];
    const saved = sheet.save((scorecard) => {
      stored.push(scorecard);
      return true;
    });
    const expected: NewScorecard = {
      date: "2026-11-07",
      archer: "Kyle",
      shooterNumber: "",
      format: "bullseye",
      side: null,
      firstAnimal: null,
      arrowScores: [...new Array(29).fill(9), null],
      createdAt: 42,
    };
    assert.deepEqual(stored, [expected]);
    assert.deepEqual(saved, expected);
    assert.deepEqual(sheet.getState().saveMessage, {
      text: "Saved with 1 blank arrow counted as 0.",
      isProblem: false,
    });
  });

  it("says to scan the next card when no arrow is blank", () => {
    const sheet = createSavableSheet();
    sheet.edit(29, "9");
    sheet.save(() => true);
    assert.equal(sheet.getState().saveMessage.text, "Saved. Scan the next card when you're ready.");
  });

  it("dates a scorecard with a blank date today", () => {
    const sheet = createSavableSheet();
    sheet.edit("date", "");
    assert.equal(sheet.save(() => true)?.date, "2026-11-07");
  });

  it("saves a 3D scorecard's Side and First animal, and leaves them off a Bullseye one", () => {
    const threeD = createSavableSheet("3d");
    threeD.edit("side", "left");
    threeD.edit("firstAnimal", "Coyote");
    const saved = threeD.save(() => true);
    assert.equal(saved?.side, "left");
    assert.equal(saved?.firstAnimal, "Coyote");

    const bullseye = createSavableSheet();
    bullseye.edit("side", "left");
    assert.equal(bullseye.save(() => true)?.side, null);
  });

  it("saves again when Save is tapped twice", () => {
    const sheet = createSavableSheet();
    let storeCount = 0;
    const store = (): boolean => {
      storeCount++;
      return true;
    };
    sheet.save(store);
    sheet.save(store);
    assert.equal(storeCount, 2);
  });

  it("explains when the browser wouldn't save", () => {
    const sheet = createSavableSheet();
    assert.equal(
      sheet.save(() => false),
      null,
    );
    assert.deepEqual(sheet.getState().saveMessage, {
      text: "This browser wouldn't save the scorecard. Its storage may be full or blocked in private browsing.",
      isProblem: true,
    });
  });

  const problems: Array<{
    description: string;
    breakSheet: (sheet: ScoreSheet<string>) => void;
    message: string;
    field: string | null;
  }> = [
    {
      description: "no name or Shooter #",
      breakSheet: (sheet) => sheet.edit("archer", ""),
      message: "Add the archer's name or shooter number first.",
      field: "archer",
    },
    {
      description: "an unfinished Shooter #",
      breakSheet: (sheet) => sheet.edit("shooterNumber", "123"),
      message:
        "Enter all five digits of the Shooter #, including any leading zeros, like 00123, or clear it.",
      field: "shooterNumber",
    },
    {
      description: "a 3D sheet with no Side",
      breakSheet: (sheet) => sheet.edit("format", "3d"),
      message: "Choose the side this archer shot from.",
      field: "side",
    },
    {
      description: "a 3D sheet with no First animal",
      breakSheet: (sheet) => {
        sheet.edit("format", "3d");
        sheet.edit("side", "left");
      },
      message: "Choose the first animal this archer shot.",
      field: "firstAnimal",
    },
    {
      description: "every arrow blank",
      breakSheet: (sheet) => {
        for (let arrowIndex = 0; arrowIndex < 30; arrowIndex++) {
          sheet.edit(arrowIndex, "");
        }
      },
      message: "There are no scores to save yet.",
      field: null,
    },
  ];
  for (const { description, breakSheet, message, field } of problems) {
    it(`refuses ${description}, explains and moves to the field`, () => {
      const sheet = createSavableSheet();
      breakSheet(sheet);
      assert.equal(
        sheet.save(() => assert.fail("shouldn't be stored")),
        null,
      );
      assert.deepEqual(sheet.getState().saveMessage, { text: message, isProblem: true });
      assert.equal(sheet.getState().focusRequest, field);
    });
  }

  it("shows the unfinished Shooter # problem on a refused save", () => {
    const sheet = createSavableSheet();
    sheet.edit("shooterNumber", "123");
    sheet.save(() => true);
    assert.equal(
      sheet.getState().shooterNumberProblem,
      "3 of 5 digits entered. Add any leading zeros.",
    );
  });

  it("asks for focus only once", () => {
    const sheet = createSavableSheet();
    sheet.edit("archer", "");
    sheet.save(() => true);
    sheet.edit(0, "8");
    assert.equal(sheet.getState().focusRequest, null);
  });

  it("clears the save message when the archer, Shooter #, Side or First animal change", () => {
    const edits: Array<[SheetField, string]> = [
      ["archer", "Ryan"],
      ["shooterNumber", "1"],
      ["side", "left"],
      ["firstAnimal", "Coyote"],
    ];
    for (const [field, value] of edits) {
      const sheet = createSavableSheet("3d");
      sheet.save(() => true);
      sheet.edit(field, value);
      assert.equal(sheet.getState().saveMessage.text, "", String(field));
    }
  });

  it("keeps the save message through arrow, format and date edits and log changes", () => {
    const sheet = createSavableSheet();
    sheet.save(() => true);
    sheet.edit(0, "5");
    sheet.edit("format", "bullseye");
    sheet.edit("date", "2026-11-06");
    sheet.setLog([JANE]);
    assert.equal(sheet.getState().saveMessage.text, "Saved with 1 blank arrow counted as 0.");
  });

  it("clears the save message when a new card is read", async () => {
    const sheet = createSavableSheet();
    sheet.save(() => true);
    await sheet.readPhoto(Promise.resolve({ image: "photo", reading: createReading() }));
    assert.equal(sheet.getState().saveMessage.text, "");
  });
});

describe("ScoreSheet: the overlay on the photo", () => {
  const NO_RING = { chosenBubble: null, needsReview: false };

  async function readCard(reading: CardReadResult): Promise<ScoreSheet<string>> {
    const sheet = createSheet();
    await sheet.readPhoto(Promise.resolve({ image: "photo", reading }));
    return sheet;
  }

  it("rings each arrow the sheet shows, marking the ones that need a look", async () => {
    const arrowFlags = new Array<string | null>(30).fill(null);
    arrowFlags[1] = "Faint mark";
    const sheet = await readCard(createReading({ arrowFlags }));
    sheet.edit(0, "10");
    const rings = sheet.getState().photo?.rings ?? [];
    assert.equal(rings.length, 35);
    assert.deepEqual(rings.slice(0, 3), [
      { chosenBubble: 10, needsReview: false },
      { chosenBubble: 9, needsReview: true },
      { chosenBubble: 9, needsReview: false },
    ]);
  });

  it("rings the Shooter # digits the sheet shows", async () => {
    const sheet = await readCard(createReading());
    assert.deepEqual(
      sheet
        .getState()
        .photo?.rings.slice(30)
        .map((ring) => ring.chosenBubble),
      [1, 0, 7, 9, 8],
    );
  });

  it("marks a doubtful digit until the coach corrects the number", async () => {
    const shooterFlags = [null, null, "Two bubbles filled", null, null];
    const sheet = await readCard(createReading({ shooterFlags }));
    assert.deepEqual(sheet.getState().photo?.rings[32], { chosenBubble: 7, needsReview: true });

    sheet.edit("shooterNumber", "10398");
    assert.deepEqual(sheet.getState().photo?.rings.slice(30), [
      { chosenBubble: 1, needsReview: false },
      { chosenBubble: 0, needsReview: false },
      { chosenBubble: 3, needsReview: false },
      { chosenBubble: 9, needsReview: false },
      { chosenBubble: 8, needsReview: false },
    ]);
  });

  it("rings no digits while the Shooter # isn't complete", async () => {
    const shooterFlags = [null, null, "No bubble filled", null, null];
    const sheet = await readCard(
      createReading({ shooterDigits: [1, 0, null, 9, 8], shooterFlags }),
    );
    assert.equal(sheet.getState().shooterNumber, "1098");
    assert.deepEqual(sheet.getState().photo?.rings.slice(30), new Array(5).fill(NO_RING));
  });

  it("draws no rings for a card that couldn't be read, but keeps its timing marks", async () => {
    const sheet = await readCard(FAILED_READING);
    assert.equal(sheet.getState().photo?.reading, FAILED_READING);
    assert.deepEqual(sheet.getState().photo?.rings, []);
  });
});
