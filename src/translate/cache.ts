/**
 * 訳文の保存。ブラウザ内蔵のデータベース(IndexedDB)に置く。
 *
 * 引くための鍵は、「モデルの名前、生成の設定、依頼の文字列全体」から計算したハッシュ値である。
 * 依頼の文字列そのものを鍵に含めるため、段落の検出の方法を変えても、古い訳文が誤って使われない。
 */

import type { TranslateRequest } from './backend.ts'
import { buildPfml3Prompt } from './pfml3.ts'

/**
 * 生成の設定の版。llamaServer.ts が送る生成の項目(温度など)を変えたら、この値も変える。
 * 変えると、それまでに保存した訳文は使われなくなる。
 */
export const GENERATION_SETTINGS_VERSION = 'greedy-1'

const DATABASE_NAME = 'translated-paper-pdf-viewer'
const STORE_NAME = 'translations'

export interface CachedTranslation {
  text: string
  /** 保存した時刻(ミリ秒)。 */
  savedAt: number
}

/** 保存と取り出しに使う鍵の、もとになる文字列。 */
export function cacheKeySource(modelId: string, request: TranslateRequest): string {
  const { maxTokens, ...pfml3 } = request
  return [modelId, GENERATION_SETTINGS_VERSION, `maxTokens=${maxTokens}`, buildPfml3Prompt(pfml3)].join('\n')
}

export async function cacheKey(modelId: string, request: TranslateRequest): Promise<string> {
  const bytes = new TextEncoder().encode(cacheKeySource(modelId, request))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB の操作に失敗しました'))
  })
}

export interface TranslationCache {
  get(key: string): Promise<CachedTranslation | undefined>
  set(key: string, value: CachedTranslation): Promise<void>
}

/**
 * 保存先を開く。IndexedDB が使えない場合(プライベートウィンドウなど)は、何も保存しない保存先を返す。
 * その場合も、翻訳は動く。
 */
export async function openTranslationCache(): Promise<TranslationCache> {
  try {
    const open = indexedDB.open(DATABASE_NAME, 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(STORE_NAME)
    }
    const database = await promisify(open)
    return {
      async get(key) {
        const store = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)
        return (await promisify(store.get(key))) as CachedTranslation | undefined
      },
      async set(key, value) {
        const store = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME)
        await promisify(store.put(value, key))
      },
    }
  } catch {
    return {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    }
  }
}
