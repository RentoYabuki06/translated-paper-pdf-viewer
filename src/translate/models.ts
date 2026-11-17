/**
 * PLaMo 3 Translate のモデルの一覧と、モデルの名前。
 *
 * 起動用のコマンド(scripts/llama.ts)と、Web アプリの両方が使う。
 * アプリは、訳文を、モデルの名前ごとに分けて保存する(cache.ts)。
 */

/** PFN が公開している PLaMo 3 Translate の大きさ。 */
export const MODEL_SIZES = ['0.8b', '2b', '8b', '31b'] as const
export type ModelSize = (typeof MODEL_SIZES)[number]

export const DEFAULT_MODEL_SIZE: ModelSize = '2b'
/** 量子化の種類。PFN がモデルカードで既定として勧めている形式。 */
export const DEFAULT_QUANT = 'Q4_K_M'

export function isModelSize(value: string): value is ModelSize {
  return (MODEL_SIZES as readonly string[]).includes(value)
}

/**
 * llama-server に付ける、モデルの別名。大きさと量子化の種類を含める。例: plamo-3-translate-2b-Q4_K_M
 *
 * 別名に大きさと量子化の種類が入っていないと、モデルを替えても、前のモデルの訳文が使われてしまう。
 * アプリは、別名がこの形かどうかで、npm run model で起動した llama-server かどうかも確かめる(settings.ts)。
 */
export function modelAlias(size: ModelSize, quant: string): string {
  return `plamo-3-translate-${size}-${quant}`
}

/** npm run model が、既定の量子化の種類で付ける別名の一覧。大きさの小さい順。 */
export function launcherModelIds(): string[] {
  return MODEL_SIZES.map((size) => modelAlias(size, DEFAULT_QUANT))
}

/**
 * モデルの名前を、画面に出す短い名前にする。
 * npm run model が付けた別名は、大きさだけにする(既定でない量子化の種類は、かっこで足す)。それ以外は、そのまま返す。
 */
export function shortModelLabel(modelId: string): string {
  const match = /^plamo-3-translate-([0-9.]+b)-([A-Za-z0-9_]+)$/.exec(modelId)
  if (!match) return modelId
  const [, size, quant] = match
  return quant === DEFAULT_QUANT ? (size as string) : `${size}(${quant})`
}

const KNOWN_MODELS_KEY = 'knownModels'
/** 覚えておくモデルの名前の数の上限。 */
const MAX_KNOWN_MODELS = 20

/** 保存されていた値を、モデルの名前の並びに直す。 */
export function normalizeKnownModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names = (value as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return [...new Set(names)].slice(0, MAX_KNOWN_MODELS)
}

/** このブラウザで、PDF の翻訳に使ったことのあるモデルの名前。 */
export function loadKnownModels(): string[] {
  try {
    const stored = localStorage.getItem(KNOWN_MODELS_KEY)
    return normalizeKnownModels(stored ? JSON.parse(stored) : null)
  } catch {
    return []
  }
}

/** PDF の翻訳に使ったモデルの名前を、覚えておく。訳文を比べる画面で、候補として使う。 */
export function rememberModel(modelId: string): void {
  try {
    const next = normalizeKnownModels([modelId, ...loadKnownModels()])
    localStorage.setItem(KNOWN_MODELS_KEY, JSON.stringify(next))
  } catch {
    // 保存できない場合は、覚えない。訳文を比べる画面の候補が減るだけである。
  }
}

/**
 * 訳文を比べる画面で、保存した訳文を探すモデルの名前の候補。
 *
 * 保存した訳文は、鍵がハッシュ値なので、どのモデルのものがあるかを、保存先からは調べられない。
 * そこで、npm run model が付ける別名(既定の量子化の種類)と、このブラウザで使ったことのある名前を、候補にする。
 * 並びは、npm run model の別名(大きさの小さい順)、そのほかの名前の順。
 */
export function candidateModelIds(known: readonly string[]): string[] {
  return [...new Set([...launcherModelIds(), ...known])]
}
