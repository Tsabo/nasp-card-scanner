import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LogStore, StorageUnavailableError } from "../src/app/log-store.ts";
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
    format: "bullseye",
    side: null,
    firstAnimal: null,
    arrowScores: [firstArrow, ...new Array(29).fill(9)],
    createdAt: Date.now(),
  };
}

describe("LogStore", () => {
  it("saves scorecards and reads them back in a new session", () => {
    const storage = new MemoryStorage();
    const store = new LogStore(storage);
    const saved = store.add(createScorecard());
    assert.ok(saved.id);

    const reopened = new LogStore(storage);
    assert.deepEqual(reopened.getAll(), [saved]);
  });

  it("deletes a scorecard", () => {
    const store = new LogStore(new MemoryStorage());
    const first = store.add(createScorecard("Kyle"));
    store.add(createScorecard("Ryan"));
    store.remove(first.id);
    assert.deepEqual(
      store.getAll().map((scorecard) => scorecard.archer),
      ["Ryan"],
    );
  });

  it("skips duplicates when importing", () => {
    const store = new LogStore(new MemoryStorage());
    store.add(createScorecard("Kyle"));
    const result = store.addMany([
      createScorecard("kyle"),
      createScorecard("Kyle", 8),
      createScorecard("Ryan"),
    ]);
    assert.deepEqual(result, {
      addedCount: 2,
      addedCountByFormat: { bullseye: 2, "3d": 0 },
      duplicateCount: 1,
    });
    assert.equal(store.getAll().length, 3);
  });

  it("counts the same arrows in another format or from another animal as new", () => {
    const store = new LogStore(new MemoryStorage());
    store.add(createScorecard());
    const threeD = (firstAnimal: "Coyote" | "Alert Turkey"): NewScorecard => ({
      ...createScorecard(),
      format: "3d",
      side: "left",
      firstAnimal,
    });
    const result = store.addMany([threeD("Coyote"), threeD("Alert Turkey"), threeD("Coyote")]);
    assert.deepEqual(result, {
      addedCount: 2,
      addedCountByFormat: { bullseye: 0, "3d": 2 },
      duplicateCount: 1,
    });
  });

  it("counts the same arrows from the other side as new", () => {
    const store = new LogStore(new MemoryStorage());
    const threeD = (side: "left" | "right"): NewScorecard => ({
      ...createScorecard(),
      format: "3d",
      side,
      firstAnimal: "Coyote",
    });
    const result = store.addMany([threeD("left"), threeD("right")]);
    assert.equal(result.addedCount, 2);
  });

  it("counts 3D scorecards saved before sides existed as the left side", () => {
    const storage = new MemoryStorage();
    const { side: _side, ...withoutSide } = {
      ...createScorecard(),
      format: "3d",
      firstAnimal: "Coyote",
    };
    storage.setItem("nasp-scorecards", JSON.stringify([{ ...withoutSide, id: "scorecard-1" }]));
    assert.equal(new LogStore(storage).getAll()[0].side, "left");
  });

  it("keeps a 3D scorecard's format, side and first animal across sessions", () => {
    const storage = new MemoryStorage();
    const saved = new LogStore(storage).add({
      ...createScorecard(),
      format: "3d",
      side: "right",
      firstAnimal: "Coyote",
    });
    assert.deepEqual(new LogStore(storage).getAll(), [saved]);
  });

  it("leaves the log unchanged when the browser refuses to save", () => {
    const store = new LogStore(new MemoryStorage({ refuseWrites: true }));
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
    const [scorecard] = new LogStore(storage).getAll();
    assert.equal(scorecard.shooterNumber, "12828");
    assert.equal(scorecard.format, "bullseye");
    assert.equal(scorecard.side, null);
    assert.equal(scorecard.firstAnimal, null);
    assert.equal(scorecard.arrowScores.length, 30);
  });

  it("moves a log from the old storage key on the next save", () => {
    const storage = new MemoryStorage();
    const oldStore = new LogStore(storage);
    oldStore.add(createScorecard("Kyle"));
    storage.setItem("nasp-practice-log", storage.getItem("nasp-scorecards") ?? "");
    storage.removeItem("nasp-scorecards");

    const store = new LogStore(storage);
    assert.equal(store.getAll().length, 1);
    store.add(createScorecard("Ryan"));
    assert.equal(storage.getItem("nasp-practice-log"), null);
    assert.equal(new LogStore(storage).getAll().length, 2);
  });

  it("keeps scorecards saved under the old storage key after a rollback", () => {
    const storage = new MemoryStorage();
    new LogStore(storage).add(createScorecard("Kyle"));
    const rollbackStorage = new MemoryStorage();
    new LogStore(rollbackStorage).add(createScorecard("Ryan"));
    storage.setItem("nasp-practice-log", rollbackStorage.getItem("nasp-scorecards") ?? "");

    const store = new LogStore(storage);
    assert.deepEqual(
      store.getAll().map((scorecard) => scorecard.archer),
      ["Kyle", "Ryan"],
    );

    store.add(createScorecard("Sam"));
    assert.equal(storage.getItem("nasp-practice-log"), null);
    assert.deepEqual(
      new LogStore(storage).getAll().map((scorecard) => scorecard.archer),
      ["Kyle", "Ryan", "Sam"],
    );
  });

  it("doesn't duplicate a scorecard stored under both keys", () => {
    const storage = new MemoryStorage();
    new LogStore(storage).add(createScorecard("Kyle"));
    storage.setItem("nasp-practice-log", storage.getItem("nasp-scorecards") ?? "");
    assert.equal(new LogStore(storage).getAll().length, 1);
  });

  it("keeps the log when the old storage key is damaged", () => {
    const storage = new MemoryStorage();
    new LogStore(storage).add(createScorecard("Kyle"));
    storage.setItem("nasp-practice-log", "{not json");
    assert.equal(new LogStore(storage).getAll().length, 1);
  });

  it("starts empty when the stored log is damaged", () => {
    const storage = new MemoryStorage();
    storage.setItem("nasp-scorecards", "{not json");
    assert.deepEqual(new LogStore(storage).getAll(), []);
  });
});
