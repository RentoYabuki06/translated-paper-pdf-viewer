/**
 * 1 ページ分の表示。表示範囲に近づいたときに、描画と解析を行う。
 */

import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'
import { analyzePage } from '../analysis/analyzePage.ts'
import type { PageAnalysis } from '../analysis/analyzePage.ts'
import type { LayoutDetector } from '../layout/ortWebClient.ts'
import type { LayoutRegion } from '../layout/types.ts'
import { renderPage } from '../pdf/render.ts'
import { XRayLayer } from './XRayLayer.tsx'
import type { XRayOptions } from './XRayLayer.tsx'

export interface PageSize {
  width: number
  height: number
}

interface Props {
  document: PDFDocumentProxy
  pageNumber: number
  scale: number
  /** ページを読み込む前に、場所を確保するための大きさ(ポイント)。 */
  estimatedSize: PageSize
  /** true のとき、通常の描画の代わりに、文字を描かない描画を見せる。 */
  showWithoutText: boolean
  xray: XRayOptions
  onAnalyzed: (pageNumber: number, analysis: PageAnalysis) => void
  /** レイアウト検出器。有効にしていない間は null。 */
  detector: LayoutDetector | null
  onDetected: (pageNumber: number, milliseconds: number) => void
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

export function PageView({
  document,
  pageNumber,
  scale,
  estimatedSize,
  showWithoutText,
  xray,
  onAnalyzed,
  detector,
  onDetected,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const normalCanvasRef = useRef<HTMLCanvasElement>(null)
  const textlessCanvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [size, setSize] = useState<PageSize>(estimatedSize)
  const [analysis, setAnalysis] = useState<PageAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 通常の描画が終わっているかどうか。レイアウト検出は、描画済みの画像を入力にする。 */
  const [rendered, setRendered] = useState(false)
  const [regions, setRegions] = useState<LayoutRegion[] | null>(null)

  // 表示範囲の上下 1 画面分まで近づいたら、描画の対象にする。一度対象になったら、そのままにする。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100% 0px' },
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    let task: RenderTask | undefined

    async function run(): Promise<void> {
      const page = await document.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale: 1 })
      setSize({ width: viewport.width, height: viewport.height })

      // 同じページの描画は、1 つずつ順に行う。
      for (const [canvas, withoutText] of [
        [normalCanvasRef.current, false],
        [textlessCanvasRef.current, true],
      ] as const) {
        if (!canvas || cancelled) return
        task = renderPage(page, canvas, { scale, withoutText })
        await task.promise
        if (!withoutText && !cancelled) setRendered(true)
      }
      if (cancelled) return

      const result = await analyzePage(page)
      if (cancelled) return
      setAnalysis(result)
      onAnalyzed(pageNumber, result)
    }

    run().catch((cause: unknown) => {
      if (!cancelled && !isCancelled(cause)) setError(cause instanceof Error ? cause.message : String(cause))
    })

    return () => {
      cancelled = true
      task?.cancel()
      setRendered(false)
    }
  }, [document, pageNumber, scale, near, onAnalyzed])

  // レイアウト検出は、検出器ごとに、ページにつき 1 回だけ行う。結果はページの座標なので、倍率を変えても使える。
  const detectedWith = useRef<LayoutDetector | null>(null)
  useEffect(() => {
    if (!detector) {
      detectedWith.current = null
      setRegions(null)
      return
    }
    const canvas = normalCanvasRef.current
    if (!rendered || !canvas || detectedWith.current === detector) return
    detectedWith.current = detector
    let cancelled = false
    detector
      .detect(canvas, size.width, size.height)
      .then((result) => {
        if (cancelled) return
        setRegions(result.regions)
        onDetected(pageNumber, result.milliseconds)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        detectedWith.current = null
        setError(`レイアウト検出に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [detector, rendered, size, pageNumber, onDetected])

  return (
    <div
      ref={containerRef}
      className="page"
      style={{ width: size.width * scale, height: size.height * scale }}
      data-page-number={pageNumber}
    >
      <canvas ref={normalCanvasRef} hidden={showWithoutText} />
      <canvas ref={textlessCanvasRef} hidden={!showWithoutText} />
      {analysis && (
        <XRayLayer analysis={analysis} regions={regions} width={size.width} height={size.height} options={xray} />
      )}
      {error && <p className="page-error error">{`${pageNumber} ページ目を表示できません: ${error}`}</p>}
    </div>
  )
}
