/**
 * 翻訳の順番待ち。
 *
 * 同時に処理する数を制限しながら、待っている項目のうち優先度の値が最も小さいものから処理する。
 * 優先度は、処理を始める時点で計算し直す。表示中のページが変わったときに、順番が変わるようにするためである。
 */

export interface QueueOptions<T> {
  /** 同時に処理する数。 */
  concurrency: number
  /** 1 件の処理。失敗しても、ほかの項目の処理は続ける。失敗の扱いは、この関数の中で行う。 */
  worker: (item: T, signal: AbortSignal) => Promise<void>
  /** 優先度。値が小さいほど先に処理する。 */
  priority: (item: T) => number
  /** 待っている項目と処理中の項目が、どちらも無くなったときに呼ぶ。 */
  onIdle?: () => void
}

export class PriorityQueue<T> {
  private readonly options: QueueOptions<T>
  private readonly waiting: T[] = []
  private readonly controller = new AbortController()
  private running = 0

  constructor(options: QueueOptions<T>) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error(`同時実行数が不正です: ${options.concurrency}`)
    }
    this.options = options
  }

  get size(): number {
    return this.waiting.length + this.running
  }

  add(items: readonly T[]): void {
    if (this.controller.signal.aborted) return
    this.waiting.push(...items)
    this.dispatch()
  }

  /** 待っている項目を捨て、処理中の項目に取り消しを伝える。以後の add は無視する。 */
  cancel(): void {
    this.waiting.length = 0
    this.controller.abort()
  }

  private takeNext(): T | undefined {
    let bestIndex = -1
    let bestPriority = Infinity
    this.waiting.forEach((item, index) => {
      const priority = this.options.priority(item)
      if (priority < bestPriority) {
        bestPriority = priority
        bestIndex = index
      }
    })
    return bestIndex === -1 ? undefined : this.waiting.splice(bestIndex, 1)[0]
  }

  private dispatch(): void {
    while (this.running < this.options.concurrency) {
      const item = this.takeNext()
      if (item === undefined) break
      this.running += 1
      this.options
        .worker(item, this.controller.signal)
        .catch(() => undefined)
        .finally(() => {
          this.running -= 1
          this.dispatch()
          if (this.size === 0 && !this.controller.signal.aborted) this.options.onIdle?.()
        })
    }
  }
}

/**
 * 表示中のページを基準にした、ページの優先度。
 * 表示中のページ、その後ろのページ、表示中より前のページ(近い順)の順に小さい値を返す。
 */
export function pagePriority(pageNumber: number, focusPage: number): number {
  return pageNumber >= focusPage ? pageNumber - focusPage : 1_000_000 + (focusPage - pageNumber)
}
