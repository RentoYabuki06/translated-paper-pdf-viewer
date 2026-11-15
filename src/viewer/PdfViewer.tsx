/**
 * PDF を開いて表示する画面。
 * 開き方は 3 通り: ファイルの選択、ドラッグ&ドロップ、arXiv の ID または URL の入力。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import type { PageAnalysis } from '../analysis/analyzePage.ts'
import { arxivPdfUrl, parseArxivId } from '../pdf/arxiv.ts'
import { loadPdf } from '../pdf/pdfjs.ts'
import { PageView } from './PageView.tsx'
import type { PageSize } from './PageView.tsx'
import type { XRayOptions } from './XRayLayer.tsx'

const SCALES = [1, 1.25, 1.5, 2]

const XRAY_LABELS: { key: keyof XRayOptions; label: string }[] = [
  { key: 'paragraphs', label: '段落' },
  { key: 'lines', label: '行' },
  { key: 'runs', label: '文字のまとまり' },
  { key: 'math', label: '数式の文字' },
]

interface Opened {
  name: string
  document: PDFDocumentProxy
  firstPageSize: PageSize
}

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
  const [xray, setXray] = useState<XRayOptions>({ paragraphs: true, lines: false, runs: false, math: true })
  const [dragging, setDragging] = useState(false)
  const [counts, setCounts] = useState<Record<number, { paragraphs: number; lines: number; math: number }>>({})
  /** 開く操作の通し番号。あとから始めた操作だけを画面に反映するために使う。 */
  const openSequence = useRef(0)
  const openedRef = useRef<Opened | null>(null)

  // 画面を閉じるときに、開いている PDF を解放する。
  useEffect(() => () => void openedRef.current?.document.loadingTask.destroy(), [])

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
      void openedRef.current?.document.loadingTask.destroy()
      const next = { name, document, firstPageSize: { width: viewport.width, height: viewport.height } }
      openedRef.current = next
      setCounts({})
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

  const onAnalyzed = useCallback((pageNumber: number, analysis: PageAnalysis) => {
    setCounts((current) => ({
      ...current,
      [pageNumber]: {
        paragraphs: analysis.paragraphs.length,
        lines: analysis.lines.length,
        math: analysis.runs.filter((run) => run.isMath).length,
      },
    }))
  }, [])

  const analyzedPages = Object.keys(counts).length
  const totals = Object.values(counts).reduce(
    (sum, page) => ({
      paragraphs: sum.paragraphs + page.paragraphs,
      lines: sum.lines + page.lines,
      math: sum.math + page.math,
    }),
    { paragraphs: 0, lines: 0, math: 0 },
  )

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
              解析済み {analyzedPages} ページ: 段落 {totals.paragraphs}、行 {totals.lines}、数式の文字のまとまり{' '}
              {totals.math}
            </span>
          </section>

          <div className="pages">
            {Array.from({ length: opened.document.numPages }, (_, index) => (
              <PageView
                // PDF を開き直したときに、前の PDF の描画や解析結果を引き継がない。
                key={`${opened.document.fingerprints[0] ?? opened.name}-${index + 1}`}
                document={opened.document}
                pageNumber={index + 1}
                scale={scale}
                estimatedSize={opened.firstPageSize}
                showWithoutText={showWithoutText}
                xray={xray}
                onAnalyzed={onAnalyzed}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
