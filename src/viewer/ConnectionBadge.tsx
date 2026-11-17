/** 翻訳サーバーとの接続の状態を、短く表示する。押すと、設定の画面に切り替わる。 */

import { describeTarget } from '../translate/settings.ts'
import { useTranslator } from './translatorContext.ts'

export function ConnectionBadge({ onOpen }: { onOpen: () => void }) {
  const { settings, connection } = useTranslator()
  const text =
    connection.state === 'ok'
      ? `接続済み: ${connection.info.modelId}`
      : connection.state === 'error'
        ? '接続できません'
        : connection.state === 'checking'
          ? '確かめています…'
          : '未確認'
  return (
    <button type="button" className={`badge ${connection.state}`} onClick={onOpen} title="翻訳サーバーの設定を開く">
      {describeTarget(settings)} — {text}
    </button>
  )
}
