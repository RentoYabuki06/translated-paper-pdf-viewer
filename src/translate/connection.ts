/**
 * 翻訳サーバーとの接続を確かめる。
 *
 * 指定した URL で別のソフトが待ち受けていると、接続は受け付けられるが、応答が返らないことがある。
 * 確認が終わらないままにならないよう、待つ時間に上限を設ける。
 */

import type { BackendInfo, TranslatorBackend } from './backend.ts'

/** 応答を待つ時間の上限(ミリ秒)。 */
export const CONNECTION_TIMEOUT_MS = 8000

/**
 * 依頼先に接続できることを確かめ、依頼先の情報を返す。
 * target は、エラーの文言に入れる依頼先の呼び名(例: "llama-server(http://127.0.0.1:8080)")。
 */
export async function checkBackend(
  backend: Pick<TranslatorBackend, 'info'>,
  target: string,
  timeoutMs: number = CONNECTION_TIMEOUT_MS,
): Promise<BackendInfo> {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    return await backend.info(signal)
  } catch (error) {
    if (signal.aborted) {
      throw new Error(
        `${target} から、${Math.round(timeoutMs / 100) / 10} 秒待っても応答がありません。別のソフトが、その URL で待ち受けている可能性があります。`,
      )
    }
    throw error
  }
}
