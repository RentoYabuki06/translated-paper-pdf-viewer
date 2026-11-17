/**
 * PDF を開いて表示する画面。
 * 開き方は 3 通り: ファイルの選択、ドラッグ&ドロップ、arXiv の ID または URL の入力。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { DragEvent, FormEvent, ReactNode } from 'react'
import { LayoutDetector, MODEL_BYTES } from '../layout/ortWebClient.ts'
import type { LayoutBackend } from '../layout/types.ts'
import { buildImagePdf } from '../lib/imagePdf.ts'
import type { PdfImagePage } from '../lib/imagePdf.ts'
import { median } from '../lib/stats.ts'
import { arxivPdfUrl, parseArxivId } from '../pdf/arxiv.ts'
import { loadPdf } from '../pdf/pdfjs.ts'
import { openTranslationCache } from '../translate/cache.ts'
import { candidateModelIds, loadKnownModels, rememberModel } from '../translate/models.ts'
import { ComparePanel } from './ComparePanel.tsx'
import { useGlossary } from './glossaryContext.ts'
import { clearPainterCache, paintRow } from './pagePainter.ts'
import { PageView } from './PageView.tsx'
import type { PageSize } from './PageView.tsx'
import { DocumentSession } from './session.ts'
import type { ComparisonRow, SessionProgress } from './session.ts'
import { useTranslator } from './translatorContext.ts'
import type { XRayOptions } from './XRayLayer.tsx'

const SCALES = [1, 1.25, 1.5, 2]

const XRAY_LABELS: { key: keyof XRayOptions; label: string }[] = [
  { key: 'paragraphs', label: '段落' },
  { key: 'lines', label: '行' },
  { key: 'runs', label: '文字のまとまり' },
  { key: 'math', label: '文中の数式' },
  { key: 'regions', label: '検出した領域' },
]

interface Opened {
  name: string
  document: PDFDocumentProxy
  session: DocumentSession
  firstPageSize: PageSize
}

type DetectorState =
  | { state: 'off' }
  | { state: 'loading'; loaded: number; total: number }
  | { state: 'ready'; detector: LayoutDetector }
  | { state: 'error'; message: string }

const NO_PROGRESS: SessionProgress = {
  analyzedPages: 0,
  paragraphs: 0,
  lines: 0,
  mathSpans: 0,
  detectTimes: [],
  translating: false,
  stopped: false,
  preparedPages: 0,
  units: 0,
  merged: 0,
  done: 0,
  cached: 0,
  failed: 0,
  kept: 0,
  retried: 0,
  truncated: 0,
  requests: 0,
  glossaryTerms: 0,
  glossaryUnits: 0,
  glossaryDropped: 0,
}

/** 確認用の枠を、どれも表示しない指定。原文を並べるときの、左のページに使う。 */
const NO_XRAY: XRayOptions = { paragraphs: false, lines: false, runs: false, math: false, regions: false }

/**
 * URL に ?debug が付いている場合に true。
 * 解析結果の確認用の枠と、レイアウト検出の操作を、画面に出す。ふだんは出さない。
 */
const DEBUG = new URLSearchParams(globalThis.location?.search ?? '').has('debug')

/** 確認用の枠の、初めの状態。 */
const DEBUG_XRAY: XRayOptions = { paragraphs: true, lines: false, runs: false, math: true, regions: false }

/** 翻訳の進み具合を、短い文と、くわしい文にする。くわしい文は、マウスを重ねたときに表示する。 */
function describeProgress(progress: SessionProgress, pages: number): { short: string; detail: string } {
  const state = progress.translating ? '翻訳しています' : progress.stopped ? '翻訳を中止しました' : '翻訳が終わりました'
  const short =
    `${state}: ${progress.done + progress.kept} / ${progress.units} 段落` +
    (progress.failed > 0 ? `、失敗 ${progress.failed} 件` : '') +
    (progress.kept > 0 ? `、原文のまま ${progress.kept} 件` : '')
  const detail =
    `${progress.preparedPages} / ${pages} ページを準備済み、段やページをまたいでつないだ段落 ${progress.merged} 件、依頼 ${progress.requests} 件、保存分の再利用 ${progress.cached} 件、失敗 ${progress.failed} 件、途中で切れた訳文 ${progress.truncated} 件、文ごとに訳し直した段落 ${progress.retried} 件、数式の目印がそろわず原文のまま ${progress.kept} 件` +
    (progress.glossaryTerms > 0 ? `、用語集の語が出てくる段落 ${progress.glossaryUnits} 件` : '') +
    (progress.glossaryDropped > 0 ? `、うち用語集を付けずに訳し直した段落 ${progress.glossaryDropped} 件` : '')
  return { short, detail }
}

/** PDF に入れるページの画像の、JPEG の品質(0 から 1)。 */
const JPEG_QUALITY = 0.9

/** 保存する PDF のファイルの名前。もとの名前に、訳文だけなら _ja、原文と並べた形なら _en-ja を足す。 */
function savedFileName(name: string, sideBySide: boolean): string {
  const base = name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')
  return `${base}${sideBySide ? '_en-ja' : '_ja'}.pdf`
}

/** プリンターの形のアイコン。 */
function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 9V3h10v6" />
      <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="7" y="14" width="10" height="7" />
    </svg>
  )
}

const noSubscription = () => () => undefined
const noProgress = () => NO_PROGRESS

type Status = { state: 'idle' } | { state: 'loading'; message: string } | { state: 'error'; message: string }

/** モデルごとの訳文を比べる画面の状態。 */
type CompareState =
  | { state: 'closed' }
  | { state: 'loading' }
  | { state: 'ready'; modelIds: string[]; rows: ComparisonRow[] }
  | { state: 'error'; message: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface Props {
  /** 用語集の画面を開く。 */
  onOpenGlossary: () => void
}

export function PdfViewer({ onOpenGlossary }: Props) {
  const translator = useTranslator()
  const glossary = useGlossary()
  /** いまの用語集の内容を表す文字列。翻訳を始めたときの用語集と比べるために使う。 */
  const glossarySignature = useMemo(() => JSON.stringify(glossary.entries), [glossary.entries])
  /** 開いている PDF の翻訳を最後に始めたときの、用語集の内容。まだ翻訳していなければ null。 */
  const [translatedGlossary, setTranslatedGlossary] = useState<string | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [arxivInput, setArxivInput] = useState('')
  const [scale, setScale] = useState(1.5)
  const [showWithoutText, setShowWithoutText] = useState(false)
  const [xray, setXray] = useState<XRayOptions>(DEBUG ? DEBUG_XRAY : NO_XRAY)
  const [dragging, setDragging] = useState(false)
  const [backend, setBackend] = useState<LayoutBackend>('webgpu')
  const [detectorState, setDetectorState] = useState<DetectorState>({ state: 'off' })
  const [showTranslations, setShowTranslations] = useState(true)
  /** true のとき、原文のページを左、訳文を重ねたページを右に、並べて表示する。 */
  const [sideBySide, setSideBySide] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  /** 翻訳を始める準備(接続の確認やモデルの読み込み)をしている間は true。 */
  const [startingTranslation, setStartingTranslation] = useState(false)
  const [compare, setCompare] = useState<CompareState>({ state: 'closed' })
  /** PDF を作っている間の、進み具合の表示。失敗した場合は、その知らせ。作っていなければ null。 */
  const [saving, setSaving] = useState<string | null>(null)
  /** PDF を作っている最中かどうか。 */
  const savingNow = saving !== null && !saving.includes('保存できませんでした')
  const pagesRef = useRef<HTMLDivElement>(null)
  const detectorRef = useRef<LayoutDetector | null>(null)
  /** 開く操作の通し番号。あとから始めた操作だけを画面に反映するために使う。 */
  const openSequence = useRef(0)
  const openedRef = useRef<Opened | null>(null)
  /** 翻訳を自動で始めた PDF。同じ PDF で、2 度始めないために使う。 */
  const autoStarted = useRef<DocumentSession | null>(null)

  // 画面を閉じるときに、開いている PDF を解放する。
  useEffect(
    () => () => {
      openedRef.current?.session.dispose()
      void openedRef.current?.document.loadingTask.destroy()
    },
    [],
  )
  useEffect(() => () => detectorRef.current?.dispose(), [])

  /** レイアウト検出を有効にする。初回は、モデルのファイルを取得する。失敗した場合は null を返す。 */
  async function enableDetector(): Promise<LayoutDetector | null> {
    openedRef.current?.session.setDetector(null)
    detectorRef.current?.dispose()
    detectorRef.current = null
    setDetectorState({ state: 'loading', loaded: 0, total: MODEL_BYTES })
    try {
      const detector = await LayoutDetector.create(backend, (loaded, total) =>
        setDetectorState({ state: 'loading', loaded, total }),
      )
      detectorRef.current = detector
      openedRef.current?.session.setDetector(detector)
      setDetectorState({ state: 'ready', detector })
      return detector
    } catch (error) {
      setDetectorState({ state: 'error', message: messageOf(error) })
      return null
    }
  }

  function disableDetector(): void {
    openedRef.current?.session.setDetector(null)
    detectorRef.current?.dispose()
    detectorRef.current = null
    setDetectorState({ state: 'off' })
    // 翻訳単位を捨てるので、訳文を比べる画面も閉じる。
    setCompare({ state: 'closed' })
  }

  /**
   * 開いている PDF について、モデルごとに保存してある訳文を集めて、比べる画面を開く。翻訳の依頼はしない。
   * 段落を決めるためにレイアウト検出が要るので、有効になっていなければ先に有効にする。
   */
  async function openComparison(): Promise<void> {
    const session = openedRef.current?.session
    if (!session) return
    setCompare({ state: 'loading' })
    try {
      const detector = detectorRef.current ?? (await enableDetector())
      if (!detector) {
        setCompare({ state: 'closed' })
        return
      }
      const cache = await openTranslationCache()
      // 保存してある訳文を探すモデルの名前。いま接続しているモデルと、Ollama の設定の名前も、候補に足す。
      const connected = translator.connection.state === 'ok' ? [translator.connection.info.modelId] : []
      const ollama = translator.settings.ollamaModel ? [translator.settings.ollamaModel] : []
      const candidates = candidateModelIds([...loadKnownModels(), ...connected, ...ollama])
      const rows = await session.collectSavedTranslations(candidates, cache, glossary.entries)
      // 集めている間に、別の PDF を開いた場合や、レイアウト検出を切り替えた場合は、開かない。
      if (openedRef.current?.session !== session || !rows) {
        setCompare({ state: 'closed' })
        return
      }
      // 訳文が 1 件も無いモデルは、列にしない。
      const found = candidates.map((id, index) => ({ id, index })).filter(({ index }) => rows.some((row) => row.translations[index] != null))
      setCompare({
        state: 'ready',
        modelIds: found.map(({ id }) => id),
        rows: rows.map((row) => ({ unit: row.unit, translations: found.map(({ index }) => row.translations[index] ?? null) })),
      })
    } catch (error) {
      setCompare({ state: 'error', message: messageOf(error) })
    }
  }

  /**
   * 開いている PDF の翻訳を始める。
   * 訳す段落を決めるためにレイアウト検出が要るので、有効になっていなければ先に有効にする。
   */
  async function startTranslation(): Promise<void> {
    const session = openedRef.current?.session
    if (!session) return
    // ボタンを押した時点の用語集を使う。準備の間に用語集を編集しても、今回の翻訳には反映しない。
    const entries = glossary.entries
    const signature = glossarySignature
    setTranslationError(null)
    setStartingTranslation(true)
    try {
      // 翻訳サーバーに接続できることを、先に確かめる。設定は「翻訳サーバー」の画面のものを使う。
      const connected = await translator.check()
      if (!connected.ok) {
        setTranslationError(`翻訳サーバーに接続できません。「翻訳サーバー」の画面で、設定を確かめてください。(${connected.message})`)
        return
      }
      const detector = detectorRef.current ?? (await enableDetector())
      if (!detector) return
      const cache = await openTranslationCache()
      // 準備の間に、別の PDF を開いた場合は始めない。
      if (openedRef.current?.session !== session) return
      // 訳文を読みやすくするため、確認用の枠を消す。
      setXray(NO_XRAY)
      setShowTranslations(true)
      // 訳文を比べる画面で、このモデルの訳文を探せるよう、名前を覚えておく。
      rememberModel(connected.info.modelId)
      session.startTranslation(connected.backend, connected.info, cache, entries)
      setTranslatedGlossary(signature)
    } catch (error) {
      setTranslationError(messageOf(error))
    } finally {
      setStartingTranslation(false)
    }
  }

  /**
   * いま表示している形(訳文だけ、または原文と訳文を並べた形)を、PDF のファイルにして保存する。
   * ページを 1 枚ずつ画像に描き写し、その画像を並べた PDF を作る。ブラウザの印刷の画面は使わない。
   * ページは、表示範囲の近くだけを描画しているので、先に、すべてのページを描画する。
   */
  async function savePdf(): Promise<void> {
    const container = pagesRef.current
    const current = openedRef.current
    if (!container || !current) return
    setSaving('PDF を作る準備をしています…')
    try {
      const started = Date.now()
      for (;;) {
        const pages = [...container.querySelectorAll<HTMLElement>('.page')]
        const ready = pages.filter((page) => page.dataset.rendered === 'true' && page.dataset.cover !== 'pending').length
        // 訳文の中の数式は、もとのページの画像ができてから表示される。
        const waiting = [...container.querySelectorAll<HTMLElement>('.math-sprite')].filter((sprite) => !sprite.style.backgroundImage).length
        if (pages.length > 0 && ready === pages.length && waiting === 0) break
        if (Date.now() - started > 180_000) throw new Error('ページの描画が、3 分待っても終わりませんでした')
        setSaving(`PDF を作る準備をしています… ${ready} / ${pages.length} ページ分を描画しました`)
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      const rows = [...container.querySelectorAll<HTMLElement>('.page-row')]
      const pdfPages: PdfImagePage[] = []
      for (const [index, row] of rows.entries()) {
        setSaving(`PDF を作っています… ${index + 1} / ${rows.length} ページ`)
        const painted = await paintRow(row)
        if (!painted) continue
        const blob = await new Promise<Blob | null>((resolve) => painted.canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
        if (!blob) throw new Error(`${index + 1} ページ目を、画像にできませんでした`)
        pdfPages.push({
          jpeg: new Uint8Array(await blob.arrayBuffer()),
          pixelWidth: painted.canvas.width,
          pixelHeight: painted.canvas.height,
          // 画面の上の大きさを倍率で割ると、もとの PDF のページの大きさ(ポイント)になる。
          width: painted.cssWidth / scale,
          height: painted.cssHeight / scale,
        })
        // 画像のメモリを、すぐに手放す。
        painted.canvas.width = 0
        painted.canvas.height = 0
      }
      if (pdfPages.length === 0) throw new Error('保存できるページがありません')
      const url = URL.createObjectURL(new Blob([buildImagePdf(pdfPages) as BlobPart], { type: 'application/pdf' }))
      const link = globalThis.document.createElement('a')
      link.href = url
      link.download = savedFileName(current.name, sideBySide)
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setSaving(null)
    } catch (error) {
      setSaving(`PDF を保存できませんでした: ${messageOf(error)}`)
    } finally {
      clearPainterCache()
    }
  }

  const openData = useCallback(async (name: string, getData: () => Promise<ArrayBuffer>, loadingMessage: string) => {
    const sequence = ++openSequence.current
    setStatus({ state: 'loading', message: loadingMessage })
    try {
      const data = await getData()
      const document = await loadPdf(data).promise
      const firstPage = await document.getPage(1)
      const viewport = firstPage.getViewport({ scale: 1 })
      if (sequence !== openSequence.current) {
        void document.loadingTask.destroy()
        return
      }
      openedRef.current?.session.dispose()
      void openedRef.current?.document.loadingTask.destroy()
      const session = new DocumentSession(document)
      session.setDetector(detectorRef.current)
      const next = { name, document, session, firstPageSize: { width: viewport.width, height: viewport.height } }
      openedRef.current = next
      setTranslationError(null)
      setTranslatedGlossary(null)
      setCompare({ state: 'closed' })
      setOpened(next)
      setStatus({ state: 'idle' })
    } catch (error) {
      if (sequence === openSequence.current) {
        setStatus({ state: 'error', message: `PDF を開けませんでした: ${messageOf(error)}` })
      }
    }
  }, [])

  const openFile = useCallback(
    (file: File) => openData(file.name, () => file.arrayBuffer(), `${file.name} を読み込んでいます…`),
    [openData],
  )

  const openArxiv = useCallback(
    (input: string) => {
      const id = parseArxivId(input)
      if (!id) {
        setStatus({ state: 'error', message: 'arXiv の ID または URL として読めません(例: 1706.03762)。' })
        return
      }
      const url = arxivPdfUrl(id)
      void openData(
        `arXiv:${id}`,
        async () => {
          const response = await fetch(url)
          if (!response.ok) throw new Error(`arXiv が HTTP ${response.status} を返しました`)
          return response.arrayBuffer()
        },
        `${url} を取得しています…`,
      )
    },
    [openData],
  )

  // URL に ?arxiv=<ID> が付いている場合は、その論文を開く。
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('arxiv')
    if (id) {
      setArxivInput(id)
      openArxiv(id)
    }
  }, [openArxiv])

  function onSubmitArxiv(event: FormEvent): void {
    event.preventDefault()
    openArxiv(arxivInput)
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void openFile(file)
  }

  const progress = useSyncExternalStore(
    opened ? opened.session.subscribe : noSubscription,
    opened ? opened.session.getProgress : noProgress,
  )
  const times = progress.detectTimes
  const detector = detectorState.state === 'ready' ? detectorState.detector : null
  const hasTranslations = progress.done > 0 || progress.failed > 0 || progress.kept > 0
  /** 翻訳を始めたあとで、用語集が変わっている場合に true。 */
  const glossaryChanged =
    translatedGlossary !== null && translatedGlossary !== glossarySignature && !progress.translating && !startingTranslation

  /** 翻訳を始め直すボタンを出すかどうか。中止したとき、始められなかったとき、用語集が変わったときに出す。 */
  const needsRestart =
    !startingTranslation && (progress.stopped || translationError !== null || detectorState.state === 'error' || glossaryChanged)

  // PDF を開いたら、翻訳を自動で始める。解析結果を確かめる画面(?debug)では、始めない。
  useEffect(() => {
    if (!opened || DEBUG || autoStarted.current === opened.session) return
    autoStarted.current = opened.session
    void startTranslation()
    // 開いた PDF が替わったときだけ動かす。
  }, [opened])

  const summary = opened && (progress.translating || hasTranslations) ? describeProgress(progress, opened.document.numPages) : null
  /** 操作の帯の下に出す、状態の表示。出すものが無ければ、行そのものを出さない。 */
  const statusNodes: ReactNode[] = []
  if (detectorState.state === 'loading') {
    statusNodes.push(
      <span key="detector">
        {detectorState.loaded > 0
          ? `レイアウト検出のモデルを取得しています… ${Math.round((detectorState.loaded / detectorState.total) * 100)}% `
          : 'レイアウト検出のモデルを読み込んでいます… '}
      </span>,
    )
  }
  if (detectorState.state === 'error') {
    statusNodes.push(
      <span key="detector-error" className="error">
        レイアウト検出を始められませんでした: {detectorState.message}{' '}
      </span>,
    )
  }
  if (DEBUG && detectorState.state === 'ready') {
    statusNodes.push(
      <span key="detector-ready">
        {`${detectorState.detector.info.backend === 'webgpu' ? 'WebGPU' : `WebAssembly(${detectorState.detector.info.threads} スレッド)`}で検出します。` +
          (times.length > 0
            ? `検出済み ${times.length} ページ: 中央値 ${Math.round(median(times))} ミリ秒、最大 ${Math.round(Math.max(...times))} ミリ秒 `
            : ' ')}
      </span>,
    )
  }
  if (translationError) {
    statusNodes.push(
      <span key="error" className="error">
        {translationError}{' '}
      </span>,
    )
  } else if (startingTranslation) {
    statusNodes.push(<span key="starting">翻訳の準備をしています… </span>)
  }
  if (summary) {
    statusNodes.push(
      <span key="summary" title={summary.detail}>
        {summary.short}
      </span>,
    )
  }
  if (saving) {
    statusNodes.push(
      <span key="saving" className="notice">
        {' '}
        {saving}
      </span>,
    )
  }
  if (glossaryChanged) {
    statusNodes.push(
      <span key="glossary" className="notice">
        {' '}
        用語集が変わりました。「{DEBUG ? 'この PDF を翻訳する' : '訳し直す'}」を押すと、訳語の指定が変わる段落だけを訳し直します。
      </span>,
    )
  }

  return (
    <div
      className={dragging ? 'pdf-viewer dragging' : 'pdf-viewer'}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <section className="panel">
        <form className="row open-row" onSubmit={onSubmitArxiv}>
          <label className="file-button" title="この画面へ PDF をドラッグ&ドロップしても開けます">
            PDF のファイルを選ぶ
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void openFile(file)
                event.target.value = ''
              }}
            />
          </label>
          <input
            type="text"
            value={arxivInput}
            onChange={(event) => setArxivInput(event.target.value)}
            placeholder="arXiv の ID または URL"
            aria-label="arXiv の ID または URL"
            spellCheck={false}
          />
          <button type="submit" disabled={arxivInput.trim().length === 0}>
            arXiv から開く
          </button>
        </form>
        {(status.state !== 'idle' || !opened) && (
          <p className="status" role="status">
            {status.state === 'loading' && status.message}
            {status.state === 'error' && <span className="error">{status.message}</span>}
            {status.state === 'idle' && 'PDF は、この画面へドラッグ&ドロップしても開けます。'}
          </p>
        )}
      </section>

      {opened && (
        <>
          <section className="panel toolbar">
            {progress.translating ? (
              <button type="button" onClick={() => opened.session.stopTranslation()}>
                中止
              </button>
            ) : (
              // 翻訳は、PDF を開いたときに自動で始まる。ボタンは、やり直す理由があるときだけ出す。
              (DEBUG || needsRestart) && (
                <button type="button" className="primary" onClick={() => void startTranslation()} disabled={startingTranslation}>
                  {DEBUG ? 'この PDF を翻訳する' : glossaryChanged ? '訳し直す' : '翻訳を再開'}
                </button>
              )
            )}
            {hasTranslations && (
              <label>
                <input type="checkbox" checked={showTranslations} onChange={(event) => setShowTranslations(event.target.checked)} />
                訳文を表示
              </label>
            )}
            <label className="switch">
              <input type="checkbox" role="switch" checked={sideBySide} onChange={(event) => setSideBySide(event.target.checked)} />
              原文を左に並べる
            </label>
            <label>
              倍率{' '}
              <select value={scale} onChange={(event) => setScale(Number(event.target.value))}>
                {SCALES.map((value) => (
                  <option key={value} value={value}>
                    {Math.round(value * 100)}%
                  </option>
                ))}
              </select>
            </label>
            <span className="toolbar-end">
              <button type="button" onClick={onOpenGlossary}>
                用語集({glossary.entries.length} 語)
              </button>
              <button type="button" onClick={() => void openComparison()} disabled={compare.state === 'loading'}>
                モデルごとの訳文を比べる
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void savePdf()}
                disabled={savingNow || compare.state === 'ready'}
                aria-label="PDF として保存"
                title="いま表示している形(訳文だけ、または原文と訳文を並べた形)を、PDF のファイルにして保存します"
              >
                <PrinterIcon />
              </button>
            </span>
            {/* 解析結果の確認用の操作。URL に ?debug を付けたときだけ出す。 */}
            {DEBUG && (
              <div className="toolbar-debug">
                <span className="status">
                  {opened.name}、{opened.document.numPages} ページ
                </span>
              <span className="toolbar-group">
                解析結果の表示:
                {XRAY_LABELS.map(({ key, label }) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={xray[key]}
                      onChange={(event) => setXray((current) => ({ ...current, [key]: event.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={showWithoutText}
                  onChange={(event) => setShowWithoutText(event.target.checked)}
                />
                文字を描かない描画を見る
              </label>
              <span className="status">
                解析済み {progress.analyzedPages} ページ: 段落 {progress.paragraphs}、行 {progress.lines}、文中の数式{' '}
                {progress.mathSpans}
              </span>
              <span className="toolbar-group">
                レイアウト検出:
                <label>
                  実行の方法{' '}
                  <select
                    value={backend}
                    onChange={(event) => setBackend(event.target.value as LayoutBackend)}
                    disabled={detectorState.state === 'loading' || detectorState.state === 'ready'}
                  >
                    <option value="webgpu">WebGPU</option>
                    <option value="wasm">WebAssembly</option>
                  </select>
                </label>
                {detectorState.state === 'ready' ? (
                  <button type="button" onClick={disableDetector}>
                    無効にする
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void enableDetector().then((created) => {
                        if (created) setXray((current) => ({ ...current, regions: true }))
                      })
                    }}
                    disabled={detectorState.state === 'loading'}
                  >
                    有効にする(初回は約 130 MB を取得)
                  </button>
                )}
              </span>
              </div>
            )}
            {statusNodes.length > 0 && (
              <span className="status toolbar-status" role="status">
                {statusNodes}
              </span>
            )}
          </section>

          {compare.state === 'loading' && (
            <p className="status" role="status">
              保存してある訳文を集めています…
            </p>
          )}
          {compare.state === 'error' && (
            <p className="status" role="status">
              <span className="error">訳文を比べる画面を開けませんでした: {compare.message}</span>
            </p>
          )}
          {compare.state === 'ready' && (
            <ComparePanel
              // 読み込み直したときに、列の選び方を作り直す。
              key={compare.modelIds.join('|')}
              modelIds={compare.modelIds}
              rows={compare.rows}
              onReload={() => void openComparison()}
              onClose={() => setCompare({ state: 'closed' })}
            />
          )}

          {/* 比べる画面を開いている間も、ページの描画や翻訳の状態を保つため、隠すだけにする。 */}
          <div hidden={compare.state === 'ready'}>
            <div ref={pagesRef} className={sideBySide ? 'pages side-by-side' : 'pages'}>
              {Array.from({ length: opened.document.numPages }, (_, index) => {
                // PDF を開き直したときに、前の PDF の描画や解析結果を引き継がない。
                const key = `${opened.document.fingerprints[0] ?? opened.name}-${index + 1}`
                return (
                  <div key={key} className="page-row">
                    {/* 左は、訳文も確認用の枠も重ねない、原文のままのページ。 */}
                    {sideBySide && (
                      <PageView
                        session={opened.session}
                        pageNumber={index + 1}
                        scale={scale}
                        estimatedSize={opened.firstPageSize}
                        showWithoutText={false}
                        showTranslations={false}
                        detectorEnabled={detector !== null}
                        xray={NO_XRAY}
                        forceRender={savingNow}
                      />
                    )}
                    <PageView
                      session={opened.session}
                      pageNumber={index + 1}
                      scale={scale}
                      estimatedSize={opened.firstPageSize}
                      showWithoutText={showWithoutText}
                      showTranslations={showTranslations}
                      detectorEnabled={detector !== null}
                      xray={xray}
                      forceRender={savingNow}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
