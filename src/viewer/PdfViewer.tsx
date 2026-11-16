/**
 * PDF を開いて表示する画面。
 * 開き方は 3 通り: ファイルの選択、ドラッグ&ドロップ、arXiv の ID または URL の入力。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { LayoutDetector, MODEL_BYTES } from '../layout/ortWebClient.ts'
import type { LayoutBackend } from '../layout/types.ts'
import { median } from '../lib/stats.ts'
import { arxivPdfUrl, parseArxivId } from '../pdf/arxiv.ts'
import { loadPdf } from '../pdf/pdfjs.ts'
import { openTranslationCache } from '../translate/cache.ts'
import { LlamaServerBackend } from '../translate/llamaServer.ts'
import { loadServerUrl, saveServerUrl } from '../translate/serverUrl.ts'
import { PageView } from './PageView.tsx'
import type { PageSize } from './PageView.tsx'
import { DocumentSession } from './session.ts'
import type { SessionProgress } from './session.ts'
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
}

const noSubscription = () => () => undefined
const noProgress = () => NO_PROGRESS

type Status = { state: 'idle' } | { state: 'loading'; message: string } | { state: 'error'; message: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function PdfViewer() {
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
  const [serverUrl, setServerUrl] = useState(loadServerUrl)
  const [showTranslations, setShowTranslations] = useState(true)
  const [translationError, setTranslationError] = useState<string | null>(null)
  /** 翻訳を始める準備(接続の確認やモデルの読み込み)をしている間は true。 */
  const [startingTranslation, setStartingTranslation] = useState(false)
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
  }

  /**
   * 開いている PDF の翻訳を始める。
   * 訳す段落を決めるためにレイアウト検出が要るので、有効になっていなければ先に有効にする。
   */
  async function startTranslation(): Promise<void> {
    const session = openedRef.current?.session
    if (!session) return
    setTranslationError(null)
    setStartingTranslation(true)
    try {
      saveServerUrl(serverUrl)
      const translator = new LlamaServerBackend({ baseUrl: serverUrl })
      const info = await translator.info()
      const detector = detectorRef.current ?? (await enableDetector())
      if (!detector) return
      const cache = await openTranslationCache()
      // 準備の間に、別の PDF を開いた場合は始めない。
      if (openedRef.current?.session !== session) return
      // 訳文を読みやすくするため、確認用の枠を消す。
      setXray({ paragraphs: false, lines: false, runs: false, math: false, regions: false })
      setShowTranslations(true)
      session.startTranslation(translator, info, cache)
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
              <input
                type="url"
                className="server-url"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                disabled={progress.translating || startingTranslation}
                aria-label="llama-server の URL"
                spellCheck={false}
              />
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
            </span>
            <span className="status" role="status">
              {translationError && <span className="error">{translationError}</span>}
              {startingTranslation && !translationError && '翻訳の準備をしています…'}
              {(progress.translating || hasTranslations) &&
                `${progress.translating ? '翻訳しています' : '翻訳が終わりました'}: ${progress.done + progress.kept} / ${progress.units} 段落(${progress.preparedPages} / ${opened.document.numPages} ページを準備済み、段やページをまたいでつないだ段落 ${progress.merged} 件、依頼 ${progress.requests} 件、保存分の再利用 ${progress.cached} 件、失敗 ${progress.failed} 件、途中で切れた訳文 ${progress.truncated} 件、文ごとに訳し直した段落 ${progress.retried} 件、数式の目印がそろわず原文のまま ${progress.kept} 件)`}
            </span>
          </section>

          <div className="pages">
            {Array.from({ length: opened.document.numPages }, (_, index) => (
              <PageView
                // PDF を開き直したときに、前の PDF の描画や解析結果を引き継がない。
                key={`${opened.document.fingerprints[0] ?? opened.name}-${index + 1}`}
                session={opened.session}
                pageNumber={index + 1}
                scale={scale}
                estimatedSize={opened.firstPageSize}
                showWithoutText={showWithoutText}
                showTranslations={showTranslations}
                detectorEnabled={detector !== null}
                xray={xray}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
