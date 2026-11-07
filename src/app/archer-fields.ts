/**
 * @file The rules linking the archer and Shooter # on the score sheet: what
 * the log knows about each archer, which details fill in the other, and when a
 * filled-in value gives way. No page code, so the rules can be tested in Node.
 */

import { isCompleteShooterNumber, sortNewestFirst } from "./scorecard.ts";
import type { Scorecard } from "./scorecard.ts";

/** The part of a reader's row that matters for the Shooter #. */
interface ShooterDigit {
  value: number | null;
  flag: string | null;
}

/** Where the Shooter # on the sheet came from. */
type ShooterNumberSource = "scan" | "flagged-scan" | "typed" | "filled";

/** The archer and Shooter # on the sheet, and how each one got there. */
export interface ArcherFields {
  /** As it appears in the field, so it may have stray spaces while being typed. */
  archer: string;
  /** True when the name came from the log rather than from a person. */
  isArcherFilled: boolean;
  shooterNumber: string;
  shooterNumberSource: ShooterNumberSource;
  /** What a filled-in number replaced, restored if the name stops matching. */
  numberBeforeFill: { shooterNumber: string; source: ShooterNumberSource } | null;
}

/** The fields on a blank sheet. */
export const BLANK_ARCHER_FIELDS: ArcherFields = {
  archer: "",
  isArcherFilled: false,
  shooterNumber: "",
  shooterNumberSource: "typed",
  numberBeforeFill: null,
};

/** Tells whether the archer left the card's Shooter # section completely blank. */
export function isShooterSectionBlank(digits: readonly ShooterDigit[]): boolean {
  return digits.every((digit) => digit.value === null);
}

/**
 * Turns the reader's digits into a Shooter #. A completely blank section only
 * means the archer didn't fill it in, so it needs no review. A blank digit is
 * left out rather than kept in place, so a partial reading can't be trusted
 * position by position.
 */
export function readShooterNumber(digits: readonly ShooterDigit[]): {
  shooterNumber: string;
  needsReview: boolean;
} {
  return {
    shooterNumber: digits.map((digit) => digit.value ?? "").join(""),
    needsReview: !isShooterSectionBlank(digits) && digits.some((digit) => digit.flag !== null),
  };
}

/** Puts a name in the form used to compare names, which ignores case and stray spaces. */
function getNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * What the log knows about archers: each name's latest Shooter #, and each
 * Shooter #'s latest name. Only complete numbers count, so partial numbers from
 * old logs and imports are never filled in on a new card.
 */
export class ArcherDirectory {
  private readonly numbersByName = new Map<string, string>();
  private readonly namesByNumber = new Map<string, string>();

  constructor(scorecards: readonly Scorecard[] = []) {
    for (const { archer, shooterNumber } of sortNewestFirst(scorecards)) {
      const name = archer.trim();
      if (name === "" || !isCompleteShooterNumber(shooterNumber)) {
        continue;
      }
      const nameKey = getNameKey(name);
      if (!this.numbersByName.has(nameKey)) {
        this.numbersByName.set(nameKey, shooterNumber);
      }
      if (!this.namesByNumber.has(shooterNumber)) {
        this.namesByNumber.set(shooterNumber, name);
      }
    }
  }

  /** Returns the Shooter # on this archer's latest scorecard that has one. */
  findShooterNumber(name: string): string | null {
    return this.numbersByName.get(getNameKey(name)) ?? null;
  }

  /** Returns the name on the latest scorecard with this Shooter # and a name. */
  findArcher(shooterNumber: string): string | null {
    return this.namesByNumber.get(shooterNumber) ?? null;
  }
}

/**
 * Applies a person changing the name. A known name fills in the number when
 * the number is blank, a doubtful scan, or left over from an earlier name. A
 * clean scan or a typed number stays, since the card is the record.
 */
export function changeArcher(
  fields: ArcherFields,
  archer: string,
  directory: ArcherDirectory,
): ArcherFields {
  const named: ArcherFields = { ...fields, archer, isArcherFilled: false };
  const knownNumber = directory.findShooterNumber(archer);

  if (fields.shooterNumberSource === "filled") {
    if (knownNumber !== null) {
      return { ...named, shooterNumber: knownNumber };
    }
    const previous = fields.numberBeforeFill;
    return {
      ...named,
      shooterNumber: previous?.shooterNumber ?? "",
      shooterNumberSource: previous?.source ?? "typed",
      numberBeforeFill: null,
    };
  }

  const canReplace = fields.shooterNumber === "" || fields.shooterNumberSource === "flagged-scan";
  if (knownNumber === null || !canReplace) {
    return named;
  }
  return {
    ...named,
    shooterNumber: knownNumber,
    shooterNumberSource: "filled",
    numberBeforeFill: { shooterNumber: fields.shooterNumber, source: fields.shooterNumberSource },
  };
}

/** Applies a person typing in the number. */
export function changeShooterNumber(
  fields: ArcherFields,
  shooterNumber: string,
  directory: ArcherDirectory,
): ArcherFields {
  return fillArcherFromNumber(
    { ...fields, shooterNumber, shooterNumberSource: "typed", numberBeforeFill: null },
    directory,
  );
}

/** Applies what the reader found on a card. */
export function applyScannedNumber(
  fields: ArcherFields,
  scan: { shooterNumber: string; needsReview: boolean },
  directory: ArcherDirectory,
): ArcherFields {
  return fillArcherFromNumber(
    {
      ...fields,
      shooterNumber: scan.shooterNumber,
      shooterNumberSource: scan.needsReview ? "flagged-scan" : "scan",
      numberBeforeFill: null,
    },
    directory,
  );
}

/**
 * Fills in the name from a trustworthy, complete number. A name a person
 * entered always stays; one filled in earlier follows the number. A flagged
 * number can't fill in a name, as that would make a misread look confirmed.
 */
function fillArcherFromNumber(fields: ArcherFields, directory: ArcherDirectory): ArcherFields {
  if (fields.archer.trim() !== "" && !fields.isArcherFilled) {
    return fields;
  }
  const canLookUp =
    fields.shooterNumberSource !== "flagged-scan" && isCompleteShooterNumber(fields.shooterNumber);
  const knownName = canLookUp ? directory.findArcher(fields.shooterNumber) : null;
  if (knownName !== null) {
    return { ...fields, archer: knownName, isArcherFilled: true };
  }
  return fields.isArcherFilled ? { ...fields, archer: "", isArcherFilled: false } : fields;
}

/** Tells whether the Shooter # on the sheet was read but needs checking. */
export function isShooterNumberFlagged(fields: ArcherFields): boolean {
  return fields.shooterNumberSource === "flagged-scan";
}

/**
 * Returns the archer's latest Shooter # when it differs from the complete
 * number on the sheet, or null when there's nothing to point out.
 */
export function findMismatchedNumber(
  fields: ArcherFields,
  directory: ArcherDirectory,
): string | null {
  if (!isCompleteShooterNumber(fields.shooterNumber)) {
    return null;
  }
  const knownNumber = directory.findShooterNumber(fields.archer);
  return knownNumber !== null && knownNumber !== fields.shooterNumber ? knownNumber : null;
}
