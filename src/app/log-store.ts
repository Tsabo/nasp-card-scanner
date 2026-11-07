/**
 * @file Keeps the log in the browser's local storage.
 *
 * Local storage belongs to one browser on one device. To move scorecards
 * between devices, export a CSV on one and import it on the other.
 */

import { getScorecardIdentity, normalizeStoredScorecard } from "./scorecard.ts";
import type { NewScorecard, Scorecard } from "./scorecard.ts";
import type { ScorecardFormat } from "./scorecard-format.ts";

const STORAGE_KEY = "nasp-scorecards";

/** Where logs were kept before the rename; merged on load, then removed on the next save. */
const LEGACY_STORAGE_KEY = "nasp-practice-log";

/**
 * Thrown when the browser refuses to save, for example in private browsing
 * or when storage is full.
 */
export class StorageUnavailableError extends Error {
  constructor() {
    super("This browser wouldn't save the log.");
    this.name = "StorageUnavailableError";
  }
}

/** The outcome of {@link LogStore.addMany}. */
export interface AddManyResult {
  addedCount: number;
  /** How many of the added scorecards are in each format. */
  addedCountByFormat: Record<ScorecardFormat, number>;
  /** Scorecards skipped because they were already in the log. */
  duplicateCount: number;
}

/**
 * The log, backed by local storage.
 *
 * Every change is saved straight away. If saving fails, the change is
 * undone and a {@link StorageUnavailableError} is thrown, so what's on
 * screen always matches what's stored.
 */
export class LogStore {
  private readonly storage: Storage;
  private scorecards: Scorecard[];

  /**
   * @param storage Where to keep the log. Defaults to the browser's local
   *   storage; tests pass a stand-in.
   */
  constructor(storage: Storage = globalThis.localStorage) {
    this.storage = storage;
    this.scorecards = this.load();
  }

  /** Returns every saved scorecard, in the order they were added. */
  getAll(): readonly Scorecard[] {
    return this.scorecards;
  }

  /**
   * Saves a new scorecard.
   *
   * @returns The saved scorecard, with its id.
   * @throws {StorageUnavailableError}
   */
  add(scorecard: NewScorecard): Scorecard {
    const saved: Scorecard = { ...scorecard, id: createScorecardId() };
    this.commit([...this.scorecards, saved]);
    return saved;
  }

  /**
   * Saves several scorecards at once, skipping any that are already in the log.
   *
   * @throws {StorageUnavailableError}
   */
  addMany(scorecards: readonly NewScorecard[]): AddManyResult {
    const knownScorecards = new Set(this.scorecards.map(getScorecardIdentity));
    const toAdd: Scorecard[] = [];
    for (const scorecard of scorecards) {
      const identity = getScorecardIdentity(scorecard);
      if (!knownScorecards.has(identity)) {
        knownScorecards.add(identity);
        toAdd.push({ ...scorecard, id: createScorecardId() });
      }
    }
    if (toAdd.length > 0) {
      this.commit([...this.scorecards, ...toAdd]);
    }
    const countAdded = (format: ScorecardFormat): number =>
      toAdd.filter((scorecard) => scorecard.format === format).length;
    return {
      addedCount: toAdd.length,
      addedCountByFormat: { bullseye: countAdded("bullseye"), "3d": countAdded("3d") },
      duplicateCount: scorecards.length - toAdd.length,
    };
  }

  /**
   * Deletes a scorecard.
   *
   * @throws {StorageUnavailableError}
   */
  remove(scorecardId: string): void {
    this.commit(this.scorecards.filter((scorecard) => scorecard.id !== scorecardId));
  }

  /**
   * Tells whether this browser will let the page save at all. Private
   * browsing windows in some browsers refuse.
   */
  canSave(): boolean {
    const probeKey = `${STORAGE_KEY}-probe`;
    try {
      this.storage.setItem(probeKey, "1");
      this.storage.removeItem(probeKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Asks the browser not to clear the log when the device runs low on
   * space. Browsers may ignore the request; nothing depends on it.
   */
  static requestPersistentStorage(): void {
    navigator.storage?.persist?.().catch(() => {});
  }

  /**
   * Replaces the stored log, or leaves everything unchanged if that fails.
   *
   * @throws {StorageUnavailableError}
   */
  private commit(scorecards: Scorecard[]): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(scorecards));
    } catch {
      throw new StorageUnavailableError();
    }
    this.storage.removeItem(LEGACY_STORAGE_KEY);
    this.scorecards = scorecards;
  }

  /**
   * Reads the stored log, adding any scorecards still under the legacy key.
   * Both keys can hold scorecards if the app was rolled back to a version that
   * saves under the legacy key, and the next save removes that key.
   */
  private load(): Scorecard[] {
    const scorecards = this.readScorecards(STORAGE_KEY);
    const knownScorecards = new Set(scorecards.map(getScorecardIdentity));
    const legacyScorecards = this.readScorecards(LEGACY_STORAGE_KEY).filter(
      (scorecard) => !knownScorecards.has(getScorecardIdentity(scorecard)),
    );
    return [...scorecards, ...legacyScorecards];
  }

  /**
   * Reads the scorecards under one storage key. Returns none if nothing is
   * stored, the stored data is damaged, or storage can't be read.
   */
  private readScorecards(key: string): Scorecard[] {
    try {
      const stored: unknown = JSON.parse(this.storage.getItem(key) ?? "[]");
      if (!Array.isArray(stored)) {
        return [];
      }
      return stored
        .map(normalizeStoredScorecard)
        .filter((scorecard): scorecard is Scorecard => scorecard !== null)
        .map((scorecard) => (scorecard.id ? scorecard : { ...scorecard, id: createScorecardId() }));
    } catch {
      return [];
    }
  }
}

/**
 * Creates an id that is unique within this browser's log: the time plus a
 * random suffix.
 */
function createScorecardId(): string {
  return `scorecard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
