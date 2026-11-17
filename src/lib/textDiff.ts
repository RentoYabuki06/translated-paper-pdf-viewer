/**
 * 2 つの文字列を比べ、片方を、もう片方と同じ部分と、違う部分に分ける。
 * 訳文を比べる画面で、基準にするモデルの訳文と違う部分に、色を付けるために使う。
 *
 * 比べる単位は 1 文字。ただし、数式の目印(<m1> など)は、1 つの単位として扱い、途中で分けない。
 * 同じ部分は、2 つの文字列に共通する、最も長い並び(最長共通部分列)として求める。
 */

export interface DiffSegment {
  text: string
  /** 基準の文字列には無い部分の場合に true。 */
  changed: boolean
}

/** 比べる単位に分ける。数式の目印は 1 つの単位、それ以外は 1 文字ずつ。 */
function tokenize(text: string): string[] {
  return text.match(/<\/?m\d+>|[\s\S]/gu) ?? []
}

/**
 * other を、base と同じ部分と、違う部分に分けて返す。返した部分を順につなぐと、other に戻る。
 *
 * 違う部分にはさまれた、ごく短い同じ部分(minSame 未満の単位)は、違う部分にまとめる。
 * 助詞などが 1 文字だけ偶然に一致して、色がまだらになるのを防ぐためである。数式の目印は、短くてもまとめない。
 */
export function markDifferences(base: string, other: string, minSame = 2): DiffSegment[] {
  const a = tokenize(base)
  const b = tokenize(other)
  if (b.length === 0) return []

  // 前と後ろの共通の部分は、先に取り除く。表を小さくするためである。
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1

  const rows = a.length - head - tail
  const columns = b.length - head - tail
  /** b の各単位が、base と同じ部分に入るかどうか。 */
  const same = new Array<boolean>(b.length).fill(false)
  for (let index = 0; index < head; index += 1) same[index] = true
  for (let index = 0; index < tail; index += 1) same[b.length - 1 - index] = true

  if (rows > 0 && columns > 0) {
    // lengths[i * width + j] は、a の i 番目以降と、b の j 番目以降の、最長共通部分列の長さ。
    const width = columns + 1
    const lengths = new Uint32Array((rows + 1) * width)
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = columns - 1; j >= 0; j -= 1) {
        lengths[i * width + j] =
          a[head + i] === b[head + j]
            ? (lengths[(i + 1) * width + j + 1] as number) + 1
            : Math.max(lengths[(i + 1) * width + j] as number, lengths[i * width + j + 1] as number)
      }
    }
    let i = 0
    let j = 0
    while (i < rows && j < columns) {
      if (a[head + i] === b[head + j]) {
        same[head + j] = true
        i += 1
        j += 1
      } else if ((lengths[(i + 1) * width + j] as number) >= (lengths[i * width + j + 1] as number)) {
        i += 1
      } else {
        j += 1
      }
    }
  }

  // 違う部分にはさまれた、ごく短い同じ部分を、違う部分にまとめる。
  let start = 0
  while (start < b.length) {
    let end = start
    while (end < b.length && same[end] === same[start]) end += 1
    const isolated = same[start] === true && start > 0 && end < b.length
    const hasTag = b.slice(start, end).some((token) => token.length > 1 && token.startsWith('<'))
    if (isolated && end - start < minSame && !hasTag) {
      for (let index = start; index < end; index += 1) same[index] = false
    }
    start = end
  }

  const segments: DiffSegment[] = []
  for (const [index, token] of b.entries()) {
    const changed = same[index] !== true
    const last = segments.at(-1)
    if (last && last.changed === changed) last.text += token
    else segments.push({ text: token, changed })
  }
  return segments
}
