# 001 アプリの骨組み

## 1. 目的

翻訳論文 PDF ビューアを実装するための土台を作ります。
以降の機能(PFML3 の組み立て、llama-server との通信、PDF の表示)は、この骨組みの上に追加します。

## 2. 変更内容

| ファイル | 内容 |
| --- | --- |
| `package.json` | 依存パッケージと、`dev`・`build`・`preview`・`test` の 4 つのコマンドを定義 |
| `tsconfig.json` | TypeScript の設定。対象は `src`、`tests`、`scripts`、`vite.config.ts` |
| `vite.config.ts` | Vite と Vitest の設定。テストの対象は `tests/**/*.test.ts` |
| `index.html` | ページの入口 |
| `src/main.tsx` | React の起動処理 |
| `src/App.tsx` | 仮の画面(題名と説明文だけ) |
| `src/index.css` | 最小限の見た目の指定 |
| `.gitignore` | `node_modules`、ビルド結果、環境変数ファイル、モデルの重み、見本の PDF を管理対象から除外 |

導入した版は次のとおりです: Vite 8.3.8、React 19.3.1、TypeScript 7.0.2、Vitest 5.1.0。

## 3. 設計判断

- 画面の枠組みは Vite + React にしました。このアプリはサーバー側の処理を持たず、すべてブラウザ内で動くためです。Next.js は、サーバー側の機能を使わないので選びませんでした。
- 設定ファイルは手で書きました。公式のひな形を生成するコマンド(`npm create vite`)は、実行の許可が下りなかったためです。
- `tsconfig.json` は 1 ファイルにまとめました。ひな形が使う分割構成(アプリ用とツール用)は、この規模では不要と判断しました。
- `allowImportingTsExtensions` と `erasableSyntaxOnly` を有効にしました。`scripts/` の TypeScript を、変換なしで Node.js から直接実行できるようにするためです。そのため、import 文には `.ts` や `.tsx` の拡張子を書きます。
- ESLint は入れていません。型検査の厳格な設定(`strict`、未使用の変数の検出)で当面は足りると判断しました。

## 4. 動作確認

- `npm install`: 46 パッケージを導入。脆弱性の報告は 0 件。
- `npm run build`: 型検査(`tsc --noEmit`)と Vite のビルドがどちらも成功。
- ブラウザでの表示: 未確認。
- `npm test`: 未確認。テストファイルがまだ無いためです。

## 5. 注意点・残課題

- Node.js は 22.18 以上が必要です(`package.json` の `engines` に記載)。
- llama.cpp の導入(`brew install llama.cpp`)は、実行の許可が下りず未実施です。翻訳の実験にはこの導入が必要です。
