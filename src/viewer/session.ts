/**
 * 開いている PDF 1 つ分の、解析・レイアウト検出・翻訳の状態をまとめて持つ。
 *
 * ページの解析と検出は、画面の描画とは切り離して行う。
 * 画面に出ていないページも、先に解析して翻訳を依頼できるようにするためである。
 * 画面の部品は、subscribe で変化を受け取り、getPage でページごとの状態を読む。
 *
 * 翻訳単位は、2 段階で作る。
 *   1. ページごとに、段落から翻訳単位を作る(units.ts)。
 *   2. 前後のページの翻訳単位がそろったら、段やページをまたいで続く段落をつなぐ(chains.ts)。
 * つないだ翻訳単位は、複数のページに断片を持つことがある。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { analyzePage } from '../analysis/analyzePage.ts'
import type { PageAnalysis } from '../analysis/analyzePage.ts'
import { linkPage } from '../analysis/chains.ts'
import { buildUnits } from '../analysis/units.ts'
import type { TranslationUnit } from '../analysis/units.ts'
import type { LayoutDetector } from '../layout/ortWebClient.ts'
import { INPUT_SIZE } from '../layout/protocol.ts'
import type { LayoutRegion } from '../layout/types.ts'
import { checkTags, normalizeTags, tagIds } from '../math/placeholders.ts'
import { createCanvasInkMeasurer } from '../pdf/glyphInk.ts'
import type { GlyphInkMeasurer } from '../pdf/glyphInk.ts'
import { renderPage } from '../pdf/render.ts'
import type { BackendInfo, TranslateRequest, TranslatorBackend } from '../translate/backend.ts'
import { cacheKey } from '../translate/cache.ts'
import type { CachedTranslation, TranslationCache } from '../translate/cache.ts'
import { buildContexts } from '../translate/context.ts'
import { createGlossaryMatcher } from '../translate/glossary.ts'
import type { GlossaryEntry } from '../translate/pfml3.ts'
import { pagePriority, PriorityQueue } from '../translate/queue.ts'
import { translateTaggedWithGlossary } from '../translate/tagged.ts'

/** 1 つの翻訳単位の訳文の長さの上限(トークン数)。 */
const MAX_TOKENS = 1024

/**
 * 数式を切り抜くもとになるページの画像の細かさ。1 ポイントあたりの画素数。
 * 表示の倍率 150%、画面の解像度 2 倍のときに、表示と同じ細かさになる値。
 */
const PAGE_IMAGE_SCALE = 3

/**
 * 翻訳単位の状態。
 * - waiting: 順番を待っている
 * - running: 翻訳している
 * - done: 訳文がある
 * - failed: 依頼が失敗した
 * - kept: 訳文の中の数式の目印がそろわなかったため、原文のまま残した
 */
export type UnitStatus = 'waiting' | 'running' | 'done' | 'failed' | 'kept'

export interface UnitState {
  status: UnitStatus
  /** 訳文。status が 'done' のときだけ意味を持つ。 */
  text: string
  /** 今回の翻訳で、依頼せずに、すでにある訳文(保存してあったもの、または前の翻訳で得たもの)を使った場合に true。 */
  fromCache: boolean
  /** 長さの上限に達して、訳文が途中で切れている場合に true。 */
  truncated: boolean
  /** 文ごとに訳し直した場合に true。 */
  retried?: boolean
  error?: string
  /** この翻訳単位の原文に出てくる語の、用語集の項目。無ければ、空の配列。 */
  glossary: readonly GlossaryEntry[]
  /**
   * 用語集を付けた依頼では、訳文の中の数式の目印がそろわず、用語集を付けずに訳し直した場合に true。
   * このとき、訳文には、用語集の訳語の指定は反映されていない。
   */
  glossaryDropped?: boolean
  /** 訳文を得た依頼の鍵(cache.ts)。status が 'done' のときだけ持つ。同じ依頼をやり直さないために使う。 */
  key?: string
}

/** ページに表示する、翻訳単位の断片 1 つ。 */
export interface PageFragment {
  unit: TranslationUnit
  /** unit.fragments の中での番号。 */
  index: number
}

export interface PageState {
  analysis: PageAnalysis | null
  /** レイアウト検出の結果。検出していない間は null。 */
  regions: LayoutRegion[] | null
  /** このページの段落から作った翻訳単位(段やページをまたぐ段落をつなぐ前)。検出が終わるまでは null。 */
  rawUnits: TranslationUnit[] | null
  /** このページに表示する断片。前のページから続く段落の断片を含む。 */
  fragments: readonly PageFragment[]
  /** fragments に含まれる翻訳単位の、名前(id)ごとの翻訳の状態。 */
  translations: Readonly<Record<string, UnitState>>
}

export interface SessionProgress {
  analyzedPages: number
  paragraphs: number
  lines: number
  /** 文中の数式の数。 */
  mathSpans: number
  /** ページごとの、レイアウト検出にかかった時間(ミリ秒)。 */
  detectTimes: readonly number[]
  /** 翻訳を依頼している最中(待っている単位がある)なら true。 */
  translating: boolean
  /** 翻訳単位を確定し終えたページの数。 */
  preparedPages: number
  units: number
  /** units のうち、段やページをまたぐ段落をつないだもの。 */
  merged: number
  done: number
  /** done のうち、保存してあった訳文を使った数。 */
  cached: number
  failed: number
  /** 数式の目印がそろわず、原文のまま残した数。 */
  kept: number
  /** done のうち、文ごとに訳し直して目印がそろった数。 */
  retried: number
  truncated: number
  /** 今回の翻訳で、翻訳サーバーへ依頼した数。 */
  requests: number
  /** 今回の翻訳で使った用語集の項目の数。 */
  glossaryTerms: number
  /** 原文に、用語集の語が出てくる翻訳単位の数。 */
  glossaryUnits: number
  /** glossaryUnits のうち、用語集を付けると数式の目印がそろわず、用語集を付けずに訳し直した数。 */
  glossaryDropped: number
}

const EMPTY_PAGE: PageState = { analysis: null, regions: null, rawUnits: null, fragments: [], translations: {} }

interface ActiveTranslation {
  backend: TranslatorBackend
  modelId: string
  cache: TranslationCache
  /** 原文に出てくる語の、用語集の項目を選ぶ関数(glossary.ts)。 */
  selectGlossary: (source: string) => GlossaryEntry[]
  queue: PriorityQueue<TranslationUnit>
  /** 翻訳単位を順番待ちに入れ終えたページ。 */
  enqueued: Set<number>
  /** すべてのページの翻訳単位を組み立て終えたら true。 */
  prepared: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 翻訳の依頼を作る。
 * context は、参考情報として渡す文脈(題名、節の見出し、直前の段落)。glossary は、この原文に出てくる語の、用語集の項目。
 */
function requestForSource(source: string, context: string | undefined, glossary: readonly GlossaryEntry[]): TranslateRequest {
  const request: TranslateRequest = { source, sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: MAX_TOKENS }
  if (context !== undefined) request.context = context
  if (glossary.length > 0) request.glossary = glossary
  return request
}

/**
 * ページを準備する順番。値が小さいほど先。
 * 翻訳単位を確定するには前後のページが要るので、表示中のページの次に、その前後のページを準備する。
 */
export function preparePriority(pageNumber: number, focusPage: number): number {
  const distance = pageNumber - focusPage
  if (distance === 0) return 0
  if (distance === 1) return 1
  if (distance === -1) return 2
  return distance > 0 ? distance + 1 : 1_000_000 - distance
}

export class DocumentSession {
  readonly document: PDFDocumentProxy
  private readonly pages = new Map<number, PageState>()
  private readonly listeners = new Set<() => void>()
  private readonly analysisPromises = new Map<number, Promise<PageAnalysis>>()
  private layoutPromises = new Map<number, Promise<void>>()
  private detectTimes = new Map<number, number>()
  /** ページごとの、確定した翻訳単位。そのページから始まる翻訳単位を持つ。 */
  private linked = new Map<number, TranslationUnit[]>()
  /** 翻訳単位の名前(id)ごとの、翻訳の状態。 */
  private unitStates = new Map<string, UnitState>()
  /** 翻訳単位の名前(id)ごとの、依頼に付ける文脈。 */
  private contexts = new Map<string, string>()
  /** 論文の題名。1 ページ目の準備が終わるまでは null。題名が見つからなければ空文字列。 */
  private title: string | null = null
  private detector: LayoutDetector | null = null
  private translation: ActiveTranslation | null = null
  private progress: SessionProgress | null = null
  private focusPage = 1
  /** 直近の翻訳で、翻訳サーバーへ依頼した数。翻訳を止めたあとも、表示のために残す。 */
  private requests = 0
  /** 直近の翻訳で使った用語集の項目の数。 */
  private glossaryTerms = 0
  private disposed = false
  /** 字形の実際の範囲を測る関数。数式の範囲を決めるときに使う。 */
  private readonly measureInk: GlyphInkMeasurer = createCanvasInkMeasurer()
  /** ページ番号ごとの、ページの画像の URL。数式を切り抜くもとになる。 */
  private images: ReadonlyMap<number, string> = new Map()
  private readonly imageRequests = new Set<number>()
  private imageQueue: Promise<void> = Promise.resolve()
  /** 原文の表示に切り替えている翻訳単位の名前。 */
  private originals: ReadonlySet<string> = new Set()

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

  /** 翻訳単位の状態を変える。その翻訳単位の断片があるすべてのページに反映する。 */
  private updateUnit(unit: TranslationUnit, state: UnitState | undefined): void {
    if (this.disposed) return
    if (state) this.unitStates.set(unit.id, state)
    else this.unitStates.delete(unit.id)
    for (const pageNumber of new Set(unit.fragments.map((fragment) => fragment.pageNumber))) {
      const translations = { ...this.getPage(pageNumber).translations }
      if (state) translations[unit.id] = state
      else delete translations[unit.id]
      this.pages.set(pageNumber, { ...this.getPage(pageNumber), translations })
    }
    this.emit()
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
      mathSpans: 0,
      detectTimes: [...this.detectTimes.values()],
      translating: this.translation !== null && (!this.translation.prepared || this.translation.queue.size > 0),
      preparedPages: this.linked.size,
      units: 0,
      merged: 0,
      done: 0,
      cached: 0,
      failed: 0,
      kept: 0,
      retried: 0,
      truncated: 0,
      requests: this.requests,
      glossaryTerms: this.glossaryTerms,
      glossaryUnits: 0,
      glossaryDropped: 0,
    }
    for (const page of this.pages.values()) {
      if (!page.analysis) continue
      progress.analyzedPages += 1
      progress.paragraphs += page.analysis.paragraphs.length
      progress.lines += page.analysis.lines.length
      progress.mathSpans += page.analysis.lines.reduce((sum, line) => sum + line.spans.length, 0)
    }
    for (const units of this.linked.values()) {
      progress.units += units.length
      progress.merged += units.filter((unit) => unit.fragments.length > 1).length
    }
    for (const state of this.unitStates.values()) {
      if (state.glossary.length > 0) progress.glossaryUnits += 1
      if (state.glossaryDropped) progress.glossaryDropped += 1
      if (state.status === 'done') {
        progress.done += 1
        if (state.fromCache) progress.cached += 1
        if (state.truncated) progress.truncated += 1
        if (state.retried) progress.retried += 1
      } else if (state.status === 'failed') {
        progress.failed += 1
      } else if (state.status === 'kept') {
        progress.kept += 1
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
        const analysis = await analyzePage(page, this.measureInk)
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
    this.linked = new Map()
    this.unitStates = new Map()
    this.contexts = new Map()
    this.title = null
    for (const [pageNumber, page] of this.pages) {
      this.pages.set(pageNumber, { ...page, regions: null, rawUnits: null, fragments: [], translations: {} })
    }
    this.emit()
  }

  /**
   * ページの領域を検出し、そのページの翻訳単位を組み立てる。検出器が無い場合は何もしない。
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
          rawUnits: buildUnits(pageNumber, analysis.paragraphs, result.regions, this.measureInk),
        })
      })()
      promises.set(pageNumber, promise)
      promise.catch(() => promises.delete(pageNumber))
    }
    return promise
  }

  /**
   * ページの翻訳単位を確定する。段やページをまたいで続く段落を、1 つの翻訳単位につなぐ。
   * 確定には、前後のページの翻訳単位が要る。そろっていなければ、何もせずに false を返す。
   */
  private tryLink(pageNumber: number): boolean {
    const lastPage = this.document.numPages
    if (pageNumber < 1 || pageNumber > lastPage) return false
    if (this.linked.has(pageNumber)) return true
    const raw = this.getPage(pageNumber).rawUnits
    const previous = pageNumber > 1 ? this.getPage(pageNumber - 1).rawUnits : null
    const next = pageNumber < lastPage ? this.getPage(pageNumber + 1).rawUnits : null
    if (!raw || (pageNumber > 1 && !previous) || (pageNumber < lastPage && !next)) return false

    const units = linkPage(previous, raw, next).units
    this.linked.set(pageNumber, units)
    for (const [id, context] of buildContexts({ title: this.title ?? '', previousPage: previous, page: raw, units })) {
      this.contexts.set(id, context)
    }
    // このページから始まる翻訳単位は、このページと次のページに断片を持つ。
    this.rebuildFragments(pageNumber)
    this.rebuildFragments(pageNumber + 1)
    return true
  }

  /** ページに表示する断片の一覧を作り直す。断片は、前のページとこのページから始まる翻訳単位が持つ。 */
  private rebuildFragments(pageNumber: number): void {
    if (pageNumber < 1 || pageNumber > this.document.numPages) return
    const fragments: PageFragment[] = []
    for (const owner of [pageNumber - 1, pageNumber]) {
      for (const unit of this.linked.get(owner) ?? []) {
        unit.fragments.forEach((fragment, index) => {
          if (fragment.pageNumber === pageNumber) fragments.push({ unit, index })
        })
      }
    }
    const translations: Record<string, UnitState> = {}
    for (const { unit } of fragments) {
      const state = this.unitStates.get(unit.id)
      if (state) translations[unit.id] = state
    }
    this.update(pageNumber, { fragments, translations })
  }

  /**
   * 文書全体の翻訳を始める。表示中のページから順に、翻訳単位を組み立てて依頼する。
   * 同じ依頼の訳文がすでにある翻訳単位(保存してあるもの、または前の翻訳で得たもの)は、依頼せずにそれを使う。
   * glossary は、用語集の項目。翻訳単位ごとに、原文に出てくる語の項目だけを依頼に付ける。
   * 依頼先や用語集を変えてから呼ぶと、依頼の内容が変わった翻訳単位だけを訳し直す。
   */
  startTranslation(
    backend: TranslatorBackend,
    info: BackendInfo,
    cache: TranslationCache,
    glossary: readonly GlossaryEntry[] = [],
  ): void {
    if (!this.detector) throw new Error('翻訳の前に、レイアウト検出を有効にしてください')
    this.stopTranslation()

    const translation: ActiveTranslation = {
      backend,
      modelId: info.modelId,
      cache,
      selectGlossary: createGlossaryMatcher(glossary),
      enqueued: new Set(),
      prepared: false,
      queue: new PriorityQueue<TranslationUnit>({
        // 同時に依頼する数は、サーバーが同時に処理できる数に合わせる。
        concurrency: info.slots,
        priority: (unit) => pagePriority(unit.pageNumber, this.focusPage) * 1000 + unit.order / 1e7,
        worker: (unit, signal) => this.translateUnit(translation, unit, signal),
        onIdle: () => this.emit(),
      }),
    }
    this.translation = translation
    this.requests = 0
    this.glossaryTerms = glossary.length
    this.emit()
    void this.prepareAll(translation)
  }

  /**
   * 表示中のページに近い順に、すべてのページの翻訳単位を組み立てる。
   * 前後のページがそろって翻訳単位が確定したページから、順番待ちに入れる。
   */
  private async prepareAll(translation: ActiveTranslation): Promise<void> {
    // 題名は、すべての依頼の文脈に入る。どのページから翻訳を始めても同じ文脈になるよう、最初に 1 ページ目を準備する。
    if (this.title === null) {
      await this.ensureLayout(1).catch(() => undefined)
      if (this.translation !== translation) return
      const first = this.getPage(1).rawUnits?.find((unit) => unit.kind === 'doc_title')
      this.title = first?.source ?? ''
    }
    const remaining = new Set(Array.from({ length: this.document.numPages }, (_, index) => index + 1))
    while (remaining.size > 0 && this.translation === translation) {
      let next = 0
      let nextPriority = Infinity
      for (const pageNumber of remaining) {
        const priority = preparePriority(pageNumber, this.focusPage)
        if (priority < nextPriority) {
          next = pageNumber
          nextPriority = priority
        }
      }
      remaining.delete(next)
      try {
        await this.ensureLayout(next)
      } catch (error) {
        console.warn(`[session] ${next} ページ目の準備に失敗しました:`, error)
        // 翻訳単位が無いページとして扱い、前後のページの確定を止めない。
        if (this.translation === translation) this.update(next, { rawUnits: [] })
      }
      if (this.translation !== translation) return
      for (const pageNumber of [next - 1, next, next + 1]) {
        if (!this.tryLink(pageNumber) || translation.enqueued.has(pageNumber)) continue
        translation.enqueued.add(pageNumber)
        await this.enqueuePage(translation, pageNumber)
        if (this.translation !== translation) return
      }
    }
    if (this.translation === translation) {
      translation.prepared = true
      this.emit()
    }
  }

  private async enqueuePage(translation: ActiveTranslation, pageNumber: number): Promise<void> {
    const fresh: TranslationUnit[] = []
    for (const unit of this.linked.get(pageNumber) ?? []) {
      const request = this.requestFor(translation, unit)
      const glossary = request.glossary ?? []
      const key = await cacheKey(translation.modelId, request)
      if (this.translation !== translation) return
      // 前の翻訳で、同じ依頼の訳文を得ている場合は、そのまま使う。
      // 依頼先や用語集を変えた場合は、鍵が変わるので、ここには当てはまらない。
      const current = this.unitStates.get(unit.id)
      if (current?.status === 'done' && current.key === key) {
        if (!current.fromCache) this.updateUnit(unit, { ...current, fromCache: true })
        continue
      }
      const saved = await translation.cache.get(key).catch(() => undefined)
      if (this.translation !== translation) return
      if (saved) {
        this.updateUnit(unit, {
          status: 'done',
          text: saved.text,
          fromCache: true,
          truncated: false,
          glossary,
          glossaryDropped: saved.withoutGlossary === true,
          key,
        })
      } else {
        this.updateUnit(unit, { status: 'waiting', text: '', fromCache: false, truncated: false, glossary })
        fresh.push(unit)
      }
    }
    translation.queue.add(fresh)
  }

  /** 翻訳単位の全体を訳す依頼を作る。 */
  private requestFor(translation: ActiveTranslation, unit: TranslationUnit): TranslateRequest {
    return requestForSource(unit.source, this.contexts.get(unit.id), translation.selectGlossary(unit.source))
  }

  /**
   * 1 件の依頼を行い、目印の表記ゆれを直した訳文を返す。保存してある訳文があれば、依頼せずにそれを使う。
   * withGlossary が false の場合は、用語集を付けない。
   */
  private async requestTranslation(
    translation: ActiveTranslation,
    source: string,
    context: string | undefined,
    signal: AbortSignal,
    withGlossary: boolean,
  ): Promise<{ text: string; truncated: boolean }> {
    // 文ごとに訳し直す場合は、その文に出てくる語の項目だけを付ける。
    const request = requestForSource(source, context, withGlossary ? translation.selectGlossary(source) : [])
    const key = await cacheKey(translation.modelId, request)
    const saved = await translation.cache.get(key).catch(() => undefined)
    if (saved) return { text: saved.text, truncated: false }

    this.requests += 1
    this.emit()
    const result = await translation.backend.translate(request, { signal })
    const text = normalizeTags(result.text)
    const truncated = result.stopReason === 'limit'
    // 保存するのは、途中で切れておらず、目印がそろっている訳文だけ。
    if (!truncated && text.length > 0 && checkTags(text, tagIds(source)).ok) {
      await translation.cache.set(key, { text, savedAt: Date.now() }).catch(() => undefined)
    }
    return { text, truncated }
  }

  private async translateUnit(translation: ActiveTranslation, unit: TranslationUnit, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    const request = this.requestFor(translation, unit)
    const glossary = request.glossary ?? []
    this.updateUnit(unit, { status: 'running', text: '', fromCache: false, truncated: false, glossary })
    try {
      // 訳文の中の数式の目印がそろわない場合は、文ごとに訳し直す。文ごとの依頼にも、同じ文脈を付ける。
      // 用語集を付けた依頼でそろわない場合は、用語集を付けずに、もう一度訳す(tagged.ts)。
      const context = this.contexts.get(unit.id)
      const result = await translateTaggedWithGlossary(unit.source, glossary.length > 0, (source, withGlossary) =>
        this.requestTranslation(translation, source, context, signal, withGlossary),
      )
      if (result.status === 'kept') {
        this.updateUnit(unit, { status: 'kept', text: '', fromCache: false, truncated: false, glossary })
        return
      }
      const key = await cacheKey(translation.modelId, request)
      this.updateUnit(unit, {
        status: 'done',
        text: result.text,
        fromCache: false,
        truncated: result.truncated,
        retried: result.retried,
        glossary,
        glossaryDropped: result.glossaryDropped,
        key,
      })
      if ((result.retried || result.glossaryDropped) && !result.truncated) {
        // 段落全体の依頼の結果として保存する。次に開いたときは、訳し直しをせずに使える。
        // 文ごとの訳文をつないだ場合と、用語集を付けずに訳し直した場合は、依頼そのものの結果とは違うので、ここで保存する。
        const saved: CachedTranslation = { text: result.text, savedAt: Date.now() }
        if (result.glossaryDropped) saved.withoutGlossary = true
        await translation.cache.set(key, saved).catch(() => undefined)
      }
    } catch (error) {
      if (signal.aborted) {
        // 中止した場合は、原文の表示に戻す。
        this.updateUnit(unit, undefined)
      } else {
        this.updateUnit(unit, { status: 'failed', text: '', fromCache: false, truncated: false, error: messageOf(error), glossary })
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
    for (const units of this.linked.values()) {
      for (const unit of units) {
        const status = this.unitStates.get(unit.id)?.status
        if (status === 'waiting' || status === 'running') this.updateUnit(unit, undefined)
      }
    }
    this.emit()
  }

  /** ページ番号ごとの、ページの画像の URL。内容が変わるまで、同じオブジェクトを返す。 */
  getImages = (): ReadonlyMap<number, string> => this.images

  /**
   * ページの画像を用意する。訳文の中に置く数式を、この画像から切り抜く。
   * 段やページをまたぐ段落では、数式が、もとのページとは別のページに表示されることがある。
   * そのため、画像は、ページの表示とは別に、ここで作って持つ。画像は 1 ページずつ順に作る。
   */
  ensurePageImage(pageNumber: number): void {
    if (this.images.has(pageNumber) || this.imageRequests.has(pageNumber)) return
    this.imageRequests.add(pageNumber)
    this.imageQueue = this.imageQueue
      .then(async () => {
        if (this.disposed) return
        const page = await this.document.getPage(pageNumber)
        const canvas = globalThis.document.createElement('canvas')
        await renderPage(page, canvas, { scale: PAGE_IMAGE_SCALE, outputScale: 1 }).promise
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        canvas.width = 0
        canvas.height = 0
        if (!blob || this.disposed) return
        this.images = new Map(this.images).set(pageNumber, URL.createObjectURL(blob))
        this.emit()
      })
      .catch((error: unknown) => {
        console.warn(`[session] ${pageNumber} ページ目の画像を作れませんでした:`, error)
      })
      .finally(() => this.imageRequests.delete(pageNumber))
  }

  /** 原文の表示に切り替えている翻訳単位の名前。内容が変わるまで、同じオブジェクトを返す。 */
  getOriginals = (): ReadonlySet<string> => this.originals

  /** 翻訳単位の表示を、訳文と原文の間で切り替える。断片が複数のページにある場合も、まとめて切り替わる。 */
  toggleOriginal = (unitId: string): void => {
    const next = new Set(this.originals)
    if (!next.delete(unitId)) next.add(unitId)
    this.originals = next
    this.emit()
  }

  dispose(): void {
    this.stopTranslation()
    this.disposed = true
    this.listeners.clear()
    for (const url of this.images.values()) URL.revokeObjectURL(url)
  }
}
