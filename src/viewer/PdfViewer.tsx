/**
 * PDF を開いて表示する画面。
 * 開き方は 3 通り: ファイルの選択、ドラッグ&ドロップ、arXiv の ID または URL の入力。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { LayoutDetector, MODEL_BYTES } from '../layout/ortWebClient.ts'
import type { LayoutBackend } from '../layout/types.ts'
import { median } from '../lib/stats.ts'
import { arxivPdfUrl, parseArxivId } from '../pdf/arxiv.ts'
import { loadPdf } from '../pdf/pdfjs.ts'
import { openTranslationCache } from '../translate/cache.ts'
import { candidateModelIds, loadKnownModels, rememberModel } from '../translate/models.ts'
import { describeTarget } from '../translate/settings.ts'
import { ComparePanel } from './ComparePanel.tsx'
import { useGlossary } from './glossaryContext.ts'
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
  /** 翻訳サーバーの設定の画面を開く。 */
  onOpenServerSettings: () => void
  /** 用語集の画面を開く。 */
  onOpenGlossary: () => void
}

export function PdfViewer({ onOpenServerSettings, onOpenGlossary }: Props) {
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
  const [xray, setXray] = useState<XRayOptions>({
    paragraphs: true,
    lines: false,
    runs: false,
    math: true,
    regions: false,
  })
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
  const detectorRef = useRef<LayoutDetector | null>(null)
  /** 開く操作の通し番号。あとから始めた操作だけを画面に反映するために使う。 */
  const openSequence = useRef(0)
  const openedRef = useRef<Opened | null>(null)

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
      setXray({ paragraphs: false, lines: false, runs: false, math: false, regions: false })
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
        <div className="row">
          <label className="file-button">
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
          <span className="status">または、この画面へ PDF をドラッグ&ドロップします。</span>
        </div>
        <form className="row" onSubmit={onSubmitArxiv}>
          <input
            type="text"
            value={arxivInput}
            onChange={(event) => setArxivInput(event.target.value)}
            placeholder="arXiv の ID または URL(例: 1706.03762)"
            aria-label="arXiv の ID または URL"
            spellCheck={false}
          />
          <button type="submit" disabled={arxivInput.trim().length === 0}>
            arXiv から開く
          </button>
        </form>
        <p className="status" role="status">
          {status.state === 'loading' && status.message}
          {status.state === 'error' && <span className="error">{status.message}</span>}
        </p>
      </section>

      {opened && (
        <>
          <section className="panel toolbar">
            <strong>{opened.name}</strong>
            <span className="status">{opened.document.numPages} ページ</span>
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
            <span className="status" role="status">
              {detectorState.state === 'loading' &&
                (detectorState.loaded > 0
                  ? `モデルを取得しています… ${Math.round((detectorState.loaded / detectorState.total) * 100)}%`
                  : 'モデルを読み込んでいます…')}
              {detectorState.state === 'error' && <span className="error">{detectorState.message}</span>}
              {detectorState.state === 'ready' &&
                `${detectorState.detector.info.backend === 'webgpu' ? 'WebGPU' : `WebAssembly(${detectorState.detector.info.threads} スレッド)`}で検出します。` +
                  (times.length > 0
                    ? `検出済み ${times.length} ページ: 中央値 ${Math.round(median(times))} ミリ秒、最大 ${Math.round(Math.max(...times))} ミリ秒`
                    : '')}
            </span>
            <span className="toolbar-group">
              翻訳:
              <span className="status">{describeTarget(translator.settings)}</span>
              <button type="button" onClick={onOpenServerSettings} disabled={progress.translating || startingTranslation}>
                設定
              </button>
              <button type="button" onClick={onOpenGlossary}>
                用語集({glossary.entries.length} 語)
              </button>
              {progress.translating ? (
                <button type="button" onClick={() => opened.session.stopTranslation()}>
                  中止
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => void startTranslation()} disabled={startingTranslation}>
                  この PDF を翻訳する
                </button>
              )}
              {hasTranslations && (
                <label>
                  <input
                    type="checkbox"
                    checked={showTranslations}
                    onChange={(event) => setShowTranslations(event.target.checked)}
                  />
                  訳文を表示
                </label>
              )}
              <label>
                <input type="checkbox" checked={sideBySide} onChange={(event) => setSideBySide(event.target.checked)} />
                原文を左に並べる
              </label>
              <button type="button" onClick={() => void openComparison()} disabled={compare.state === 'loading'}>
                モデルごとの訳文を比べる
              </button>
            </span>
            <span className="status" role="status">
              {translationError && <span className="error">{translationError}</span>}
              {startingTranslation && !translationError && '翻訳の準備をしています…'}
              {(progress.translating || hasTranslations) &&
                `${progress.translating ? '翻訳しています' : progress.stopped ? '翻訳を中止しました' : '翻訳が終わりました'}: ${progress.done + progress.kept} / ${progress.units} 段落(${progress.preparedPages} / ${opened.document.numPages} ページを準備済み、段やページをまたいでつないだ段落 ${progress.merged} 件、依頼 ${progress.requests} 件、保存分の再利用 ${progress.cached} 件、失敗 ${progress.failed} 件、途中で切れた訳文 ${progress.truncated} 件、文ごとに訳し直した段落 ${progress.retried} 件、数式の目印がそろわず原文のまま ${progress.kept} 件${
                  progress.glossaryTerms > 0 ? `、用語集の語が出てくる段落 ${progress.glossaryUnits} 件` : ''
                }${progress.glossaryDropped > 0 ? `、うち用語集を付けずに訳し直した段落 ${progress.glossaryDropped} 件` : ''})`}
              {glossaryChanged && (
                <span className="notice">
                  {' '}
                  用語集が変わりました。「この PDF を翻訳する」を押すと、訳語の指定が変わる段落だけを訳し直します。
                </span>
              )}
            </span>
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
            <div className={sideBySide ? 'pages side-by-side' : 'pages'}>
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
