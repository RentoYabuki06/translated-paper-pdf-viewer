/**
 * 開いている PDF 1 つ分の、解析・レイアウト検出・翻訳の状態をまとめて持つ。
 *
 * ページの解析と検出は、画面の描画とは切り離して行う。
 * 画面に出ていないページも、先に解析して翻訳を依頼できるようにするためである。
 * 画面の部品は、subscribe で変化を受け取り、getPage でページごとの状態を読む。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { analyzePage } from '../analysis/analyzePage.ts'
import type { PageAnalysis } from '../analysis/analyzePage.ts'
import { buildUnits } from '../analysis/units.ts'
import type { TranslationUnit } from '../analysis/units.ts'
import type { LayoutDetector } from '../layout/ortWebClient.ts'
import { INPUT_SIZE } from '../layout/protocol.ts'
import type { LayoutRegion } from '../layout/types.ts'
import { renderPage } from '../pdf/render.ts'
import type { BackendInfo, TranslateRequest, TranslatorBackend } from '../translate/backend.ts'
import { cacheKey } from '../translate/cache.ts'
import type { TranslationCache } from '../translate/cache.ts'
import { pagePriority, PriorityQueue } from '../translate/queue.ts'

/** 1 つの翻訳単位の訳文の長さの上限(トークン数)。 */
const MAX_TOKENS = 1024

export type UnitStatus = 'waiting' | 'running' | 'done' | 'failed'

export interface UnitState {
  status: UnitStatus
  /** 訳文。status が 'done' のときだけ意味を持つ。 */
  text: string
  /** 保存してあった訳文を使った場合に true。 */
  fromCache: boolean
  /** 長さの上限に達して、訳文が途中で切れている場合に true。 */
  truncated: boolean
  error?: string
}

export interface PageState {
  analysis: PageAnalysis | null
  /** レイアウト検出の結果。検出していない間は null。 */
  regions: LayoutRegion[] | null
  /** 翻訳単位。検出が終わるまでは null。 */
  units: TranslationUnit[] | null
  /** 翻訳単位の名前(id)ごとの、翻訳の状態。 */
  translations: Readonly<Record<string, UnitState>>
}

export interface SessionProgress {
  analyzedPages: number
  paragraphs: number
  lines: number
  mathRuns: number
  /** ページごとの、レイアウト検出にかかった時間(ミリ秒)。 */
  detectTimes: readonly number[]
  /** 翻訳を依頼している最中(待っている単位がある)なら true。 */
  translating: boolean
  /** 翻訳単位を組み立て終えたページの数。 */
  preparedPages: number
  units: number
  done: number
  /** done のうち、保存してあった訳文を使った数。 */
  cached: number
  failed: number
  truncated: number
  /** 今回の翻訳で、llama-server へ依頼した数。 */
  requests: number
}

const EMPTY_PAGE: PageState = { analysis: null, regions: null, units: null, translations: {} }

interface ActiveTranslation {
  backend: TranslatorBackend
  modelId: string
  cache: TranslationCache
  queue: PriorityQueue<TranslationUnit>
  requests: number
  /** すべてのページの翻訳単位を組み立て終えたら true。 */
  prepared: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requestFor(unit: TranslationUnit): TranslateRequest {
  return { source: unit.source, sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: MAX_TOKENS }
}

export class DocumentSession {
  readonly document: PDFDocumentProxy
  private readonly pages = new Map<number, PageState>()
  private readonly listeners = new Set<() => void>()
  private readonly analysisPromises = new Map<number, Promise<PageAnalysis>>()
  private layoutPromises = new Map<number, Promise<void>>()
  private detectTimes = new Map<number, number>()
  private detector: LayoutDetector | null = null
  private translation: ActiveTranslation | null = null
  private progress: SessionProgress | null = null
  private focusPage = 1
  private disposed = false

  constructor(document: PDFDocumentProxy) {
    this.document = document
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getPage(pageNumber: number): PageState {
    return this.pages.get(pageNumber) ?? EMPTY_PAGE
  }

  private update(pageNumber: number, patch: Partial<PageState>): void {
    if (this.disposed) return
    this.pages.set(pageNumber, { ...this.getPage(pageNumber), ...patch })
    this.emit()
  }

  private updateUnit(unit: TranslationUnit, state: UnitState | undefined): void {
    const translations = { ...this.getPage(unit.pageNumber).translations }
    if (state) translations[unit.id] = state
    else delete translations[unit.id]
    this.update(unit.pageNumber, { translations })
  }

  private emit(): void {
    this.progress = null
    for (const listener of this.listeners) listener()
  }

  /** 全体の進み具合。内容が変わるまで、同じオブジェクトを返す。 */
  getProgress = (): SessionProgress => {
    if (this.progress) return this.progress
    const progress = {
      analyzedPages: 0,
      paragraphs: 0,
      lines: 0,
      mathRuns: 0,
      detectTimes: [...this.detectTimes.values()],
      translating: this.translation !== null && (!this.translation.prepared || this.translation.queue.size > 0),
      preparedPages: 0,
      units: 0,
      done: 0,
      cached: 0,
      failed: 0,
      truncated: 0,
      requests: this.translation?.requests ?? 0,
    }
    for (const page of this.pages.values()) {
      if (page.analysis) {
        progress.analyzedPages += 1
        progress.paragraphs += page.analysis.paragraphs.length
        progress.lines += page.analysis.lines.length
        progress.mathRuns += page.analysis.runs.filter((run) => run.isMath).length
      }
      if (page.units) {
        progress.preparedPages += 1
        progress.units += page.units.length
      }
      for (const state of Object.values(page.translations)) {
        if (state.status === 'done') {
          progress.done += 1
          if (state.fromCache) progress.cached += 1
          if (state.truncated) progress.truncated += 1
        } else if (state.status === 'failed') {
          progress.failed += 1
        }
      }
    }
    this.progress = progress
    return progress
  }

  /** 表示中のページを伝える。翻訳の順番は、このページを基準に決まる。 */
  setFocusPage(pageNumber: number): void {
    this.focusPage = pageNumber
  }

  /** ページを解析する。同じページは 1 回だけ解析する。 */
  ensureAnalysis(pageNumber: number): Promise<PageAnalysis> {
    let promise = this.analysisPromises.get(pageNumber)
    if (!promise) {
      promise = this.document.getPage(pageNumber).then(async (page) => {
        const analysis = await analyzePage(page)
        this.update(pageNumber, { analysis })
        return analysis
      })
      this.analysisPromises.set(pageNumber, promise)
      // 失敗した場合は、次に呼ばれたときにやり直す。
      promise.catch(() => this.analysisPromises.delete(pageNumber))
    }
    return promise
  }

  /**
   * レイアウト検出器を設定する。null を渡すと、検出を無効にする。
   * 検出の結果と、それをもとにした翻訳単位・訳文の状態は、捨てる。
   */
  setDetector(detector: LayoutDetector | null): void {
    if (detector === this.detector) return
    this.stopTranslation()
    this.detector = detector
    this.layoutPromises = new Map()
    this.detectTimes = new Map()
    for (const [pageNumber, page] of this.pages) {
      this.pages.set(pageNumber, { ...page, regions: null, units: null, translations: {} })
    }
    this.emit()
  }

  get hasDetector(): boolean {
    return this.detector !== null
  }

  /**
   * ページの領域を検出し、翻訳単位を組み立てる。検出器が無い場合は何もしない。
   * 検出には、表示とは別に、検出用の大きさで描画した画像を使う。表示の倍率で結果が変わらないようにするためである。
   */
  ensureLayout(pageNumber: number): Promise<void> {
    const detector = this.detector
    if (!detector) return Promise.resolve()
    const promises = this.layoutPromises
    let promise = promises.get(pageNumber)
    if (!promise) {
      promise = (async () => {
        const [page, analysis] = await Promise.all([this.document.getPage(pageNumber), this.ensureAnalysis(pageNumber)])
        const viewport = page.getViewport({ scale: 1 })
        const canvas = globalThis.document.createElement('canvas')
        await renderPage(page, canvas, { scale: INPUT_SIZE / viewport.width, outputScale: 1 }).promise
        const result = await detector.detect(canvas, viewport.width, viewport.height)
        canvas.width = 0
        canvas.height = 0
        // 検出の途中で検出器が替わった場合は、結果を捨てる。
        if (this.detector !== detector) return
        this.detectTimes.set(pageNumber, result.milliseconds)
        this.update(pageNumber, {
          regions: result.regions,
          units: buildUnits(pageNumber, analysis.paragraphs, result.regions),
        })
      })()
      promises.set(pageNumber, promise)
      promise.catch(() => promises.delete(pageNumber))
    }
    return promise
  }

  /**
   * 文書全体の翻訳を始める。表示中のページから順に、翻訳単位を組み立てて依頼する。
   * 保存してある訳文がある翻訳単位は、依頼せずにそれを使う。
   */
  startTranslation(backend: TranslatorBackend, info: BackendInfo, cache: TranslationCache): void {
    if (!this.detector) throw new Error('翻訳の前に、レイアウト検出を有効にしてください')
    this.stopTranslation()

    const translation: ActiveTranslation = {
      backend,
      modelId: info.modelId,
      cache,
      requests: 0,
      prepared: false,
      queue: new PriorityQueue<TranslationUnit>({
        // 同時に依頼する数は、サーバーが同時に処理できる数に合わせる。
        concurrency: info.slots,
        priority: (unit) => pagePriority(unit.pageNumber, this.focusPage) * 1000 + unit.index,
        worker: (unit, signal) => this.translateUnit(translation, unit, signal),
        onIdle: () => this.emit(),
      }),
    }
    this.translation = translation
    this.emit()
    void this.prepareAll(translation)
  }

  /** 表示中のページに近い順に、すべてのページの翻訳単位を組み立てて、順番待ちに入れる。 */
  private async prepareAll(translation: ActiveTranslation): Promise<void> {
    const remaining = new Set(Array.from({ length: this.document.numPages }, (_, index) => index + 1))
    while (remaining.size > 0 && this.translation === translation) {
      let next = 0
      let nextPriority = Infinity
      for (const pageNumber of remaining) {
        const priority = pagePriority(pageNumber, this.focusPage)
        if (priority < nextPriority) {
          next = pageNumber
          nextPriority = priority
        }
      }
      remaining.delete(next)
      try {
        await this.ensureLayout(next)
        if (this.translation !== translation) return
        await this.enqueuePage(translation, next)
      } catch (error) {
        console.warn(`[session] ${next} ページ目の準備に失敗しました:`, error)
      }
    }
    if (this.translation === translation) {
      translation.prepared = true
      this.emit()
    }
  }

  private async enqueuePage(translation: ActiveTranslation, pageNumber: number): Promise<void> {
    const page = this.getPage(pageNumber)
    const fresh: TranslationUnit[] = []
    for (const unit of page.units ?? []) {
      const current = page.translations[unit.id]
      if (current?.status === 'done') continue
      const key = await cacheKey(translation.modelId, requestFor(unit))
      const saved = await translation.cache.get(key).catch(() => undefined)
      if (this.translation !== translation) return
      if (saved) {
        this.updateUnit(unit, { status: 'done', text: saved.text, fromCache: true, truncated: false })
      } else {
        this.updateUnit(unit, { status: 'waiting', text: '', fromCache: false, truncated: false })
        fresh.push(unit)
      }
    }
    translation.queue.add(fresh)
  }

  private async translateUnit(translation: ActiveTranslation, unit: TranslationUnit, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    this.updateUnit(unit, { status: 'running', text: '', fromCache: false, truncated: false })
    translation.requests += 1
    const request = requestFor(unit)
    try {
      const result = await translation.backend.translate(request, { signal })
      const truncated = result.stopReason === 'limit'
      this.updateUnit(unit, { status: 'done', text: result.text, fromCache: false, truncated })
      // 途中で切れた訳文は、保存しない。
      if (!truncated && result.text.length > 0) {
        const key = await cacheKey(translation.modelId, request)
        await translation.cache.set(key, { text: result.text, savedAt: Date.now() }).catch(() => undefined)
      }
    } catch (error) {
      if (signal.aborted) {
        // 中止した場合は、原文の表示に戻す。
        this.updateUnit(unit, undefined)
      } else {
        this.updateUnit(unit, { status: 'failed', text: '', fromCache: false, truncated: false, error: messageOf(error) })
      }
    }
  }

  /** 翻訳の依頼を止める。訳し終えた分は、そのまま残す。 */
  stopTranslation(): void {
    const translation = this.translation
    if (!translation) return
    this.translation = null
    translation.queue.cancel()
    // 待っていた翻訳単位を、原文の表示に戻す。
    for (const [pageNumber, page] of this.pages) {
      const kept = Object.fromEntries(
        Object.entries(page.translations).filter(([, state]) => state.status === 'done' || state.status === 'failed'),
      )
      this.pages.set(pageNumber, { ...page, translations: kept })
    }
    this.emit()
  }

  dispose(): void {
    this.stopTranslation()
    this.disposed = true
    this.listeners.clear()
  }
}
