class ThreesAI {
    constructor(game) {
        this.game = game;
        this.transpositionTable = new Map();
    }

    // 最適な手を取得
    getBestMove() {
        // Expectimaxアルゴリズムで最適な手を探索
        const depth = 3; // 探索深度
        const directions = ['up', 'down', 'left', 'right'];
        let bestScore = -Infinity;
        let bestMove = null;

        // トランスポジションテーブルをクリア（各手の探索前に）
        this.transpositionTable.clear();

        directions.forEach(direction => {
            if (!this.canMoveInDirection(direction)) return;

            // 移動をシミュレート
            const simResult = this.simulateMove(direction);
            if (!simResult) return;

            // Expectimaxで評価（Chanceノード）
            const score = this.expectimaxChance(simResult.grid, simResult.tiles, depth - 1);

            if (score > bestScore) {
                bestScore = score;
                bestMove = direction;
            }
        });

        return bestMove;
    }

    // グリッドのハッシュ値を計算
    hashGrid(grid, tiles) {
        // グリッドを文字列化してハッシュとして使用
        const gridStr = grid.map(row => row.map(id => {
            if (id === null) return '0';
            const tile = tiles.find(t => t.id === id);
            return tile ? tile.value.toString() : '0';
        }).join(',')).join('|');
        return gridStr;
    }

    // Maxノード（プレイヤーターン）
    expectimaxMax(grid, tiles, depth) {
        // 深さ0または終了状態なら評価関数を返す
        if (depth === 0) {
            return this.evaluateBoard(grid, tiles);
        }

        // トランスポジションテーブルのチェック
        const hash = this.hashGrid(grid, tiles);
        const cacheKey = `max_${hash}_${depth}`;
        if (this.transpositionTable.has(cacheKey)) {
            return this.transpositionTable.get(cacheKey);
        }

        const directions = ['up', 'down', 'left', 'right'];
        let maxScore = -Infinity;
        let hasValidMove = false;

        directions.forEach(direction => {
            const simResult = this.simulateMoveOnState(grid, tiles, direction);
            if (!simResult) return;

            hasValidMove = true;
            const score = this.expectimaxChance(simResult.grid, simResult.tiles, depth - 1);
            maxScore = Math.max(maxScore, score);
        });

        // 有効な手がない場合は現在の評価値
        if (!hasValidMove) {
            maxScore = this.evaluateBoard(grid, tiles);
        }

        // 結果をキャッシュ
        this.transpositionTable.set(cacheKey, maxScore);

        return maxScore;
    }

    // Chanceノード（タイル出現）
    expectimaxChance(grid, tiles, depth) {
        if (depth === 0) {
            return this.evaluateBoard(grid, tiles);
        }

        // トランスポジションテーブルのチェック
        const hash = this.hashGrid(grid, tiles);
        const cacheKey = `chance_${hash}_${depth}`;
        if (this.transpositionTable.has(cacheKey)) {
            return this.transpositionTable.get(cacheKey);
        }

        // 空きマスを探す
        const emptyCells = [];
        for (let row = 0; row < this.game.gridSize; row++) {
            for (let col = 0; col < this.game.gridSize; col++) {
                if (grid[row][col] === null) {
                    emptyCells.push({ row, col });
                }
            }
        }

        if (emptyCells.length === 0) {
            const score = this.evaluateBoard(grid, tiles);
            this.transpositionTable.set(cacheKey, score);
            return score;
        }

        // 次に出るタイルの確率を計算
        const tileProbabilities = this.calculateTileProbabilities();

        let expectedScore = 0;
        const cellProbability = 1.0 / emptyCells.length;

        // サンプリングで計算量を削減（全探索は重すぎる）
        const sampleSize = Math.min(3, emptyCells.length);
        for (let i = 0; i < sampleSize; i++) {
            const cell = emptyCells[i];

            tileProbabilities.forEach(({ value, probability }) => {
                // 新しいタイルを配置した状態を作成
                const newGrid = grid.map(row => [...row]);
                const newTiles = tiles.map(t => ({ ...t }));

                const newTileId = this.game.nextTileId + 1000 + i; // 仮のID
                newTiles.push({
                    id: newTileId,
                    value: value,
                    row: cell.row,
                    col: cell.col
                });
                newGrid[cell.row][cell.col] = newTileId;

                const score = this.expectimaxMax(newGrid, newTiles, depth - 1);
                expectedScore += score * cellProbability * probability;
            });
        }

        const finalScore = expectedScore / sampleSize;

        // 結果をキャッシュ
        this.transpositionTable.set(cacheKey, finalScore);

        return finalScore;
    }

    // タイル出現確率の計算（デッキカウンティング）
    calculateTileProbabilities() {
        const probabilities = [];

        // デッキの残り枚数を計算
        const deckCounts = { 1: 0, 2: 0, 3: 0 };
        this.game.deck.forEach(value => {
            deckCounts[value]++;
        });

        const totalCards = this.game.deck.length || 12; // デッキが空なら次のデッキ

        // 次のタイルが確定している場合（プレビュー情報）
        if (this.game.nextTileValue !== null && !this.game.nextTileIsBonus) {
            probabilities.push({ value: this.game.nextTileValue, probability: 1.0 });
            return probabilities;
        }

        // ボーナスカードの可能性
        if (this.shouldGenerateBonusCard() && this.game.nextTileValue === null) {
            const bonusProb = (1 / 21) * (deckCounts[3] / totalCards);
            const bonusValue = this.generateBonusCardValue();
            probabilities.push({ value: bonusValue, probability: bonusProb });
        }

        // 通常カード
        const totalNormalProb = 1.0 - (probabilities.reduce((sum, p) => sum + p.probability, 0));
        [1, 2, 3].forEach(value => {
            const prob = (deckCounts[value] / totalCards) * totalNormalProb;
            if (prob > 0) {
                probabilities.push({ value, probability: prob });
            }
        });

        // 確率が0の場合のフォールバック
        if (probabilities.length === 0) {
            probabilities.push({ value: 1, probability: 0.33 });
            probabilities.push({ value: 2, probability: 0.33 });
            probabilities.push({ value: 3, probability: 0.34 });
        }

        return probabilities;
    }

    shouldGenerateBonusCard() {
        const maxTile = this.getMaxTileValue();
        return maxTile >= 48;
    }

    generateBonusCardValue() {
        const maxTile = this.getMaxTileValue();
        const bonusLimit = Math.floor(maxTile / 8);

        const possibleValues = [];
        let value = 6;
        while (value <= bonusLimit) {
            possibleValues.push(value);
            value *= 2;
        }

        if (possibleValues.length === 0) {
            return 6;
        }

        return possibleValues[Math.floor(Math.random() * possibleValues.length)];
    }

    getMaxTileValue() {
        let maxValue = 0;
        Object.values(this.game.tiles).forEach(tile => {
            if (tile.value > maxValue) {
                maxValue = tile.value;
            }
        });
        return maxValue;
    }

    // 状態をシミュレート（grid, tilesを受け取る）
    simulateMoveOnState(grid, tiles, direction) {
        const tilesMap = {};
        tiles.forEach(t => {
            tilesMap[t.id] = { ...t };
        });

        const newGrid = grid.map(row => [...row]);
        let moved = false;

        if (direction === 'left') {
            for (let row = 0; row < this.game.gridSize; row++) {
                for (let col = 1; col < this.game.gridSize; col++) {
                    const tileId = newGrid[row][col];
                    if (tileId === null) continue;

                    const tile = tilesMap[tileId];
                    const targetCol = col - 1;

                    if (newGrid[row][targetCol] === null) {
                        tile.col = targetCol;
                        newGrid[row][targetCol] = tileId;
                        newGrid[row][col] = null;
                        moved = true;
                    } else {
                        const targetTileId = newGrid[row][targetCol];
                        const targetTile = tilesMap[targetTileId];
                        if (this.canMerge(tile.value, targetTile.value)) {
                            targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                            delete tilesMap[tileId];
                            newGrid[row][col] = null;
                            moved = true;
                        }
                    }
                }
            }
        } else if (direction === 'right') {
            for (let row = 0; row < this.game.gridSize; row++) {
                for (let col = this.game.gridSize - 2; col >= 0; col--) {
                    const tileId = newGrid[row][col];
                    if (tileId === null) continue;

                    const tile = tilesMap[tileId];
                    const targetCol = col + 1;

                    if (newGrid[row][targetCol] === null) {
                        tile.col = targetCol;
                        newGrid[row][targetCol] = tileId;
                        newGrid[row][col] = null;
                        moved = true;
                    } else {
                        const targetTileId = newGrid[row][targetCol];
                        const targetTile = tilesMap[targetTileId];
                        if (this.canMerge(tile.value, targetTile.value)) {
                            targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                            delete tilesMap[tileId];
                            newGrid[row][col] = null;
                            moved = true;
                        }
                    }
                }
            }
        } else if (direction === 'up') {
            for (let col = 0; col < this.game.gridSize; col++) {
                for (let row = 1; row < this.game.gridSize; row++) {
                    const tileId = newGrid[row][col];
                    if (tileId === null) continue;

                    const tile = tilesMap[tileId];
                    const targetRow = row - 1;

                    if (newGrid[targetRow][col] === null) {
                        tile.row = targetRow;
                        newGrid[targetRow][col] = tileId;
                        newGrid[row][col] = null;
                        moved = true;
                    } else {
                        const targetTileId = newGrid[targetRow][col];
                        const targetTile = tilesMap[targetTileId];
                        if (this.canMerge(tile.value, targetTile.value)) {
                            targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                            delete tilesMap[tileId];
                            newGrid[row][col] = null;
                            moved = true;
                        }
                    }
                }
            }
        } else if (direction === 'down') {
            for (let col = 0; col < this.game.gridSize; col++) {
                for (let row = this.game.gridSize - 2; row >= 0; row--) {
                    const tileId = newGrid[row][col];
                    if (tileId === null) continue;

                    const tile = tilesMap[tileId];
                    const targetRow = row + 1;

                    if (newGrid[targetRow][col] === null) {
                        tile.row = targetRow;
                        newGrid[targetRow][col] = tileId;
                        newGrid[row][col] = null;
                        moved = true;
                    } else {
                        const targetTileId = newGrid[targetRow][col];
                        const targetTile = tilesMap[targetTileId];
                        if (this.canMerge(tile.value, targetTile.value)) {
                            targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                            delete tilesMap[tileId];
                            newGrid[row][col] = null;
                            moved = true;
                        }
                    }
                }
            }
        }

        if (!moved) return null;

        return { grid: newGrid, tiles: Object.values(tilesMap) };
    }

    simulateMove(direction) {
        // 現在の状態をコピー
        const tilesCopy = JSON.parse(JSON.stringify(Object.values(this.game.tiles).map(t => ({
            id: t.id,
            value: t.value,
            row: t.row,
            col: t.col
        }))));

        const tilesMap = {};
        tilesCopy.forEach(t => {
            tilesMap[t.id] = t;
        });

        const grid = Array(this.game.gridSize).fill(null).map(() => Array(this.game.gridSize).fill(null));
        tilesCopy.forEach(tile => {
            grid[tile.row][tile.col] = tile.id;
        });

        // 移動をシミュレート
        let moved = false;

        if (direction === 'left') {
            for (let row = 0; row < this.game.gridSize; row++) {
                for (let col = 1; col < this.game.gridSize; col++) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = tilesMap[tileId];
                    const targetCol = col - 1;

                    if (grid[row][targetCol] === null) {
                        tile.col = targetCol;
                        grid[row][targetCol] = tileId;
                        grid[row][col] = null;
                        moved = true;
                    } else {
                        const targetTileId = grid[row][targetCol];
                        const targetTile = tilesMap[targetTileId];
                        if (this.canMerge(tile.value, targetTile.value)) {
                            targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                            delete tilesMap[tileId];
                            grid[row][col] = null;
                            moved = true;
                        }
                    }
                }
            }
        } else if (direction === 'right') {
            for (let row = 0; row < this.game.gridSize; row++) {
                for (let col = this.game.gridSize - 2; col >= 0; col--) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = tilesMap[tileId];
                    const targetCol = col + 1;

                    if (grid[row][targetCol] === null) {
                        tile.col = targetCol;
                        grid[row][targetCol] = tileId;
                        grid[row][col] = null;
                        moved = true;
                    } else {
                        const targetTileId = grid[row][targetCol];
                        const targetTile = tilesMap[targetTileId];
                        if (this.canMerge(tile.value, targetTile.value)) {
                            targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                            delete tilesMap[tileId];
                            grid[row][col] = null;
                            moved = true;
                        }
                    }
                }
            }
        } else if (direction === 'up') {
            for (let col = 0; col < this.game.gridSize; col++) {
                for (let row = 1; row < this.game.gridSize; row++) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = tilesMap[tileId];
                    const targetRow = row - 1;

                    if (grid[targetRow][col] === null) {
                        tile.row = targetRow;
                        grid[targetRow][col] = tileId;
                        grid[row][col] = null;
                        moved = true;
                    } else {
                        const targetTileId = grid[targetRow][col];
                        const targetTile = tilesMap[targetTileId];
                        if (this.canMerge(tile.value, targetTile.value)) {
                            targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                            delete tilesMap[tileId];
                            grid[row][col] = null;
                            moved = true;
                        }
                    }
                }
            }
        } else if (direction === 'down') {
            for (let col = 0; col < this.game.gridSize; col++) {
                for (let row = this.game.gridSize - 2; row >= 0; row--) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = tilesMap[tileId];
                    const targetRow = row + 1;

                    if (grid[targetRow][col] === null) {
                        tile.row = targetRow;
                        grid[targetRow][col] = tileId;
                        grid[row][col] = null;
                        moved = true;
                    } else {
                        const targetTileId = grid[targetRow][col];
                        const targetTile = tilesMap[targetTileId];
                        if (this.canMerge(tile.value, targetTile.value)) {
                            targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                            delete tilesMap[tileId];
                            grid[row][col] = null;
                            moved = true;
                        }
                    }
                }
            }
        }

        if (!moved) return null;

        return { grid, tiles: Object.values(tilesMap) };
    }

    evaluateBoard(grid, tiles) {
        const tilesMap = {};
        tiles.forEach(t => {
            tilesMap[t.id] = t;
        });

        // 重み
        const w1 = 1000;  // Openness (空きマス)
        const w2 = 800;   // Monotonicity (蛇行配置)
        const w3 = 1500;   // Smoothness (滑らかさ)
        const w4 = 600;   // Adjacency (1-2ペアリング)
        const w5 = 3000;  // Corner Integrity (コーナー固定) - 最重要

        // A. 空きマスの数 (Openness)
        let emptyCells = 0;
        for (let row = 0; row < this.game.gridSize; row++) {
            for (let col = 0; col < this.game.gridSize; col++) {
                if (grid[row][col] === null) emptyCells++;
            }
        }
        const opennessScore = Math.pow(emptyCells, 2); // 空きマスの2乗

        // B. 単調性 (Monotonicity) / 蛇行配置
        // 左上隅から「左→右」→「右→左」→「左→右」... と蛇行するルート
        const snakePath = [];
        for (let row = 0; row < this.game.gridSize; row++) {
            if (row % 2 === 0) {
                // 偶数行: 左→右
                for (let col = 0; col < this.game.gridSize; col++) {
                    const tileId = grid[row][col];
                    if (tileId !== null) {
                        snakePath.push(tilesMap[tileId].value);
                    } else {
                        snakePath.push(0);
                    }
                }
            } else {
                // 奇数行: 右→左
                for (let col = this.game.gridSize - 1; col >= 0; col--) {
                    const tileId = grid[row][col];
                    if (tileId !== null) {
                        snakePath.push(tilesMap[tileId].value);
                    } else {
                        snakePath.push(0);
                    }
                }
            }
        }

        // 蛇行パス上で降順になっているペアを数える
        let monotonicityScore = 0;
        for (let i = 0; i < snakePath.length - 1; i++) {
            if (snakePath[i] >= snakePath[i + 1] && snakePath[i] > 0) {
                monotonicityScore++;
            }
        }

        // C. 滑らかさ (Smoothness)
        let smoothnessScore = 0;
        for (let row = 0; row < this.game.gridSize; row++) {
            for (let col = 0; col < this.game.gridSize; col++) {
                const tileId = grid[row][col];
                if (tileId === null) continue;

                const tile = tilesMap[tileId];
                const logValue = tile.value > 0 ? Math.log2(tile.value) : 0;

                // 右の隣接タイル
                if (col < this.game.gridSize - 1) {
                    const rightId = grid[row][col + 1];
                    if (rightId !== null) {
                        const rightTile = tilesMap[rightId];
                        const rightLogValue = rightTile.value > 0 ? Math.log2(rightTile.value) : 0;
                        const diff = Math.abs(logValue - rightLogValue);
                        smoothnessScore -= diff;
                    }
                }

                // 下の隣接タイル
                if (row < this.game.gridSize - 1) {
                    const downId = grid[row + 1][col];
                    if (downId !== null) {
                        const downTile = tilesMap[downId];
                        const downLogValue = downTile.value > 0 ? Math.log2(downTile.value) : 0;
                        const diff = Math.abs(logValue - downLogValue);
                        smoothnessScore -= diff;
                    }
                }
            }
        }

        // D. 1と2のペアリング (Adjacency)
        let adjacencyScore = 0;
        for (let row = 0; row < this.game.gridSize; row++) {
            for (let col = 0; col < this.game.gridSize; col++) {
                const tileId = grid[row][col];
                if (tileId === null) continue;

                const tile = tilesMap[tileId];

                // 1と2の処理
                if (tile.value === 1 || tile.value === 2) {
                    const neighbors = [];

                    // 上下左右の隣接タイル
                    if (row > 0 && grid[row - 1][col] !== null) {
                        neighbors.push(tilesMap[grid[row - 1][col]].value);
                    }
                    if (row < this.game.gridSize - 1 && grid[row + 1][col] !== null) {
                        neighbors.push(tilesMap[grid[row + 1][col]].value);
                    }
                    if (col > 0 && grid[row][col - 1] !== null) {
                        neighbors.push(tilesMap[grid[row][col - 1]].value);
                    }
                    if (col < this.game.gridSize - 1 && grid[row][col + 1] !== null) {
                        neighbors.push(tilesMap[grid[row][col + 1]].value);
                    }

                    neighbors.forEach(neighborValue => {
                        if (tile.value === 1 && neighborValue === 2) {
                            adjacencyScore += 10; // 1の隣に2: ボーナス
                        } else if (tile.value === 2 && neighborValue === 1) {
                            adjacencyScore += 10; // 2の隣に1: ボーナス
                        } else if (tile.value === 1 && neighborValue === 1) {
                            adjacencyScore -= 5; // 1の隣に1: ペナルティ
                        } else if (tile.value === 2 && neighborValue === 2) {
                            adjacencyScore -= 5; // 2の隣に2: ペナルティ
                        } else if (tile.value === 1 && neighborValue >= 3) {
                            adjacencyScore -= 3; // 1の隣に3以上: 軽いペナルティ
                        } else if (tile.value === 2 && neighborValue >= 3) {
                            adjacencyScore -= 3; // 2の隣に3以上: 軽いペナルティ
                        }
                    });
                }
            }
        }

        // E. コーナー固定・アンカーボーナス (Corner Integrity) - 最優先戦略
        let cornerIntegrityScore = 0;

        // 最大タイルを見つける
        let maxTileValue = 0;
        let maxTilePos = null;
        tiles.forEach(tile => {
            if (tile.value > maxTileValue) {
                maxTileValue = tile.value;
                maxTilePos = { row: tile.row, col: tile.col };
            }
        });

        if (maxTilePos) {
            const targetCornerRow = 0;  // 左上コーナー
            const targetCornerCol = 0;

            // コーナー判定: (0,0)に最大タイルがある場合
            if (maxTilePos.row === targetCornerRow && maxTilePos.col === targetCornerCol) {
                // 巨大なボーナス（最大値 × 1000）
                cornerIntegrityScore += maxTileValue * 1000;
            }
            // エッジ判定: 壁際（行0 または 列0）にある場合
            else if (maxTilePos.row === targetCornerRow || maxTilePos.col === targetCornerCol) {
                // 中程度のボーナス（リカバリー可能）
                cornerIntegrityScore += maxTileValue * 300;
            }
            // ペナルティ: 壁から離れている場合
            else {
                // 大幅な減点
                cornerIntegrityScore -= maxTileValue * 500;
            }
        }

        // F. 重み付け勾配マップ (Gradient Map / Weighted Matrix)
        // 左上をターゲットとする場合のマップ
        const weightMap = [
            [4096, 1024, 256, 64],
            [16, 32, 64, 128],
            [8, 4, 2, 1],
            [0, 0, 0, 0]
        ];

        let weightedPositionScore = 0;
        for (let row = 0; row < this.game.gridSize; row++) {
            for (let col = 0; col < this.game.gridSize; col++) {
                const tileId = grid[row][col];
                if (tileId !== null) {
                    const tile = tilesMap[tileId];
                    weightedPositionScore += tile.value * weightMap[row][col];
                }
            }
        }

        // 最終スコアの計算
        const finalScore =
            w1 * opennessScore +
            w2 * monotonicityScore +
            w3 * smoothnessScore +
            w4 * adjacencyScore +
            w5 * cornerIntegrityScore +
            weightedPositionScore;  // Gradient Mapは重みなしで直接加算

        return finalScore;
    }

    canMoveInDirection(direction) {
        const grid = this.game.getGrid();

        if (direction === 'left') {
            for (let row = 0; row < this.game.gridSize; row++) {
                for (let col = 1; col < this.game.gridSize; col++) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = this.game.tiles[tileId];
                    const targetCol = col - 1;

                    if (grid[row][targetCol] === null) {
                        return true;
                    }

                    const targetTileId = grid[row][targetCol];
                    const targetTile = this.game.tiles[targetTileId];
                    if (this.canMerge(tile.value, targetTile.value)) {
                        return true;
                    }
                }
            }
        } else if (direction === 'right') {
            for (let row = 0; row < this.game.gridSize; row++) {
                for (let col = this.game.gridSize - 2; col >= 0; col--) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = this.game.tiles[tileId];
                    const targetCol = col + 1;

                    if (grid[row][targetCol] === null) {
                        return true;
                    }

                    const targetTileId = grid[row][targetCol];
                    const targetTile = this.game.tiles[targetTileId];
                    if (this.canMerge(tile.value, targetTile.value)) {
                        return true;
                    }
                }
            }
        } else if (direction === 'up') {
            for (let col = 0; col < this.game.gridSize; col++) {
                for (let row = 1; row < this.game.gridSize; row++) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = this.game.tiles[tileId];
                    const targetRow = row - 1;

                    if (grid[targetRow][col] === null) {
                        return true;
                    }

                    const targetTileId = grid[targetRow][col];
                    const targetTile = this.game.tiles[targetTileId];
                    if (this.canMerge(tile.value, targetTile.value)) {
                        return true;
                    }
                }
            }
        } else if (direction === 'down') {
            for (let col = 0; col < this.game.gridSize; col++) {
                for (let row = this.game.gridSize - 2; row >= 0; row--) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = this.game.tiles[tileId];
                    const targetRow = row + 1;

                    if (grid[targetRow][col] === null) {
                        return true;
                    }

                    const targetTileId = grid[targetRow][col];
                    const targetTile = this.game.tiles[targetTileId];
                    if (this.canMerge(tile.value, targetTile.value)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    canMerge(value1, value2) {
        // 1と2は3になる
        if ((value1 === 1 && value2 === 2) || (value1 === 2 && value2 === 1)) {
            return true;
        }
        // 3以上は同じ数字同士でマージ
        if (value1 === value2 && value1 >= 3) {
            return true;
        }
        return false;
    }

    getMergedValue(value1, value2) {
        // 1と2は3になる
        if ((value1 === 1 && value2 === 2) || (value1 === 2 && value2 === 1)) {
            return 3;
        }
        // 3以上は同じ数字同士で2倍
        if (value1 === value2 && value1 >= 3) {
            return value1 * 2;
        }
        return value1;
    }
}
