export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** 中央値。要素数が偶数のときは中央の 2 つの平均。空の配列は受け付けない。 */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('空の配列の中央値は計算できません')
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] as number
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}
