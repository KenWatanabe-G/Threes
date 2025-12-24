class ThreesGame {
    constructor() {
        this.gridSize = 4;
        this.tiles = {}; // タイルオブジェクトを保持
        this.nextTileId = 0;
        this.score = 0;
        this.bestScore = localStorage.getItem('threes-best-score') || 0;

        this.gameBoard = document.getElementById('game-board');
        this.scoreElement = document.getElementById('score');
        this.bestElement = document.getElementById('best');
        this.finalScoreElement = document.getElementById('final-score');
        this.gameOverElement = document.getElementById('game-over');
        this.aiIndicatorElement = document.getElementById('ai-indicator');
        this.nextTileElement = document.getElementById('next-tile');

        this.touchStartX = 0;
        this.touchStartY = 0;
        this.isMoving = false;

        // デッキシステム（12枚のカード）
        this.deck = [];
        this.initializeDeck();

        // 次のタイル
        this.nextTileValue = null;
        this.nextTileIsBonus = false;

        // AI自動操作
        this.aiMode = false;
        this.aiInterval = null;
        this.aiSpeed = 300; // ミリ秒

        // トランスポジションテーブル
        this.transpositionTable = new Map();

        this.init();
    }

    initializeDeck() {
        // 12枚のデッキ：1が4枚、2が4枚、3が4枚
        this.deck = [
            1, 1, 1, 1,
            2, 2, 2, 2,
            3, 3, 3, 3
        ];
        this.shuffleDeck();
    }

    shuffleDeck() {
        // Fisher-Yatesシャッフル
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    drawFromDeck() {
        // デッキが空になったら補充
        if (this.deck.length === 0) {
            this.initializeDeck();
        }

        // デッキから1枚引く
        return this.deck.pop();
    }

    getMaxTileValue() {
        let maxValue = 0;
        Object.values(this.tiles).forEach(tile => {
            if (tile.value > maxValue) {
                maxValue = tile.value;
            }
        });
        return maxValue;
    }

    shouldGenerateBonusCard() {
        const maxTile = this.getMaxTileValue();
        // 48以上のタイルがある場合のみボーナスカード出現
        return maxTile >= 48;
    }

    generateBonusCardValue() {
        const maxTile = this.getMaxTileValue();
        const bonusLimit = Math.floor(maxTile / 8);

        // 6から bonusLimit までのいずれかをランダムに選択
        const possibleValues = [];
        let value = 6;
        while (value <= bonusLimit) {
            possibleValues.push(value);
            value *= 2;
        }

        if (possibleValues.length === 0) {
            return 6; // 最低でも6
        }

        return possibleValues[Math.floor(Math.random() * possibleValues.length)];
    }

    init() {
        this.setupGrid();
        this.setupEventListeners();
        this.updateBestScore();
        this.startGame();
    }

    setupGrid() {
        // グリッドセルを作成
        this.gameBoard.innerHTML = '';
        for (let i = 0; i < this.gridSize * this.gridSize; i++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            this.gameBoard.appendChild(cell);
        }
    }

    setupEventListeners() {
        // キーボード操作
        document.addEventListener('keydown', (e) => {
            if (this.isMoving) return;

            switch(e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this.move('up');
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.move('down');
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.move('left');
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.move('right');
                    break;
            }
        });

        // タッチ操作
        this.gameBoard.addEventListener('touchstart', (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        }, { passive: true });

        this.gameBoard.addEventListener('touchend', (e) => {
            if (this.isMoving) return;

            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;

            const deltaX = touchEndX - this.touchStartX;
            const deltaY = touchEndY - this.touchStartY;

            const minSwipeDistance = 30;

            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                if (Math.abs(deltaX) > minSwipeDistance) {
                    this.move(deltaX > 0 ? 'right' : 'left');
                }
            } else {
                if (Math.abs(deltaY) > minSwipeDistance) {
                    this.move(deltaY > 0 ? 'down' : 'up');
                }
            }
        }, { passive: true });

        // ボタン
        document.getElementById('new-game').addEventListener('click', () => {
            this.startGame();
        });

        document.getElementById('restart-button').addEventListener('click', () => {
            this.startGame();
        });

        // AI自動操作ボタン
        document.getElementById('ai-toggle').addEventListener('click', () => {
            this.toggleAI();
        });
    }

    toggleAI() {
        this.aiMode = !this.aiMode;
        const button = document.getElementById('ai-toggle');

        if (this.aiMode) {
            button.textContent = 'AI自動操作 停止';
            button.classList.add('active');
            this.aiIndicatorElement.classList.remove('hidden');
            this.startAI();
        } else {
            button.textContent = 'AI自動操作 開始';
            button.classList.remove('active');
            this.aiIndicatorElement.classList.add('hidden');
            this.stopAI();
        }
    }

    startAI() {
        if (this.aiInterval) return;

        this.aiInterval = setInterval(() => {
            if (this.isMoving) return;

            const validMoves = this.getValidMoves();
            if (validMoves.length === 0) {
                this.stopAI();
                return;
            }

            // 最適な移動を選択
            const bestMove = this.getBestMove();
            if (bestMove) {
                this.move(bestMove);
            }
        }, this.aiSpeed);
    }

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
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
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

                const newTileId = this.nextTileId + 1000 + i; // 仮のID
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
        this.deck.forEach(value => {
            deckCounts[value]++;
        });

        const totalCards = this.deck.length || 12; // デッキが空なら次のデッキ

        // 次のタイルが確定している場合（プレビュー情報）
        if (this.nextTileValue !== null && !this.nextTileIsBonus) {
            probabilities.push({ value: this.nextTileValue, probability: 1.0 });
            return probabilities;
        }

        // ボーナスカードの可能性
        if (this.shouldGenerateBonusCard() && this.nextTileValue === null) {
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

    // 状態をシミュレート（grid, tilesを受け取る）
    simulateMoveOnState(grid, tiles, direction) {
        const tilesMap = {};
        tiles.forEach(t => {
            tilesMap[t.id] = { ...t };
        });

        const newGrid = grid.map(row => [...row]);
        let moved = false;

        if (direction === 'left') {
            for (let row = 0; row < this.gridSize; row++) {
                for (let col = 1; col < this.gridSize; col++) {
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
            for (let row = 0; row < this.gridSize; row++) {
                for (let col = this.gridSize - 2; col >= 0; col--) {
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
            for (let col = 0; col < this.gridSize; col++) {
                for (let row = 1; row < this.gridSize; row++) {
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
            for (let col = 0; col < this.gridSize; col++) {
                for (let row = this.gridSize - 2; row >= 0; row--) {
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
        const tilesCopy = JSON.parse(JSON.stringify(Object.values(this.tiles).map(t => ({
            id: t.id,
            value: t.value,
            row: t.row,
            col: t.col
        }))));

        const tilesMap = {};
        tilesCopy.forEach(t => {
            tilesMap[t.id] = t;
        });

        const grid = Array(this.gridSize).fill(null).map(() => Array(this.gridSize).fill(null));
        tilesCopy.forEach(tile => {
            grid[tile.row][tile.col] = tile.id;
        });

        // 移動をシミュレート
        let moved = false;

        if (direction === 'left') {
            for (let row = 0; row < this.gridSize; row++) {
                for (let col = 1; col < this.gridSize; col++) {
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
            for (let row = 0; row < this.gridSize; row++) {
                for (let col = this.gridSize - 2; col >= 0; col--) {
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
            for (let col = 0; col < this.gridSize; col++) {
                for (let row = 1; row < this.gridSize; row++) {
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
            for (let col = 0; col < this.gridSize; col++) {
                for (let row = this.gridSize - 2; row >= 0; row--) {
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
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                if (grid[row][col] === null) emptyCells++;
            }
        }
        const opennessScore = Math.pow(emptyCells, 2); // 空きマスの2乗

        // B. 単調性 (Monotonicity) / 蛇行配置
        // 左上隅から「左→右」→「右→左」→「左→右」... と蛇行するルート
        const snakePath = [];
        for (let row = 0; row < this.gridSize; row++) {
            if (row % 2 === 0) {
                // 偶数行: 左→右
                for (let col = 0; col < this.gridSize; col++) {
                    const tileId = grid[row][col];
                    if (tileId !== null) {
                        snakePath.push(tilesMap[tileId].value);
                    } else {
                        snakePath.push(0);
                    }
                }
            } else {
                // 奇数行: 右→左
                for (let col = this.gridSize - 1; col >= 0; col--) {
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
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const tileId = grid[row][col];
                if (tileId === null) continue;

                const tile = tilesMap[tileId];
                const logValue = tile.value > 0 ? Math.log2(tile.value) : 0;

                // 右の隣接タイル
                if (col < this.gridSize - 1) {
                    const rightId = grid[row][col + 1];
                    if (rightId !== null) {
                        const rightTile = tilesMap[rightId];
                        const rightLogValue = rightTile.value > 0 ? Math.log2(rightTile.value) : 0;
                        const diff = Math.abs(logValue - rightLogValue);
                        smoothnessScore -= diff;
                    }
                }

                // 下の隣接タイル
                if (row < this.gridSize - 1) {
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
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
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
                    if (row < this.gridSize - 1 && grid[row + 1][col] !== null) {
                        neighbors.push(tilesMap[grid[row + 1][col]].value);
                    }
                    if (col > 0 && grid[row][col - 1] !== null) {
                        neighbors.push(tilesMap[grid[row][col - 1]].value);
                    }
                    if (col < this.gridSize - 1 && grid[row][col + 1] !== null) {
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
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
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

    stopAI() {
        if (this.aiInterval) {
            clearInterval(this.aiInterval);
            this.aiInterval = null;
        }
    }

    getValidMoves() {
        const directions = ['up', 'down', 'left', 'right'];
        const validMoves = [];

        // 各方向をシミュレートして有効な移動を判定
        directions.forEach(direction => {
            const canMove = this.canMoveInDirection(direction);
            if (canMove) {
                validMoves.push(direction);
            }
        });

        return validMoves;
    }

    canMoveInDirection(direction) {
        const grid = this.getGrid();

        if (direction === 'left') {
            for (let row = 0; row < this.gridSize; row++) {
                for (let col = 1; col < this.gridSize; col++) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = this.tiles[tileId];
                    const targetCol = col - 1;

                    if (grid[row][targetCol] === null) {
                        return true;
                    }

                    const targetTileId = grid[row][targetCol];
                    const targetTile = this.tiles[targetTileId];
                    if (this.canMerge(tile.value, targetTile.value)) {
                        return true;
                    }
                }
            }
        } else if (direction === 'right') {
            for (let row = 0; row < this.gridSize; row++) {
                for (let col = this.gridSize - 2; col >= 0; col--) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = this.tiles[tileId];
                    const targetCol = col + 1;

                    if (grid[row][targetCol] === null) {
                        return true;
                    }

                    const targetTileId = grid[row][targetCol];
                    const targetTile = this.tiles[targetTileId];
                    if (this.canMerge(tile.value, targetTile.value)) {
                        return true;
                    }
                }
            }
        } else if (direction === 'up') {
            for (let col = 0; col < this.gridSize; col++) {
                for (let row = 1; row < this.gridSize; row++) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = this.tiles[tileId];
                    const targetRow = row - 1;

                    if (grid[targetRow][col] === null) {
                        return true;
                    }

                    const targetTileId = grid[targetRow][col];
                    const targetTile = this.tiles[targetTileId];
                    if (this.canMerge(tile.value, targetTile.value)) {
                        return true;
                    }
                }
            }
        } else if (direction === 'down') {
            for (let col = 0; col < this.gridSize; col++) {
                for (let row = this.gridSize - 2; row >= 0; row--) {
                    const tileId = grid[row][col];
                    if (tileId === null) continue;

                    const tile = this.tiles[tileId];
                    const targetRow = row + 1;

                    if (grid[targetRow][col] === null) {
                        return true;
                    }

                    const targetTileId = grid[targetRow][col];
                    const targetTile = this.tiles[targetTileId];
                    if (this.canMerge(tile.value, targetTile.value)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    startGame() {
        // AI停止
        if (this.aiMode) {
            this.toggleAI();
        }

        this.tiles = {};
        this.nextTileId = 0;
        this.score = 0;
        this.updateScore();
        this.gameOverElement.classList.add('hidden');

        // デッキをリセット
        this.initializeDeck();

        // 既存のタイル要素を削除
        const existingTiles = this.gameBoard.querySelectorAll('.tile');
        existingTiles.forEach(tile => tile.remove());

        // 初期タイルを配置（9個のタイル）
        const positions = [];
        for (let i = 0; i < this.gridSize * this.gridSize; i++) {
            positions.push(i);
        }

        // ランダムに9個選択
        for (let i = 0; i < 9; i++) {
            const randomIndex = Math.floor(Math.random() * positions.length);
            const pos = positions.splice(randomIndex, 1)[0];
            const row = Math.floor(pos / this.gridSize);
            const col = pos % this.gridSize;

            this.createTile(this.getRandomTileValue(), row, col);
        }

        // 次のタイルを生成
        this.generateNextTile();

        this.render();
    }

    generateNextTile() {
        // ボーナスカードの判定（3が出た時に一定確率で）
        const baseCard = this.drawFromDeck();

        if (baseCard === 3 && this.shouldGenerateBonusCard()) {
            // 約1/21の確率でボーナスカードに変換
            const shouldBeBonus = Math.random() < (1 / 21);
            if (shouldBeBonus) {
                this.nextTileValue = this.generateBonusCardValue();
                this.nextTileIsBonus = true;
            } else {
                this.nextTileValue = baseCard;
                this.nextTileIsBonus = false;
            }
        } else {
            this.nextTileValue = baseCard;
            this.nextTileIsBonus = false;
        }

        this.updateNextTileDisplay();
    }

    updateNextTileDisplay() {
        if (this.nextTileValue === null) return;

        // ボーナスカードの場合は「+」を追加
        const displayText = this.nextTileIsBonus ? `${this.nextTileValue}+` : this.nextTileValue;
        this.nextTileElement.textContent = displayText;
        this.nextTileElement.className = `next-tile-display tile-${this.nextTileValue}`;
    }

    createTile(value, row, col, isNew = false) {
        const id = this.nextTileId++;
        this.tiles[id] = {
            id: id,
            value: value,
            row: row,
            col: col,
            element: null,
            isNew: isNew,
            merged: false
        };
        return id;
    }

    getRandomTileValue() {
        // 初期配置用：デッキから引く
        return this.drawFromDeck();
    }

    getGrid() {
        // タイルデータからグリッドを生成
        const grid = Array(this.gridSize).fill(null).map(() => Array(this.gridSize).fill(null));

        Object.values(this.tiles).forEach(tile => {
            grid[tile.row][tile.col] = tile.id;
        });

        return grid;
    }

    move(direction) {
        if (this.isMoving) return;

        const beforeMove = JSON.stringify(this.getGrid());
        this.isMoving = true;

        // マージフラグをリセット
        Object.values(this.tiles).forEach(tile => {
            tile.merged = false;
            tile.isNew = false;
        });

        let moved = false;

        switch(direction) {
            case 'left':
                moved = this.moveLeft();
                break;
            case 'right':
                moved = this.moveRight();
                break;
            case 'up':
                moved = this.moveUp();
                break;
            case 'down':
                moved = this.moveDown();
                break;
        }

        const afterMove = JSON.stringify(this.getGrid());

        if (beforeMove !== afterMove && moved) {
            // アニメーションを実行
            this.render();

            // アニメーション完了後に新しいタイルを追加
            setTimeout(() => {
                this.addNewTile(direction);
                this.render();

                setTimeout(() => {
                    if (this.isGameOver()) {
                        this.endGame();
                    }
                    this.isMoving = false;
                }, 20);
            }, 120);
        } else {
            this.isMoving = false;
        }
    }

    moveLeft() {
        let moved = false;
        const grid = this.getGrid();

        // 左から右へ処理（左端から順に）
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 1; col < this.gridSize; col++) {
                const tileId = grid[row][col];
                if (tileId === null) continue;

                const tile = this.tiles[tileId];
                const targetCol = col - 1;

                // 移動先が空の場合
                if (grid[row][targetCol] === null) {
                    tile.col = targetCol;
                    grid[row][targetCol] = tileId;
                    grid[row][col] = null;
                    moved = true;
                }
                // マージ可能な場合
                else {
                    const targetTileId = grid[row][targetCol];
                    const targetTile = this.tiles[targetTileId];

                    if (this.canMerge(tile.value, targetTile.value)) {
                        targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                        targetTile.merged = true;
                        this.score += targetTile.value;
                        this.updateScore();
                        delete this.tiles[tileId];
                        grid[row][col] = null;
                        moved = true;
                    }
                }
            }
        }

        return moved;
    }

    moveRight() {
        let moved = false;
        const grid = this.getGrid();

        // 右から左へ処理（右端から順に）
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = this.gridSize - 2; col >= 0; col--) {
                const tileId = grid[row][col];
                if (tileId === null) continue;

                const tile = this.tiles[tileId];
                const targetCol = col + 1;

                // 移動先が空の場合
                if (grid[row][targetCol] === null) {
                    tile.col = targetCol;
                    grid[row][targetCol] = tileId;
                    grid[row][col] = null;
                    moved = true;
                }
                // マージ可能な場合
                else {
                    const targetTileId = grid[row][targetCol];
                    const targetTile = this.tiles[targetTileId];

                    if (this.canMerge(tile.value, targetTile.value)) {
                        targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                        targetTile.merged = true;
                        this.score += targetTile.value;
                        this.updateScore();
                        delete this.tiles[tileId];
                        grid[row][col] = null;
                        moved = true;
                    }
                }
            }
        }

        return moved;
    }

    moveUp() {
        let moved = false;
        const grid = this.getGrid();

        // 上から下へ処理（上端から順に）
        for (let col = 0; col < this.gridSize; col++) {
            for (let row = 1; row < this.gridSize; row++) {
                const tileId = grid[row][col];
                if (tileId === null) continue;

                const tile = this.tiles[tileId];
                const targetRow = row - 1;

                // 移動先が空の場合
                if (grid[targetRow][col] === null) {
                    tile.row = targetRow;
                    grid[targetRow][col] = tileId;
                    grid[row][col] = null;
                    moved = true;
                }
                // マージ可能な場合
                else {
                    const targetTileId = grid[targetRow][col];
                    const targetTile = this.tiles[targetTileId];

                    if (this.canMerge(tile.value, targetTile.value)) {
                        targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                        targetTile.merged = true;
                        this.score += targetTile.value;
                        this.updateScore();
                        delete this.tiles[tileId];
                        grid[row][col] = null;
                        moved = true;
                    }
                }
            }
        }

        return moved;
    }

    moveDown() {
        let moved = false;
        const grid = this.getGrid();

        // 下から上へ処理（下端から順に）
        for (let col = 0; col < this.gridSize; col++) {
            for (let row = this.gridSize - 2; row >= 0; row--) {
                const tileId = grid[row][col];
                if (tileId === null) continue;

                const tile = this.tiles[tileId];
                const targetRow = row + 1;

                // 移動先が空の場合
                if (grid[targetRow][col] === null) {
                    tile.row = targetRow;
                    grid[targetRow][col] = tileId;
                    grid[row][col] = null;
                    moved = true;
                }
                // マージ可能な場合
                else {
                    const targetTileId = grid[targetRow][col];
                    const targetTile = this.tiles[targetTileId];

                    if (this.canMerge(tile.value, targetTile.value)) {
                        targetTile.value = this.getMergedValue(tile.value, targetTile.value);
                        targetTile.merged = true;
                        this.score += targetTile.value;
                        this.updateScore();
                        delete this.tiles[tileId];
                        grid[row][col] = null;
                        moved = true;
                    }
                }
            }
        }

        return moved;
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


    addNewTile(direction) {
        const grid = this.getGrid();
        const emptyCells = [];

        // 方向に応じて新しいタイルを追加する位置を決定
        if (direction === 'left') {
            for (let row = 0; row < this.gridSize; row++) {
                if (grid[row][this.gridSize - 1] === null) {
                    emptyCells.push({ row, col: this.gridSize - 1 });
                }
            }
        } else if (direction === 'right') {
            for (let row = 0; row < this.gridSize; row++) {
                if (grid[row][0] === null) {
                    emptyCells.push({ row, col: 0 });
                }
            }
        } else if (direction === 'up') {
            for (let col = 0; col < this.gridSize; col++) {
                if (grid[this.gridSize - 1][col] === null) {
                    emptyCells.push({ row: this.gridSize - 1, col });
                }
            }
        } else if (direction === 'down') {
            for (let col = 0; col < this.gridSize; col++) {
                if (grid[0][col] === null) {
                    emptyCells.push({ row: 0, col });
                }
            }
        }

        if (emptyCells.length > 0) {
            const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
            // 次のタイルの値を使用
            this.createTile(this.nextTileValue, randomCell.row, randomCell.col, true);
            // 新しい次のタイルを生成
            this.generateNextTile();
        }
    }

    isGameOver() {
        const grid = this.getGrid();

        // 空きセルがあるかチェック
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                if (grid[row][col] === null) {
                    return false;
                }
            }
        }

        // マージ可能なタイルがあるかチェック
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const currentId = grid[row][col];
                const current = this.tiles[currentId].value;

                // 右のセル
                if (col < this.gridSize - 1) {
                    const rightId = grid[row][col + 1];
                    const right = this.tiles[rightId].value;
                    if ((current === 1 && right === 2) || (current === 2 && right === 1) ||
                        (current === right && current >= 3)) {
                        return false;
                    }
                }

                // 下のセル
                if (row < this.gridSize - 1) {
                    const downId = grid[row + 1][col];
                    const down = this.tiles[downId].value;
                    if ((current === 1 && down === 2) || (current === 2 && down === 1) ||
                        (current === down && current >= 3)) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    endGame() {
        // AI停止
        if (this.aiMode) {
            this.toggleAI();
        }

        this.finalScoreElement.textContent = this.score;
        this.gameOverElement.classList.remove('hidden');

        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            localStorage.setItem('threes-best-score', this.bestScore);
            this.updateBestScore();
        }
    }

    updateScore() {
        this.scoreElement.textContent = this.score;
    }

    updateBestScore() {
        this.bestElement.textContent = this.bestScore;
    }

    render() {
        const cellSize = 100 / this.gridSize;
        const gap = 0.8;

        Object.values(this.tiles).forEach(tile => {
            if (!tile.element) {
                // 新しいタイル要素を作成
                tile.element = document.createElement('div');
                tile.element.classList.add('tile', `tile-${tile.value}`);
                tile.element.textContent = tile.value;
                tile.element.dataset.tileId = tile.id;

                const left = tile.col * cellSize + gap;
                const top = tile.row * cellSize + gap;
                const size = cellSize - gap * 2;

                tile.element.style.left = `${left}%`;
                tile.element.style.top = `${top}%`;
                tile.element.style.width = `${size}%`;
                tile.element.style.height = `${size}%`;

                if (tile.isNew) {
                    tile.element.classList.add('tile-new');
                }

                this.gameBoard.appendChild(tile.element);
            } else {
                // 既存のタイル要素を更新
                const left = tile.col * cellSize + gap;
                const top = tile.row * cellSize + gap;
                const size = cellSize - gap * 2;

                // クラスを更新（値が変わった場合）
                tile.element.className = `tile tile-${tile.value}`;
                tile.element.textContent = tile.value;

                // 位置を更新（アニメーション）
                tile.element.style.left = `${left}%`;
                tile.element.style.top = `${top}%`;
                tile.element.style.width = `${size}%`;
                tile.element.style.height = `${size}%`;

                if (tile.merged) {
                    tile.element.classList.add('tile-merged');
                    // アニメーション後にクラスを削除
                    setTimeout(() => {
                        tile.element.classList.remove('tile-merged');
                    }, 150);
                }

                if (tile.isNew) {
                    tile.element.classList.add('tile-new');
                    setTimeout(() => {
                        tile.element.classList.remove('tile-new');
                    }, 150);
                }
            }
        });

        // 削除されたタイルの要素を削除
        const existingElements = this.gameBoard.querySelectorAll('.tile');
        existingElements.forEach(element => {
            const tileId = parseInt(element.dataset.tileId);
            if (!this.tiles[tileId]) {
                element.remove();
            }
        });
    }
}

// ゲームを開始
document.addEventListener('DOMContentLoaded', () => {
    new ThreesGame();
});
