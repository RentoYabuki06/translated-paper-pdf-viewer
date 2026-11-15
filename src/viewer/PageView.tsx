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
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NO_ORIGINALS: ReadonlySet<string> = new Set()
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const normalCanvasRef = useRef<HTMLCanvasElement>(null)
  const textlessCanvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [size, setSize] = useState<PageSize>(estimatedSize)
  const [error, setError] = useState<string | null>(null)
  /** 通常の描画が終わるたびに増える番号。0 は、まだ描画していないことを表す。 */
  const [normalVersion, setNormalVersion] = useState(0)
  /** 文字を描かない描画が、いまの倍率と範囲で終わっているかどうか。 */
  const [coverReady, setCoverReady] = useState(false)
  /** 通常の描画を画像にしたものの URL。訳文の中に置く数式を、ここから切り抜く。 */
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null)
  /** 原文の表示に切り替えている翻訳単位の名前。 */
  const [originals, setOriginals] = useState<ReadonlySet<string>>(NO_ORIGINALS)

  const state = useSyncExternalStore(
    session.subscribe,
    useCallback(() => session.getPage(pageNumber), [session, pageNumber]),
  )
  const units = state.units

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
      if (!cancelled) setNormalVersion((version) => version + 1)
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

  const clipPath = useMemo(
    () => (units && showTranslations ? coverClipPath(units, state.translations, originals, scale) : null),
    [units, state.translations, originals, scale, showTranslations],
  )

  // 文字を描かない描画は、必要になってから行う(訳文を表示するとき、または、この描画を見るとき)。
  // 訳す段落の範囲が分かっている場合は、その中の細い罫線(分数の線など)も描かない。
  const needCover = showWithoutText || clipPath !== null
  const ruleRects = useMemo(
    () =>
      units
        ? units.map((unit) => ({
            x: unit.rect.x - COVER_PAD_X,
            y: unit.rect.y - COVER_PAD_Y,
            width: unit.rect.width + 2 * COVER_PAD_X,
            height: unit.rect.height + 2 * COVER_PAD_Y,
          }))
        : NO_RECTS,
    [units],
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

  // 訳文の中に数式を置く必要があるときだけ、通常の描画を画像にする。
  const needPageImage = useMemo(
    () =>
      showTranslations &&
      units !== null &&
      units.some((unit) => unit.math.length > 0 && state.translations[unit.id]?.status === 'done'),
    [units, state.translations, showTranslations],
  )
  useEffect(() => {
    const canvas = normalCanvasRef.current
    if (!needPageImage || normalVersion === 0 || !canvas) return
    let cancelled = false
    let url: string | null = null
    canvas.toBlob((blob) => {
      if (cancelled || !blob) return
      url = URL.createObjectURL(blob)
      setPageImageUrl(url)
    }, 'image/png')
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      setPageImageUrl(null)
    }
  }, [needPageImage, normalVersion])

  const pageImage = useMemo(
    () => ({ url: pageImageUrl, width: size.width, height: size.height }),
    [pageImageUrl, size],
  )
  const coverVisible = showWithoutText || (clipPath !== null && coverReady)

  return (
    <div
      ref={containerRef}
      className="page"
      style={{ width: size.width * scale, height: size.height * scale }}
      data-page-number={pageNumber}
    >
      <canvas ref={normalCanvasRef} hidden={showWithoutText && coverReady} />
      <canvas
        ref={textlessCanvasRef}
        hidden={!coverVisible}
        style={showWithoutText || clipPath === null ? undefined : { clipPath }}
      />
      {/* 元の文字を消す描画が終わるまでは、訳文を出さない。文字が重なって見えるのを防ぐため。 */}
      {units && showTranslations && !showWithoutText && coverReady && (
        <TranslationLayer
          units={units}
          translations={state.translations}
          page={pageImage}
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
