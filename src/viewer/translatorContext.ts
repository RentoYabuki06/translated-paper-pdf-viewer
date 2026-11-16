/**
 * 翻訳サーバーの設定と、接続の状態を、画面の部品の間で共有するための入れ物。
 * 中身を用意する部品は TranslatorProvider.tsx にある。
 */

import { createContext, useContext } from 'react'
import type { BackendInfo, TranslatorBackend } from '../translate/backend.ts'
import type { TranslatorSettings } from '../translate/settings.ts'

/** 接続の状態。 */
export type Connection =
  | { state: 'idle' }
  | { state: 'checking' }
  /** warnings は、接続はできたが、利用者に知らせておく注意。 */
  | { state: 'ok'; info: BackendInfo; warnings: string[] }
  | { state: 'error'; message: string }

/** 接続を確かめた結果。成功した場合は、そのまま翻訳に使える依頼先を含む。 */
export type CheckResult =
  | { ok: true; info: BackendInfo; backend: TranslatorBackend }
  | { ok: false; message: string }

export interface TranslatorContextValue {
  settings: TranslatorSettings
  /** 設定の一部を変える。変えた設定は保存され、接続の状態は「まだ確かめていない」に戻る。 */
  updateSettings: (patch: Partial<TranslatorSettings>) => void
  connection: Connection
  /** Ollama に入っているモデルの名前。取得していない場合や、取得できなかった場合は null。 */
  ollamaModels: string[] | null
  /** いまの設定で、接続を確かめる。 */
  check: () => Promise<CheckResult>
}

export const TranslatorContext = createContext<TranslatorContextValue | null>(null)

export function useTranslator(): TranslatorContextValue {
  const value = useContext(TranslatorContext)
  if (!value) throw new Error('TranslatorProvider の外で useTranslator が呼ばれました')
  return value
}
