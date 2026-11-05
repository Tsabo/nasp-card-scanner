import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PracticeLogStore, StorageUnavailableError } from "../src/app/practice-log-store.ts";
import type { NewPracticeRound } from "../src/app/practice-round.ts";

/** A stand-in for the browser's localStorage, kept in memory. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  private readonly refuseWrites: boolean;

  constructor({ refuseWrites = false }: { refuseWrites?: boolean } = {}) {
    this.refuseWrites = refuseWrites;
  }
  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.refuseWrites) {
      throw new Error("QuotaExceededError");
    }
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  clear(): void {
    this.items.clear();
  }
}

function createRound(archer = "Kyle", firstArrow = 10): NewPracticeRound {
  return {
    date: "2026-11-04",
    archer,
    shooterNumber: "10798",
    arrowScores: [firstArrow, ...new Array(29).fill(9)],
    createdAt: Date.now(),
  };
}

describe("PracticeLogStore", () => {
  it("saves rounds and reads them back in a new session", () => {
    const storage = new MemoryStorage();
    const store = new PracticeLogStore(storage);
    const saved = store.add(createRound());
    assert.ok(saved.id);

    const reopened = new PracticeLogStore(storage);
    assert.deepEqual(reopened.getAll(), [saved]);
  });

  it("deletes a round", () => {
    const store = new PracticeLogStore(new MemoryStorage());
    const first = store.add(createRound("Kyle"));
    store.add(createRound("Ryan"));
    store.remove(first.id);
    assert.deepEqual(
      store.getAll().map((round) => round.archer),
      ["Ryan"],
    );
  });

  it("skips duplicates when importing", () => {
    const store = new PracticeLogStore(new MemoryStorage());
    store.add(createRound("Kyle"));
    const result = store.addMany([
      createRound("kyle"),
      createRound("Kyle", 8),
      createRound("Ryan"),
    ]);
    assert.deepEqual(result, { addedCount: 2, duplicateCount: 1 });
    assert.equal(store.getAll().length, 3);
  });

  it("leaves the log unchanged when the browser refuses to save", () => {
    const store = new PracticeLogStore(new MemoryStorage({ refuseWrites: true }));
    assert.throws(() => store.add(createRound()), StorageUnavailableError);
    assert.equal(store.getAll().length, 0);
    assert.equal(store.canSave(), false);
  });

  it("reads logs saved by the first version of the app", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "nasp-practice-log",
      JSON.stringify([
        {
          id: "r1",
          date: "2026-11-04",
          archer: "Ryan",
          shooter: "12828",
          arrows: new Array(30).fill(10),
          createdAt: 5,
        },
      ]),
    );
    const [round] = new PracticeLogStore(storage).getAll();
    assert.equal(round.shooterNumber, "12828");
    assert.equal(round.arrowScores.length, 30);
  });

  it("starts empty when the stored log is damaged", () => {
    const storage = new MemoryStorage();
    storage.setItem("nasp-practice-log", "{not json");
    assert.deepEqual(new PracticeLogStore(storage).getAll(), []);
  });
});
