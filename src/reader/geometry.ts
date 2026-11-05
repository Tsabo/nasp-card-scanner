/**
 * @file Small 2D vector helpers used throughout the reader.
 *
 * Image coordinates follow the browser convention: x grows to the right and
 * y grows downward, measured in pixels from the top-left corner.
 */

/** A position in the image, in pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A direction or offset in the image. Directions are normally unit length. */
export type Vector = Point;

/** Returns the straight-line distance between two points. */
export function distanceBetween(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** Returns the unit-length direction from one point toward another. */
export function directionBetween(from: Point, to: Point): Vector {
  const length = distanceBetween(from, to);
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** Returns a vector scaled to unit length. */
export function normalize(vector: Vector): Vector {
  const length = Math.hypot(vector.x, vector.y);
  return { x: vector.x / length, y: vector.y / length };
}

/**
 * Returns the vector rotated a quarter turn: the direction "across" a line
 * that runs along `direction`.
 */
export function perpendicular(direction: Vector): Vector {
  return { x: -direction.y, y: direction.x };
}

/**
 * Returns the dot product of two vectors: how far `vector` reaches along
 * `direction` when `direction` is unit length.
 */
export function dot(vector: Vector, direction: Vector): number {
  return vector.x * direction.x + vector.y * direction.y;
}

/** Returns `point + direction * distance`. */
export function moveAlong(point: Point, direction: Vector, distance: number): Point {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}
