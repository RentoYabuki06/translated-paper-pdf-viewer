import { describe, expect, it } from 'vitest'
import { buildImagePdf } from '../../src/lib/imagePdf.ts'

/** バイトの並びを、1 バイト 1 文字の文字列にする。位置を、バイトの数で数えるため。 */
function latin1(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}

/** 中身が JPEG である必要はないので、決まった値のバイトを使う。 */
function fakeJpeg(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value)
}

const PAGES = [
  { jpeg: fakeJpeg(40, 0x41), pixelWidth: 1836, pixelHeight: 2376, width: 612, height: 792 },
  { jpeg: fakeJpeg(70, 0x42), pixelWidth: 3672, pixelHeight: 2376, width: 1224, height: 792.5 },
]

describe('buildImagePdf', () => {
  it('PDF の先頭と末尾の決まりの行がある', () => {
    const text = latin1(buildImagePdf(PAGES))
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.endsWith('%%EOF\n')).toBe(true)
  })

  it('ページの数と、ページごとの大きさを書く', () => {
    const text = latin1(buildImagePdf(PAGES))
    expect(text).toContain('/Type /Pages /Count 2 /Kids [3 0 R 6 0 R]')
    expect(text).toContain('/MediaBox [0 0 612 792]')
    expect(text).toContain('/MediaBox [0 0 1224 792.5]')
    expect(text).toContain('q 1224 0 0 792.5 0 0 cm /Im0 Do Q')
  })

  it('画像の大きさと、データの長さを書き、データをそのまま入れる', () => {
    const text = latin1(buildImagePdf(PAGES))
    expect(text).toContain('/Width 1836 /Height 2376 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 40 >>')
    expect(text).toContain(`stream\n${'A'.repeat(40)}\nendstream`)
    expect(text).toContain(`stream\n${'B'.repeat(70)}\nendstream`)
  })

  it('相互参照表の位置が、それぞれのオブジェクトの先頭を指す', () => {
    const text = latin1(buildImagePdf(PAGES))
    const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1])
    expect(text.slice(xref, xref + 5)).toBe('xref\n')
    const lines = text.slice(xref).split('\n')
    expect(lines[1]).toBe('0 9')
    expect(lines[2]).toBe('0000000000 65535 f ')
    for (let id = 1; id < 9; id += 1) {
      const offset = Number((lines[2 + id] as string).slice(0, 10))
      expect(text.slice(offset, offset + `${id} 0 obj\n`.length)).toBe(`${id} 0 obj\n`)
    }
    expect(text).toContain('/Size 9 /Root 1 0 R')
  })

  it('ページが無い場合も、形の整ったファイルを返す', () => {
    const text = latin1(buildImagePdf([]))
    expect(text).toContain('/Count 0 /Kids []')
    expect(text).toContain('/Size 3 /Root 1 0 R')
  })
})
