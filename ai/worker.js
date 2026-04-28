// AI 計算用 Web Worker
// メインスレッドから { board, deck, nextTileValue, nextTileIsBonus, requestId } を受け取り、
// 最適な move 方向 ('up'|'down'|'left'|'right'|null) を返す

importScripts('board.js', 'heuristic.js', 'expectimax.js');

initHeurScoreTable();

const MOVE_NAMES = ['up', 'down', 'left', 'right'];

// nextTile の情報からブリック候補配列 (ランク値) を作る
function buildNextBricks(nextTileValue, nextTileIsBonus, bb) {
    if (nextTileValue == null) return [];
    const rank = valueToRank(nextTileValue);
    if (!nextTileIsBonus) return [rank];

    // ボーナスの場合、game.js のロジックに合わせて
    // 最大タイル / 8 以下の 2 のべき乗を全列挙
    const { max: maxRank } = maxElement(bb);
    const maxValue = rankToValue(maxRank);
    const maxBonus = Math.floor(maxValue / 8);
    const bricks = [];
    for (let v = 6; v <= maxBonus; v *= 2) {
        bricks.push(valueToRank(v));
    }
    return bricks.length > 0 ? bricks : [rank];
}

self.addEventListener('message', (event) => {
    const { requestId, grid, deck, nextTileValue, nextTileIsBonus, rootMove, type } = event.data;
    try {
        const bb = valuesToBB(grid);
        const candidate = candidateFromDeck(deck);
        const nextBricks = buildNextBricks(nextTileValue, nextTileIsBonus, bb);

        if (type === 'suggest') {
            // 4 方向すべてを順に評価して合法手とスコアを返す (UI 表示用)
            const perMove = [];
            for (let m = 0; m < 4; m++) {
                const moved = makeMove(bb, m);
                if (moved.changeNum === 0) {
                    perMove.push({ move: MOVE_NAMES[m], legal: false });
                    continue;
                }
                const score = rootEvaluate(bb, candidate, nextBricks, m);
                perMove.push({ move: MOVE_NAMES[m], legal: true, score });
            }
            self.postMessage({ requestId, type: 'suggest', perMove });
            return;
        }

        if (rootMove !== undefined && rootMove !== null) {
            // マルチ Worker モード: 単一の root move のスコアだけ返す
            const score = rootEvaluate(bb, candidate, nextBricks, rootMove);
            self.postMessage({ requestId, rootMove, score });
        } else {
            // シングル Worker モード (フォールバック)
            const moveIdx = expectSearch(bb, candidate, nextBricks);
            const move = moveIdx >= 0 ? MOVE_NAMES[moveIdx] : null;
            self.postMessage({ requestId, move });
        }
    } catch (err) {
        if (type === 'suggest') {
            self.postMessage({ requestId, type: 'suggest', perMove: [], error: err.message });
        } else {
            self.postMessage({ requestId, move: null, error: err.message });
        }
    }
});
