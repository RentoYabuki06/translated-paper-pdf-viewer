/**
 * 翻訳サーバーの設定と、接続の状態を確かめる画面。
 *
 * 翻訳を依頼するソフト(llama-server か Ollama)と、その URL を選ぶ。
 * 「接続を確かめる」で、モデルの名前、同時に処理できる依頼の数、1 件の依頼で使える長さを表示する。
 * うまくいかない場合は、確かめる点を案内する。
 */

import { MAX_OLLAMA_PARALLEL } from '../translate/settings.ts'
import type { BackendKind } from '../translate/settings.ts'
import { useTranslator } from './translatorContext.ts'

const KINDS: { kind: BackendKind; label: string; description: string }[] = [
  {
    kind: 'llama-server',
    label: 'llama-server',
    description: 'npm run model で起動する、llama.cpp 付属のサーバー。このアプリが主に対応しているソフトです。',
  },
  {
    kind: 'ollama',
    label: 'Ollama',
    description:
      'すでに Ollama を使っている場合の、代わりの依頼先です。PLaMo 3 Translate のモデルを、Ollama に入れておく必要があります(入れ方は、README の「Ollama を使う場合」)。',
  },
]

/** 接続できなかったときに、確かめる点。 */
const HINTS: Record<BackendKind, string[]> = {
  'llama-server': [
    'llama-server が起動しているかを確かめます。別のターミナルで npm run model を実行し、起動したままにします。',
    'URL のポート番号が、llama-server を起動したときの番号と同じかを確かめます。npm run model -- --port 8081 で起動した場合は、http://127.0.0.1:8081 です。',
    '「HTTP 404」や「解釈できません」と表示される場合は、llama-server ではない別のソフトが、その URL で応答している可能性があります。',
  ],
  ollama: [
    'Ollama が起動しているかを確かめます。',
    'モデルの名前が、ollama list に表示される名前と同じかを確かめます。',
    'URL のポート番号を確かめます。Ollama の既定は http://127.0.0.1:11434 です。',
  ],
}

export function ServerPanel() {
  const { settings, updateSettings, connection, ollamaModels, check } = useTranslator()
  const checking = connection.state === 'checking'

  return (
    <>
      <p>翻訳を依頼するソフトと、その URL を設定します。設定は、このブラウザに保存されます。</p>

      <section className="panel">
        <fieldset className="choices">
          <legend>翻訳を依頼するソフト</legend>
          {KINDS.map(({ kind, label, description }) => (
            <label key={kind} className="choice">
              <input type="radio" name="backend-kind" checked={settings.kind === kind} onChange={() => updateSettings({ kind })} />
              <span>
                <strong>{label}</strong>
                <span className="status">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      {settings.kind === 'llama-server' ? (
        <section className="panel">
          <label htmlFor="llama-server-url">llama-server の URL</label>
          <input
            id="llama-server-url"
            type="url"
            className="wide"
            value={settings.llamaServerUrl}
            onChange={(event) => updateSettings({ llamaServerUrl: event.target.value })}
            spellCheck={false}
          />
          <p className="status">
            既定は http://127.0.0.1:8080 です。同時に処理できる依頼の数と、1 件の依頼で使える長さは、llama-server
            が知らせる値を使います。
          </p>
        </section>
      ) : (
        <section className="panel">
          <label htmlFor="ollama-url">Ollama の URL</label>
          <input
            id="ollama-url"
            type="url"
            className="wide"
            value={settings.ollamaUrl}
            onChange={(event) => updateSettings({ ollamaUrl: event.target.value })}
            spellCheck={false}
          />
          <label htmlFor="ollama-model">モデルの名前</label>
          <input
            id="ollama-model"
            type="text"
            className="wide"
            list="ollama-models"
            value={settings.ollamaModel}
            onChange={(event) => updateSettings({ ollamaModel: event.target.value })}
            placeholder="ollama list に表示される名前"
            spellCheck={false}
          />
          <datalist id="ollama-models">
            {(ollamaModels ?? []).map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {ollamaModels && (
            <p className="status">
              Ollama に入っているモデル: {ollamaModels.length > 0 ? ollamaModels.join('、') : '(ありません)'}
            </p>
          )}
          <label htmlFor="ollama-parallel">同時に依頼する数</label>
          <input
            id="ollama-parallel"
            type="number"
            min={1}
            max={MAX_OLLAMA_PARALLEL}
            value={settings.ollamaParallel}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isInteger(value) && value >= 1 && value <= MAX_OLLAMA_PARALLEL) updateSettings({ ollamaParallel: value })
            }}
          />
          <p className="status">
            Ollama は、同時に処理できる依頼の数を知らせません。Ollama の設定(OLLAMA_NUM_PARALLEL。既定は
            1)に合わせて指定します。設定より大きい数を指定しても、Ollama の側で順番待ちになるだけで、速くはなりません。
          </p>
          <p className="status">
            Ollama には、llama-server の起動時に渡している PLaMo 3 Translate
            向けの補正を渡せません。そのため、一部の段落で、訳文が llama-server のものと変わります。
          </p>
        </section>
      )}

      <section className="panel">
        <div className="row">
          <button type="button" className="primary" onClick={() => void check()} disabled={checking}>
            接続を確かめる
          </button>
        </div>
        <div className="connection" role="status">
          {connection.state === 'idle' && <p className="status">接続は、まだ確かめていません。</p>}
          {connection.state === 'checking' && <p className="status">確かめています…</p>}
          {connection.state === 'ok' && (
            <>
              <p className="ok">接続できました。</p>
              <dl className="facts">
                <dt>モデル</dt>
                <dd>{connection.info.modelId}</dd>
                <dt>同時に処理できる依頼</dt>
                <dd>{connection.info.slots} 件</dd>
                <dt>1 件の依頼で使える長さ</dt>
                <dd>{connection.info.contextPerSlot === null ? '不明' : `${connection.info.contextPerSlot} トークン`}</dd>
              </dl>
              {connection.warnings.length > 0 && (
                <ul className="warnings">
                  {connection.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {connection.state === 'error' && (
            <>
              <p className="error">{connection.message}</p>
              <p className="status">確かめる点:</p>
              <ul className="hints">
                {HINTS[settings.kind].map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </>
  )
}
