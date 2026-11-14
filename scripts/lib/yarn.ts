/**
 * llama-server に渡す、位置符号化(YaRN)の補正オプションを計算する。
 *
 * 背景: PLaMo 3 の GGUF は `yarn_truncate = false` を指定しており、補正を掛ける次元の範囲が
 * 小数(2B では 13.96 から 30.02)になる。llama.cpp はこの指定をまだ反映せず、範囲を整数へ
 * 広げて 13 から 31 として扱う。その誤差は入力が長いほど大きくなる。
 * 範囲の両端が最も近い整数(14 と 30)になるような beta の値を渡すと、誤差を抑えられる。
 *
 * この計算は、PFN 公式 CLI(pfnet/plamo-translate-cli、Apache License 2.0)の
 * `src/plamo_translate/servers/llama_cpp/server.py` にある `yarn_range_arguments` を移植したもの。
 * llama.cpp が `yarn_truncate` に対応したら、このオプションは外す。
 */

/**
 * GGUF の先頭部分に書かれた情報。キーは "plamo3.rope.freq_base" のような文字列。
 * GGUF を読むライブラリは、キーごとに型の付いたオブジェクトを返す。
 * その型をそのまま受け取れるよう、引数の型は object にしている。
 */
export type GgufMetadata = object

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  return undefined
}

/** Python の `%.8g` と同じく、有効数字 8 桁で表し、末尾の 0 を落とす。 */
function formatBeta(value: number): string {
  return String(Number(value.toPrecision(8)))
}

/**
 * GGUF の情報から `--yarn-beta-fast` と `--yarn-beta-slow` の引数を作る。
 * 補正が不要な場合と、必要な情報が欠けている場合は空の配列を返す。
 */
export function yarnRangeArguments(metadata: GgufMetadata): string[] {
  const values = metadata as Readonly<Record<string, unknown>>
  const architecture = values['general.architecture']
  if (typeof architecture !== 'string') return []

  const scaling = `${architecture}.rope.scaling.`
  if (values[`${scaling}type`] !== 'yarn') return []
  // 指定が無い場合の既定は「整数に丸める」であり、llama.cpp の動作と一致するので補正は要らない。
  if (values[`${scaling}yarn_truncate`] !== false) return []

  const dimensions =
    toNumber(values[`${architecture}.rope.dimension_count`]) ??
    toNumber(values[`${architecture}.attention.key_length`])
  const original = toNumber(values[`${scaling}original_context_length`])
  const base = toNumber(values[`${architecture}.rope.freq_base`])
  if (!dimensions || !original || !base) return []

  const betaFast = toNumber(values[`${scaling}yarn_beta_fast`]) ?? 32
  const betaSlow = toNumber(values[`${scaling}yarn_beta_slow`]) ?? 1

  // llama.cpp の ggml_rope_yarn_corr_dim と同じ式。beta から、補正を掛ける次元の境界を求める。
  const scale = dimensions / (2 * Math.log(base))
  const boundary = (beta: number) => scale * Math.log(original / (beta * 2 * Math.PI))

  // 境界を最も近い整数のわずかに内側へ寄せる。llama.cpp の切り捨てと切り上げが、その整数に落ちる。
  const low = Math.round(boundary(betaFast)) + 0.001
  const high = Math.round(boundary(betaSlow)) - 0.001
  if (!(low > 0 && low < high)) return []

  // 上の式の逆算。次元の境界から beta を求める。
  const betaOf = (dimension: number) => original / (2 * Math.PI * Math.exp(dimension / scale))
  return ['--yarn-beta-fast', formatBeta(betaOf(low)), '--yarn-beta-slow', formatBeta(betaOf(high))]
}
