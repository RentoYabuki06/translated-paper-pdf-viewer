/**
 * 字形が実際に描かれる範囲を測る。
 *
 * フォントが持つ高さの情報(上端と下端)は、フォント全体で 1 組しか無い。
 * 根号や総和の記号のように、字形が基準線からぶら下がる形で作られた文字では、実際の範囲と大きく違う。
 * そこで、PDF.js がブラウザに読み込ませたフォントを使って、字形ごとの範囲を測る。
 */

/** 字形が描かれる範囲。字形の原点からの距離で、文字の大きさ 1 に対する割合。 */
export interface GlyphInk {
  /** 基準線から上端・下端までの距離。上端は上向き、下端は下向きを正とする。 */
  ascent: number
  descent: number
  /** 原点から左端・右端までの距離。左端は左向き、右端は右向きを正とする。 */
  left: number
  right: number
}

/**
 * 字形の範囲を返す関数。fontId は PDF.js が付けたフォントの名前、fontChar はそのフォントの中で字形を指す文字。
 * 測れない場合は null を返す。
 */
export type GlyphInkMeasurer = (fontId: string, fontChar: string) => GlyphInk | null

/** 測るときの文字の大きさ(画素)。大きいほど、結果が細かくなる。 */
const MEASURE_SIZE = 200

/**
 * canvas を使って字形の範囲を測る関数を作る。ブラウザでだけ使える。
 * 同じ字形の結果は覚えておき、2 回目以降は測り直さない。
 */
export function createCanvasInkMeasurer(): GlyphInkMeasurer {
  const context = new OffscreenCanvas(1, 1).getContext('2d')
  const cache = new Map<string, GlyphInk | null>()
  /** フォントごとの、ブラウザに読み込まれているかどうか。 */
  const available = new Map<string, boolean>()

  return (fontId, fontChar) => {
    if (!context || fontChar.length === 0) return null
    const key = `${fontId}\n${fontChar}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached

    const font = `${MEASURE_SIZE}px "${fontId}"`
    let loaded = available.get(fontId)
    if (loaded === undefined) {
      // 読み込まれていないフォントで測ると、代わりのフォントの字形を測ってしまう。
      loaded = [...document.fonts].some((face) => face.family.replace(/["']/g, '') === fontId && face.status === 'loaded')
      available.set(fontId, loaded)
    }
    let ink: GlyphInk | null = null
    if (loaded) {
      context.font = font
      const metrics = context.measureText(fontChar)
      const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
      const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
      if (Number.isFinite(height) && Number.isFinite(width) && height > 0 && width > 0) {
        ink = {
          ascent: metrics.actualBoundingBoxAscent / MEASURE_SIZE,
          descent: metrics.actualBoundingBoxDescent / MEASURE_SIZE,
          left: metrics.actualBoundingBoxLeft / MEASURE_SIZE,
          right: metrics.actualBoundingBoxRight / MEASURE_SIZE,
        }
      }
    }
    cache.set(key, ink)
    return ink
  }
}
