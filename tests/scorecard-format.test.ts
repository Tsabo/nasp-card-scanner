import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANIMALS,
  SIDES,
  getRoundAnimals,
  loadRememberedFormat,
  parseAnimal,
  parseFormat,
  parseSide,
  rememberFormat,
} from "../src/app/scorecard-format.ts";

/** Just enough of localStorage for remembering a format. */
function createStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } as unknown as Storage;
}

describe("getRoundAnimals", () => {
  it("on the left, starts on the first animal and wraps from the sheep to the turkey", () => {
    assert.deepEqual(getRoundAnimals("Pronghorn Antelope", "left"), [
      "Pronghorn Antelope",
      "Alert Deer / White-tailed Deer",
      "Standing Stone Sheep / Mountain Sheep",
      "Alert Turkey",
      "Coyote",
      "Cinnamon Bear / Black Bear",
    ]);
  });

  it("on the right, starts at the sheep and ends with the turkey", () => {
    assert.deepEqual(getRoundAnimals("Standing Stone Sheep / Mountain Sheep", "right"), [
      "Standing Stone Sheep / Mountain Sheep",
      "Alert Deer / White-tailed Deer",
      "Pronghorn Antelope",
      "Cinnamon Bear / Black Bear",
      "Coyote",
      "Alert Turkey",
    ]);
  });

  it("on the right, wraps from the turkey to the sheep", () => {
    assert.deepEqual(getRoundAnimals("Coyote", "right"), [
      "Coyote",
      "Alert Turkey",
      "Standing Stone Sheep / Mountain Sheep",
      "Alert Deer / White-tailed Deer",
      "Pronghorn Antelope",
      "Cinnamon Bear / Black Bear",
    ]);
  });

  it("on the left, goes from the sheep to the turkey straight away", () => {
    const [first, second] = getRoundAnimals("Standing Stone Sheep / Mountain Sheep", "left");
    assert.equal(first, "Standing Stone Sheep / Mountain Sheep");
    assert.equal(second, "Alert Turkey");
  });

  it("visits every animal exactly once, whichever side and animal are first", () => {
    for (const firstAnimal of ANIMALS) {
      for (const side of SIDES) {
        const roundAnimals = getRoundAnimals(firstAnimal, side);
        assert.equal(roundAnimals[0], firstAnimal);
        assert.equal(new Set(roundAnimals).size, ANIMALS.length);
      }
    }
  });
});

describe("parsing", () => {
  it("reads formats regardless of capitalization, and rejects anything else", () => {
    assert.equal(parseFormat("3D"), "3d");
    assert.equal(parseFormat(" bullseye "), "bullseye");
    assert.equal(parseFormat("Field"), null);
  });

  it("reads sides regardless of capitalization, and rejects anything else", () => {
    assert.equal(parseSide("Left"), "left");
    assert.equal(parseSide(" RIGHT "), "right");
    assert.equal(parseSide("Middle"), null);
  });

  it("reads animals regardless of capitalization, and rejects anything else", () => {
    assert.equal(parseAnimal("alert turkey"), "Alert Turkey");
    assert.equal(parseAnimal("Black Bear"), null);
  });
});

describe("remembering the format", () => {
  it("defaults to Bullseye and then remembers the choice", () => {
    const storage = createStorage();
    assert.equal(loadRememberedFormat(storage), "bullseye");
    rememberFormat("3d", storage);
    assert.equal(loadRememberedFormat(storage), "3d");
  });

  it("falls back to Bullseye when the stored value is unknown", () => {
    assert.equal(
      loadRememberedFormat(createStorage({ "nasp-scorecard-format": "field" })),
      "bullseye",
    );
  });

  it("carries on when storage refuses", () => {
    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    assert.equal(loadRememberedFormat(refusing), "bullseye");
    assert.doesNotThrow(() => rememberFormat("3d", refusing));
  });
});
