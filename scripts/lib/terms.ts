/**
 * 訳文に、指定した訳語が使われているかを、文字列の一致で調べる。用語集の実験(probe-glossary.ts)で使う。
 */

export interface TermCheck {
  /** 含まれているはずの文字列がすべてあり、含まれていてはいけない文字列が 1 つも無い場合に true。 */
  ok: boolean
  /** 含まれているはずなのに、訳文に無い文字列。 */
  missing: string[]
  /** 含まれていてはいけないのに、訳文にある文字列。 */
  unwanted: string[]
}

export function checkTerms(translation: string, expect: readonly string[], avoid: readonly string[]): TermCheck {
  const missing = expect.filter((term) => !translation.includes(term))
  const unwanted = avoid.filter((term) => translation.includes(term))
  return { ok: missing.length === 0 && unwanted.length === 0, missing, unwanted }
}

/** 調べた結果を、短い文字列にする。 */
export function describeTermCheck(check: TermCheck): string {
  if (check.ok) return '指定どおり'
  const parts = [
    ...check.missing.map((term) => `「${term}」が無い`),
    ...check.unwanted.map((term) => `「${term}」がある`),
  ]
  return `指定と違う: ${parts.join('、')}`
}
