/**
 * arXiv の ID または URL から、PDF の URL を作る。
 *
 * 受け付ける形:
 *   2401.01234、2401.01234v2、arXiv:2401.01234、hep-th/9901001、
 *   https://arxiv.org/abs/2401.01234、https://arxiv.org/pdf/2401.01234v2.pdf
 */

const NEW_ID = /^\d{4}\.\d{4,5}(v\d+)?$/
const OLD_ID = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/

/** 入力から arXiv の ID を取り出す。arXiv の ID や URL として読めない場合は null。 */
export function parseArxivId(input: string): string | null {
  let text = input.trim()
  if (text.length === 0) return null

  const url = /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/([^?#]+)/i.exec(text)
  if (url) {
    text = (url[1] as string).replace(/\.pdf$/i, '').replace(/\/+$/, '')
  } else {
    text = text.replace(/^arxiv:/i, '')
  }
  return NEW_ID.test(text) || OLD_ID.test(text) ? text : null
}

export function arxivPdfUrl(id: string): string {
  return `https://arxiv.org/pdf/${id}`
}
