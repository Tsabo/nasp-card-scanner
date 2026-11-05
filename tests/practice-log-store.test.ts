import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PracticeLogStore, StorageUnavailableError } from "../src/app/practice-log-store.ts";
import type { NewScorecard } from "../src/app/scorecard.ts";

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

function createScorecard(archer = "Kyle", firstArrow = 10): NewScorecard {
  return {
    date: "2026-11-04",
    archer,
    shooterNumber: "10798",
    arrowScores: [firstArrow, ...new Array(29).fill(9)],
    createdAt: Date.now(),
  };
}

describe("PracticeLogStore", () => {
  it("saves scorecards and reads them back in a new session", () => {
    const storage = new MemoryStorage();
    const store = new PracticeLogStore(storage);
    const saved = store.add(createScorecard());
    assert.ok(saved.id);

    const reopened = new PracticeLogStore(storage);
    assert.deepEqual(reopened.getAll(), [saved]);
  });

  it("deletes a scorecard", () => {
    const store = new PracticeLogStore(new MemoryStorage());
    const first = store.add(createScorecard("Kyle"));
    store.add(createScorecard("Ryan"));
    store.remove(first.id);
    assert.deepEqual(
      store.getAll().map((scorecard) => scorecard.archer),
      ["Ryan"],
    );
  });

  it("skips duplicates when importing", () => {
    const store = new PracticeLogStore(new MemoryStorage());
    store.add(createScorecard("Kyle"));
    const result = store.addMany([
      createScorecard("kyle"),
      createScorecard("Kyle", 8),
      createScorecard("Ryan"),
    ]);
    assert.deepEqual(result, { addedCount: 2, duplicateCount: 1 });
    assert.equal(store.getAll().length, 3);
  });

  it("leaves the log unchanged when the browser refuses to save", () => {
    const store = new PracticeLogStore(new MemoryStorage({ refuseWrites: true }));
    assert.throws(() => store.add(createScorecard()), StorageUnavailableError);
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
    const [scorecard] = new PracticeLogStore(storage).getAll();
    assert.equal(scorecard.shooterNumber, "12828");
    assert.equal(scorecard.arrowScores.length, 30);
  });

  it("moves a log from the old storage key on the next save", () => {
    const storage = new MemoryStorage();
    const oldStore = new PracticeLogStore(storage);
    oldStore.add(createScorecard("Kyle"));
    storage.setItem("nasp-practice-log", storage.getItem("nasp-scorecards") ?? "");
    storage.removeItem("nasp-scorecards");

    const store = new PracticeLogStore(storage);
    assert.equal(store.getAll().length, 1);
    store.add(createScorecard("Ryan"));
    assert.equal(storage.getItem("nasp-practice-log"), null);
    assert.equal(new PracticeLogStore(storage).getAll().length, 2);
  });

  it("starts empty when the stored log is damaged", () => {
    const storage = new MemoryStorage();
    storage.setItem("nasp-scorecards", "{not json");
    assert.deepEqual(new PracticeLogStore(storage).getAll(), []);
  });
});
