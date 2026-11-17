/**
 * 訳文を比べる画面の、列(モデル)についての処理。
 */

/** 比べる画面の 1 行のうち、この処理が使う部分。 */
interface RowLike {
  /** モデルごとの訳文。保存されていなければ null。 */
  translations: readonly (string | null)[]
}

/**
 * 訳文の列が、前にある別のモデルの列と、すべての行で同じモデルを探す。
 * 返すのは、モデルの名前から、同じ列を持つ前のモデルの名前への対応。
 * 同じモデルに別の名前が付いている場合(llama-server の別名を変える前と後など)に当たる。
 * 比べる画面は、ここで見つけたモデルを、初めは表示しない。同じ訳文の列が 2 つ並ぶのを防ぐためである。
 */
export function duplicateColumns(modelIds: readonly string[], rows: readonly RowLike[]): Map<string, string> {
  const duplicates = new Map<string, string>()
  modelIds.forEach((id, index) => {
    for (let earlier = 0; earlier < index; earlier += 1) {
      const earlierId = modelIds[earlier] as string
      // すでに重複と分かっている列とは、比べない。対応は、いちばん前にある列に付ける。
      if (duplicates.has(earlierId)) continue
      if (rows.every((row) => (row.translations[index] ?? null) === (row.translations[earlier] ?? null))) {
        duplicates.set(id, earlierId)
        break
      }
    }
  })
  return duplicates
}
