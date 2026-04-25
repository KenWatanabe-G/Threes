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
    const { requestId, grid, deck, nextTileValue, nextTileIsBonus, rootMove } = event.data;
    try {
        const bb = valuesToBB(grid);
        const candidate = candidateFromDeck(deck);
        const nextBricks = buildNextBricks(nextTileValue, nextTileIsBonus, bb);

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
        self.postMessage({ requestId, move: null, error: err.message });
    }
});
