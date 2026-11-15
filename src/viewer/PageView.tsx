/**
 * 1 ページ分の表示。表示範囲に近づいたときに、描画と解析を行う。
 *
 * 層は、下から順に、通常の描画、文字を描かない描画、訳文、解析結果の確認用の枠。
 * 文字を描かない描画は、訳文を表示している段落の範囲だけを見せる。
 * こうすると、元の文字だけが消え、背景の色や罫線は残る。
 */

import type { RenderTask } from 'pdfjs-dist'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { renderPage } from '../pdf/render.ts'
import type { DocumentSession } from './session.ts'
import { coverClipPath, TranslationLayer } from './TranslationLayer.tsx'
import { XRayLayer } from './XRayLayer.tsx'
import type { XRayOptions } from './XRayLayer.tsx'

export interface PageSize {
  width: number
  height: number
}

interface Props {
  session: DocumentSession
  pageNumber: number
  scale: number
  /** ページを読み込む前に、場所を確保するための大きさ(ポイント)。 */
  estimatedSize: PageSize
  /** true のとき、通常の描画の代わりに、文字を描かない描画を見せる。 */
  showWithoutText: boolean
  /** false のとき、訳文を隠して原文を見せる。 */
  showTranslations: boolean
  /** レイアウト検出が有効かどうか。有効になったら、表示中のページを検出にかける。 */
  detectorEnabled: boolean
  xray: XRayOptions
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NO_ORIGINALS: ReadonlySet<string> = new Set()

export function PageView({
  session,
  pageNumber,
  scale,
  estimatedSize,
  showWithoutText,
  showTranslations,
  detectorEnabled,
  xray,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const normalCanvasRef = useRef<HTMLCanvasElement>(null)
  const textlessCanvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [size, setSize] = useState<PageSize>(estimatedSize)
  const [error, setError] = useState<string | null>(null)
  /** 原文の表示に切り替えている翻訳単位の名前。 */
  const [originals, setOriginals] = useState<ReadonlySet<string>>(NO_ORIGINALS)

  const state = useSyncExternalStore(
    session.subscribe,
    useCallback(() => session.getPage(pageNumber), [session, pageNumber]),
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // 表示範囲の上下 1 画面分まで近づいたら、描画の対象にする。一度対象になったら、そのままにする。
    const nearObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          nearObserver.disconnect()
        }
      },
      { rootMargin: '100% 0px' },
    )
    // 画面の中央の高さにかかっているページを、表示中のページとして伝える。翻訳の順番に使う。
    const focusObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) session.setFocusPage(pageNumber)
      },
      { rootMargin: '-50% 0px -50% 0px' },
    )
    nearObserver.observe(container)
    focusObserver.observe(container)
    return () => {
      nearObserver.disconnect()
      focusObserver.disconnect()
    }
  }, [session, pageNumber])

  // 描画。倍率を変えたら描き直す。
  useEffect(() => {
    if (!near) return
    let cancelled = false
    let task: RenderTask | undefined

    async function run(): Promise<void> {
      const page = await session.document.getPage(pageNumber)
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
      }
    }

    run().catch((cause: unknown) => {
      if (!cancelled && !isCancelled(cause)) setError(messageOf(cause))
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [session, pageNumber, scale, near])

  // 解析と、レイアウト検出。結果は session が持ち、ページにつき 1 回だけ行われる。
  useEffect(() => {
    if (!near) return
    let cancelled = false
    const work = detectorEnabled ? session.ensureLayout(pageNumber) : session.ensureAnalysis(pageNumber)
    work.catch((cause: unknown) => {
      if (!cancelled) setError(`解析に失敗しました: ${messageOf(cause)}`)
    })
    return () => {
      cancelled = true
    }
  }, [session, pageNumber, near, detectorEnabled])

  const onToggle = useCallback((unitId: string) => {
    setOriginals((current) => {
      const next = new Set(current)
      if (!next.delete(unitId)) next.add(unitId)
      return next
    })
  }, [])

  const units = state.units
  const clipPath = useMemo(
    () => (units && showTranslations ? coverClipPath(units, state.translations, originals, scale) : null),
    [units, state.translations, originals, scale, showTranslations],
  )

  return (
    <div
      ref={containerRef}
      className="page"
      style={{ width: size.width * scale, height: size.height * scale }}
      data-page-number={pageNumber}
    >
      <canvas ref={normalCanvasRef} hidden={showWithoutText} />
      <canvas
        ref={textlessCanvasRef}
        hidden={!showWithoutText && clipPath === null}
        style={showWithoutText || clipPath === null ? undefined : { clipPath }}
      />
      {units && showTranslations && !showWithoutText && (
        <TranslationLayer
          units={units}
          translations={state.translations}
          width={size.width}
          height={size.height}
          scale={scale}
          originals={originals}
          onToggle={onToggle}
        />
      )}
      {state.analysis && (
        <XRayLayer
          analysis={state.analysis}
          regions={state.regions}
          width={size.width}
          height={size.height}
          options={xray}
        />
      )}
      {error && <p className="page-error error">{`${pageNumber} ページ目: ${error}`}</p>}
    </div>
  )
}
