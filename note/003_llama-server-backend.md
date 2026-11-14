# 003 llama-server との通信

## 1. 目的

組み立てた PFML3 の文字列を llama-server へ送り、訳文を受け取る処理が必要です。
翻訳の依頼先は将来差し替える予定(Ollama、ブラウザ内推論)なので、依頼先に共通の型も同時に定めます。

## 2. 変更内容

| ファイル | 内容 |
| --- | --- |
| `src/translate/backend.ts` | 依頼先に共通の型。`TranslatorBackend`(`info` と `translate` を持つ)、依頼と結果の型 |
| `src/translate/llamaServer.ts` | llama-server 版の実装 `LlamaServerBackend` と、エラーの型 `LlamaServerError` |
| `tests/translate/llamaServer.test.ts` | 模擬サーバーを使った単体テスト 11 件 |

`translate` は `/completion` へ依頼を送り、逐次届く訳文をつなげて返します。
`info` は `/props` から、モデル名、同時に処理できる数、文脈の長さを読み取ります。

## 3. 設計判断

- 送り先は `/completion` にしました。OpenAI 互換の `/v1/completions` は選びませんでした。PFN 公式 CLI(`pfnet/plamo-translate-cli`)が `/completion` を使っており、生成速度などの計測値を同じ応答から読めるためです。
- 依頼の項目(`temperature: 0`、`top_p: 1`、`min_p: 0`、`stop: []`、`cache_prompt: false`)は、PFN 公式 CLI の実装に合わせました。モデルカードは停止文字列を 2 つ指定する例を示していますが、公式 CLI は PLaMo 3 では停止文字列を空にしています。食い違う箇所は実装の側に従いました。
- 上限に達して訳文が途中で切れた場合は、エラーにせず `stopReason: 'limit'` を返します。呼び出し側が段落を分割して再依頼できるようにするためです。
- 逐次届く応答の解釈は自作しました。ライブラリは入れていません。必要な処理は「`data:` で始まる行を取り出す」だけで、依存を増やす利点が小さいためです。
- 取り消しの合図(`AbortSignal`)による中断は、接続エラーと区別して、そのまま呼び出し側へ伝えます。

## 4. 動作確認

- `npm test`: 28 件すべて成功(本機能の 11 件と、既存の 17 件)。
- `npm run build`: 成功。
- テストの内容: 正常な応答、文字の途中での通信の分割、終了トークンの除去、上限での停止、サーバーからのエラー、HTTP のエラー、途中での切断、取り消し、接続不能、`/props` の読み取り。
- 実物の llama-server に対する動作: 未確認。llama.cpp が未導入のためです。テストは、応答形式をまねた模擬サーバーに対するものです。

## 5. 注意点・残課題

- `/completion` の応答の項目名(`content`、`stop`、`stop_type`、`truncated`、`tokens_evaluated`、`tokens_predicted`、`timings`)は、PFN 公式 CLI のソースと llama.cpp の README の記述に基づきます。`/props` の項目名(`total_slots`、`model_alias`、`model_path`、`default_generation_settings.n_ctx`)は、実物での確認ができていません。
- llama.cpp を導入したら、実物の応答で項目名を確かめる必要があります。
