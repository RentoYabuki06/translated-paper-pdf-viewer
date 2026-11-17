/**
 * ページごとの JPEG の画像から、PDF のファイルを作る。
 *
 * 1 ページに、画像を 1 枚、ページいっぱいに置く。文字は画像の中にあり、PDF の文字としては入らない。
 * JPEG のデータは、そのまま PDF に入れる(DCTDecode)。圧縮し直さない。
 */

export interface PdfImagePage {
  /** JPEG のデータ。色は RGB、1 色 8 ビット。 */
  jpeg: Uint8Array
  /** 画像の大きさ(画素)。 */
  pixelWidth: number
  pixelHeight: number
  /** ページの大きさ(ポイント)。 */
  width: number
  height: number
}

/** 数値を、PDF に書く形にする。小数は 2 桁まで。 */
function num(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export function buildImagePdf(pages: readonly PdfImagePage[]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  /** オブジェクトの番号(1 から)ごとの、ファイルの先頭からの位置。 */
  const offsets: number[] = []
  let length = 0

  function push(data: string | Uint8Array): void {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    chunks.push(bytes)
    length += bytes.length
  }
  /** オブジェクトを 1 つ書く。stream を渡すと、辞書のあとにデータを置く。 */
  function object(id: number, dictionary: string, stream?: Uint8Array): void {
    offsets[id] = length
    push(`${id} 0 obj\n${dictionary}\n`)
    if (stream) {
      push('stream\n')
      push(stream)
      push('\nendstream\n')
    }
    push('endobj\n')
  }

  // 2 行目は、ファイルが文字だけでないことを示す、決まりの注釈。
  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  // オブジェクトの番号: 1 は文書、2 はページの一覧。ページごとに、ページ、描画の命令、画像の 3 つ。
  const pageId = (index: number) => 3 + index * 3
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(' ')}] >>`)
  pages.forEach((page, index) => {
    const id = pageId(index)
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    )
    // 画像を、ページの左下から、ページの大きさに広げて描く。
    const content = encoder.encode(`q ${num(page.width)} 0 0 ${num(page.height)} 0 0 cm /Im0 Do Q`)
    object(id + 1, `<< /Length ${content.length} >>`, content)
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      page.jpeg,
    )
  })

  const count = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const result = new Uint8Array(length)
  let position = 0
  for (const chunk of chunks) {
    result.set(chunk, position)
    position += chunk.length
  }
  return result
}
