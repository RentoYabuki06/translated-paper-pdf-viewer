# 翻訳論文 PDF ビューア

英語の論文 PDF を、ページのレイアウトを保ったまま日本語で読むための、ブラウザで動くアプリです。
元のページの上に、段落ごとの訳文を同じ位置に重ねて表示することを目指しています。
翻訳には、Preferred Networks(以下 PFN)が公開している翻訳専用の言語モデル **PLaMo 3 Translate** を使います[PFN モデルカード (2026/11), 冒頭]。
モデルは自分のパソコンの上で動かすため、論文の本文を外部の翻訳サービスへ送りません。

対象にする PDF は、arXiv(論文を公開するサイト)で配布されるものや出版社版のように、文字の情報を持つものです。
紙をスキャンした画像だけの PDF は対象にしません。

このアプリは開発の途中です。
**PDF を開いて訳文を表示する機能は、まだありません**。
いま動くものは「現在の状態」に書いています。

文中の角括弧は出典を示し、一覧は末尾の「出典」にあります。
出典の「モデルカード」は、モデルの配布ページに PFN が載せている説明書きです。

## 仕組み

次の 2 つを、同じパソコンの上で動かします。

| 部品 | 役割 |
| --- | --- |
| Web アプリ | ブラウザの中で動き、PDF の描画、段落の検出、訳文の重ね表示を受け持ちます(いずれも未実装) |
| llama-server | PLaMo 3 Translate を読み込み、翻訳を受け持ちます |

**llama-server** は、言語モデルを動かすソフト **llama.cpp** に付属する HTTP サーバーです[llama.cpp 1.0.0 (2026/11), tools/server/README.md]。
Web アプリは、llama-server(既定では `http://127.0.0.1:8080`)へ原文を送り、訳文を受け取る作りです。
この通信の処理は実装してありますが、画面からはまだ呼び出していません。

llama-server は、コマンド `npm run model` で起動します。
このコマンドは、モデルの指定と、PLaMo 3 Translate に必要なオプションを付けて llama-server を起動します。
オプションの内容と理由は [note/004_llama-launcher.md](note/004_llama-launcher.md) に書いています。

## 現在の状態

| 区分 | 内容 |
| --- | --- |
| 実装してあるもの | llama-server を起動するコマンド、llama-server へ翻訳を依頼する処理、実験用のコマンド 2 つ(`npm run probe:speed` と `npm run probe:placeholders`)、単体テスト |
| 動くことを確かめたもの | 「セットアップ」の手順 1 と手順 2、単体テスト、ビルド、**模擬サーバー**に対する実験用のコマンド、`npm run model -- --dry-run` |
| 確かめていないこと | 実物の llama-server を使う操作のすべて(手順 3、手順 4、実物の llama-server に対する実験用のコマンド)。開発に使っているパソコンに llama.cpp をまだ導入していないためです |
| まだ無いもの | PDF の表示、段落の検出、訳文の重ね表示、訳文の保存 |

実験用のコマンドは、生成の速度(モデルが訳文を出力する速さ)などを測るためのものです。
模擬サーバーは、llama-server の応答の形式をまねる開発用のサーバーです。
実験用のコマンドは、模擬サーバーへ依頼を送り、結果をターミナル(コマンドを入力して実行するアプリ)に表示するところまで動いています。

## 必要なもの

Web アプリを表示するまでに必要なものは、次のとおりです。

| 必要なもの | 説明 |
| --- | --- |
| Git | リポジトリの取得に使います |
| Node.js | JavaScript の実行環境です。Web アプリと、このリポジトリの各コマンドの実行に使います。版は、22 系(22.18 以上)、24 系、26 以上のいずれかです |
| Chrome | Web アプリを表示するブラウザです |
| インターネット接続 | このアプリが使うライブラリ(依存パッケージ)の取得に使います |

PLaMo 3 Translate を実際に動かす場合は、次のものも必要です。

| 必要なもの | 説明 |
| --- | --- |
| llama.cpp | PLaMo 3 Translate に対応した版が必要です。導入の方法は「セットアップ」の手順 3 に書いています |
| Homebrew | macOS 用のパッケージ管理ソフトです。macOS で llama.cpp を導入するときに使います |
| ディスクの空き 1.81 GB | 既定のモデルのファイルを保存します。ほかのモデルについては「モデルの大きさと起動時の指定」を見てください |
| インターネット接続 | モデルの取得に使います。llama-server を起動するたびにも使います |

Node.js の版の条件は、[package.json](package.json) の指定(22.18 以上)と、テストに使うライブラリ Vitest の対応範囲(22.12 以上の 22 系、24 系、26 以上)を合わせたものです。
「現在の状態」の「動くことを確かめたもの」は、macOS 26.6(Apple シリコン)、Node.js 26.13.0、npm 11.20.0、Chrome 157 で確かめました。
ほかの OS、ほかの版の Node.js、ほかのブラウザでは確かめていません。

## セットアップ

手順 1 と手順 2 で、Web アプリを表示できます。
手順 3 と手順 4 は、PLaMo 3 Translate を実際に動かすための準備です。
いまの Web アプリは翻訳を呼び出さないので、手順 3 と手順 4 が必要になるのは、実験用のコマンドを実物の llama-server に対して実行する場合だけです。
開発に使っているパソコンに llama.cpp をまだ導入していないため、手順 3 と手順 4 は実際に試せていません。
llama.cpp を導入せずに実験用のコマンドを試す方法は、「動作の確認」に書いています。

### 1. リポジトリを取得して、依存パッケージを入れる

```bash
git clone https://github.com/RentoYabuki06/translated-paper-pdf-viewer.git
cd translated-paper-pdf-viewer
npm install
```

このリポジトリは、2026 年 11 月の時点で非公開です。
取得するには、閲覧を許可された GitHub のアカウントでの認証が必要です。

`npm install` が終わると、`added 49 packages` のように、取得したパッケージの数が表示されます。
途中で `npm warn install-scripts` で始まる警告が出ることがあります。
この警告が出ても、そのまま次の手順へ進めます。

### 2. Web アプリを起動する

```bash
npm run dev
```

表示された URL(既定では `http://localhost:5173/`)を Chrome で開きます。
アプリの名前と説明文だけのページが表示されれば、ここまでの手順は成功です。
止めるときは、ターミナルで Ctrl+C を押します。

### 3. llama.cpp を導入する

macOS では、Homebrew で導入できます。

```bash
brew install llama.cpp
```

ほかの OS での導入の方法は、[llama.cpp の配布ページ](https://github.com/ggml-org/llama.cpp)を見てください。

導入できたかどうかは、次のコマンドで確かめます。
版の情報が表示されれば、導入できています。

```bash
llama-server --version
```

Homebrew で導入できる版は、2026 年 11 月 14 日の時点で 1.0.0 です[Homebrew (2026/11), llama.cpp]。
1.0.0 と 0.9.0 のソースコードには、PLaMo 3 を読み込む処理が含まれています[llama.cpp 1.0.0 (2026/11), src/models/plamo3.cpp]、[llama.cpp 0.9.0 (2026/11), src/models/plamo3.cpp]。
手順 4 のコマンドが渡すオプションも、1.0.0 のソースコードに含まれています[llama.cpp 1.0.0 (2026/11), common/arg.cpp]。
どちらの版も、実際に動かして確かめてはいません。
0.9.0 より古い版は調べていないので、その場合は更新してから進めてください。
Homebrew で導入した llama.cpp は、`brew upgrade llama.cpp` で更新できます。

### 4. llama-server を起動する

```bash
npm run model
```

このコマンドは、既定のモデル(`2b`)を読み込んだ llama-server を起動します。
npm 自身の表示に続いて、次の 2 行が表示されます。
2 行目は、ここでは途中を省略しています。

```text
モデルの情報を読んでいます: https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF/resolve/main/plamo-3-translate-2b-Q4_K_M.gguf
llama-server -hf pfnet/plamo-3-translate-2b-GGUF:Q4_K_M --alias plamo-3-translate ...
```

1 行目は、モデルの情報を Hugging Face(機械学習のモデルを配布するサイト)から読んでいることを示します。
2 行目は、これから実行する llama-server のコマンドです。
そのあとに、llama-server 自身の表示が続きます。

初回は、llama-server がモデルのファイルを Hugging Face から取得します[llama.cpp 1.0.0 (2026/11), common/arg.cpp]。
ファイルの大きさは 1.81 GB です[PFN モデルカード (2026/11), Usage]。
取得したファイルは、このリポジトリの中ではなく、llama.cpp の既定の場所である `~/.cache/huggingface/hub` に保存されます[llama.cpp 1.0.0 (2026/11), common/hf-cache.cpp]。

モデルの利用には、PLaMo コミュニティライセンス契約が適用されます[PLaMo コミュニティライセンス (2026/11), 前文]。
条件の概要は「ライセンス」に書いています。

準備ができたかどうかは、別のターミナルで次のコマンドを実行して確かめます。

```bash
curl http://127.0.0.1:8080/health
```

llama.cpp の説明書によると、モデルの読み込みが終わっていれば `"status": "ok"` を含む応答が返り、読み込みの途中であれば状態コード 503 のエラーが返ります[llama.cpp 1.0.0 (2026/11), tools/server/README.md]。

起動したあとは、`npm run model` を実行したターミナルを開いたままにします。
llama-server は `http://127.0.0.1:8080` で依頼を待ち受け、同じパソコンからの接続だけを受け付けます。
止めるときは、そのターミナルで Ctrl+C を押します。

`npm run model` は、起動のたびにモデルの情報を Hugging Face から読みます。
そのため、2 回目以降の起動にもインターネット接続が必要です。

llama.cpp を導入する前に、実行されるコマンドだけを見たい場合は、`npm run model -- --dry-run` を使います。
`npm run` のコマンドに指定を渡すときは、このように `--` のあとに書きます。

## 動作の確認

### 単体テストとビルド

```bash
npm test
npm run build
```

どちらもエラーなく終われば、手順 1 は正しく完了しています。

### llama.cpp を導入せずに試す方法

模擬サーバーを使うと、llama.cpp が無くても、実験用のコマンドの流れを試せます。
模擬サーバーは翻訳を行わず、原文の先頭に「【訳】」を付けて返します。

1 つ目のターミナルで、模擬サーバーを起動します。

```bash
npm run mock
```

`模擬サーバーを起動しました: http://127.0.0.1:8089(同時処理数 4)` と表示されれば、起動できています。

2 つ目のターミナルで、依頼先を模擬サーバーに変えて、生成の速度を測るコマンドを実行します。

```bash
npm run probe:speed -- --base-url http://127.0.0.1:8089
```

このコマンドは、英語の段落 20 件を、同時に依頼する数を 1、2、4 と変えながら 3 回訳させます。
10 秒ほどで、同時に依頼する数ごとの速度の表と、訳文の例が表示されます。
速度の単位はトークン毎秒で、トークンは、モデルが文章を扱う単位です。
模擬サーバーの場合、表示される速度は見かけの値で、実物の性能とは関係がありません。

`npm run probe:placeholders` も、同じ `--base-url` の指定で模擬サーバーに対して実行できます。

### 実物の llama-server への依頼

手順 4 で llama-server を起動した状態で、別のターミナルから次を実行します。

```bash
npm run probe:speed
```

速度の表が表示されれば、llama-server への依頼は成功しています。
この確認は、実物の llama-server ではまだ試せていません。
実物での所要時間も、まだ測っていません。

## コマンドの一覧

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発用の Web サーバーを起動します(`http://localhost:5173/`) |
| `npm run build` | 型の検査をしてから、配布用のファイルを `dist/` に作ります |
| `npm run preview` | `dist/` の内容を表示するサーバーを起動します(`http://localhost:4173/`) |
| `npm test` | 単体テストを実行します |
| `npm run model` | llama-server を起動します |
| `npm run mock` | 模擬サーバーを起動します(`http://127.0.0.1:8089`) |
| `npm run probe:speed` | llama-server に英語の段落を訳させ、生成の速度を測ります |
| `npm run probe:placeholders` | 数式の位置を示す目印が、訳文に残る割合を測ります |

`npm run probe:placeholders` の「目印」は、文中の数式の位置を示す記号です。
このアプリは、文中の数式を目印に置き換えてから訳し、訳文の目印の位置に元の数式を戻す予定です。

各コマンドの使い方の例は、[scripts/](scripts/) にある各ファイルの冒頭に書いています。
指定の一覧は、同じファイルの中の、指定を定義している箇所にあります。

## モデルの大きさと起動時の指定

`npm run model` は、1 つ目の引数でモデルの大きさを選べます。

```bash
npm run model -- 8b
```

PFN は、PLaMo 3 Translate を 4 種類の大きさで公開しています[PFN モデルカード (2026/11), Model List]。
`2b` などは、その大きさの呼び名です。

| モデルの大きさ | ファイルの大きさ | 評価値(PFTB) |
| --- | ---: | ---: |
| `0.8b` | 0.57 GB | 0.5832 |
| `2b`(既定) | 1.81 GB | 0.6062 |
| `8b` | 5.28 GB | 0.6100 |
| `31b` | 19.53 GB | 0.6237 |

表の値は、既定の量子化の種類(Q4_K_M)でのものです[PFN モデルカード (2026/11), Accuracy changes from quantization]。
**量子化**は、モデルの数値を少ないビット数で表して、ファイルを小さくする処理です。
PFTB は、同じモデルカードに載っている英日と日英の翻訳の評価値で、高いほど良い値です。

既定を `2b` にしている理由は、評価値の差が小さいわりに、ファイルが小さいことです。
`2b` と `8b` の評価値の差は 0.0038 で、最も小さい `0.8b` と最も大きい `31b` の差 0.0405 の 10 分の 1 ほどです。
ファイルは、`2b` のほうが `8b` より 3.47 GB 小さくなります。
生成の速度とメモリの使用量は、まだ測っていません。
既定の大きさは、速度を測ったあとで見直します。

そのほかの指定は次のとおりです。

| 指定 | 既定値 | 内容 |
| --- | --- | --- |
| `--port <番号>` | `8080` | llama-server が待ち受けるポート番号 |
| `--parallel <数>` | `4` | 同時に処理する依頼の数 |
| `--quant <種類>` | `Q4_K_M` | 量子化の種類。2026 年 11 月 14 日の時点で、`Q4_K_M`、`Q3_K_M`、`Q2_K` がすべての大きさにあり、`Q4_0` が `0.8b` と `2b` にあります[PFN 配布ページ (2026/11), 各 GGUF リポジトリのファイルの一覧] |
| `--dry-run` | なし | 起動せずに、実行されるコマンドだけを表示します。llama.cpp が無くても使えます。モデルの情報を読むので、インターネット接続は必要です |

`llama-server` の実行ファイルが PATH(コマンドを探す場所)に無い場合は、環境変数 `LLAMA_SERVER` にそのパスを指定します。
次の例の `/path/to/llama-server` を、実際のパスに置き換えます。

```bash
LLAMA_SERVER=/path/to/llama-server npm run model
```

## うまく動かないとき

| 表示 | 対処 |
| --- | --- |
| `llama-server が見つかりません。` | llama.cpp を導入します(手順 3)。導入してあるのに表示される場合は、環境変数 `LLAMA_SERVER` に実行ファイルのパスを指定します。`LLAMA_SERVER` を指定している場合は、表示の先頭がその値になります |
| `モデルの大きさは 0.8b、2b、8b、31b のいずれかで指定してください` | `npm run model` の 1 つ目の引数を、4 種類のどれかにします |
| `モデルの情報を読めませんでした。` | インターネット接続を確かめます。`--quant` を指定した場合は、その値も確かめます |
| `llama-server(http://127.0.0.1:8080)に接続できません。` | llama-server が起動しているかを確かめます。8080 番のポートを別のソフトが使っている場合にも、この表示になることがあります |
| `llama-server が HTTP 404 を返しました` や `SyntaxError: ... is not valid JSON` | llama-server ではない別のソフトが、その URL で応答している可能性があります |

下の 2 行に当てはまり、llama-server を起動しているはずの場合は、次の「ポート番号を変える方法」に進みます。

### ポート番号を変える方法

llama-server は、既定では 8080 番のポートを使います。
ポートは、1 台のパソコンの中で、通信の相手のソフトを区別するための番号です。
8080 番を別のソフトが使っている場合は、別の番号を指定します。

8080 番を使っているソフトは、macOS では次のコマンドで調べられます。
何も表示されなければ、8080 番は空いています。

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

たとえば 8081 番を使う場合は、起動するときと依頼するときの両方で指定します。

```bash
npm run model -- --port 8081
npm run probe:speed -- --base-url http://127.0.0.1:8081
```

8080 番を別のソフトが使っている状態で `npm run model` を実行したときの表示は、まだ確かめていません。

## ディレクトリの構成

| 場所 | 内容 |
| --- | --- |
| `src/` | Web アプリの本体 |
| `src/translate/` | llama-server への翻訳の依頼(PLaMo の入力書式の組み立てと通信) |
| `scripts/` | llama-server の起動、実験、模擬サーバーの各スクリプト |
| `tests/` | 単体テスト |
| `note/` | 機能ごとの実装の記録(目的、設計の判断、確かめたこと、確かめていないこと) |

設計の経緯は、`note/` のファイルを番号の順に読むとたどれます。

## 今後の予定

次の順に進めます。

1. 実物の llama-server での動作の確認と、生成の速度の測定
2. PDF の表示と、PDF から読み取った行や段落の範囲を目で確かめるための表示
3. レイアウト検出(図や表の中の文字と本文を区別する処理)
4. 段落ごとの翻訳、訳文の重ね表示、訳文の保存
5. 文中の数式の扱い
6. 段組やページをまたいで続く段落の結合
7. llama-server との接続の状態を確かめる画面と、別の実行ソフト(Ollama)への対応

## ライセンス

このリポジトリのコードのライセンスは、まだ定めていません。

PLaMo 3 Translate には、PLaMo コミュニティライセンスが適用されます。
モデルカードは、利用の条件を次のように説明しています[PFN モデルカード (2026/11), License]。

- 学習や趣味などの個人での利用と、学術利用を含む非商用の利用は、事前の登録なしで無料です。
- 商用の利用は、利用者またはその関係会社の直近の事業年度の収入または売上が 10 億円以下の場合、登録フォームでの登録が必要です。
- 収入または売上が 10 億円を超える場合の商用の利用には、別のライセンス契約が必要です。

正確な条件は、ライセンスの本文で確かめてください。
本文は、モデルのリポジトリ([日本語](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF/blob/main/LICENSE/ja)、[英語](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF/blob/main/LICENSE/en))にあります。
モデルカードは、PFN のサイトの掲載ページ([日本語](https://plamo.preferredai.jp/info/plamo-community-license-ja)、[英語](https://plamo.preferredai.jp/info/plamo-community-license-en))も案内しています。

このリポジトリは、モデルのファイルを含みません。
モデルは、利用する人がそれぞれ Hugging Face から取得します。

このライセンスは、モデルを第三者に提供する場合に「Built with PLaMo」と明示することを求めています[PLaMo コミュニティライセンス (2026/11), 第 4 条]。
このリポジトリはモデルを提供しませんが、PLaMo 3 Translate を利用するアプリであることを示すために、次の表記を入れています。

Built with PLaMo

[scripts/lib/yarn.ts](scripts/lib/yarn.ts) は、llama-server に渡す補正値を計算します。
ファイル名の yarn は、モデルが使う位置符号化(語の位置をモデルに伝える仕組み)の方式 YaRN を指し、パッケージ管理ソフトの Yarn とは関係がありません。
この計算は、PFN の plamo-translate-cli(Apache License 2.0)にある処理を移植したものです[plamo-translate-cli (2026/11), src/plamo_translate/servers/llama_cpp/server.py]。

## 出典

[PFN モデルカード, 2026/11] Preferred Networks. "PLaMo 3 Translate 2B GGUF." Hugging Face. https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF

[PFN 配布ページ, 2026/11] Preferred Networks. "PLaMo 3 Translate." Hugging Face. https://huggingface.co/collections/pfnet/plamo-3-translate

[PLaMo コミュニティライセンス, 2026/11] Preferred Networks. "PLaMoコミュニティライセンス契約." Hugging Face. https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF/blob/main/LICENSE/ja

[Homebrew, 2026/11] Homebrew. "llama.cpp." Homebrew Formulae. https://formulae.brew.sh/formula/llama.cpp

[llama.cpp 1.0.0, 2026/11] ggml-org. "llama.cpp v1.0.0." GitHub. https://github.com/ggml-org/llama.cpp/tree/v1.0.0

[llama.cpp 0.9.0, 2026/11] ggml-org. "llama.cpp v0.9.0." GitHub. https://github.com/ggml-org/llama.cpp/tree/v0.9.0

[plamo-translate-cli, 2026/11] Preferred Networks. "plamo-translate-cli." GitHub. https://github.com/pfnet/plamo-translate-cli
