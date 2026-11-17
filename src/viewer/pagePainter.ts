/**
 * 画面に表示しているページを、1 枚の画像に描き写す。PDF として保存するために使う。
 *
 * ページは、PDF.js が描いた canvas に、訳文の要素(HTML)を重ねて表示している。
 * 訳文は、ブラウザが決めた 1 文字ごとの位置を読み取り、同じ位置に、同じフォントで描く。
 * 訳文の中の数式は、背景の画像の指定を読み取り、同じ範囲を描く。
 * こうすると、行の折り返しや文字の位置が、画面の表示と同じになる。
 */

export interface PaintedRow {
  canvas: HTMLCanvasElement
  /** ページの大きさ(CSS の画素)。並べた場合は、2 ページ分の幅。 */
  cssWidth: number
  cssHeight: number
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(url)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('数式の画像を読み込めませんでした'))
      image.src = url
    })
    imageCache.set(url, pending)
  }
  return pending
}

/** 描き終えたあとに、覚えていた画像を手放す。 */
export function clearPainterCache(): void {
  imageCache.clear()
}

/** 画面の上の位置(CSS の画素)を、画像の上の位置(画素)に直す。 */
interface Mapping {
  left: number
  top: number
  /** CSS の 1 画素に当たる、画像の画素の数。 */
  ratio: number
  offsetX: number
}

function toX(mapping: Mapping, clientX: number): number {
  return (clientX - mapping.left) * mapping.ratio + mapping.offsetX
}

function toY(mapping: Mapping, clientY: number): number {
  return (clientY - mapping.top) * mapping.ratio
}

/** 訳文の中の数式を描く。背景の画像のうち、要素の範囲に見えている部分だけを描く。 */
async function paintSprite(context: CanvasRenderingContext2D, sprite: HTMLElement, mapping: Mapping): Promise<void> {
  const style = getComputedStyle(sprite)
  const url = /^url\("(.*)"\)$/.exec(style.backgroundImage)?.[1]
  const rect = sprite.getBoundingClientRect()
  const width = parseFloat(style.width)
  if (!url || !(width > 0) || rect.width === 0) return
  // 要素の大きさと位置の指定は、訳文の層を拡大する前の長さ。画面の上の長さに直す倍率を求める。
  const zoom = rect.width / width
  const [sizeX, sizeY] = style.backgroundSize.split(' ').map(parseFloat)
  const [positionX, positionY] = style.backgroundPosition.split(' ').map(parseFloat)
  if (sizeX === undefined || sizeY === undefined || positionX === undefined || positionY === undefined) return
  const image = await loadImage(url)
  context.save()
  context.beginPath()
  context.rect(toX(mapping, rect.left), toY(mapping, rect.top), rect.width * mapping.ratio, rect.height * mapping.ratio)
  context.clip()
  context.drawImage(
    image,
    toX(mapping, rect.left + positionX * zoom),
    toY(mapping, rect.top + positionY * zoom),
    sizeX * zoom * mapping.ratio,
    sizeY * zoom * mapping.ratio,
  )
  context.restore()
}

/** 文字の並びを、ブラウザが決めた位置に、1 文字ずつ描く。 */
function paintText(context: CanvasRenderingContext2D, node: Text, mapping: Mapping, ascentRatio: number): void {
  const text = node.data
  const range = document.createRange()
  let offset = 0
  for (const character of text) {
    const start = offset
    offset += character.length
    if (character.trim() === '') continue
    range.setStart(node, start)
    range.setEnd(node, offset)
    const rect = range.getClientRects()[0]
    if (!rect || rect.width === 0) continue
    // 文字の範囲の上端から、基準線までの距離は、フォントの上の高さと下の高さの比で決まる。
    context.fillText(character, toX(mapping, rect.left), toY(mapping, rect.top + rect.height * ascentRatio))
  }
}

/** 訳文の箱を 1 つ描く。 */
async function paintBox(context: CanvasRenderingContext2D, box: HTMLElement, mapping: Mapping): Promise<void> {
  const rect = box.getBoundingClientRect()
  if (box.offsetWidth === 0 || rect.width === 0) return
  const style = getComputedStyle(box)
  // 訳文の層は、CSS で拡大してある。文字の大きさの指定は、拡大する前の値。
  const zoom = rect.width / box.offsetWidth
  const fontSize = parseFloat(style.fontSize) * zoom * mapping.ratio
  context.save()
  if (style.overflow === 'hidden') {
    // 収まらなかった訳文は、画面と同じく、箱からはみ出した分を描かない。
    context.beginPath()
    context.rect(toX(mapping, rect.left), toY(mapping, rect.top), rect.width * mapping.ratio, rect.height * mapping.ratio)
    context.clip()
  }
  context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  context.fillStyle = style.color
  context.textBaseline = 'alphabetic'
  const metrics = context.measureText('あ')
  const ascent = metrics.fontBoundingBoxAscent
  const descent = metrics.fontBoundingBoxDescent
  const ascentRatio = ascent + descent > 0 ? ascent / (ascent + descent) : 0.88
  for (const child of box.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) paintText(context, child as Text, mapping, ascentRatio)
    else if (child instanceof HTMLElement && child.classList.contains('math-sprite')) await paintSprite(context, child, mapping)
  }
  context.restore()
}

/** ページを 1 つ描く。下から順に、通常の描画、文字を描かない描画(訳文のある範囲だけ)、訳文。 */
async function paintPage(context: CanvasRenderingContext2D, page: HTMLElement, offsetX: number): Promise<void> {
  const [normal, textless] = [...page.querySelectorAll<HTMLCanvasElement>(':scope > canvas')]
  if (!normal) return
  const rect = page.getBoundingClientRect()
  const mapping: Mapping = { left: rect.left, top: rect.top, ratio: normal.width / rect.width, offsetX }
  if (!normal.hidden) context.drawImage(normal, offsetX, 0)
  if (textless && !textless.hidden && textless.width > 0) {
    context.save()
    const path = /^path\(["'](.*)["']\)$/.exec(textless.style.clipPath)?.[1]
    if (path) {
      // 範囲の指定は、CSS の画素。画像の画素に直して、その中だけに描く。
      const clip = new Path2D()
      clip.addPath(new Path2D(path), new DOMMatrix().translateSelf(offsetX, 0).scaleSelf(mapping.ratio))
      context.clip(clip)
    }
    context.drawImage(textless, offsetX, 0)
    context.restore()
  }
  for (const box of page.querySelectorAll<HTMLElement>('.translation-layer > .translation')) {
    await paintBox(context, box, mapping)
  }
}

/**
 * 横に並んだページ(1 ページ、または原文と訳文の 2 ページ)を、1 枚の画像に描く。
 * ページの間のすき間は入れない。描画が終わっているページを渡すこと。
 */
export async function paintRow(row: HTMLElement): Promise<PaintedRow | null> {
  const pages = [...row.querySelectorAll<HTMLElement>('.page')]
  const canvases = pages.map((page) => page.querySelector<HTMLCanvasElement>(':scope > canvas'))
  const width = canvases.reduce((sum, canvas) => sum + (canvas?.width ?? 0), 0)
  const height = Math.max(0, ...canvases.map((canvas) => canvas?.height ?? 0))
  if (width === 0 || height === 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('画像を描く準備ができませんでした')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  let offsetX = 0
  let cssWidth = 0
  let cssHeight = 0
  for (const [index, page] of pages.entries()) {
    await paintPage(context, page, offsetX)
    offsetX += canvases[index]?.width ?? 0
    const rect = page.getBoundingClientRect()
    cssWidth += rect.width
    cssHeight = Math.max(cssHeight, rect.height)
  }
  return { canvas, cssWidth, cssHeight }
}
