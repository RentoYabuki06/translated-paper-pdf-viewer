# 018 Ollama へ翻訳を依頼する処理

## 1. 目的

翻訳の依頼先として、llama-server のほかに、Ollama(言語モデルを動かすソフト)を使えるようにします。
すでに Ollama を使っている人が、llama.cpp を別に導入しなくても試せるようにするためです。
計画のマイルストーン M7 のうち、「別の実行ソフト(Ollama)への対応」に当たります。
この変更は、依頼の処理だけを足します。画面から依頼先を選ぶ機能は、次の変更(`note/019_server-settings.md`)で足します。

## 2. 変更内容

| ファイル | 内容 |
| --- | --- |
| `src/translate/ollama.ts` | 新規。Ollama へ翻訳を依頼する処理。llama-server 版と同じ型(`TranslatorBackend`)を実装する |
| `src/translate/streamLines.ts` | 新規。逐次届く応答を 1 行ずつ取り出す処理。`llamaServer.ts` から切り出した |
| `src/translate/llamaServer.ts` | 上の処理を使う形に変えた。動作は変えていない |
| `tests/translate/ollama.test.ts` | 新規。模擬サーバーに対するテスト 14 件 |

## 3. 設計判断

### 依頼の送り方

- 送り先は `/api/generate` です。PFML3 の文字列(PLaMo 3 Translate の入力の書式)を、`raw: true` を付けて、そのまま `prompt` として送ります。Ollama の説明書は、`raw` を「プロンプトに整形を適用しない」指定と説明しています。PFML3 の文字列は、すでに完成した入力なので、Ollama のテンプレートを通しません。
- 生成の設定は、llama-server 版と同じです(温度 0、`top_p` 1、`min_p` 0、`repeat_penalty` 1、`seed` 0)。
- 1 つの依頼で使う長さ(`num_ctx`)は、2,048 トークンを指定します。llama-server の 1 件あたりの長さ(8,192 を 4 件で分けた値)に合わせました。Ollama の既定は 4,096 トークンです。
- 訳文の終わりの印(`<|plamo:tag|>` など)を、停止文字列にも指定します。PLaMo 3 Translate は終了トークンで自分から生成を止めますが、Ollama で印が文字として出てくる場合に備えたものです。実際に必要かどうかは、確かめていません。

### 応答の読み方

- 応答は、1 行に 1 つの JSON が、逐次届きます。途中の行の `response` をつなぎ、`done` が `true` の行で終わりとします。
- 止まった理由は、最後の行の `done_reason` から決めます。`"stop"` は正常な終了、`"length"` は長さの上限に達した(訳文が途中で切れている)とします。Ollama は、終了トークンで止まった場合と、停止文字列で止まった場合を区別しません。
- `"length"` という値は、Ollama の説明書には載っていません。手元の Ollama に、生成の上限を 4 トークンにした依頼を送り、実際に返ることを確かめました。
- 生成の速度は、最後の行の `eval_count`(生成したトークン数)と `eval_duration`(ナノ秒)から計算します。
- エラーは、HTTP の状態コードと、`{"error": "…"}` の形の本文で届きます。この形も説明書には載っておらず、存在しないモデルを指定した依頼で確かめました。

### llama-server 版との違い

- **同時に処理できる依頼の数**: Ollama は、この数を応答で知らせません。利用者が指定した数を使います。既定は 1 です。Ollama の説明書によると、Ollama の側の既定(`OLLAMA_NUM_PARALLEL`)も 1 です。
- **依頼先の情報**: `/api/show` で、指定したモデルが Ollama にあることを確かめます。モデルが無い場合は、入っているモデルを確かめるよう案内します。
- **モデルの一覧**: `/api/tags` で、Ollama に入っているモデルの名前を取得できるようにしました。画面でモデルを選ぶために使います。
- **位置符号化の補正**: llama-server では、起動時に PLaMo 3 Translate 向けの補正の値を渡しています(`note/004_llama-launcher.md`)。Ollama には、この値を渡す手段が見つかりませんでした。長い入力で、訳の質が落ちる可能性があります。計画が llama-server を主な依頼先にしている理由の 1 つです。

### 行を読む処理の切り出し

- 応答を 1 行ずつ取り出す処理は、llama-server 版にもありました。同じ処理を 2 か所に書かないよう、`streamLines.ts` に切り出して、両方から使います。
- llama-server 版は、取り出した行のうち `data:` で始まる行だけを使います。この部分は、これまでどおりです。

## 4. 動作確認

環境は、macOS 26.6(Apple M5)、Node.js 26.13.1、Ollama 0.40.16 です。

- `npm test`: Ollama 版のテスト 14 件と、llama-server 版の既存のテスト 11 件が成功。
- API の仕様: Ollama の説明書(`docs/api.md`、`docs.ollama.com` の FAQ と取り込みの説明)で、`/api/generate` の項目、応答の項目、`/api/tags`、`/api/show`、`/api/version` を確かめました。
- 実際の応答: 手元の Ollama に `curl` で依頼を送り、次を確かめました。モデルは、手元に入っていた `llama3.1:8b` を使いました。
  - 逐次の応答が、1 行に 1 つの JSON で届くこと。途中の行は `response` と `done: false`、最後の行は `done: true`、`done_reason`、`prompt_eval_count`、`eval_count`、`eval_duration` を持つこと。
  - 生成の上限で止まると、`done_reason` が `"length"` になること。
  - 存在しないモデルでは、HTTP 404 と `{"error": "model '…' not found"}` が返ること。
  - `/api/show` の応答が `model_info`、`details` を持つこと。`/api/tags` の応答が `models` の配列で、各要素が `name` を持つこと。
  - ブラウザのページ(`http://localhost:5173`)からの呼び出しが許可されること(応答に `Access-Control-Allow-Origin` が付く)。

### 未確認

- **PLaMo 3 Translate を Ollama で動かすこと。** 手元の Ollama には、PLaMo 3 Translate のモデルが入っていません。Ollama 0.40.16 が、このモデルのファイルを読み込めるかどうかも、確かめていません。上の確認は、すべて別のモデルで行った、通信の形の確認です。
- `raw: true` のときに、Ollama が文頭の印(`<|plamo:bos|>`)を付けるかどうか。llama-server は自動で付けます。
- 同時に依頼する数を 2 以上にした場合の動作。
- 訳文の質と、生成の速度。

## 5. 注意点・残課題

- Ollama で PLaMo 3 Translate を使うには、モデルを Ollama に入れておく必要があります。Ollama の説明書には、手元のモデルのファイルから作る方法(`FROM` にファイルのパスを書いた Modelfile と、`ollama create`)が載っています。この手順は、試していません。
- Ollama のモデルの名前と、同時に依頼する数は、利用者が指定します。
