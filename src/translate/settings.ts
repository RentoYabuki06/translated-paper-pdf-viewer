/**
 * 翻訳サーバーの設定。どのソフト(llama-server か Ollama)に、どの URL で依頼するかを持つ。
 * 設定は、ブラウザの localStorage に保存する。
 */

import type { BackendInfo, TranslatorBackend } from './backend.ts'
import { DEFAULT_LLAMA_SERVER_URL, LlamaServerBackend } from './llamaServer.ts'
import { DEFAULT_OLLAMA_URL, OllamaBackend } from './ollama.ts'

export type BackendKind = 'llama-server' | 'ollama'

export interface TranslatorSettings {
  /** 翻訳を依頼するソフト。 */
  kind: BackendKind
  llamaServerUrl: string
  ollamaUrl: string
  /** Ollama で使うモデルの名前(ollama list に出る名前)。 */
  ollamaModel: string
  /** Ollama に同時に依頼する数。Ollama の設定(OLLAMA_NUM_PARALLEL)に合わせる。 */
  ollamaParallel: number
}

export const DEFAULT_SETTINGS: TranslatorSettings = {
  kind: 'llama-server',
  llamaServerUrl: DEFAULT_LLAMA_SERVER_URL,
  ollamaUrl: DEFAULT_OLLAMA_URL,
  ollamaModel: '',
  ollamaParallel: 1,
}

/** Ollama に同時に依頼する数の上限。 */
export const MAX_OLLAMA_PARALLEL = 8

const STORAGE_KEY = 'translatorSettings'
/** 以前の版が、llama-server の URL だけを保存していたときの名前。 */
const LEGACY_URL_KEY = 'llamaServerUrl'

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

/**
 * 保存されていた値を、設定の形に直す。欠けている項目や、正しくない値は、既定の値で補う。
 * legacyUrl には、以前の版が保存した llama-server の URL を渡す。設定が保存されていない場合に、これを使う。
 */
export function normalizeSettings(value: unknown, legacyUrl?: string | null): TranslatorSettings {
  const source = (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const parallel = source.ollamaParallel
  return {
    kind: source.kind === 'ollama' ? 'ollama' : 'llama-server',
    llamaServerUrl: stringOr(source.llamaServerUrl, stringOr(legacyUrl, DEFAULT_SETTINGS.llamaServerUrl)),
    ollamaUrl: stringOr(source.ollamaUrl, DEFAULT_SETTINGS.ollamaUrl),
    ollamaModel: typeof source.ollamaModel === 'string' ? source.ollamaModel.trim() : '',
    ollamaParallel:
      typeof parallel === 'number' && Number.isInteger(parallel) && parallel >= 1 && parallel <= MAX_OLLAMA_PARALLEL
        ? parallel
        : DEFAULT_SETTINGS.ollamaParallel,
  }
}

export function loadSettings(): TranslatorSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return normalizeSettings(stored ? JSON.parse(stored) : null, localStorage.getItem(LEGACY_URL_KEY))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: TranslatorSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 保存できない場合(プライベートウィンドウなど)は、今回の設定だけを使う。
  }
}

/** 設定に合わせて、翻訳の依頼先を作る。 */
export function createBackend(settings: TranslatorSettings): TranslatorBackend {
  return settings.kind === 'ollama'
    ? new OllamaBackend({ baseUrl: settings.ollamaUrl, model: settings.ollamaModel, parallel: settings.ollamaParallel })
    : new LlamaServerBackend({ baseUrl: settings.llamaServerUrl })
}

/** 依頼先を、画面に出す短い文字列にする。 */
export function describeTarget(settings: TranslatorSettings): string {
  return settings.kind === 'ollama' ? `Ollama(${settings.ollamaUrl})` : `llama-server(${settings.llamaServerUrl})`
}

/**
 * npm run model が llama-server に付ける、モデルの別名の形(scripts/lib/llamaArgs.ts の modelAlias)。
 * 大きさと量子化の種類を含む。例: plamo-3-translate-2b-Q4_K_M
 */
const LAUNCHER_ALIAS = /^plamo-3-translate-[0-9.]+b-[A-Za-z0-9_]+$/
/** 以前の版の npm run model が付けていた別名。大きさと量子化の種類を含まない。 */
const LEGACY_LAUNCHER_ALIAS = 'plamo-3-translate'
/** 1 件の依頼に必要な、入出力の長さの目安(トークン数)。 */
const REQUIRED_CONTEXT = 2048

/**
 * 接続できた依頼先について、利用者に知らせておく注意を返す。問題が無ければ、空の配列を返す。
 */
export function connectionWarnings(kind: BackendKind, info: BackendInfo): string[] {
  const warnings: string[] = []
  if (!/plamo/i.test(info.modelId)) {
    warnings.push(
      `モデルの名前(${info.modelId})に「plamo」が含まれていません。PLaMo 3 Translate 以外のモデルでは、依頼の書式が合わず、正しく訳されません。`,
    )
  } else if (kind === 'llama-server' && info.modelId === LEGACY_LAUNCHER_ALIAS) {
    warnings.push(
      `モデルの別名(${info.modelId})に、モデルの大きさが入っていません。以前の版の npm run model で起動した llama-server です。このままでは、モデルの大きさを替えても、保存した訳文が区別されません。llama-server を起動し直してください。`,
    )
  } else if (kind === 'llama-server' && !LAUNCHER_ALIAS.test(info.modelId)) {
    warnings.push(
      `モデルの別名(${info.modelId})が、npm run model が付ける形(plamo-3-translate-2b-Q4_K_M など)ではありません。npm run model 以外の方法で起動した llama-server では、PLaMo 3 Translate に必要な起動時の指定が付いていない可能性があります。`,
    )
  }
  if (info.contextPerSlot !== null && info.contextPerSlot < REQUIRED_CONTEXT) {
    warnings.push(
      `1 件の依頼で使える長さが ${info.contextPerSlot} トークンです。${REQUIRED_CONTEXT} トークンより短いと、長い段落の訳文が途中で切れることがあります。`,
    )
  }
  return warnings
}
