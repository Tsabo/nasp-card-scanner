/**
 * @file The Score sheet: the scorecard being read or typed in, before it's
 * saved. It holds everything about the card being worked on and decides what
 * each step does, in order: reading a photo or the sample card, entering
 * scores by hand, each edit, the log changing, and saving.
 *
 * No page code, so it runs in Node tests. {@link ScoreSheetView} draws it and
 * reports edits, and the photo panel draws its photo and overlay.
 */

import type { CardReadResult } from "../reader/analyze-card.ts";
import {
  ArcherDirectory,
  BLANK_ARCHER_FIELDS,
  applyScannedNumber,
  changeArcher,
  changeShooterNumber,
  findMismatchedNumber,
  isShooterNumberFlagged,
  readShooterNumber,
} from "./archer-fields.ts";
import type { ArcherFields } from "./archer-fields.ts";
import { getTodayAsIsoDate } from "./dates.ts";
import {
  SHOOTER_NUMBER_LENGTH,
  findSaveProblem,
  isCompleteShooterNumber,
  isPartialShooterNumber,
} from "./scorecard.ts";
import type { NewScorecard, SaveProblem, Scorecard } from "./scorecard.ts";
import { getRoundAnimals, parseAnimal, parseFormat, parseSide } from "./scorecard-format.ts";
import type { Animal, ScorecardFormat, Side } from "./scorecard-format.ts";
import {
  ARROW_COUNT,
  MAXIMUM_ARROW_SCORE,
  ROUND_COUNT,
  createBlankScores,
  describeArrow,
  isRoundIncomplete,
  summarizeScorecard,
} from "./scoring.ts";
import type { ArrowScore, ScorecardSummary } from "./scoring.ts";
import { formatCount } from "./text.ts";

/** Why an arrow needs checking, or null when it doesn't. */
export type ReviewFlag = string | null;

/** The badge in the photo panel's corner. */
export type BadgeKind = "sample" | "read" | "manual" | "error";

/** A control on the sheet. A number is an arrow, 0 to 29 in card order. */
export type SheetField =
  "archer" | "shooterNumber" | "date" | "format" | "side" | "firstAnimal" | number;

/** A message for the coach. */
export interface SheetMessage {
  text: string;
  /** Problems are shown in the warning color. */
  isProblem: boolean;
}

/** What the photo panel says about the card, and its badge. */
export interface ReadStatus extends SheetMessage {
  badge: BadgeKind;
}

/** An entry in the "needs a look" list. */
export interface ReviewItem {
  label: string;
  message: string;
  /** The control to move to when the entry is tapped. */
  field: SheetField;
}

/** How to draw one of the reader's rows over the photo. */
export interface Ring {
  /** The bubble to ring, or null for none. */
  chosenBubble: number | null;
  needsReview: boolean;
}

/** The photo on the panel and what the reader found in it. */
export interface SheetPhoto<Photo> {
  image: Photo;
  reading: CardReadResult;
  /** One per reader row: 30 arrows, then the 5 Shooter # digits. Empty with no successful read. */
  rings: readonly Ring[];
}

/** Everything the page draws for the Score sheet. A new snapshot after every change. */
export interface SheetState<Photo> {
  /** 30 scores in card order; null for blanks. */
  arrowScores: readonly ArrowScore[];
  arrowFlags: readonly ReviewFlag[];
  summary: ScorecardSummary;
  /** "Round 1", or "Round 1 · Coyote" once a 3D sheet has its Side and First animal. */
  roundLabels: readonly string[];
  /** One per round: true when an arrow in it is blank. */
  roundIncomplete: readonly boolean[];
  /** As typed, so it may have stray spaces. */
  archer: string;
  /** Digits only, at most five. */
  shooterNumber: string;
  /** Explains an unfinished Shooter #, or null. Held back until the coach leaves the field. */
  shooterNumberProblem: string | null;
  shooterNumberNeedsReview: boolean;
  /** Names to suggest while typing the archer's name. */
  archerNames: readonly string[];
  /** As typed: "YYYY-MM-DD", or blank for today. */
  date: string;
  format: ScorecardFormat;
  /** Kept while the format is Bullseye, but not saved. */
  side: Side | null;
  firstAnimal: Animal | null;
  /** Every spot a person should check, in the order they're listed. */
  reviewItems: readonly ReviewItem[];
  status: ReadStatus;
  saveMessage: SheetMessage;
  /** Null before any photo has been read, and while scores are entered by hand. */
  photo: SheetPhoto<Photo> | null;
  /**
   * The control to move the keyboard focus to, set only in the snapshot right
   * after the step that asks for it.
   */
  focusRequest: SheetField | null;
}

/** Today's date and the current time. */
export interface Clock {
  /** "YYYY-MM-DD" in local time. */
  today(): string;
  /** Milliseconds since 1970. */
  now(): number;
}

/** A photo and what the reader found in it. */
export interface CardPhoto<Photo> {
  image: Photo;
  reading: CardReadResult;
}

/** Options for a new {@link ScoreSheet}. */
export interface ScoreSheetOptions {
  format: ScorecardFormat;
  /** Defaults to the device's clock. Tests pass a fixed one. */
  clock?: Clock;
}

/** Why a photo couldn't be read at all. */
export type PhotoProblem = "not-an-image" | "cannot-open";

const MESSAGES = {
  readingSample: "Reading the sample card…",
  reading: "Reading the card…",
  sampleRead:
    "This is a sample card with one double-marked arrow. Take a photo of one of yours to start.",
  noSample: "Take a photo of a score card to start.",
  notAnImage: "That file isn't an image. Choose a photo of the score card.",
  cannotOpenImage: "This browser couldn't open that image. Try a JPEG or PNG.",
  readFailed: "Something went wrong while reading this photo.",
  retakeAdvice:
    "Retake it with the whole card in frame, flat and evenly lit, or enter the scores by hand.",
  enterByHand: "Enter each arrow on the score sheet.",
  cannotSave:
    "This browser wouldn't save the scorecard. Its storage may be full or blocked in private browsing.",
  shooterNumberFlagged: "Some shooter-number digits weren't marked clearly",
} as const;

/** What each save problem says, and the control it moves to. */
const SAVE_PROBLEMS: Readonly<Record<SaveProblem, { text: string; field: SheetField | null }>> = {
  "no-archer": { text: "Add the archer's name or shooter number first.", field: "archer" },
  "partial-shooter-number": {
    text: "Enter all five digits of the Shooter #, including any leading zeros, like 00123, or clear it.",
    field: "shooterNumber",
  },
  "no-side": { text: "Choose the side this archer shot from.", field: "side" },
  "no-first-animal": { text: "Choose the first animal this archer shot.", field: "firstAnimal" },
  "no-scores": { text: "There are no scores to save yet.", field: null },
};

const NO_MESSAGE: SheetMessage = { text: "", isProblem: false };

const DEVICE_CLOCK: Clock = { today: getTodayAsIsoDate, now: () => Date.now() };

/** What the sheet keeps. Everything else in {@link SheetState} is worked out from it. */
interface SheetFields<Photo> {
  arrowScores: readonly ArrowScore[];
  arrowFlags: readonly ReviewFlag[];
  archerFields: ArcherFields;
  directory: ArcherDirectory;
  archerNames: readonly string[];
  date: string;
  format: ScorecardFormat;
  side: Side | null;
  firstAnimal: Animal | null;
  /** Held back while typing, so a number isn't called unfinished too early. */
  isShooterNumberProblemShown: boolean;
  /** The photo showing, and what the reader found in it. */
  card: CardPhoto<Photo> | null;
  status: ReadStatus;
  saveMessage: SheetMessage;
  focusRequest: SheetField | null;
}

/**
 * The Score sheet. Every change goes through one of its methods, which applies
 * the step in full and then tells each listener once. `Photo` is whatever the
 * page uses to hold a photo; the sheet only keeps it and hands it back.
 */
export class ScoreSheet<Photo> {
  private readonly clock: Clock;
  private fields: SheetFields<Photo>;
  private state: SheetState<Photo>;
  private readonly listeners: Array<(state: SheetState<Photo>) => void> = [];
  private readonly formatListeners: Array<(format: ScorecardFormat) => void> = [];
  /** Counts photo reads and hand entries, so only the newest is shown. */
  private photoReadCount = 0;
  /** True once the coach chose a photo or chose to enter by hand, so the sample stays away. */
  private hasCoachTakenOver = false;

  constructor({ format, clock = DEVICE_CLOCK }: ScoreSheetOptions) {
    this.clock = clock;
    const directory = new ArcherDirectory();
    this.fields = {
      arrowScores: createBlankScores(),
      arrowFlags: new Array<ReviewFlag>(ARROW_COUNT).fill(null),
      archerFields: BLANK_ARCHER_FIELDS,
      directory,
      archerNames: directory.getNames(),
      date: clock.today(),
      format,
      side: null,
      firstAnimal: null,
      isShooterNumberProblemShown: false,
      card: null,
      status: { badge: "sample", text: MESSAGES.readingSample, isProblem: false },
      saveMessage: NO_MESSAGE,
      focusRequest: null,
    };
    this.state = describeSheet(this.fields);
  }

  /** Registers a function to call with the new state after every change. */
  subscribe(listener: (state: SheetState<Photo>) => void): void {
    this.listeners.push(listener);
  }

  /** Registers a function to call when the coach chooses a different format. */
  onFormatChange(listener: (format: ScorecardFormat) => void): void {
    this.formatListeners.push(listener);
  }

  /** Returns the current state. The same object until the next change. */
  getState(): SheetState<Photo> {
    return this.state;
  }

  /**
   * Applies the coach changing a control, given the control's raw value ("" for
   * blank). A value that isn't valid for the control is ignored.
   *
   * @throws {RangeError} For an arrow that isn't 0 to 29.
   */
  edit(field: SheetField, value: string): void {
    const { archerFields, directory } = this.fields;
    if (typeof field === "number") {
      if (!Number.isInteger(field) || field < 0 || field >= ARROW_COUNT) {
        throw new RangeError(`There is no arrow ${field}.`);
      }
      const score = readArrowScore(value);
      if (score === undefined) {
        return;
      }
      // A person has now checked this arrow, so it no longer needs review.
      this.update({
        arrowScores: replaceAt(this.fields.arrowScores, field, score),
        arrowFlags: replaceAt(this.fields.arrowFlags, field, null),
      });
      return;
    }
    switch (field) {
      case "archer":
        this.update({
          archerFields: changeArcher(archerFields, value, directory),
          isShooterNumberProblemShown: false,
          saveMessage: NO_MESSAGE,
        });
        return;
      case "shooterNumber": {
        const digits = value.replace(/\D/g, "").slice(0, SHOOTER_NUMBER_LENGTH);
        this.update({
          archerFields: changeShooterNumber(archerFields, digits, directory),
          isShooterNumberProblemShown: false,
          saveMessage: NO_MESSAGE,
        });
        return;
      }
      case "date":
        this.update({ date: value });
        return;
      case "format": {
        const format = parseFormat(value);
        if (format === null) {
          return;
        }
        this.update({ format });
        this.formatListeners.forEach((listener) => listener(format));
        return;
      }
      case "side":
        this.update({ side: parseSide(value), saveMessage: NO_MESSAGE });
        return;
      case "firstAnimal":
        this.update({ firstAnimal: parseAnimal(value), saveMessage: NO_MESSAGE });
        return;
    }
  }

  /** The coach left the Shooter # field: points out a number that isn't finished. */
  finishShooterNumber(): void {
    this.update({
      isShooterNumberProblemShown: isPartialShooterNumber(this.fields.archerFields.shooterNumber),
    });
  }

  /**
   * Shows that a photo is being read, then puts what the reader found on the
   * sheet. A new card is usually a new archer, so the last card's archer, Side
   * and First animal are cleared first. When photos are read one after
   * another, only the newest one is shown.
   */
  async readPhoto(read: Promise<CardPhoto<Photo>>): Promise<void> {
    this.hasCoachTakenOver = true;
    const readNumber = ++this.photoReadCount;
    this.update({ status: { ...this.fields.status, text: MESSAGES.reading, isProblem: false } });
    let cardPhoto: CardPhoto<Photo>;
    try {
      cardPhoto = await read;
    } catch {
      if (readNumber === this.photoReadCount) {
        this.update({
          status: {
            badge: "error",
            text: `${MESSAGES.readFailed} ${MESSAGES.retakeAdvice}`,
            isProblem: true,
          },
        });
      }
      return;
    }
    if (readNumber !== this.photoReadCount) {
      return;
    }
    const { archerFields, directory } = this.fields;
    this.showCard(cardPhoto, {
      isSample: false,
      archerFields: changeArcher(archerFields, "", directory),
      side: null,
      firstAnimal: null,
    });
  }

  /**
   * Shows the sample card when the page opens. Ignored once the coach chose a
   * photo or chose to enter scores by hand.
   */
  async readSample(read: Promise<CardPhoto<Photo>>): Promise<void> {
    if (this.hasCoachTakenOver) {
      return;
    }
    this.update({ status: { ...this.fields.status, text: MESSAGES.reading, isProblem: false } });
    let cardPhoto: CardPhoto<Photo>;
    try {
      cardPhoto = await read;
    } catch {
      if (!this.hasCoachTakenOver) {
        this.update({
          status: { ...this.fields.status, text: MESSAGES.noSample, isProblem: false },
        });
      }
      return;
    }
    if (!this.hasCoachTakenOver) {
      this.showCard(cardPhoto, { isSample: true });
    }
  }

  /** Explains a file that couldn't be read as a photo. The sample then stays away. */
  showPhotoProblem(problem: PhotoProblem): void {
    this.hasCoachTakenOver = true;
    const text = problem === "not-an-image" ? MESSAGES.notAnImage : MESSAGES.cannotOpenImage;
    this.update({ status: { ...this.fields.status, text, isProblem: true } });
  }

  /**
   * Blanks the sheet so every arrow can be typed in, and moves to the first
   * arrow. The photo is hidden, since the card being typed in usually isn't
   * the one in the photo.
   */
  enterByHand(): void {
    this.hasCoachTakenOver = true;
    this.photoReadCount++;
    const { archerFields, directory } = this.fields;
    this.update({
      ...blankScores(changeArcher(archerFields, "", directory), directory),
      side: null,
      firstAnimal: null,
      card: null,
      status: { badge: "manual", text: MESSAGES.enterByHand, isProblem: false },
      saveMessage: NO_MESSAGE,
      focusRequest: 0,
    });
  }

  /**
   * Updates what the sheet knows about archers from the log, for name
   * suggestions and for filling in names and numbers. A name or number already
   * on the sheet stays.
   */
  setLog(scorecards: readonly Scorecard[]): void {
    const directory = new ArcherDirectory(scorecards);
    this.update({ directory, archerNames: directory.getNames() });
  }

  /**
   * Saves the sheet as a new scorecard. When the sheet can't be saved, explains
   * why, moves to the field to fix and returns null. Otherwise calls `store`
   * once and says how it went. The sheet stays as it is, so saving again saves
   * another copy.
   *
   * @param store Adds the scorecard to the log. Returns false when the browser
   *   wouldn't save it.
   * @returns The saved scorecard, or null when nothing was saved.
   */
  save(store: (scorecard: NewScorecard) => boolean): NewScorecard | null {
    const { archerFields, format, arrowScores } = this.fields;
    const details = {
      date: this.fields.date || this.clock.today(),
      archer: archerFields.archer.trim(),
      shooterNumber: archerFields.shooterNumber,
      format,
      side: format === "3d" ? this.fields.side : null,
      firstAnimal: format === "3d" ? this.fields.firstAnimal : null,
      arrowScores: [...arrowScores],
    };

    const problem = findSaveProblem(details);
    if (problem !== null) {
      const { text, field } = SAVE_PROBLEMS[problem];
      this.update({
        saveMessage: { text, isProblem: true },
        focusRequest: field,
        isShooterNumberProblemShown:
          problem === "partial-shooter-number" || this.fields.isShooterNumberProblemShown,
      });
      return null;
    }

    const scorecard: NewScorecard = { ...details, createdAt: this.clock.now() };
    if (!store(scorecard)) {
      this.update({ saveMessage: { text: MESSAGES.cannotSave, isProblem: true } });
      return null;
    }
    const blankCount = arrowScores.filter((score) => score === null).length;
    this.update({
      saveMessage: {
        text:
          blankCount === 0
            ? "Saved. Scan the next card when you're ready."
            : `Saved with ${formatCount(blankCount, "blank arrow")} counted as 0.`,
        isProblem: false,
      },
    });
    return scorecard;
  }

  /**
   * Puts a reading on the sheet, with any other changes the step makes first,
   * and explains the result.
   */
  private showCard(
    { image, reading }: CardPhoto<Photo>,
    { isSample, ...earlierChanges }: { isSample: boolean } & Partial<SheetFields<Photo>>,
  ): void {
    const fields: SheetFields<Photo> = {
      ...this.fields,
      ...earlierChanges,
      card: { image, reading },
      saveMessage: NO_MESSAGE,
      focusRequest: null,
    };
    if (!reading.ok) {
      this.update({
        ...fields,
        ...blankScores(fields.archerFields, fields.directory),
        status: {
          badge: "error",
          text: `${reading.error} ${MESSAGES.retakeAdvice}`,
          isProblem: true,
        },
      });
      return;
    }
    const scan = readShooterNumber(reading.shooter);
    const read: SheetFields<Photo> = {
      ...fields,
      arrowScores: reading.scores.map((row) => row.value),
      arrowFlags: reading.scores.map((row) => row.flag),
      archerFields: applyScannedNumber(fields.archerFields, scan, fields.directory),
      isShooterNumberProblemShown: false,
    };
    const status: ReadStatus = isSample
      ? { badge: "sample", text: MESSAGES.sampleRead, isProblem: false }
      : {
          badge: "read",
          text: describeReadResult(describeSheet(read).reviewItems.length),
          isProblem: false,
        };
    this.update({ ...read, status });
  }

  /**
   * Applies a step's changes, works out the new state and tells every listener.
   * A focus request lasts only for the step that makes it.
   */
  private update(changes: Partial<SheetFields<Photo>>): void {
    this.fields = { ...this.fields, focusRequest: null, ...changes };
    this.state = describeSheet(this.fields);
    this.listeners.forEach((listener) => listener(this.state));
  }
}

/** Blank arrows and a blank Shooter #, applied through the archer rules. */
function blankScores(
  archerFields: ArcherFields,
  directory: ArcherDirectory,
): Pick<
  SheetFields<never>,
  "arrowScores" | "arrowFlags" | "archerFields" | "isShooterNumberProblemShown"
> {
  return {
    arrowScores: createBlankScores(),
    arrowFlags: new Array<ReviewFlag>(ARROW_COUNT).fill(null),
    archerFields: applyScannedNumber(
      archerFields,
      { shooterNumber: "", needsReview: false },
      directory,
    ),
    isShooterNumberProblemShown: false,
  };
}

/** Works out everything the page draws from what the sheet keeps. */
function describeSheet<Photo>(fields: SheetFields<Photo>): SheetState<Photo> {
  const { arrowScores, arrowFlags, archerFields, directory, format, side, firstAnimal } = fields;
  const { archer, shooterNumber } = archerFields;

  const roundAnimals =
    format === "3d" && side && firstAnimal ? getRoundAnimals(firstAnimal, side) : null;
  const roundLabels = Array.from({ length: ROUND_COUNT }, (_, roundIndex) => {
    const roundName = `Round ${roundIndex + 1}`;
    return roundAnimals ? `${roundName} · ${roundAnimals[roundIndex]}` : roundName;
  });

  const shooterNumberProblem =
    fields.isShooterNumberProblemShown && isPartialShooterNumber(shooterNumber)
      ? `${shooterNumber.length} of ${SHOOTER_NUMBER_LENGTH} digits entered. Add any leading zeros.`
      : null;
  const mismatchedNumber = findMismatchedNumber(archerFields, directory);

  const reviewItems: ReviewItem[] = [];
  arrowFlags.forEach((flag, arrowIndex) => {
    if (flag !== null) {
      reviewItems.push({ label: describeArrow(arrowIndex), message: flag, field: arrowIndex });
    }
  });
  if (isShooterNumberFlagged(archerFields)) {
    reviewItems.push({
      label: "Shooter #",
      message: MESSAGES.shooterNumberFlagged,
      field: "shooterNumber",
    });
  }
  if (mismatchedNumber !== null) {
    reviewItems.push({
      label: "Shooter #",
      message: `${archer.trim()}'s last scorecard used ${mismatchedNumber}`,
      field: "shooterNumber",
    });
  }

  return Object.freeze({
    arrowScores,
    arrowFlags,
    summary: summarizeScorecard(arrowScores),
    roundLabels,
    roundIncomplete: roundLabels.map((_, roundIndex) => isRoundIncomplete(arrowScores, roundIndex)),
    archer,
    shooterNumber,
    shooterNumberProblem,
    shooterNumberNeedsReview:
      shooterNumberProblem !== null ||
      isShooterNumberFlagged(archerFields) ||
      mismatchedNumber !== null,
    archerNames: fields.archerNames,
    date: fields.date,
    format,
    side,
    firstAnimal,
    reviewItems,
    status: fields.status,
    saveMessage: fields.saveMessage,
    photo: fields.card === null ? null : { ...fields.card, rings: describeRings(fields) },
    focusRequest: fields.focusRequest,
  });
}

/**
 * How to draw each of the reader's rows. The rings follow the sheet rather than
 * the original reading, so a corrected arrow or Shooter # moves its rings. The
 * Shooter # digits are only ringed when the number is complete, since a partial
 * number can't be matched to the card's rows digit by digit.
 */
function describeRings(fields: SheetFields<unknown>): Ring[] {
  const { card, archerFields } = fields;
  const reading = card?.reading;
  if (!reading?.ok) {
    return [];
  }
  const arrowRings = fields.arrowScores.map((score, arrowIndex) => ({
    chosenBubble: score,
    needsReview: fields.arrowFlags[arrowIndex] !== null,
  }));
  const { shooterNumber } = archerFields;
  const isComplete = isCompleteShooterNumber(shooterNumber);
  // Only the scan's own doubts count, and only until someone changes the number.
  const isFlagged = isShooterNumberFlagged(archerFields);
  const digitRings = reading.shooter.map((row, digitIndex) =>
    isComplete
      ? {
          chosenBubble: Number(shooterNumber[digitIndex]),
          needsReview: isFlagged && row.flag !== null,
        }
      : { chosenBubble: null, needsReview: false },
  );
  return [...arrowRings, ...digitRings];
}

/** Builds the status message after a successful read. */
function describeReadResult(spotsToCheck: number): string {
  if (spotsToCheck === 0) {
    return "Read all 30 arrows. Check the sheet against the card, then save.";
  }
  const spots = spotsToCheck === 1 ? "One spot needs" : `${spotsToCheck} spots need`;
  return `Read all 30 arrows. ${spots} a look before you save.`;
}

/**
 * Reads an arrow control's value.
 *
 * @returns The score, null for blank, or undefined for anything else.
 */
function readArrowScore(value: string): ArrowScore | undefined {
  if (value === "") {
    return null;
  }
  return /^\d+$/.test(value) && Number(value) <= MAXIMUM_ARROW_SCORE ? Number(value) : undefined;
}

/** Returns a copy of a list with one item replaced. */
function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  const copy = [...items];
  copy[index] = item;
  return copy;
}
