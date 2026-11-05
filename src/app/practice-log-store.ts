/**
 * @file Keeps the practice log in the browser's local storage.
 *
 * Local storage belongs to one browser on one device. To move rounds
 * between devices, export a CSV on one and import it on the other.
 */

import { getRoundIdentity, normalizeStoredRound } from "./practice-round.ts";
import type { NewPracticeRound, PracticeRound } from "./practice-round.ts";

/** Storage key. Unchanged since the first version, so existing logs carry over. */
const STORAGE_KEY = "nasp-practice-log";

/**
 * Thrown when the browser refuses to save, for example in private browsing
 * or when storage is full.
 */
export class StorageUnavailableError extends Error {
  constructor() {
    super("This browser wouldn't save the practice log.");
    this.name = "StorageUnavailableError";
  }
}

/** The outcome of {@link PracticeLogStore.addMany}. */
export interface AddManyResult {
  addedCount: number;
  /** Rounds skipped because they were already in the log. */
  duplicateCount: number;
}

/**
 * The practice log, backed by local storage.
 *
 * Every change is saved straight away. If saving fails, the change is
 * undone and a {@link StorageUnavailableError} is thrown, so what's on
 * screen always matches what's stored.
 */
export class PracticeLogStore {
  private readonly storage: Storage;
  private rounds: PracticeRound[];

  /**
   * @param storage Where to keep the log. Defaults to the browser's local
   *   storage; tests pass a stand-in.
   */
  constructor(storage: Storage = globalThis.localStorage) {
    this.storage = storage;
    this.rounds = this.load();
  }

  /** Returns every saved round, in the order they were added. */
  getAll(): readonly PracticeRound[] {
    return this.rounds;
  }

  /**
   * Saves a new round.
   *
   * @returns The saved round, with its id.
   * @throws {StorageUnavailableError}
   */
  add(round: NewPracticeRound): PracticeRound {
    const saved: PracticeRound = { ...round, id: createRoundId() };
    this.commit([...this.rounds, saved]);
    return saved;
  }

  /**
   * Saves several rounds at once, skipping any that are already in the log.
   *
   * @throws {StorageUnavailableError}
   */
  addMany(rounds: readonly NewPracticeRound[]): AddManyResult {
    const knownRounds = new Set(this.rounds.map(getRoundIdentity));
    const toAdd: PracticeRound[] = [];
    for (const round of rounds) {
      const identity = getRoundIdentity(round);
      if (!knownRounds.has(identity)) {
        knownRounds.add(identity);
        toAdd.push({ ...round, id: createRoundId() });
      }
    }
    if (toAdd.length > 0) {
      this.commit([...this.rounds, ...toAdd]);
    }
    return { addedCount: toAdd.length, duplicateCount: rounds.length - toAdd.length };
  }

  /**
   * Deletes a round.
   *
   * @throws {StorageUnavailableError}
   */
  remove(roundId: string): void {
    this.commit(this.rounds.filter((round) => round.id !== roundId));
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
  private commit(rounds: PracticeRound[]): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(rounds));
    } catch {
      throw new StorageUnavailableError();
    }
    this.rounds = rounds;
  }

  /**
   * Reads the stored log. Returns an empty log if nothing is stored, the
   * stored data is damaged, or storage can't be read.
   */
  private load(): PracticeRound[] {
    try {
      const stored: unknown = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? "[]");
      if (!Array.isArray(stored)) {
        return [];
      }
      return stored
        .map(normalizeStoredRound)
        .filter((round): round is PracticeRound => round !== null)
        .map((round) => (round.id ? round : { ...round, id: createRoundId() }));
    } catch {
      return [];
    }
  }
}

/**
 * Creates an id that is unique within this browser's log: the time plus a
 * random suffix.
 */
function createRoundId(): string {
  return `round-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
