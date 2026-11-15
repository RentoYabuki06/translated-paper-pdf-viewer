/**
 * PDF の座標の変換に使う、2 次元のアフィン変換の行列。
 *
 * 行列は、PDF と同じく 6 つの数値 [a, b, c, d, e, f] で表す。
 * 点 (x, y) は、(a·x + c·y + e, b·x + d·y + f) に移る。
 */

export type Matrix = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** 2 つの変換をつなぐ。返す変換は、second を先に適用し、次に first を適用するもの。 */
export function multiply(first: Matrix, second: Matrix): Matrix {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ]
}

export function applyToPoint(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}

/** 6 つの数値が並んだ値(配列や Float32Array)を、行列として読む。そうでなければ null。 */
export function toMatrix(value: unknown): Matrix | null {
  if (value === null || typeof value !== 'object') return null
  const list = value as ArrayLike<unknown>
  if (list.length !== 6) return null
  const numbers: number[] = []
  for (let index = 0; index < 6; index += 1) {
    const item = list[index]
    if (typeof item !== 'number' || !Number.isFinite(item)) return null
    numbers.push(item)
  }
  return numbers as unknown as Matrix
}
