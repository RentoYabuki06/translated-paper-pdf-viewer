# 004 llama-server の起動スクリプト

## 1. 目的

PLaMo 3 Translate を llama-server で正しく動かすには、モデルの指定に加えて、位置符号化の補正値などのオプションが必要です。
これらを手で入力すると誤りやすいため、`npm run model` の 1 コマンドで起動できるようにします。

## 2. 変更内容

| ファイル | 内容 |
| --- | --- |
| `scripts/llama.ts` | 起動スクリプト本体。引数の解釈、llama-server の有無の確認、モデルの情報の取得、起動 |
| `scripts/lib/yarn.ts` | `yarnRangeArguments`。GGUF の情報から `--yarn-beta-fast` と `--yarn-beta-slow` の値を計算する |
| `scripts/lib/llamaArgs.ts` | モデルのリポジトリ名と URL、llama-server に渡す引数の組み立て |
| `tests/scripts/yarn.test.ts` | 補正値の計算の単体テスト 6 件 |
| `tests/scripts/llamaArgs.test.ts` | 引数の組み立ての単体テスト 6 件 |
| `package.json` | コマンド `model` と、開発用の依存 `@huggingface/gguf`(GGUF の先頭部分を読むライブラリ)を追加 |

使い方は次のとおりです。

```
npm run model                     2B を起動する
npm run model -- 8b               8B を起動する
npm run model -- 2b --port 8081   ポート番号を変える
npm run model -- --dry-run        起動せずに、実行するコマンドだけを表示する
```

2B を既定の設定で起動する場合に実行されるコマンドは次のとおりです。

```
llama-server -hf pfnet/plamo-3-translate-2b-GGUF:Q4_K_M --alias plamo-3-translate --host 127.0.0.1 --port 8080 --parallel 4 --ctx-size 8192 --no-context-shift --no-webui --chat-template chatml --cache-ram 0 --ctx-checkpoints 0 --yarn-beta-fast 31.738495 --yarn-beta-slow 1.0040927
```

## 3. 設計判断

- 補正値は固定値にせず、起動のたびに GGUF の情報から計算します。モデルの大きさや量子化の種類を変えても、正しい値になるためです。計算の式は、PFN 公式 CLI(`pfnet/plamo-translate-cli`、Apache License 2.0)の `yarn_range_arguments` を移植しました。出典は `scripts/lib/yarn.ts` の冒頭に記しています。
- GGUF の情報は、Hugging Face 上のファイルの先頭部分だけを読んで得ます。モデル全体を先に取得する方法は選びませんでした。llama-server の `-hf` にモデルの取得を任せると、保存場所の管理が不要になるためです。
- スクリプトは TypeScript で書きました。計画ではファイル名を `scripts/llama.mjs` としていましたが、`scripts/llama.ts` に変えています。補正値の計算を単体テストと共有し、型検査の対象にするためです。Node.js 22.18 以降は TypeScript を変換なしで実行できます。
- 文脈の長さ(`--ctx-size`)は、1 依頼の上限 2,048 トークンに同時処理数を掛けた値にしました。
- 待ち受け先は `127.0.0.1` に固定しました。自分のマシン以外からの接続を受け付けないためです。
- 既定のポート番号は 8080 にしました。llama-server の既定値は版によって異なるという報告があるため、常に明示します。
- 起動オプションのうち `--chat-template chatml`、`--cache-ram 0`、`--ctx-checkpoints 0`、`--no-context-shift`、`--no-webui` は、PFN 公式 CLI が llama-server に渡しているものと同じです。公式 CLI が渡すスレッド数やバッチの大きさの指定は、M1 Max 向けの調整値なので含めていません。

## 4. 動作確認

- `npm test`: 40 件すべて成功(本機能の 12 件と、既存の 28 件)。
- `npm run build`: 成功。
- `npm run model -- --dry-run`: 2B の GGUF を Hugging Face から読み、補正値 31.738495 と 1.0040927 を計算して、上記のコマンドを表示。この値は、PFN 公式 CLI が公表している値と一致します。
- `npm run model -- 8b --parallel 2 --dry-run`: 8B でも同じ補正値になることを確認。文脈の長さは 4096 になりました。
- `npm run model -- 4b --dry-run`: 大きさの指定が不正である旨を表示し、終了コード 1 で終了。
- `npm run model`(llama-server が無い状態): 導入方法の案内を表示し、終了コード 1 で終了。
- llama-server の実際の起動: 未確認。llama.cpp が未導入のためです。

## 5. 注意点・残課題

- 起動オプションが、Homebrew の llama.cpp 1.0.0 でそのまま通ることは未確認です。PFN 公式 CLI は llama.cpp の別の版(b11960)を対象にしています。オプション名が変わっていれば、起動時にエラーになります。
- 同時処理数を明示した場合に、各依頼が使える文脈の長さがどう配分されるかは未確認です。
- 利用には llama.cpp の導入が必要です(例: `brew install llama.cpp`)。初回の起動では、モデルのファイル(2B は 1.81 GB)を Hugging Face から取得します。
- llama.cpp が `yarn_truncate` に対応したら、補正値のオプションを外します。
