# ファイル構成ガイド

このリポジトリのファイルを役割ごとに分けて、それぞれの使い方をまとめたものです。

```
Eigo-Wordbook/
├── index.html               … フラッシュカード単語帳（GitHub Pages のトップページ）
├── typing.html              … タイピング練習（CSS/JS もこのファイル内）
├── game.html                … タイピングゲーム「WORD RUSH」
│
├── app/                     … アプリ本体の JS / CSS
│   ├── app.js               … 単語帳のロジック
│   ├── style.css            … 単語帳のスタイル
│   ├── game.js              … WORD RUSH のロジック
│   └── game.css             … WORD RUSH のスタイル
│
├── data/                    … 単語データ（const wordData = { A1: [...], ... }）
│   ├── words.js             … アプリが実際に読み込むデータ（現在はテスト用の小規模版）
│   ├── words_.js            … 全単語・意味整形済みの完成版
│   ├── words_generated.js   … 単語リストのみ（意味は "TODO"）
│   ├── words_translated.js  … EJDict で意味を埋めた中間データ
│   └── words_old.js         … 整形前の旧データ（バックアップ）
│
├── scripts/                 … データ生成スクリプト（Node.js）
│   ├── generate_words.js    … ① CEFR-J から単語リストを作る
│   ├── fill_meanings.js     … ② 日本語の意味を埋める
│   └── reformat_meanings.js … ③ 意味を短く整形する
│
├── README.md                … 概要とデータのライセンス表記
└── STRUCTURE.md             … このファイル
```

> HTML ファイルは、GitHub Pages（https://ponmeee.github.io/Eigo-Wordbook/）の URL を変えないようにルートに置いています。

---

## 1. アプリ本体

ビルドやサーバーは不要です。HTML ファイルをブラウザで直接開けば動きます。どちらのページも `data/words.js` の `wordData` を読み込みます。

### index.html / app/app.js / app/style.css — フラッシュカード単語帳

- **起動**: `index.html` をブラウザで開く。
- **タイトル画面で設定する項目**
  - レベル: A1〜C2
  - 出題方向: 英→日 / 日→英
  - 習得判断: 正解率（%）または正解回数。習得済みと判定された単語は出題されにくくなる
  - 出題数とアニメーションの ON/OFF
- **学習画面の操作**

  | 操作 | マウス / タッチ | キーボード |
  |---|---|---|
  | カードをめくる | タップ | `Space` / `W` / `↑` |
  | 覚えた | 右スワイプ | `D` / `→` |
  | 忘れた | 左スワイプ | `A` / `←` |
  | スキップ | 下スワイプ | `S` / `↓` |

  画面右上の ⚙ でアニメーションの設定、「中断する」で結果画面に移ります。
- **セーブデータ**
  - レベルごとに `localStorage` の `wordbook-<レベル>` キーへ自動保存されます（間違えた回数とやった回数）。
  - タイトル画面の「テキスト ▾」から、テキスト形式でのエクスポート（コピー）とインポート（貼り付け）ができます。端末間でデータを移すときに使います。
  - 「データをリセット」は長押しで実行されます。
- **編集するときの目安**
  - 画面構成を変える → `index.html`
  - 動作を変える → `app/app.js`（先頭の `state` に設定値の初期値がまとまっています）
  - 見た目を変える → `app/style.css`

### typing.html — タイピング練習

- **起動**: `typing.html` をブラウザで開く。CSS と JS もこのファイルの中に書かれています。
- レベルは複数選べます。出題数を決めてスタートし、表示された英単語を入力します（品詞がヒントとして表示されます）。
- 入力中は正確率と WPM がリアルタイムで表示されます。結果画面には打鍵数、ミス数、間違えた単語やスキップした単語の一覧が出ます。
- 入力欄がフォーカスを失ったら、カードをクリックすると戻ります。

### game.html / app/game.js / app/game.css — タイピングゲーム「WORD RUSH」

- **起動**: `game.html` をブラウザで開く。PC のキーボード向けです。日本語入力はオフにして遊んでください。
- **遊び方**: 日本語の意味が書かれたカードが右から左へ流れてきます。カードが左端に消える前に、レーン中央に出ている英単語を打ち切ります。
- **タイトル画面の設定**（設定は `localStorage` に保存されます）

  | 項目 | 選択肢 |
  |---|---|
  | レベル | A1〜C2 を複数選択できます |
  | コース | スプリント 60秒 / スタンダード 90秒 / エンデュランス 120秒 |
  | 出題モード | 英単語を見て打つ / 意味から思い出す（頭文字と文字数だけが表示され、カードが半分まで進むか、その単語で 5 回ミスすると答えが出ます） |
  | 効果音 | ON / OFF |
  | 英単語の読み上げ | ON / OFF（ブラウザの音声合成を使います。対応していないブラウザでは選べません） |

- **ルール**
  - 得点は 1 語打ち切るごとに入ります。時間切れになった単語は 0 点です。
    - 1語の得点 =（文字数 × 10 ＋ 50）× 速さ倍率 × ミス倍率 × コンボ倍率
    - 速さ倍率: 単語が出た直後に打ち切ると ×2.0、カードが消える寸前だと ×0.5 です。カードが進むほど下がります。
    - ミス倍率: その単語でミスするたびに 0.15 ずつ下がります（最低 ×0.2）。
    - 打っている単語の下に「今打ち切ったら入る点数」が表示されます。ミスがあるとき、またはカードが消えかけているときは赤字になります。
  - ミスなしで連続して打ち切るとコンボが増えます。コンボが増えるほど得点の倍率が上がります（最大 2 倍）。5 コンボごとに残り時間が 3 秒増えます。
  - ミスタイプか時間切れでコンボは 0 に戻ります。カードは時間が経つほど少しずつ速くなります。
  - 「意味から思い出す」モードでは、ヒントを見ずに打てた単語の得点が 1.5 倍になります。
- **読み上げのタイミング**
  - 英単語を見て打つ: 単語が出たとき。最初の 1 語はカウントダウン後の「GO!」で読み上げます。
  - 意味から思い出す: 答え（ヒント）が表示されたとき。ヒントなしで打ち切った場合は、打ち終わったとき。
- **キー操作**: `Space` でスタート、`Esc` で中断、結果画面では `Enter` でもう一度遊べます。ウィンドウからフォーカスが外れると一時停止します。
- **結果画面**
  - スコア、正確率、1 秒あたりの打鍵数、S〜D のランクが表示されます。
  - 時間切れ、ヒント使用、ミスがあった単語は「復習リスト」に意味付きで並びます。
  - ベストスコアは、レベル、コース、モードの組み合わせごとに保存されます。
- **調整したいとき**: `app/game.js` の先頭にある定数を変えます（得点は `LETTER_POINT`、`SPEED_MAX`、`SPEED_MIN`、`MISS_PENALTY`、`MISS_FLOOR`、そのほか `COMBO_STEP`、`BONUS_SEC`、`RANKS` など）。カードが流れる速さは `spawn()` の中で決めています。

---

## 2. 単語データ（data/）

すべて同じ形式の JS ファイルです。

```js
const wordData = {
  A1: [
    { word: "action", meaning: "行動；アクション", pos: "noun" },
    ...
  ],
  ...
  C2: [ ... ],
};
```

`pos` に使える値は `noun` `verb` `adjective` `adverb` `preposition` `conjunction` `pronoun` `determiner` `interjection` です。

| ファイル | 件数 | 中身 | 使い道 |
|---|---|---|---|
| `words.js` | 231 | 手作業で訳を付けたテスト用の小さなセット | **アプリが読み込むのはこのファイルだけ** |
| `words_.js` | 9,365 | 全単語。意味は整形済み（例: `～について；～に関して`） | 本番用の完成データ |
| `words_generated.js` | 9,365 | 単語と品詞のみ。`meaning` はすべて `"TODO"` | `generate_words.js` の出力 |
| `words_translated.js` | 9,713 | EJDict の訳がそのまま入っている（`『』《》` などの記号付き） | `fill_meanings.js` の出力 |
| `words_old.js` | 9,365 | translated と同様で、未収録の語は AI 訳（`(AI)` 付き）で補完済み | 整形前のバックアップ |

### 全単語データに切り替える方法

次のどちらかの方法で切り替えます。

- `data/words_.js` の内容を `data/words.js` にコピーする。
- `index.html` と `typing.html` の `<script src="data/words.js">` を `data/words_.js` に書き換える。

> ⚠ `words_translated.js` には Git のマージ競合マーカー（`<<<<<<< HEAD` など）が残っています。このままでは JS として読み込めないので、使う前に競合を解消してください。

---

## 3. データ生成スクリプト（scripts/）

Node.js で実行します。外部パッケージは不要です。②と③ではローカルの LM Studio（`localhost:1234`、OpenAI 互換 API）を使うので、事前に LM Studio でモデルを読み込み、サーバーを起動しておいてください。

既定の入出力先は、どこから実行しても `data/` フォルダになります。`--in` や `--out` でファイルを指定した場合は、実行したフォルダからの相対パスとして扱われます。

### 処理の流れ

```
CEFR-J / Octanove CSV (GitHub)
        │  ① node scripts/generate_words.js
        ▼
data/words_generated.js   … 意味は "TODO"
        │  ② node scripts/fill_meanings.js       （EJDict + LM Studio）
        ▼
data/words_translated.js  … 辞書の訳をそのまま格納
        │  ③ node scripts/reformat_meanings.js   （LM Studio）
        ▼
data/words_formatted.js   … 整形済み → data/words.js として使う
```

### ① generate_words.js — 単語リストの生成

```sh
node scripts/generate_words.js [1レベルあたりの単語数]   # 省略時は 50
```

- CEFR-J Wordlist（A1〜B2）と Octanove Profile（C1/C2）の CSV を GitHub から取得します。
- `data/words_generated.js` を出力します。`meaning` はすべて `"TODO"` になります。

### ② fill_meanings.js — 日本語の意味を埋める

```sh
node scripts/fill_meanings.js [--out <出力ファイル>] [--concurrency <並列数>]
# 既定: --out data/words_translated.js  --concurrency 1
```

- `data/words_generated.js` を読み込み、EJDict の訳で `meaning` を埋めます。
- 辞書に見つからない語は、語尾を外した原形でもう一度検索します（例: `abnormally` → `abnormal`）。
- それでも見つからない語は LM Studio で訳し、訳の末尾に `(AI)` を付けます。

### ③ reformat_meanings.js — 意味を整形する

```sh
node scripts/reformat_meanings.js [--in <入力>] [--out <出力>] [--concurrency <並列数>]
# 既定: --in data/words_translated.js  --out data/words_formatted.js  --concurrency 3
```

- LM Studio で辞書の記号（`『』《》…〈〉` など）を取り除き、主な意味を 1〜3 個に絞ります。区切りは `；` です。
- 出力された `data/words_formatted.js` の内容を確認してから、`data/words.js` として使ってください。

---

## 4. その他

- **README.md**: プロジェクトの概要と、使用しているデータセットのライセンス表記（CEFR-J: CC BY-SA 4.0、Octanove: CC BY 4.0、EJDict: Public Domain）。単語データを配布するときはこの表記を残してください。
