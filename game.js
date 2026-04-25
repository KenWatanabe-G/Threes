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
        this.ratingElement = document.getElementById('rating');
        this.ratingTierElement = document.getElementById('rating-tier');
        this.finalScoreElement = document.getElementById('final-score');
        this.playRatingElement = document.getElementById('play-rating');
        this.playerRatingSummaryElement = document.getElementById('player-rating-summary');
        this.ratingDeltaElement = document.getElementById('rating-delta');
        this.peakRatingElement = document.getElementById('peak-rating');
        this.gameOverElement = document.getElementById('game-over');
        this.nextTileElement = document.getElementById('next-tile');

        this.touchStartX = 0;
        this.touchStartY = 0;
        this.isMoving = false;

        // ドラッグ追従システム
        this.isDragging = false;
        this.dragDirection = null;
        this.dragOffset = 0;
        this.commitThreshold = 0; // 動的に計算（初期化時に設定）
        this.movableTilesCache = null; // 移動可能タイルのキャッシュ

        // デッキシステム（12枚のカード）
        this.deck = [];
        this.initializeDeck();

        // 次のタイル
        this.nextTileValue = null;
        this.nextTileIsBonus = false;

        // Undo用の履歴
        this.history = []; // ゲーム状態のスナップショット
        this.maxHistorySize = 10; // 最大10手まで戻せる

        // 削除モード
        this.deleteMode = false;

        // AI 自動操作 (マルチ Worker root parallelism)
        this.aiMode = false;
        this.aiWorkers = [];     // Worker pool
        this.aiPoolSize = 4;     // root move 4 つを並列評価
        this.aiRequestId = 0;
        this.aiPending = null;   // { requestId, scores: number[4], received: number, moves: number[] }
        this.aiIndicatorElement = document.getElementById('ai-indicator');

        // ランキング用フラグ
        this.usedUndo = false;      // Undoを使用したか
        this.usedDelete = false;    // 削除機能を使用したか

        // クライアントID（ランキング用）
        this.clientId = this.getOrCreateClientId();

        // プレイ回数
        this.playCount = parseInt(localStorage.getItem('threes-gameover-count') || '0');

        // プレイヤースキルレーティング
        this.skillStats = this.loadSkillStats();

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
        this.setupRankingEventListeners();
        this.updateBestScore();
        this.updateRatingDisplay();

        // 保存されたゲーム状態があれば復元、なければ新規ゲーム開始
        // ただしゲームオーバー状態だった場合は新しいゲームを開始
        const savedState = this.loadGameState();
        if (savedState && savedState.tiles && savedState.tiles.length > 0 && !savedState.gameOver) {
            this.restoreGameState(savedState);
        } else {
            this.startGame();
        }
    }

    setupGrid() {
        // グリッドセルを作成
        this.gameBoard.innerHTML = '';
        for (let i = 0; i < this.gridSize * this.gridSize; i++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            this.gameBoard.appendChild(cell);
        }

        // コミット閾値を計算（セルサイズの90%）
        setTimeout(() => {
            const cellSize = this.gameBoard.offsetWidth / this.gridSize;
            this.commitThreshold = cellSize * 0.9; // セルサイズの90%
        }, 0);
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

        // タッチ操作（ドラッグ追従システム）
        this.gameBoard.addEventListener('touchstart', (e) => {
            if (this.isMoving || this.deleteMode) return;

            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.isDragging = true;
            this.dragDirection = null;
            this.dragOffset = 0;
            this.movableTilesCache = null;
            e.preventDefault();
        }, { passive: false });

        this.gameBoard.addEventListener('touchmove', (e) => {
            if (!this.isDragging || this.isMoving) return;

            const touchCurrentX = e.touches[0].clientX;
            const touchCurrentY = e.touches[0].clientY;

            const deltaX = touchCurrentX - this.touchStartX;
            const deltaY = touchCurrentY - this.touchStartY;

            // 方向を決定（まだ決まっていない場合）
            if (!this.dragDirection) {
                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    if (Math.abs(deltaX) > Math.abs(deltaY)) {
                        this.dragDirection = deltaX > 0 ? 'right' : 'left';
                    } else {
                        this.dragDirection = deltaY > 0 ? 'down' : 'up';
                    }
                }
            }

            // 方向に沿った移動量を計算（スワイプ距離の2倍で移動）
            if (this.dragDirection) {
                const sensitivity = 2; // 感度倍率
                if (this.dragDirection === 'left') {
                    this.dragOffset = Math.max(Math.min(deltaX * sensitivity, 0), -this.commitThreshold);
                } else if (this.dragDirection === 'right') {
                    this.dragOffset = Math.min(Math.max(deltaX * sensitivity, 0), this.commitThreshold);
                } else if (this.dragDirection === 'up') {
                    this.dragOffset = Math.max(Math.min(deltaY * sensitivity, 0), -this.commitThreshold);
                } else if (this.dragDirection === 'down') {
                    this.dragOffset = Math.min(Math.max(deltaY * sensitivity, 0), this.commitThreshold);
                }

                this.renderDragPreview();
            }

            e.preventDefault();
        }, { passive: false });

        this.gameBoard.addEventListener('touchend', (e) => {
            if (!this.isDragging) return;

            // 移動中の場合はキャンセル
            if (this.isMoving) {
                this.cancelDrag();
                this.isDragging = false;
                this.dragDirection = null;
                this.dragOffset = 0;
                this.movableTilesCache = null;
                return;
            }

            // 閾値を超えていたら移動を確定
            if (this.dragDirection && Math.abs(this.dragOffset) >= this.commitThreshold) {
                const direction = this.dragDirection;

                // ドラッグ状態をクリア
                this.isDragging = false;
                this.dragDirection = null;
                this.dragOffset = 0;
                this.movableTilesCache = null;

                // 移動を実行
                this.move(direction);
            } else {
                // 閾値未満なら元に戻す
                this.cancelDrag();
                this.isDragging = false;
                this.dragDirection = null;
                this.dragOffset = 0;
                this.movableTilesCache = null;
            }

            e.preventDefault();
        }, { passive: false });

        // touchcancel イベント（OSによるジェスチャー横取り対策）
        this.gameBoard.addEventListener('touchcancel', () => {
            if (this.isDragging) {
                this.cancelDrag();
                this.isDragging = false;
                this.dragDirection = null;
                this.dragOffset = 0;
                this.movableTilesCache = null;
            }
        }, { passive: false });

        // マウス操作（ドラッグ追従システム）
        this.gameBoard.addEventListener('mousedown', (e) => {
            if (this.isMoving || this.deleteMode) return;

            this.touchStartX = e.clientX;
            this.touchStartY = e.clientY;
            this.isDragging = true;
            this.dragDirection = null;
            this.dragOffset = 0;
            this.movableTilesCache = null; // キャッシュをクリア
            e.preventDefault();
        });

        this.gameBoard.addEventListener('mousemove', (e) => {
            if (!this.isDragging || this.isMoving) return;

            const mouseCurrentX = e.clientX;
            const mouseCurrentY = e.clientY;

            const deltaX = mouseCurrentX - this.touchStartX;
            const deltaY = mouseCurrentY - this.touchStartY;

            // 方向を決定（まだ決まっていない場合）
            if (!this.dragDirection) {
                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    if (Math.abs(deltaX) > Math.abs(deltaY)) {
                        this.dragDirection = deltaX > 0 ? 'right' : 'left';
                    } else {
                        this.dragDirection = deltaY > 0 ? 'down' : 'up';
                    }
                }
            }

            // 方向に沿った移動量を計算（スワイプ距離の2倍で移動）
            if (this.dragDirection) {
                const sensitivity = 2; // 感度倍率
                if (this.dragDirection === 'left') {
                    // 左方向: 負の値、0より小さく、-commitThresholdより大きい
                    this.dragOffset = Math.max(Math.min(deltaX * sensitivity, 0), -this.commitThreshold);
                } else if (this.dragDirection === 'right') {
                    // 右方向: 正の値、0より大きく、commitThresholdより小さい
                    this.dragOffset = Math.min(Math.max(deltaX * sensitivity, 0), this.commitThreshold);
                } else if (this.dragDirection === 'up') {
                    // 上方向: 負の値、0より小さく、-commitThresholdより大きい
                    this.dragOffset = Math.max(Math.min(deltaY * sensitivity, 0), -this.commitThreshold);
                } else if (this.dragDirection === 'down') {
                    // 下方向: 正の値、0より大きく、commitThresholdより小さい
                    this.dragOffset = Math.min(Math.max(deltaY * sensitivity, 0), this.commitThreshold);
                }

                // タイルを移動量に応じて表示
                this.renderDragPreview();
            }

            e.preventDefault();
        });

        this.gameBoard.addEventListener('mouseup', (e) => {
            if (!this.isDragging) {
                return;
            }

            // 移動中の場合はキャンセル
            if (this.isMoving) {
                this.cancelDrag();
                this.isDragging = false;
                this.dragDirection = null;
                this.dragOffset = 0;
                this.movableTilesCache = null;
                return;
            }

            // 閾値を超えていたら移動を確定
            if (this.dragDirection && Math.abs(this.dragOffset) >= this.commitThreshold) {
                const direction = this.dragDirection;

                // ドラッグ状態をクリア
                this.isDragging = false;
                this.dragDirection = null;
                this.dragOffset = 0;
                this.movableTilesCache = null;

                // 移動を実行
                this.move(direction);
            } else {
                // 閾値未満なら元に戻す
                this.cancelDrag();
                this.isDragging = false;
                this.dragDirection = null;
                this.dragOffset = 0;
                this.movableTilesCache = null;
            }

            e.preventDefault();
        });

        this.gameBoard.addEventListener('mouseleave', () => {
            // マウスがボードから離れたらキャンセル
            if (this.isDragging) {
                this.cancelDrag();
                this.isDragging = false;
                this.dragDirection = null;
                this.dragOffset = 0;
                this.movableTilesCache = null;
            }
        });

        // ボタン
        document.getElementById('new-game').addEventListener('click', () => {
            this.startGame();
        });

        document.getElementById('restart-button').addEventListener('click', () => {
            this.startGame();
        });

        // Undoボタン
        document.getElementById('undo-button').addEventListener('click', () => {
            this.undo();
        });

        // 削除モードボタン
        document.getElementById('delete-mode-button').addEventListener('click', () => {
            this.toggleDeleteMode();
        });

        // AI自動操作ボタン
        document.getElementById('ai-toggle').addEventListener('click', () => {
            this.toggleAI();
        });

        // クリップボードコピーボタン
        document.getElementById('copy-board-button').addEventListener('click', () => {
            this.copyBoardToClipboard();
        });
    }

    // ---- AI 自動操作 ----

    toggleAI() {
        if (this.aiMode) {
            this.stopAI();
        } else {
            this.startAI();
        }
    }

    startAI() {
        if (this.aiMode) return;
        this.aiMode = true;
        const button = document.getElementById('ai-toggle');
        button.classList.add('active');
        this.aiIndicatorElement.classList.remove('hidden');
        this.updateUndoButton();

        if (this.aiWorkers.length === 0) {
            for (let i = 0; i < this.aiPoolSize; i++) {
                let w;
                try {
                    w = new Worker('ai/worker.js');
                } catch (e) {
                    console.error('AI worker construction failed:', e.message);
                    this.stopAI();
                    return;
                }
                w.addEventListener('message', (ev) => this.handleAIMessage(ev));
                w.addEventListener('error', (ev) => {
                    console.error('AI worker error:', ev.message);
                    this.stopAI();
                });
                this.aiWorkers.push(w);
            }
        }

        this.requestAINextMove();
    }

    stopAI() {
        if (!this.aiMode) return;
        this.aiMode = false;
        this.aiPending = null;
        const button = document.getElementById('ai-toggle');
        button.classList.remove('active');
        this.aiIndicatorElement.classList.add('hidden');
        this.updateUndoButton();
    }

    // root move 4 つを Worker pool に fan-out
    requestAINextMove() {
        if (!this.aiMode || this.aiWorkers.length === 0) return;
        if (this.isMoving) return;
        if (this.isGameOver()) {
            this.stopAI();
            return;
        }

        const requestId = ++this.aiRequestId;
        this.aiPending = {
            requestId,
            scores: [-Infinity, -Infinity, -Infinity, -Infinity],
            received: 0
        };
        const grid = this.getValueGrid();
        const deck = [...this.deck];
        const nextTileValue = this.nextTileValue;
        const nextTileIsBonus = this.nextTileIsBonus;

        for (let m = 0; m < 4; m++) {
            const worker = this.aiWorkers[m % this.aiWorkers.length];
            worker.postMessage({
                requestId,
                rootMove: m,
                grid,
                deck,
                nextTileValue,
                nextTileIsBonus
            });
        }
    }

    handleAIMessage(event) {
        const { requestId, rootMove, score } = event.data;
        if (!this.aiMode) return;
        if (!this.aiPending || requestId !== this.aiPending.requestId) return;
        if (typeof rootMove !== 'number') return;

        this.aiPending.scores[rootMove] = score;
        this.aiPending.received++;
        if (this.aiPending.received < 4) return;

        // 4 root すべて返ってきた。最大スコアの方向を選ぶ
        const scores = this.aiPending.scores;
        this.aiPending = null;

        let bestScore = 0;
        let bestMove = -1;
        for (let m = 0; m < 4; m++) {
            if (scores[m] > bestScore) {
                bestScore = scores[m];
                bestMove = m;
            }
        }
        if (bestMove < 0) {
            this.stopAI();
            return;
        }
        const moveNames = ['up', 'down', 'left', 'right'];
        this.move(moveNames[bestMove]);
    }

    // タイル ID のグリッドではなく、各セルの値 (0 = 空) のグリッドを返す
    getValueGrid() {
        const grid = [];
        for (let r = 0; r < this.gridSize; r++) {
            const row = new Array(this.gridSize).fill(0);
            grid.push(row);
        }
        Object.values(this.tiles).forEach(tile => {
            grid[tile.row][tile.col] = tile.value;
        });
        return grid;
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
        if (this.aiMode) this.stopAI();

        // 保存データをクリア
        this.clearGameState();

        this.tiles = {};
        this.nextTileId = 0;
        this.score = 0;
        this.updateScore();
        this.updateRatingDisplay();
        this.gameOverElement.classList.add('hidden');

        const rankingStatusElement = document.getElementById('ranking-status');
        if (rankingStatusElement) {
            rankingStatusElement.textContent = '';
        }

        // ランキング用フラグをリセット
        this.usedUndo = false;
        this.usedDelete = false;

        // 履歴をクリア
        this.history = [];
        this.updateUndoButton();

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

        // 盤面からスコアを計算
        this.updateScore();
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
            merged: false,
            merging: false  // マージ中フラグを追加
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

        // 移動前に状態を保存（Undo用）
        this.saveState();

        this.isMoving = true;

        // マージフラグをリセット & ドラッグ中のtransformをクリア
        Object.values(this.tiles).forEach(tile => {
            tile.merged = false;
            tile.isNew = false;
            tile.merging = false;
            // ドラッグプレビューのtransformをクリア
            if (tile.element) {
                tile.element.style.transform = '';
            }
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
                // 新タイル追加後にスコアを更新
                this.updateScore();

                setTimeout(() => {
                    if (this.isGameOver()) {
                        this.endGame();
                    }
                    this.isMoving = false;
                    // 移動完了後、Undoボタンの状態を更新
                    this.updateUndoButton();
                    // ゲーム状態を自動保存
                    this.saveGameState();
                    // AI 動作中なら次の手を要求
                    if (this.aiMode) this.requestAINextMove();
                }, 20);
            }, 120);
        } else {
            // 移動が起こらなかった場合は、保存した状態を削除
            this.history.pop();
            this.isMoving = false;
            if (this.aiMode) this.stopAI();
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
                        // 移動するタイルに移動先をマーク
                        tile.col = targetCol;
                        tile.merging = true;
                        tile.mergeTarget = targetTileId;
                        tile.mergeValue = this.getMergedValue(tile.value, targetTile.value);

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
                        // 移動するタイルに移動先をマーク
                        tile.col = targetCol;
                        tile.merging = true;
                        tile.mergeTarget = targetTileId;
                        tile.mergeValue = this.getMergedValue(tile.value, targetTile.value);

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
                        // 移動するタイルに移動先をマーク
                        tile.row = targetRow;
                        tile.merging = true;
                        tile.mergeTarget = targetTileId;
                        tile.mergeValue = this.getMergedValue(tile.value, targetTile.value);

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
                        // 移動するタイルに移動先をマーク
                        tile.row = targetRow;
                        tile.merging = true;
                        tile.mergeTarget = targetTileId;
                        tile.mergeValue = this.getMergedValue(tile.value, targetTile.value);

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
        if (this.aiMode) this.stopAI();

        // プレイ回数をインクリメント（ゲームオーバー時にカウント）
        this.playCount++;
        localStorage.setItem('threes-gameover-count', this.playCount.toString());

        const category = this.getRankingCategory();
        const playRating = this.calculatePlayRating(category);
        const ratingUpdate = this.shouldUpdateRating()
            ? this.updatePlayerRatingFromPlay(playRating, category)
            : this.getRatingSummaryWithoutChange(playRating, category);

        this.finalScoreElement.textContent = this.score;
        this.updateRatingSummary(playRating, ratingUpdate);
        this.updateRatingDisplay();
        this.gameOverElement.classList.remove('hidden');

        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            localStorage.setItem('threes-best-score', this.bestScore);
            this.updateBestScore();
        }

        // 自動ランキング登録
        this.autoRegisterRanking();
    }

    // 自動ランキング登録処理
    async autoRegisterRanking() {
        const savedName = this.getPlayerName();
        const statusElement = document.getElementById('ranking-status');

        if (savedName) {
            // 名前が保存されていれば自動登録
            if (statusElement) {
                statusElement.textContent = 'ランキング登録中...';
            }
            const scoreResult = await this.submitScoreUpsert(savedName);
            // プレイ回数も同時に登録
            await this.submitPlayCountAuto(savedName);
            if (statusElement) {
                statusElement.textContent = scoreResult ? 'ランキングに登録しました' : 'ランキング登録に失敗しました';
            }
        } else {
            // 名前がなければモーダルを表示
            if (statusElement) {
                statusElement.textContent = '';
            }
            this.showRankingModal();
        }
    }

    // タイル値から得点を計算（3以上のタイルのみ）
    // タイル値が 3 × 2^n のとき、得点 = 3^(n+1)
    calculateTileScore(value) {
        if (value < 3) return 0;

        // n を求める: value = 3 × 2^n → 2^n = value / 3 → n = log2(value / 3)
        const n = Math.log2(value / 3);
        // 得点 = 3^(n+1)
        return Math.pow(3, n + 1);
    }

    // 盤面全体のスコアを計算
    calculateBoardScore() {
        let totalScore = 0;
        Object.values(this.tiles).forEach(tile => {
            totalScore += this.calculateTileScore(tile.value);
        });
        return totalScore;
    }

    updateScore() {
        this.score = this.calculateBoardScore();
        this.scoreElement.textContent = this.score;
    }

    updateBestScore() {
        this.bestElement.textContent = this.bestScore;
    }

    getDefaultSkillStats() {
        return {
            rating: 1000,
            peakRating: 1000,
            plays: 0,
            lastPlayRating: null,
            lastDelta: 0,
            lastCategory: 'normal',
            recentPlayRatings: []
        };
    }

    loadSkillStats() {
        const saved = localStorage.getItem('threes-player-skill');
        if (!saved) {
            return this.getDefaultSkillStats();
        }

        try {
            const parsed = JSON.parse(saved);
            return {
                ...this.getDefaultSkillStats(),
                ...parsed,
                recentPlayRatings: Array.isArray(parsed.recentPlayRatings) ? parsed.recentPlayRatings : []
            };
        } catch (e) {
            console.error('プレイヤースキルデータの読み込みに失敗しました:', e);
            return this.getDefaultSkillStats();
        }
    }

    saveSkillStats() {
        localStorage.setItem('threes-player-skill', JSON.stringify(this.skillStats));
    }

    getRatingTier(rating) {
        // 通常プレイで 384 / 768 / 1536 / 3072 到達が
        // Silver / Gold / Platinum / Diamond の目安になるように設定
        if (rating >= 2080) return 'ダイヤ';
        if (rating >= 1920) return 'プラチナ';
        if (rating >= 1760) return 'ゴールド';
        if (rating >= 1600) return 'シルバー';
        return 'ブロンズ';
    }

    getRatingCategoryWeight(category) {
        if (category === 'normal') return 1.0;
        if (category === 'with_undo') return 0.65;
        return 0.4;
    }

    shouldUpdateRating() {
        return !this.usedUndo && !this.usedDelete;
    }

    calculatePlayRating(category = this.getRankingCategory()) {
        const scoreComponent = Math.log(this.score + 1) / Math.log(3) * 85;
        const maxTile = Math.max(this.getMaxTileValue(), 3);
        const maxTileStage = Math.max(0, Math.log2(maxTile / 3));
        const maxTileComponent = maxTileStage * 75;

        let playRating = 400 + scoreComponent + maxTileComponent;

        if (category === 'with_undo') {
            playRating *= 0.94;
        } else if (category === 'anything_goes') {
            playRating *= 0.88;
        }

        return Math.max(400, Math.round(playRating));
    }

    updatePlayerRatingFromPlay(playRating, category = this.getRankingCategory()) {
        const previousRating = this.skillStats.rating;
        const categoryWeight = this.getRatingCategoryWeight(category);
        const learningRate = Math.max(0.12, 0.3 - this.skillStats.plays * 0.01) * categoryWeight;
        const rawDelta = (playRating - previousRating) * learningRate;
        const delta = Math.round(Math.max(-75, Math.min(75, rawDelta)));
        const nextRating = Math.max(100, previousRating + delta);

        this.skillStats.rating = nextRating;
        this.skillStats.peakRating = Math.max(this.skillStats.peakRating, nextRating);
        this.skillStats.plays += 1;
        this.skillStats.lastPlayRating = playRating;
        this.skillStats.lastDelta = delta;
        this.skillStats.lastCategory = category;
        this.skillStats.recentPlayRatings.push(playRating);
        this.skillStats.recentPlayRatings = this.skillStats.recentPlayRatings.slice(-20);
        this.saveSkillStats();

        return {
            previousRating,
            nextRating,
            delta
        };
    }

    getRatingSummaryWithoutChange(playRating, category = this.getRankingCategory()) {
        return {
            previousRating: this.skillStats.rating,
            nextRating: this.skillStats.rating,
            delta: 0,
            category,
            ratingLocked: true,
            playRating
        };
    }

    updateRatingDisplay() {
        if (!this.ratingElement || !this.ratingTierElement) return;

        this.ratingElement.textContent = this.skillStats.rating;
        this.ratingTierElement.textContent = this.getRatingTier(this.skillStats.rating);
    }

    updateRatingSummary(playRating, ratingUpdate) {
        if (this.playRatingElement) {
            this.playRatingElement.textContent = `${playRating} (${this.getRatingTier(playRating)})`;
        }

        if (this.playerRatingSummaryElement) {
            this.playerRatingSummaryElement.textContent = `${ratingUpdate.nextRating} (${this.getRatingTier(ratingUpdate.nextRating)})`;
        }

        if (this.ratingDeltaElement) {
            if (ratingUpdate.ratingLocked) {
                this.ratingDeltaElement.textContent = '(変動なし)';
                this.ratingDeltaElement.style.color = '#d6d6d6';
            } else {
                const sign = ratingUpdate.delta > 0 ? '+' : '';
                this.ratingDeltaElement.textContent = `(${sign}${ratingUpdate.delta})`;
                this.ratingDeltaElement.style.color = ratingUpdate.delta >= 0 ? '#9fe6a0' : '#ffb3b3';
            }
        }

        if (this.peakRatingElement) {
            this.peakRatingElement.textContent = this.skillStats.peakRating;
        }
    }

    saveState() {
        // 現在のゲーム状態をスナップショットとして保存
        const state = {
            tiles: JSON.parse(JSON.stringify(Object.values(this.tiles).map(t => ({
                id: t.id,
                value: t.value,
                row: t.row,
                col: t.col
            })))),
            nextTileId: this.nextTileId,
            score: this.score,
            nextTileValue: this.nextTileValue,
            nextTileIsBonus: this.nextTileIsBonus,
            deck: [...this.deck]
        };

        this.history.push(state);

        // 履歴が最大サイズを超えたら古いものを削除
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    canUndo() {
        return this.history.length > 0 && !this.isMoving && !this.isGameOver() && !this.aiMode;
    }

    // 確認ダイアログを表示（Promise版）
    showConfirmDialog(title, message) {
        return new Promise((resolve) => {
            const dialog = document.getElementById('confirm-dialog');
            const titleEl = document.getElementById('confirm-dialog-title');
            const messageEl = document.getElementById('confirm-dialog-message');
            const okButton = document.getElementById('confirm-dialog-ok');
            const cancelButton = document.getElementById('confirm-dialog-cancel');

            titleEl.textContent = title;
            messageEl.textContent = message;
            dialog.classList.remove('hidden');

            const cleanup = () => {
                dialog.classList.add('hidden');
                okButton.removeEventListener('click', handleOk);
                okButton.removeEventListener('touchend', handleOk);
                cancelButton.removeEventListener('click', handleCancel);
                cancelButton.removeEventListener('touchend', handleCancel);
            };

            const handleOk = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cleanup();
                resolve(true);
            };

            const handleCancel = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cleanup();
                resolve(false);
            };

            okButton.addEventListener('click', handleOk);
            okButton.addEventListener('touchend', handleOk);
            cancelButton.addEventListener('click', handleCancel);
            cancelButton.addEventListener('touchend', handleCancel);
        });
    }

    async undo() {
        if (!this.canUndo()) return;

        // カテゴリが実際に変わる場合のみ確認ダイアログを表示
        // 削除を使用済み（なんでもあり）の場合はアンドゥを使ってもカテゴリは変わらない
        if (!this.usedUndo && !this.usedDelete) {
            const confirmed = await this.showConfirmDialog(
                'ランキングカテゴリ変更',
                'アンドゥを使用すると、このプレイは通常ランキングではなく「アンドゥあり」カテゴリで記録されます。また、このプレイではプレイヤーレーティングは変動しません。続行しますか？'
            );
            if (!confirmed) return;
        }

        // Undo使用フラグを立てる
        this.usedUndo = true;

        // 最後の状態を取得して削除
        const state = this.history.pop();

        // タイルを復元
        // 既存のタイル要素を全て削除
        Object.values(this.tiles).forEach(tile => {
            if (tile.element) {
                tile.element.remove();
            }
        });

        // タイルデータを復元
        this.tiles = {};
        state.tiles.forEach(tileData => {
            this.tiles[tileData.id] = {
                id: tileData.id,
                value: tileData.value,
                row: tileData.row,
                col: tileData.col,
                element: null,
                isNew: false,
                merged: false,
                merging: false
            };
        });

        // その他の状態を復元
        this.nextTileId = state.nextTileId;
        this.score = state.score;
        this.nextTileValue = state.nextTileValue;
        this.nextTileIsBonus = state.nextTileIsBonus;
        this.deck = [...state.deck];

        // ゲームオーバー画面を非表示にする
        this.gameOverElement.classList.add('hidden');

        // UIを更新
        this.updateScore();
        this.updateNextTileDisplay();
        this.render();

        // Undoボタンの状態を更新
        this.updateUndoButton();

        // ゲーム状態を自動保存
        this.saveGameState();
    }

    updateUndoButton() {
        const undoButton = document.getElementById('undo-button');
        if (undoButton) {
            undoButton.disabled = !this.canUndo();
        }
    }

    toggleDeleteMode() {
        // ゲームオーバー時は削除モードに入れない
        if (this.isGameOver()) return;

        this.deleteMode = !this.deleteMode;
        const button = document.getElementById('delete-mode-button');

        if (this.deleteMode) {
            button.classList.add('active');
            this.gameBoard.classList.add('delete-mode');

            // 既存のタイルに削除イベントを追加
            Object.values(this.tiles).forEach(tile => {
                if (tile.element) {
                    const deleteTileHandler = (e) => {
                        // 削除モードがオフの場合は何もしない
                        if (!this.deleteMode) return;
                        e.preventDefault();
                        e.stopPropagation();
                        this.deleteTile(tile.id);
                    };

                    tile.element.addEventListener('click', deleteTileHandler, { once: true });
                    tile.element.addEventListener('touchend', deleteTileHandler, { once: true });
                }
            });
        } else {
            button.classList.remove('active');
            this.gameBoard.classList.remove('delete-mode');

            // タイル要素を再作成して残っているイベントリスナーをクリア
            Object.values(this.tiles).forEach(tile => {
                if (tile.element) {
                    tile.element.remove();
                    tile.element = null;
                }
                // isNewフラグをクリアしてアニメーションを防止
                tile.isNew = false;
            });
            this.render();
        }
    }

    async deleteTile(tileId) {
        if (!this.deleteMode || this.isMoving) return;

        // 初回の削除機能使用時は確認ダイアログを表示
        if (!this.usedDelete) {
            const confirmed = await this.showConfirmDialog(
                'ランキングカテゴリ変更',
                '削除機能を使用すると、このプレイは通常ランキングではなく「なんでもあり」カテゴリで記録されます。また、このプレイではプレイヤーレーティングは変動しません。続行しますか？'
            );
            if (!confirmed) {
                // キャンセル時は削除モードを解除
                this.toggleDeleteMode();
                return;
            }
        }

        // 削除使用フラグを立てる
        this.usedDelete = true;

        // ドラッグ状態をリセット
        this.isDragging = false;
        this.dragDirection = null;
        this.dragOffset = 0;
        this.movableTilesCache = null;

        // 削除前に状態を保存
        this.saveState();

        const tile = this.tiles[tileId];
        if (!tile) return;

        // 削除アニメーションを開始
        if (tile.element) {
            tile.element.classList.add('tile-deleting');

            // アニメーション完了後に実際の削除処理
            setTimeout(() => {
                // タイル要素を削除
                if (tile.element) {
                    tile.element.remove();
                }

                // タイルデータから削除
                delete this.tiles[tileId];

                // 削除モードを自動的にオフ
                this.toggleDeleteMode();

                // UIを更新
                this.render();
                this.updateUndoButton();

                // スコアを再計算
                this.updateScore();

                // ゲーム状態を自動保存
                this.saveGameState();
            }, 300); // アニメーション時間と同じ
        } else {
            // 要素がない場合は即座に削除
            delete this.tiles[tileId];
            this.toggleDeleteMode();
            this.render();
            this.updateUndoButton();
            this.updateScore();
            this.saveGameState();
        }
    }

    copyBoardToClipboard() {
        // 盤面の状態をテキスト形式で作成
        const grid = this.getGrid();
        let boardText = 'Threes! 盤面状態\n';
        boardText += '==================\n\n';

        // グリッドを表示
        for (let row = 0; row < this.gridSize; row++) {
            let rowText = '';
            for (let col = 0; col < this.gridSize; col++) {
                const tileId = grid[row][col];
                if (tileId === null) {
                    rowText += '    -';
                } else {
                    const tile = this.tiles[tileId];
                    const value = tile.value.toString();
                    rowText += value.padStart(5, ' ');
                }
                if (col < this.gridSize - 1) {
                    rowText += ' |';
                }
            }
            boardText += rowText + '\n';
            if (row < this.gridSize - 1) {
                boardText += '------+------+------+------\n';
            }
        }

        boardText += '\n==================\n';
        boardText += `スコア: ${this.score}\n`;
        boardText += `プレイヤーレート: ${this.skillStats.rating} (${this.getRatingTier(this.skillStats.rating)})\n`;
        boardText += `次のタイル: ${this.nextTileValue || '?'}${this.nextTileIsBonus ? '+' : ''}\n`;

        // クリップボードにコピー
        navigator.clipboard.writeText(boardText).then(() => {
            // コピー成功のフィードバック
            const button = document.getElementById('copy-board-button');
            const originalBg = button.style.background;
            button.style.background = 'rgba(76, 175, 80, 0.8)';
            setTimeout(() => {
                button.style.background = originalBg;
            }, 300);
        }).catch(err => {
            console.error('クリップボードへのコピーに失敗しました:', err);
            alert('クリップボードへのコピーに失敗しました');
        });
    }

    adjustFontSize(element, value) {
        // 数字の桁数に応じてフォントサイズを調整
        const digits = value.toString().length;

        if (digits <= 2) {
            element.style.fontSize = '3.5em'; // 1-99: 最大サイズ
        } else if (digits === 3) {
            element.style.fontSize = '2.8em'; // 100-999
        } else if (digits === 4) {
            element.style.fontSize = '2.3em'; // 1000-9999
        } else if (digits === 5) {
            element.style.fontSize = '1.9em'; // 10000-99999
        } else {
            element.style.fontSize = '1.5em'; // 100000以上
        }
    }

    renderDragPreview() {
        // 移動可能なタイルを判定（初回のみ、以降はキャッシュを使用）
        if (!this.movableTilesCache) {
            const grid = this.getGrid();
            const movableTiles = new Set();

            if (this.dragDirection === 'left') {
                // 左方向：左から右へ処理して、連鎖的に移動可能なタイルを検出
                for (let row = 0; row < this.gridSize; row++) {
                    for (let col = 0; col < this.gridSize; col++) {
                        const tileId = grid[row][col];
                        if (tileId === null) continue;

                        const tile = this.tiles[tileId];
                        let canMove = false;

                        // 左隣（移動先）をチェック
                        if (col > 0) {
                            const leftTileId = grid[row][col - 1];
                            if (leftTileId === null) {
                                // 左が空きマス
                                canMove = true;
                            } else {
                                const leftTile = this.tiles[leftTileId];
                                if (this.canMerge(tile.value, leftTile.value)) {
                                    // 左とマージ可能
                                    canMove = true;
                                } else if (movableTiles.has(leftTileId)) {
                                    // 左のタイルが移動可能（空きができる）
                                    canMove = true;
                                }
                            }
                        }

                        if (canMove) {
                            movableTiles.add(tileId);
                        }
                    }
                }
            } else if (this.dragDirection === 'right') {
                // 右方向：右から左へ処理して、連鎖的に移動可能なタイルを検出
                for (let row = 0; row < this.gridSize; row++) {
                    for (let col = this.gridSize - 1; col >= 0; col--) {
                        const tileId = grid[row][col];
                        if (tileId === null) continue;

                        const tile = this.tiles[tileId];
                        let canMove = false;

                        // 右隣（移動先）をチェック
                        if (col < this.gridSize - 1) {
                            const rightTileId = grid[row][col + 1];
                            if (rightTileId === null) {
                                // 右が空きマス
                                canMove = true;
                            } else {
                                const rightTile = this.tiles[rightTileId];
                                if (this.canMerge(tile.value, rightTile.value)) {
                                    // 右とマージ可能
                                    canMove = true;
                                } else if (movableTiles.has(rightTileId)) {
                                    // 右のタイルが移動可能（空きができる）
                                    canMove = true;
                                }
                            }
                        }

                        if (canMove) {
                            movableTiles.add(tileId);
                        }
                    }
                }
            } else if (this.dragDirection === 'up') {
                // 上方向：上から下へ処理して、連鎖的に移動可能なタイルを検出
                for (let col = 0; col < this.gridSize; col++) {
                    for (let row = 0; row < this.gridSize; row++) {
                        const tileId = grid[row][col];
                        if (tileId === null) continue;

                        const tile = this.tiles[tileId];
                        let canMove = false;

                        // 上隣（移動先）をチェック
                        if (row > 0) {
                            const upTileId = grid[row - 1][col];
                            if (upTileId === null) {
                                // 上が空きマス
                                canMove = true;
                            } else {
                                const upTile = this.tiles[upTileId];
                                if (this.canMerge(tile.value, upTile.value)) {
                                    // 上とマージ可能
                                    canMove = true;
                                } else if (movableTiles.has(upTileId)) {
                                    // 上のタイルが移動可能（空きができる）
                                    canMove = true;
                                }
                            }
                        }

                        if (canMove) {
                            movableTiles.add(tileId);
                        }
                    }
                }
            } else if (this.dragDirection === 'down') {
                // 下方向：下から上へ処理して、連鎖的に移動可能なタイルを検出
                for (let col = 0; col < this.gridSize; col++) {
                    for (let row = this.gridSize - 1; row >= 0; row--) {
                        const tileId = grid[row][col];
                        if (tileId === null) continue;

                        const tile = this.tiles[tileId];
                        let canMove = false;

                        // 下隣（移動先）をチェック
                        if (row < this.gridSize - 1) {
                            const downTileId = grid[row + 1][col];
                            if (downTileId === null) {
                                // 下が空きマス
                                canMove = true;
                            } else {
                                const downTile = this.tiles[downTileId];
                                if (this.canMerge(tile.value, downTile.value)) {
                                    // 下とマージ可能
                                    canMove = true;
                                } else if (movableTiles.has(downTileId)) {
                                    // 下のタイルが移動可能（空きができる）
                                    canMove = true;
                                }
                            }
                        }

                        if (canMove) {
                            movableTiles.add(tileId);
                        }
                    }
                }
            }

            this.movableTilesCache = movableTiles;
        }

        // キャッシュを使用
        const movableTiles = this.movableTilesCache;
        const cellSize = 100 / this.gridSize;
        const gap = 0.8;

        // ドラッグオフセットをパーセントに変換
        const cellSizeInPixels = this.gameBoard.offsetWidth / this.gridSize;
        const offsetPercent = (this.dragOffset / cellSizeInPixels) * cellSize;

        // 移動可能なタイルのみを移動量に応じてシフト（left/topを直接変更）
        Object.values(this.tiles).forEach(tile => {
            if (!tile.element) return;

            const baseLeft = tile.col * cellSize + gap;
            const baseTop = tile.row * cellSize + gap;

            // 移動可能なタイルのみをシフト
            if (movableTiles.has(tile.id)) {
                if (this.dragDirection === 'left' || this.dragDirection === 'right') {
                    // 横方向の移動
                    tile.element.style.left = `${baseLeft + offsetPercent}%`;
                    tile.element.style.top = `${baseTop}%`;
                } else {
                    // 縦方向の移動
                    tile.element.style.left = `${baseLeft}%`;
                    tile.element.style.top = `${baseTop + offsetPercent}%`;
                }
                // ドラッグ中はtransitionを無効化（即座に追従）
                tile.element.style.transition = 'none';
                // 移動中のタイルを最前面に表示
                tile.element.style.zIndex = '100';
            } else {
                // 移動できないタイルは元の位置
                tile.element.style.left = `${baseLeft}%`;
                tile.element.style.top = `${baseTop}%`;
                tile.element.style.transition = 'none';
                // z-indexをリセット
                tile.element.style.zIndex = '';
            }
        });
    }

    cancelDrag() {
        const cellSize = 100 / this.gridSize;
        const gap = 0.8;

        Object.values(this.tiles).forEach(tile => {
            if (!tile.element) return;

            // 元の位置を計算
            const baseLeft = tile.col * cellSize + gap;
            const baseTop = tile.row * cellSize + gap;

            // transformをクリアして元の位置に戻す
            tile.element.style.transform = '';
            tile.element.style.transition = 'left 0.12s ease-out, top 0.12s ease-out';
            tile.element.style.left = `${baseLeft}%`;
            tile.element.style.top = `${baseTop}%`;
            tile.element.style.zIndex = '';
        });

        this.movableTilesCache = null;
    }

    render() {
        const cellSize = 100 / this.gridSize;
        const gap = 0.8;

        // マージ処理を後で実行するためのリスト
        const mergingTiles = [];

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

                // 数字の桁数に応じてフォントサイズを調整
                this.adjustFontSize(tile.element, tile.value);

                // 削除モード用のイベント（モバイル対応）
                // 削除モードの時だけクリック可能にする
                if (this.deleteMode) {
                    const deleteTileHandler = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.deleteTile(tile.id);
                    };

                    tile.element.addEventListener('click', deleteTileHandler, { once: true });
                    tile.element.addEventListener('touchend', deleteTileHandler, { once: true });
                }

                if (tile.isNew) {
                    tile.element.classList.add('tile-new');
                }

                this.gameBoard.appendChild(tile.element);
            } else {
                // 既存のタイル要素を更新
                const left = tile.col * cellSize + gap;
                const top = tile.row * cellSize + gap;
                const size = cellSize - gap * 2;

                // 位置を更新（アニメーション）
                tile.element.style.left = `${left}%`;
                tile.element.style.top = `${top}%`;
                tile.element.style.width = `${size}%`;
                tile.element.style.height = `${size}%`;

                // ドラッグ中でなければtransitionとz-indexをリセット
                if (!this.isDragging) {
                    tile.element.style.transition = '';
                    tile.element.style.zIndex = '';
                }

                // 数字の桁数に応じてフォントサイズを調整
                this.adjustFontSize(tile.element, tile.value);

                // マージ中のタイルにクラスを追加
                if (tile.merging) {
                    tile.element.classList.add('tile-merging');
                    mergingTiles.push(tile);
                }

                if (tile.isNew) {
                    tile.element.classList.add('tile-new');
                    setTimeout(() => {
                        tile.element.classList.remove('tile-new');
                    }, 150);
                }
            }
        });

        // マージアニメーション: 移動完了後にターゲットタイルを更新
        if (mergingTiles.length > 0) {
            setTimeout(() => {
                mergingTiles.forEach(tile => {
                    const targetTile = this.tiles[tile.mergeTarget];
                    if (targetTile && targetTile.element) {
                        // ターゲットタイルの値を更新してフリップアニメーション
                        targetTile.value = tile.mergeValue;
                        targetTile.element.className = `tile tile-${targetTile.value}`;
                        targetTile.element.textContent = targetTile.value;
                        targetTile.element.classList.add('tile-merged');

                        // 数字の桁数に応じてフォントサイズを調整
                        this.adjustFontSize(targetTile.element, targetTile.value);

                        // アニメーション後にクラスを削除
                        setTimeout(() => {
                            targetTile.element.classList.remove('tile-merged');
                        }, 300);
                    }

                    // 移動したタイルを削除
                    if (tile.element) {
                        tile.element.remove();
                    }
                    delete this.tiles[tile.id];
                });
                // マージ完了後にスコアを再計算
                this.updateScore();
            }, 120); // 移動アニメーション完了後
        }

        // 削除されたタイルの要素を削除
        const existingElements = this.gameBoard.querySelectorAll('.tile');
        existingElements.forEach(element => {
            const tileId = parseInt(element.dataset.tileId);
            if (!this.tiles[tileId]) {
                element.remove();
            }
        });
    }

    // ゲーム状態をlocalStorageに保存
    saveGameState() {
        const state = {
            tiles: Object.values(this.tiles).map(t => ({
                id: t.id,
                value: t.value,
                row: t.row,
                col: t.col
            })),
            nextTileId: this.nextTileId,
            score: this.score,
            nextTileValue: this.nextTileValue,
            nextTileIsBonus: this.nextTileIsBonus,
            deck: [...this.deck],
            gameOver: this.isGameOver(),
            usedUndo: this.usedUndo,
            usedDelete: this.usedDelete
        };

        localStorage.setItem('threes-game-state', JSON.stringify(state));
    }

    // localStorageからゲーム状態を読み込み
    loadGameState() {
        const saved = localStorage.getItem('threes-game-state');
        if (!saved) return null;

        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error('ゲーム状態の読み込みに失敗しました:', e);
            return null;
        }
    }

    // 保存されたゲーム状態をクリア
    clearGameState() {
        localStorage.removeItem('threes-game-state');
    }

    // 保存された状態からゲームを復元
    restoreGameState(state) {
        // AI停止
        if (this.aiMode) this.stopAI();

        // 既存のタイル要素を削除
        const existingTiles = this.gameBoard.querySelectorAll('.tile');
        existingTiles.forEach(tile => tile.remove());

        // タイルデータを復元
        this.tiles = {};
        state.tiles.forEach(tileData => {
            this.tiles[tileData.id] = {
                id: tileData.id,
                value: tileData.value,
                row: tileData.row,
                col: tileData.col,
                element: null,
                isNew: false,
                merged: false,
                merging: false
            };
        });

        // その他の状態を復元
        this.nextTileId = state.nextTileId;
        this.score = state.score;
        this.nextTileValue = state.nextTileValue;
        this.nextTileIsBonus = state.nextTileIsBonus;
        this.deck = [...state.deck];

        // ランキング用フラグを復元（古いセーブデータとの互換性のためデフォルト値をfalseに）
        this.usedUndo = state.usedUndo || false;
        this.usedDelete = state.usedDelete || false;

        // 履歴をクリア
        this.history = [];

        // ゲームオーバー画面を非表示
        this.gameOverElement.classList.add('hidden');

        // UIを更新
        this.updateScore();
        this.updateNextTileDisplay();
        this.render();
        this.updateUndoButton();

        // ゲームオーバー状態だった場合は表示
        if (state.gameOver) {
            this.endGame();
        }
    }

    // ========================================
    // ランキング機能
    // ========================================

    // クライアントIDを取得または生成
    getOrCreateClientId() {
        let clientId = localStorage.getItem('threes-client-id');
        if (!clientId) {
            clientId = 'client_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
            localStorage.setItem('threes-client-id', clientId);
        }
        return clientId;
    }

    // ランキングカテゴリを決定
    getRankingCategory() {
        if (this.usedDelete) {
            return 'anything_goes'; // なんでもあり
        } else if (this.usedUndo) {
            return 'with_undo'; // アンドゥあり
        } else {
            return 'normal'; // 通常
        }
    }

    // プレイヤー名を取得
    getPlayerName() {
        return localStorage.getItem('threes-player-name') || '';
    }

    // プレイヤー名を保存
    setPlayerName(name) {
        localStorage.setItem('threes-player-name', name);
    }

    // ランキング登録モーダルを表示
    showRankingModal() {
        const modal = document.getElementById('ranking-modal');
        if (!modal) return;

        const category = this.getRankingCategory();
        const categoryNames = {
            'normal': '通常ランキング',
            'with_undo': 'アンドゥありランキング',
            'anything_goes': 'なんでもありランキング'
        };
        const categoryNotes = {
            'normal': 'このスコアは通常ランキングに登録され、プレイヤーレーティングの対象にもなります。',
            'with_undo': 'このプレイはアンドゥを使用しているため、「アンドゥあり」ランキングに登録されます。プレイヤーレーティングは変動しません。',
            'anything_goes': 'このプレイは削除機能を使用しているため、「なんでもあり」ランキングに登録されます。プレイヤーレーティングは変動しません。'
        };

        document.getElementById('ranking-category-display').textContent = categoryNames[category];
        document.getElementById('ranking-score-display').textContent = this.score;
        document.getElementById('ranking-category-note').textContent = categoryNotes[category];
        document.getElementById('ranking-player-name').value = this.getPlayerName();

        modal.classList.remove('hidden');
    }

    // ランキング登録モーダルを閉じる
    hideRankingModal() {
        const modal = document.getElementById('ranking-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    // スコアをランキングに登録（モーダルから呼ばれる）
    async submitScore(playerName) {
        if (!playerName || playerName.trim() === '') {
            alert('名前を入力してください');
            return false;
        }

        const trimmedName = playerName.trim();
        const result = await this.submitScoreUpsert(trimmedName);
        // プレイ回数も同時に登録
        await this.submitPlayCountAuto(trimmedName);
        if (result) {
            this.hideRankingModal();
            // ステータス更新
            const statusElement = document.getElementById('ranking-status');
            if (statusElement) {
                statusElement.textContent = 'ランキングに登録しました';
            }
        }
        return result;
    }

    // スコアをランキングに登録（upsert - ハイスコアのみ上書き）
    async submitScoreUpsert(playerName) {
        this.setPlayerName(playerName);

        const category = this.getRankingCategory();
        const currentScore = this.score;
        const maxTile = this.getMaxTileValue();

        try {
            // まず既存のレコードを確認
            const existingResponse = await fetch(
                `${SUPABASE_CONFIG.url}/rest/v1/rankings?client_id=eq.${this.clientId}&category=eq.${category}&select=score`,
                {
                    headers: {
                        'apikey': SUPABASE_CONFIG.anonKey,
                        'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey
                    }
                }
            );

            if (!existingResponse.ok) {
                throw new Error('既存レコードの確認に失敗しました');
            }

            const existing = await existingResponse.json();

            // 既存レコードがあり、現在のスコアが低い場合は更新しない
            if (existing.length > 0 && existing[0].score >= currentScore) {
                console.log('既存のハイスコアの方が高いため更新しません');
                return true;
            }

            // 新規登録またはハイスコア更新
            const payload = {
                client_id: this.clientId,
                player_name: playerName,
                score: currentScore,
                category: category,
                max_tile: maxTile,
                updated_at: new Date().toISOString()
            };

            // upsert: on_conflictでユニーク制約のカラムを指定
            const response = await fetch(SUPABASE_CONFIG.url + '/rest/v1/rankings?on_conflict=client_id,category', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_CONFIG.anonKey,
                    'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey,
                    'Prefer': 'resolution=merge-duplicates,return=minimal'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('スコア登録に失敗しました');
            }

            console.log('ランキングを更新しました');
            return true;
        } catch (error) {
            console.error('スコア登録エラー:', error);
            return false;
        }
    }

    // プレイ回数をランキングに登録（upsert）
    async submitPlayCount(playerName) {
        if (!playerName || playerName.trim() === '') {
            alert('名前を入力してください');
            return false;
        }

        return await this.submitPlayCountAuto(playerName.trim());
    }

    // プレイ回数を自動登録（upsert - alertなし）
    async submitPlayCountAuto(playerName) {
        const payload = {
            client_id: this.clientId,
            player_name: playerName,
            play_count: this.playCount
        };

        try {
            // upsert: on_conflictでユニーク制約のカラムを指定
            const response = await fetch(SUPABASE_CONFIG.url + '/rest/v1/play_counts?on_conflict=client_id', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_CONFIG.anonKey,
                    'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey,
                    'Prefer': 'resolution=merge-duplicates,return=minimal'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('プレイ回数登録に失敗しました');
            }

            console.log('プレイ回数を更新しました');
            return true;
        } catch (error) {
            console.error('プレイ回数登録エラー:', error);
            return false;
        }
    }

    // ランキングを取得
    async fetchRanking(category, limit = 50) {
        try {
            const response = await fetch(
                `${SUPABASE_CONFIG.url}/rest/v1/rankings?category=eq.${category}&order=score.desc&limit=${limit}`,
                {
                    headers: {
                        'apikey': SUPABASE_CONFIG.anonKey,
                        'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey
                    }
                }
            );

            if (!response.ok) {
                throw new Error('ランキング取得に失敗しました');
            }

            return await response.json();
        } catch (error) {
            console.error('ランキング取得エラー:', error);
            return [];
        }
    }

    // プレイ回数ランキングを取得
    async fetchPlayCountRanking(limit = 50) {
        try {
            const response = await fetch(
                `${SUPABASE_CONFIG.url}/rest/v1/play_counts?order=play_count.desc&limit=${limit}`,
                {
                    headers: {
                        'apikey': SUPABASE_CONFIG.anonKey,
                        'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey
                    }
                }
            );

            if (!response.ok) {
                throw new Error('プレイ回数ランキング取得に失敗しました');
            }

            return await response.json();
        } catch (error) {
            console.error('プレイ回数ランキング取得エラー:', error);
            return [];
        }
    }

    // ランキング一覧を表示
    async showRankingList(category = 'normal') {
        const panel = document.getElementById('ranking-panel');
        if (!panel) return;

        // タブをアクティブに
        document.querySelectorAll('.ranking-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
        });

        const tbody = document.getElementById('ranking-table-body');
        tbody.innerHTML = '<tr><td colspan="4">読み込み中...</td></tr>';

        panel.classList.remove('hidden');

        let rankings;
        if (category === 'play_count') {
            rankings = await this.fetchPlayCountRanking();
            tbody.innerHTML = '';
            rankings.forEach((entry, index) => {
                const row = document.createElement('tr');
                const isMe = entry.client_id === this.clientId;
                if (isMe) row.classList.add('my-rank');
                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${this.escapeHtml(entry.player_name)}</td>
                    <td>${entry.play_count.toLocaleString()}回</td>
                    <td>-</td>
                `;
                tbody.appendChild(row);
            });
        } else {
            rankings = await this.fetchRanking(category);
            tbody.innerHTML = '';
            rankings.forEach((entry, index) => {
                const row = document.createElement('tr');
                const isMe = entry.client_id === this.clientId;
                if (isMe) row.classList.add('my-rank');
                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${this.escapeHtml(entry.player_name)}</td>
                    <td>${entry.score.toLocaleString()}</td>
                    <td>${entry.max_tile}</td>
                `;
                tbody.appendChild(row);
            });
        }

        if (rankings.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4">まだランキングデータがありません</td></tr>';
        }
    }

    // ランキングパネルを閉じる
    hideRankingPanel() {
        const panel = document.getElementById('ranking-panel');
        if (panel) {
            panel.classList.add('hidden');
        }
    }

    // HTMLエスケープ
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ランキングイベントリスナーを設定
    setupRankingEventListeners() {
        // ランキングボタン
        const rankingButton = document.getElementById('ranking-button');
        if (rankingButton) {
            rankingButton.addEventListener('click', () => {
                this.showRankingList('normal');
            });
        }

        // ランキングパネルを閉じる
        const closeRankingPanel = document.getElementById('close-ranking-panel');
        if (closeRankingPanel) {
            closeRankingPanel.addEventListener('click', () => {
                this.hideRankingPanel();
            });
        }

        // ランキングタブ切り替え
        document.querySelectorAll('.ranking-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.showRankingList(tab.dataset.category);
            });
        });

        // スコア登録モーダル
        const submitScoreButton = document.getElementById('submit-score-button');
        if (submitScoreButton) {
            submitScoreButton.addEventListener('click', () => {
                const playerName = document.getElementById('ranking-player-name').value;
                this.submitScore(playerName);
            });
        }

        // モーダルを閉じる
        const closeRankingModal = document.getElementById('close-ranking-modal');
        if (closeRankingModal) {
            closeRankingModal.addEventListener('click', () => {
                this.hideRankingModal();
            });
        }
    }
}

// Supabase設定
// ローカル開発時: config.local.js で上書き可能
// 本番環境: GitHub Actionsでビルド時に注入
const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {
    url: '__SUPABASE_URL__',
    anonKey: '__SUPABASE_ANON_KEY__'
};

// ゲームを開始
document.addEventListener('DOMContentLoaded', () => {
    new ThreesGame();
});
