/**
 * 1 ページ分の表示。表示範囲に近づいたときに、描画と解析を行う。
 *
 * 層は、下から順に、通常の描画、文字を描かない描画、訳文、解析結果の確認用の枠。
 * 文字を描かない描画は、訳文を表示している段落の範囲だけを見せる。
 * こうすると、元の文字だけが消え、背景の色や罫線は残る。
 */

import type { RenderTask } from 'pdfjs-dist'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Rect } from '../analysis/types.ts'
import { renderPage } from '../pdf/render.ts'
import type { UnitFragment } from '../analysis/units.ts'
import type { DocumentSession } from './session.ts'
import { COVER_PAD_X, COVER_PAD_Y, coverClipPath, TranslationLayer } from './TranslationLayer.tsx'
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
  /** true のとき、表示範囲から離れていても描画する。印刷の前に、すべてのページを描画するために使う。 */
  forceRender?: boolean
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NO_RECTS: readonly Rect[] = []

export function PageView({
  session,
  pageNumber,
  scale,
  estimatedSize,
  showWithoutText,
  showTranslations,
  detectorEnabled,
  xray,
  forceRender = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const normalCanvasRef = useRef<HTMLCanvasElement>(null)
  const textlessCanvasRef = useRef<HTMLCanvasElement>(null)
  const [nearViewport, setNear] = useState(false)
  const near = nearViewport || forceRender
  /** 通常の描画が、いまの倍率で終わっているかどうか。 */
  const [rendered, setRendered] = useState(false)
  const [size, setSize] = useState<PageSize>(estimatedSize)
  const [error, setError] = useState<string | null>(null)
  /** 文字を描かない描画が、いまの倍率と範囲で終わっているかどうか。 */
  const [coverReady, setCoverReady] = useState(false)

  const state = useSyncExternalStore(
    session.subscribe,
    useCallback(() => session.getPage(pageNumber), [session, pageNumber]),
  )
  const fragments = state.fragments
  // 原文の表示への切り替えと、数式を切り抜くもとの画像は、ページをまたぐ翻訳単位があるので、文書全体で持つ。
  const originals = useSyncExternalStore(session.subscribe, session.getOriginals)
  const images = useSyncExternalStore(session.subscribe, session.getImages)
  const requestImage = useCallback((page: number) => session.ensurePageImage(page), [session])

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

  // 通常の描画。倍率を変えたら描き直す。
  useEffect(() => {
    if (!near) return
    let cancelled = false
    let task: RenderTask | undefined

    async function run(): Promise<void> {
      const page = await session.document.getPage(pageNumber)
      const canvas = normalCanvasRef.current
      if (cancelled || !canvas) return
      const viewport = page.getViewport({ scale: 1 })
      setSize({ width: viewport.width, height: viewport.height })
      task = renderPage(page, canvas, { scale })
      await task.promise
      if (!cancelled) setRendered(true)
    }

    run().catch((cause: unknown) => {
      if (!cancelled && !isCancelled(cause)) setError(messageOf(cause))
    })
    return () => {
      cancelled = true
      task?.cancel()
      setRendered(false)
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

  const clipPath = useMemo(
    () => (showTranslations ? coverClipPath(fragments, state.translations, originals, scale) : null),
    [fragments, state.translations, originals, scale, showTranslations],
  )

  // 文字を描かない描画は、必要になってから行う(訳文を表示するとき、または、この描画を見るとき)。
  // 訳す段落の範囲が分かっている場合は、その中の細い罫線(分数の線など)も描かない。
  const needCover = showWithoutText || clipPath !== null
  const ruleRects = useMemo(
    () =>
      fragments.length > 0
        ? fragments.map(({ unit, index }) => {
            const rect = (unit.fragments[index] as UnitFragment).rect
            return {
              x: rect.x - COVER_PAD_X,
              y: rect.y - COVER_PAD_Y,
              width: rect.width + 2 * COVER_PAD_X,
              height: rect.height + 2 * COVER_PAD_Y,
            }
          })
        : NO_RECTS,
    [fragments],
  )
  useEffect(() => {
    if (!near || !needCover) return
    let cancelled = false
    let task: RenderTask | undefined

    async function run(): Promise<void> {
      const page = await session.document.getPage(pageNumber)
      const canvas = textlessCanvasRef.current
      if (cancelled || !canvas) return
      task = renderPage(page, canvas, { scale, withoutText: true, hideRulesIn: ruleRects })
      await task.promise
      if (!cancelled) setCoverReady(true)
    }

    run().catch((cause: unknown) => {
      if (!cancelled && !isCancelled(cause)) setError(messageOf(cause))
    })
    return () => {
      cancelled = true
      task?.cancel()
      setCoverReady(false)
    }
  }, [session, pageNumber, scale, near, needCover, ruleRects])

  const coverVisible = showWithoutText || (clipPath !== null && coverReady)

  return (
    <div
      ref={containerRef}
      className="page"
      style={{ width: size.width * scale, height: size.height * scale }}
      data-page-number={pageNumber}
      // 印刷の前に、描画が終わったかどうかを確かめるための印。
      data-rendered={rendered ? 'true' : 'false'}
      data-cover={needCover ? (coverReady ? 'ready' : 'pending') : 'none'}
    >
      <canvas ref={normalCanvasRef} hidden={showWithoutText && coverReady} />
      <canvas
        ref={textlessCanvasRef}
        hidden={!coverVisible}
        style={showWithoutText || clipPath === null ? undefined : { clipPath }}
      />
      {/* 元の文字を消す描画が終わるまでは、訳文を出さない。文字が重なって見えるのを防ぐため。 */}
      {fragments.length > 0 && showTranslations && !showWithoutText && coverReady && (
        <TranslationLayer
          fragments={fragments}
          translations={state.translations}
          images={images}
          requestImage={requestImage}
          width={size.width}
          height={size.height}
          scale={scale}
          originals={originals}
          onToggle={session.toggleOriginal}
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
