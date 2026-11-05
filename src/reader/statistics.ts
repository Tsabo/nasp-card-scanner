/**
 * @file Numeric helpers: medians, quantiles, nearest-value search and a tiny
 * least-squares solver. No dependencies.
 */

/** Three numbers, used for the coefficients of a three-term model. */
export type Triple = [number, number, number];

/**
 * Returns the median of a list of numbers. For an even count it returns the
 * upper of the two middle values rather than averaging them.
 *
 * @param values Must not be empty.
 */
export function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Returns the lower quartile (25th percentile) of a list of numbers, taking
 * the nearest value below the exact quartile position.
 *
 * @param values Must not be empty.
 */
export function lowerQuartile(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((first, second) => first - second);
  return sorted[Math.floor((sorted.length - 1) * 0.25)];
}

/**
 * Finds the entry in a sorted list that is closest to a target value.
 *
 * @param sortedValues Ascending, with at least one entry.
 * @returns Index of the closest entry.
 */
export function findNearestIndex(sortedValues: readonly number[], target: number): number {
  let low = 0;
  let high = sortedValues.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (sortedValues[middle] < target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const lowDistance = Math.abs(sortedValues[low] - target);
  const highDistance = Math.abs(sortedValues[high] - target);
  return lowDistance < highDistance ? low : high;
}

/**
 * One observation for {@link solveLeastSquares}: the model predicts `target`
 * as `basis[0] * a + basis[1] * b + basis[2] * c`.
 */
export interface LeastSquaresSample {
  basis: Triple;
  target: number;
}

/**
 * Finds the three coefficients `[a, b, c]` that best fit a set of samples in
 * the least-squares sense.
 *
 * @returns The coefficients, or null when the samples don't determine them
 *   (for example, too few distinct samples).
 */
export function solveLeastSquares(samples: Iterable<LeastSquaresSample>): Triple | null {
  // Build the normal equations: (Bᵀ B) x = Bᵀ t.
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rightHandSide = [0, 0, 0];
  for (const { basis, target } of samples) {
    for (let row = 0; row < 3; row++) {
      rightHandSide[row] += basis[row] * target;
      for (let column = 0; column < 3; column++) {
        matrix[row][column] += basis[row] * basis[column];
      }
    }
  }
  return solveLinearSystem3x3(matrix, rightHandSide);
}

/**
 * Solves the 3×3 linear system `matrix · x = rightHandSide` by Gauss-Jordan
 * elimination with partial pivoting.
 *
 * @param matrix 3 rows of 3 numbers.
 * @param rightHandSide 3 numbers.
 * @returns The solution, or null when the matrix is singular.
 */
export function solveLinearSystem3x3(matrix: number[][], rightHandSide: number[]): Triple | null {
  // Work on an augmented copy: each row is [m0, m1, m2, rhs].
  const rows = matrix.map((row, index) => [...row, rightHandSide[index]]);

  for (let column = 0; column < 3; column++) {
    // Swap in the row with the largest value in this column, for stability.
    let pivotRow = column;
    for (let row = column + 1; row < 3; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivotRow][column])) {
        pivotRow = row;
      }
    }
    [rows[column], rows[pivotRow]] = [rows[pivotRow], rows[column]];
    if (Math.abs(rows[column][column]) < 1e-12) {
      return null;
    }

    // Clear this column from every other row.
    for (let row = 0; row < 3; row++) {
      if (row === column) {
        continue;
      }
      const factor = rows[row][column] / rows[column][column];
      for (let entry = column; entry < 4; entry++) {
        rows[row][entry] -= factor * rows[column][entry];
      }
    }
  }

  return [rows[0][3] / rows[0][0], rows[1][3] / rows[1][1], rows[2][3] / rows[2][2]];
}
