/**
 * 同時に実行する数を制限しながら、各要素に非同期の処理を適用する。
 * 結果は入力と同じ順番で返す。1 件でも失敗すると、全体が失敗する。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`同時実行数が不正です: ${concurrency}`)
  }
  const results = new Array<R>(items.length)
  let next = 0

  async function run(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index] as T, index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}
