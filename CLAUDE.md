# Threes! - 技術仕様書

このドキュメントは、Threes!ゲームの実装詳細と技術的な設計について記述します。

## 📐 アーキテクチャ

### システム構成

```
┌─────────────────────────────────────────────────┐
│                  index.html                     │
│  (UI構造、ゲーム盤)                              │
└─────────────────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
 ┌──────▼──────┐ ┌────▼────┐ ┌──────▼──────┐
 │  game.js    │ │style.css│ │ ai/worker.js│
 │(ゲームロジック)│ │ (スタイル)│ │  (Web Worker)│
 └──────┬──────┘ └─────────┘ └──────┬──────┘
        │  postMessage / onmessage  │
        └───────────────────────────┘
                                    │
                          ┌─────────┴──────────────┐
                          │ ai/board.js            │
                          │ ai/heuristic.js        │
                          │ ai/expectimax.js       │
                          └────────────────────────┘
```

### ファイル別責務

#### `game.js` - メインゲームロジック
- **ThreesGameクラス**: ゲームの状態管理と操作
- タイル管理（生成、移動、マージ、削除）
- デッキシステム（12枚デッキ、シャッフル、ドロー）
- 移動ロジック（上下左右）
- アニメーション制御
- Undo機能（履歴管理）
- UI更新とイベント処理
- ドラッグ＆スワイプ処理
- AI Worker との通信 (`startAI` / `stopAI` / `requestAINextMove`)
- 次の最善手サジェスト (`toggleSuggest` / `requestSuggestion` / `handleSuggestionMessage` / `renderSuggestion` / `hideSuggestion`)

#### `style.css` - スタイリング
- PC向けレイアウト
- タイルのカラースキーム
- アニメーション定義
- レスポンシブ対応（簡易版）

#### `ai/` - AI 関連 (Web Worker)
- **`board.js`**: 盤面のランク表現 (0-15) と移動シミュレータ。`makeMove`、`insertBrick`、`maxElement`、`findDiffCount`、`calculateVariance`
- **`heuristic.js`**: 65536 エントリの評価テーブル (`empty` / `merges` / `1-2 merges` / `monotonicity` / `sum`) を起動時に初期化、`getHeurWeightScore` で行/列ごとに参照
- **`expectimax.js`**: Expectimax 探索本体。`expectSearch` がトップレベル、`deptSearch` → `heurSearch` → `insertHeurSearch` → `recursionDeptSearch` の再帰
- **`worker.js`**: Worker エントリ。`importScripts` で上記を読み込み、メインスレッドからの `{ grid, deck, nextTileValue, nextTileIsBonus }` 要求に最適 move を返す。`type: 'suggest'` で 4 方向すべての (合法/違法、スコア) を 1 メッセージで返却

[halfrost/threes-ai](https://github.com/halfrost/threes-ai) (Go) からの移植。動的探索深度・キャッシュ (BigInt ハッシュ) でパフォーマンスを確保。

---

## 🎮 ゲームロジック詳細

### デッキシステム

Threes!は完全ランダムではなく、**12枚のカードデッキ**を使用します。

```javascript
// 1セット = 12枚
deck = [
  1, 1, 1, 1,  // 青タイル × 4
  2, 2, 2, 2,  // 赤タイル × 4
  3, 3, 3, 3   // 白タイル × 4
]
```

**動作:**
1. ゲーム開始時に12枚をFisher-Yatesアルゴリズムでシャッフル
2. タイルを1枚ずつドロー
3. 12枚使い切ったら新しいデッキを生成・シャッフル

**戦略的意味:**
- 出現確率は各1/3で均等
- 例：1が4枚連続で出たら、次のデッキまで1は出ない

### ボーナスカードシステム

**出現条件:**
- 盤面に**48以上のタイル**が存在する場合のみ
- デッキから3を引いた時、約**1/21の確率**でボーナスカードに変換

**ボーナス値の計算:**
```javascript
bonusValue = 最大タイル値 ÷ 8 以下の2のべき乗
```

**例:**
- 最大タイル = 48 → ボーナス候補: 6
- 最大タイル = 96 → ボーナス候補: 6, 12
- 最大タイル = 192 → ボーナス候補: 6, 12, 24

**表示:**
- 次タイルプレビューで数字の後ろに「+」を表示（例：6+）

### タイル移動ロジック

#### マージルール
```javascript
canMerge(value1, value2) {
  // 1 + 2 = 3
  if ((value1 === 1 && value2 === 2) ||
      (value1 === 2 && value2 === 1)) {
    return true;
  }
  // 3以上は同じ数字同士でマージ
  if (value1 === value2 && value1 >= 3) {
    return true;
  }
  return false;
}
```

#### 移動アルゴリズム（右方向の例）
```javascript
moveRight() {
  // 右から左へタイルを処理
  for (let row = 0; row < 4; row++) {
    for (let col = 2; col >= 0; col--) {
      const tile = grid[row][col];
      if (!tile) continue;

      const targetCol = col + 1;
      const target = grid[row][targetCol];

      if (!target) {
        // 空きマスに移動
        moveTile(tile, targetCol);
      } else if (canMerge(tile.value, target.value)) {
        // マージ
        mergeTiles(tile, target);
      }
    }
  }
}
```

### Undo機能

**状態スナップショット:**
```javascript
saveState() {
  const snapshot = {
    tiles: JSON.parse(JSON.stringify(this.tiles)),
    grid: this.getGrid(),
    score: this.score,
    deck: [...this.deck],
    nextTileValue: this.nextTileValue,
    nextTileIsBonus: this.nextTileIsBonus,
    gameOver: this.gameOver
  };
  this.history.push(snapshot);

  // 最大10手まで保存
  if (this.history.length > this.maxHistorySize) {
    this.history.shift();
  }
}
```

**復元:**
- ゲームオーバー後でもUndoが可能
- 最大10手前まで戻れる

---

## 🎨 UI/UX実装

### ドラッグプレビュー

**スワイプ中の移動可能タイル表示:**

```javascript
renderDragPreview() {
  // 移動可能なタイルを判定（キャッシュ使用）
  if (!this.movableTilesCache) {
    const movableTiles = new Set();

    // 移動先から移動元に向かってスキャン
    // 右方向の例：右→左
    for (let col = 3; col >= 0; col--) {
      const tile = grid[row][col];
      if (!tile) continue;

      const rightTile = grid[row][col + 1];
      if (!rightTile ||
          canMerge(tile, rightTile) ||
          movableTiles.has(rightTile.id)) {
        movableTiles.add(tile.id);
      }
    }

    this.movableTilesCache = movableTiles;
  }

  // 移動可能なタイルにオフセットを適用
  movableTiles.forEach(tileId => {
    const tile = this.tiles[tileId];
    const offset = this.dragDistance * cellSize;
    tile.element.style.transform = `translate(${offset}px, 0)`;
  });
}
```

**特徴:**
- 連鎖的に移動可能なタイルを全て検出
- スワイプ距離に応じてリアルタイムで移動プレビュー表示
- 移動不可能なタイルは動かない

### 動的フォントサイズ

**桁数に応じた自動調整:**
```javascript
adjustFontSize(element, value) {
  const digits = value.toString().length;

  if (digits === 1) element.style.fontSize = '4em';
  else if (digits === 2) element.style.fontSize = '3.5em';
  else if (digits === 3) element.style.fontSize = '2.8em';
  else if (digits === 4) element.style.fontSize = '2.3em';
  else if (digits === 5) element.style.fontSize = '1.9em';
  else element.style.fontSize = '1.5em';
}
```

---

## 🤖 AI 実装詳細

### アルゴリズム: Expectimax

[halfrost/threes-ai](https://github.com/halfrost/threes-ai) の Go 実装を JavaScript に移植。

**探索木構造:**
```
       Max Node (プレイヤー)
      /     |    |     \
   UP    DOWN  LEFT   RIGHT
    │      │    │       │
   Chance Node (次タイル候補ごと)
    │
   Insert Node (空いた端に挿入する位置)
    │
   ... 再帰 ...
```

### 評価関数 (1行ごとに事前計算)

| 重み                  | 値      | 説明                              |
| --------------------- | ------- | --------------------------------- |
| `LOST_PENALTY_WEIGHT` | 10000   | 基礎ペナルティ                    |
| `EMPTY_WEIGHT`        | 500     | 空きマス数                        |
| `MERGES_WEIGHT`       | 200     | 同値隣接ランレングス              |
| `ONE_TWO_MERGES_WEIGHT` | 700   | 1-2 隣接 (3 が作れる位置)         |
| `MONOTONICITY_WEIGHT` | 40      | 単調性 (左右の小さい方を引く)     |
| `SUM_WEIGHT`          | 100     | タイル値合計 (負の重み)           |

`heurScoreTable[65536]` に行/列の状態 (4セル × 4bit = 16bit) ごとのスコアを起動時に事前計算。`getHeurWeightScore` は 4 行 + 4 列のテーブル参照を合算するだけで O(1)。

### 動的探索深度

```javascript
deptLevel(board) {
  let dept = Math.max(3, findDiffCount(board) - 2);
  const { max, row, col } = maxElement(board);
  const variance = calculateVariance(board, row, col);
  if (max - variance <= 4 && max >= 9) dept += 2;
  return dept;
}
```

異なるタイル種類数が多いほど深く、最大タイルがコーナーに集約されている (分散が小さい) ほどさらに深く読む。

### キャッシュ

`Map<bigint, number>` で盤面のハッシュ → スコア。各セル 4bit を 64bit BigInt に詰めることで衝突なし。

### Web Worker

AI 計算は `ai/worker.js` で別スレッド実行。メインスレッドは `postMessage` で要求を投げ、`onmessage` で `move` を受け取る。リクエスト ID で古いレスポンスを破棄するため、AI を途中で停止しても安全。

### 次の最善手サジェスト機能

AI ロジックを流用した「ヒント」機能。AI 自動プレイとは別系統の独立 Worker で、毎手の直後に 4 方向すべてのスコアを 1 メッセージで取得する。

- **トグル**: `#suggest-toggle` (電球アイコン)。クリックで ON/OFF (`toggleSuggest`)
- **Worker 通信**: 専用 `suggestWorker` を 1 つ確保 (AI 用 4 Worker プールとは独立)。`postMessage({ type: 'suggest', requestId, grid, deck, nextTileValue, nextTileIsBonus })` で送信し、`{ type: 'suggest', requestId, perMove: [{move, legal, score}, ...] }` を 1 メッセージで受信
- **UI 表示**: 盤面の縁に 4 方向の矢印 (`.suggestion-arrow`) を絶対配置。最善手は `.best` で黄色強調 + パルスアニメ、違法手は `.illegal` で半透明グレー、その他の合法手は半透明白
- **ライフサイクル**: `move()` 開始時に `hideSuggestion()`、移動完了 + 自動保存後に `requestSuggestion()` を再発行。`startAI()` 時はトグル無効化 + UI 非表示、`stopAI()` で復帰。`startGame` / `undo` / `restoreGameState` / `endGame` でも適切に再計算/非表示
- **ランキング/レーティング**: AI 使用や Undo と異なり「ヒント」程度の補助として通常カテゴリのまま、レートも変動する。`usedSuggest` フラグや確認ダイアログは持たない

### レート推移グラフ

ゲーム終了時のプレイヤーレートを時系列で可視化する機能。

- **データ**: `skillStats.ratingHistory: [{ ts, rating, delta, playRating, category, score, maxTile, locked }]`
  - `ts`: `Date.now()` のミリ秒UNIX時刻
  - `category`: `normal` / `with_undo` / `anything_goes`
  - `locked`: Undo・AI・削除で `true`（rating は変動せず、その時点の rating を点として記録）
  - 上限なしで全件保持 (`pushRatingHistoryEntry`)
- **追記タイミング**: `updatePlayerRatingFromPlay` と `getRatingSummaryWithoutChange` の両方から `pushRatingHistoryEntry` を呼ぶ
- **UI**: `#rating-history-button` (折れ線アイコン) → `#rating-history-panel` モーダル
- **描画**: Chart.js 4.4.6 (jsdelivr CDN同期読込)。`type: 'line'`
  - ベースの折れ線 + ピークレートの水平点線 + カテゴリ別の点 (`normal=#9b59b6` / `with_undo=#e67e22` / `anything_goes=#95a5a6`)
  - tooltip: プレイ番号 / カテゴリ / rating / delta / score / maxTile
  - legend クリックでカテゴリ別表示ON/OFF（自前フィルターUIは持たない）
- **インスタンス管理**: `this.ratingHistoryChart` を保持し、再描画/閉じる時に `destroy()`

### AI 使用時のランキング/レーティング扱い

AI を 1 手でも使ったプレイは Undo・削除と同じ「補助手段」として扱う。

- **フラグ**: `this.usedAI` (constructor で初期化、`newGame` でリセット、`saveGameState`/`restoreGameState` で永続化)
- **カテゴリ**: `getRankingCategory()` が `usedDelete || usedAI` を `anything_goes` (なんでもあり) に振り分ける
- **レーティング**: `shouldUpdateRating()` が `!usedUndo && !usedDelete && !usedAI` のときのみ true。AI 使用時は `getRatingSummaryWithoutChange()` 経路で変動なしとして表示
- **初回確認ダイアログ**: `startAI()` で現在カテゴリが `normal` かつ `!usedAI` のときに `showConfirmDialog` を表示。キャンセル時は `usedAI` を立てず AI も起動しない (Undo・削除と同じパターン)。承諾後 `usedAI = true` を立てて `saveGameState()` し、AI を起動

---

## 🎯 パフォーマンス最適化

### GPUアクセラレーション

```css
.tile {
  will-change: left, top;
  transition: left 0.12s ease-out, top 0.12s ease-out;
}
```

---

## 🔧 設定とカスタマイズ

### localStorage保存データ

```javascript
// ベストスコア
'threes-best-score': 12345
```

---

## 🐛 既知の制限事項

1. **モバイル最適化**: PC向けに最適化されている
2. **ボーナスカード確率**: 簡易実装のため、正確な確率計算ではない
3. **ブラウザ互換性**: モダンブラウザ（Chrome, Firefox, Safari）推奨

---

## 🔮 今後の改善案

### 機能拡張
- [ ] モバイル向けレスポンシブ対応
- [ ] リプレイ機能（手順の再生）
- [ ] 統計情報の表示（平均スコア、最大タイル達成率など）

### UX改善
- [ ] テーマカラー変更機能
- [ ] サウンドエフェクト
- [ ] タッチジェスチャーの改善
- [ ] キーボードショートカット

---

## 📝 ドキュメント管理ルール

### コード変更時の更新ルール

**重要:** ゲームロジックを変更した際は、必ず関連するドキュメントも更新してください。

**更新対象ドキュメント:**
- **CLAUDE.md** - 技術仕様書（このドキュメント）
  - アーキテクチャの変更
  - ロジックの変更
  - 新機能の追加
  - パフォーマンス最適化の実装

- **README.md** - ユーザー向けドキュメント
  - ゲームルールの変更
  - 操作方法の変更
  - 新機能の追加

**更新タイミング:**
- ロジック変更のコミット時に同時更新
- 新機能実装完了時に即座に更新
- バグ修正で仕様が変わった場合は更新

**チェックリスト:**
- [ ] コード変更の内容を確認
- [ ] 影響するドキュメントを特定
- [ ] ドキュメントを更新
- [ ] 一貫性を確認（他のドキュメントとの矛盾がないか）
