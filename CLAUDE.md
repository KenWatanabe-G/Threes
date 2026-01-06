# Threes! - 技術仕様書

このドキュメントは、Threes!ゲームの実装詳細と技術的な設計について記述します。

## 📐 アーキテクチャ

### システム構成

```
┌─────────────────────────────────────────────────┐
│                  index.html                     │
│  (UI構造、ゲーム盤、AI分析パネル)                │
└─────────────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼────────┐         ┌────────▼────────┐
│   game.js      │────────▶│     ai.js       │
│ (ゲームロジック)│         │  (AI実装)       │
└────────────────┘         └─────────────────┘
        │
        │
┌───────▼────────┐
│   style.css    │
│  (スタイル)     │
└────────────────┘
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
- AI分析パネル制御

#### `ai.js` - AI機能
- **ThreesAIクラス**: AI戦略と評価
- Expectimaxアルゴリズム実装
- 評価関数（6つの評価軸）
- 移動シミュレーション
- 確率計算（デッキカウンティング）
- トランスポジションテーブル（キャッシュ）
- 重み管理（localStorage連携）

#### `style.css` - スタイリング
- PC向けサイドバイサイドレイアウト
- タイルのカラースキーム
- アニメーション定義
- AI分析パネルのスタイル
- レスポンシブ対応（簡易版）

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
- AIはデッキの残り枚数を計算して確率を推定可能

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

## 🤖 AI実装詳細

> **詳細なAI戦略設計については[AI_STRATEGY.md](AI_STRATEGY.md)を参照してください。**

### Expectimaxアルゴリズム

**探索木構造:**
```
         Max Node (プレイヤー)
         /    |    |    \
      上    下   左   右
       |     |    |     |
    Chance Node (ランダム)
     /  |  \
   1   2   3  (確率的に分岐)
    |   |   |
   Max Node ...
```

**実装:**
```javascript
getBestMove() {
  const depth = 3; // 探索深度
  const directions = ['up', 'down', 'left', 'right'];
  let bestScore = -Infinity;
  let bestMove = null;

  directions.forEach(direction => {
    if (!this.canMoveInDirection(direction)) return;

    const simResult = this.simulateMove(direction);
    if (!simResult) return;

    // Chanceノードで期待値を計算
    const score = this.expectimaxChance(
      simResult.grid,
      simResult.tiles,
      depth - 1
    );

    if (score > bestScore) {
      bestScore = score;
      bestMove = direction;
    }
  });

  return bestMove;
}
```

### 評価関数

**6つの評価軸:**

#### 1. Openness（空きマス）
```javascript
opennessScore = emptyCells²
重み: w1 = 1000
```
目的: 移動の自由度を確保

#### 2. Monotonicity（蛇行配置）
```javascript
// 蛇行パターン: 左→右、右→左、左→右...
snakePath = [row0_L→R, row1_R→L, row2_L→R, row3_R→L]
monotonicityScore = 降順ペアの数
重み: w2 = 800
```
目的: タイルを綺麗に並べて連鎖的なマージを促進

#### 3. Smoothness（滑らかさ）
```javascript
smoothnessScore = -Σ|log₂(tile) - log₂(neighbor)|
重み: w3 = 1500
```
目的: 隣接タイルの値の差を小さくして孤立を防ぐ

#### 4. Adjacency（1-2ペアリング）
```javascript
if (tile === 1 && neighbor === 2) score += 10;
if (tile === 1 && neighbor === 1) score -= 5;
重み: w4 = 600
```
目的: 1と2の効率的な処理

#### 5. Corner Integrity（コーナー固定）
```javascript
if (maxTile at corner[0,0]) score += maxValue × 1000;
else if (maxTile at edge) score += maxValue × 300;
else score -= maxValue × 500;
重み: w5 = 3000（最重要）
```
目的: 最大タイルを左上コーナーに固定

#### 6. Weighted Position（重み付け位置マップ）
```javascript
weightMap = [
  [4096, 1024, 256, 64],
  [16,   32,   64,  128],
  [8,    4,    2,   1],
  [0,    0,    0,   0]
]
重み: なし（直接加算）
```
目的: 大きな数字を左上に誘導

**最終スコア:**
```javascript
totalScore = w1×openness + w2×monotonicity + w3×smoothness
           + w4×adjacency + w5×cornerIntegrity + weightedPosition
```

### デッキカウンティング

**確率計算:**
```javascript
calculateTileProbabilities() {
  // デッキの残り枚数をカウント
  const deckCounts = { 1: 0, 2: 0, 3: 0 };
  this.deck.forEach(value => deckCounts[value]++);

  const totalCards = this.deck.length || 12;

  // 次タイルが確定している場合
  if (this.nextTileValue !== null) {
    return [{ value: this.nextTileValue, probability: 1.0 }];
  }

  // 通常カードの確率
  const probabilities = [];
  [1, 2, 3].forEach(value => {
    const prob = deckCounts[value] / totalCards;
    if (prob > 0) {
      probabilities.push({ value, probability: prob });
    }
  });

  return probabilities;
}
```

### トランスポジションテーブル

**キャッシュによる高速化:**
```javascript
hashGrid(grid, tiles) {
  // グリッドを文字列化してハッシュキーに
  return grid.map(row =>
    row.map(id => id ? tiles.find(t => t.id === id).value : 0)
       .join(',')
  ).join('|');
}

expectimaxMax(grid, tiles, depth) {
  const hash = this.hashGrid(grid, tiles);
  const cacheKey = `max_${hash}_${depth}`;

  if (this.transpositionTable.has(cacheKey)) {
    return this.transpositionTable.get(cacheKey);
  }

  // ... 評価計算 ...

  this.transpositionTable.set(cacheKey, score);
  return score;
}
```

### 重み調整機能

**localStorage連携:**
```javascript
// 重みの読み込み
loadWeights() {
  const saved = localStorage.getItem('threes-ai-weights');
  if (saved) {
    return JSON.parse(saved);
  }
  return { w1: 1000, w2: 800, w3: 1500, w4: 600, w5: 3000 };
}

// 重みの保存
saveWeights() {
  localStorage.setItem('threes-ai-weights',
    JSON.stringify(this.weights));
}

// 重みの更新
updateWeights(weights) {
  this.weights = { ...this.weights, ...weights };
  this.saveWeights();
}
```

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

### AI分析パネル

**サイドバイサイドレイアウト:**

```css
body {
  display: flex;
  justify-content: center;
}

.container {
  max-width: 500px;
  flex-shrink: 0;
}

.ai-debug-panel {
  width: 600px;
  margin-left: 30px;
}

.ai-debug-content {
  position: sticky;
  top: 20px;
}
```

**リアルタイム更新:**
```javascript
// 移動後に自動更新
move(direction) {
  // ... 移動処理 ...

  if (this.debugPanelOpen) {
    this.updateDebugPanel();
  }
}

// 重みスライダーの変更時も更新
slider.addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  this.ai.updateWeights({ [weight]: value });

  if (this.debugPanelOpen) {
    this.updateDebugPanel();
  }
});
```

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

## 🎯 パフォーマンス最適化

### GPUアクセラレーション

```css
.tile {
  will-change: left, top;
  transition: left 0.12s ease-out, top 0.12s ease-out;
}
```

### トランスポジションテーブル

- 同一盤面の再評価を防止
- メモリ使用量とのトレードオフ
- 各手の探索前にクリア

### サンプリングによる計算量削減

```javascript
// 全空きマスではなく一部をサンプリング
const sampleSize = Math.min(3, emptyCells.length);
for (let i = 0; i < sampleSize; i++) {
  // ... Chanceノードの評価 ...
}
```

---

## 📊 データフロー

### ゲーム開始からAI判断まで

```
1. ユーザーがAIボタンをクリック
   ↓
2. game.toggleAI() → game.startAI()
   ↓
3. setInterval() で定期的にAI判断を実行
   ↓
4. ai.getBestMove()
   ├─ 各方向をシミュレート
   ├─ expectimaxChance() で期待値計算
   ├─ evaluateBoard() で盤面評価
   └─ 最高スコアの方向を返す
   ↓
5. game.move(bestMove)
   ├─ タイル移動
   ├─ 新タイル追加
   ├─ アニメーション
   └─ UI更新
   ↓
6. AI分析パネルが開いていれば updateDebugPanel()
```

### AI分析パネルのデータフロー

```
1. ユーザーがAI分析ボタンをクリック
   ↓
2. game.toggleDebugPanel()
   ├─ ThreesAIインスタンス作成
   ├─ loadWeightsToUI() で重みをスライダーに反映
   └─ updateDebugPanel() で初期表示
   ↓
3. ai.analyzeAllDirections()
   ├─ 各方向をシミュレート
   └─ evaluateBoardDetailed() で詳細スコア取得
   ↓
4. game.updateScoresTable(analysis)
   └─ テーブルに評価結果を表示
```

---

## 🔧 設定とカスタマイズ

### AI評価関数の調整

AI分析パネルのスライダーで以下を調整可能：

- **w1 (Openness)**: 0-3000、デフォルト1000
- **w2 (Monotonicity)**: 0-3000、デフォルト800
- **w3 (Smoothness)**: 0-3000、デフォルト1500
- **w4 (Adjacency)**: 0-3000、デフォルト600
- **w5 (Corner Integrity)**: 0-5000、デフォルト3000

### localStorage保存データ

```javascript
// AI重み設定
'threes-ai-weights': {
  w1: 1000,
  w2: 800,
  w3: 1500,
  w4: 600,
  w5: 3000
}

// ベストスコア
'threes-best-score': 12345
```

---

## 🐛 既知の制限事項

1. **モバイル最適化**: PC向けに最適化されており、モバイルではAI分析パネルが使いづらい
2. **探索深度**: パフォーマンスの都合上、深さ3に固定
3. **ボーナスカード確率**: 簡易実装のため、正確な確率計算ではない
4. **ブラウザ互換性**: モダンブラウザ（Chrome, Firefox, Safari）推奨

---

## 🔮 今後の改善案

### 機能拡張
- [ ] モバイル向けレスポンシブ対応
- [ ] リプレイ機能（手順の再生）
- [ ] 統計情報の表示（平均スコア、最大タイル達成率など）
- [ ] オンラインランキング

### AI改善
- [ ] Monte Carlo Tree Search (MCTS) の実装
- [ ] 機械学習による評価関数の最適化
- [ ] マルチスレッド対応（Web Workers）
- [ ] 可変探索深度（盤面の複雑度に応じて調整）

### UX改善
- [ ] テーマカラー変更機能
- [ ] サウンドエフェクト
- [ ] タッチジェスチャーの改善
- [ ] キーボードショートカット

---

**🤖 Generated with [Claude Code](https://claude.com/claude-code)**
