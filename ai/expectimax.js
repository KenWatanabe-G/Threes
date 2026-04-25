// halfrost/threes-ai ai.go の Expectimax 探索の JavaScript 移植
// board.js / heuristic.js に依存 (Worker 内では importScripts で読み込む)

// nextBricks: 次に出るブリックの候補値の配列 (例: [1], [3], [6, 12, 24])
//   - 通常タイル: 1, 2, 3 (ランク値)
//   - ボーナスタイル: 4以上のランク値 (6, 12, 24, ...)
// candidate: [oneCount, twoCount, threeCount] - デッキの残数
// Returns: 0=UP, 1=DOWN, 2=LEFT, 3=RIGHT (動かせない場合は -1)
function expectSearch(board, candidate, nextBricks) {
    const moveScores = new Array(4).fill(-Infinity);
    for (let move = 0; move < 4; move++) {
        moveScores[move] = deptSearch(board, candidate, nextBricks, move);
    }
    let bestScore = 0;
    let bestMove = -1;
    for (let m = 0; m < 4; m++) {
        if (moveScores[m] > bestScore) {
            bestScore = moveScores[m];
            bestMove = m;
        }
    }
    return bestMove;
}

function deptSearch(board, candidate, nextBricks, move) {
    const { max: maxEle } = maxElement(board);
    const gameState = {
        maxElement: maxEle,
        currentDept: 0,
        deptMax: deptLevel(board),
        moveCount: 0,
        cacheScore: new Map()
    };

    const moved = makeMove(board, move);
    if (moved.changeNum === 0) return 0;

    let result = 0;
    let chance = 0;
    for (const brick of nextBricks) {
        let c;
        switch (brick) {
            case 1:
                c = [candidate[0] - 1, candidate[1], candidate[2]];
                result += heurSearch(gameState, moved.board, c, brick, move, moved.change, moved.changeNum, 1.0);
                break;
            case 2:
                c = [candidate[0], candidate[1] - 1, candidate[2]];
                result += heurSearch(gameState, moved.board, c, brick, move, moved.change, moved.changeNum, 1.0);
                break;
            case 3:
                c = [candidate[0], candidate[1], candidate[2] - 1];
                result += heurSearch(gameState, moved.board, c, brick, move, moved.change, moved.changeNum, 1.0);
                break;
            default:
                // ボーナスブリック (4以上) はデッキ消費なし
                result += heurSearch(gameState, moved.board, candidate, brick, move, candidate, moved.changeNum, 1.0);
                break;
        }
        chance++;
    }
    return result / chance + 1e-6;
}

// 移動後に空いた端の各位置に nextBrickRank を挿入し、それぞれのスコアを平均
function heurSearch(gameState, board, candidate, nextBrickRank, move, changes, changeNum, prob) {
    let res = 0;
    const factor = 1.0 / changeNum;
    const cprob = prob * factor;

    for (let changeIndex = 0; changeIndex < 4; changeIndex++) {
        if (changes[changeIndex] === 1) {
            const newBoard = insertBrick(board, nextBrickRank, move, changeIndex);
            res += insertHeurSearch(gameState, newBoard, candidate, cprob);
        }
    }
    return res * factor;
}

function insertHeurSearch(gameState, board, candidate, prob) {
    if (prob < CPROB_MIN || gameState.currentDept >= gameState.deptMax) {
        return getHeurWeightScore(board);
    }

    const hash = hashBoard(board);
    const cached = gameState.cacheScore.get(hash);
    if (cached !== undefined) return cached;

    let best = 0;
    gameState.currentDept++;

    for (let move = 0; move < 4; move++) {
        const moved = makeMove(board, move);
        gameState.moveCount++;
        if (moved.changeNum !== 0) {
            const sc = recursionDeptSearch(gameState, moved.board, candidate, move,
                                           moved.change, moved.changeNum, prob);
            if (sc > best) best = sc;
        }
    }

    gameState.currentDept--;
    gameState.cacheScore.set(hash, best);
    return best;
}

function recursionDeptSearch(gameState, board, candidate, move, changes, changeNum, prob) {
    let res = 0;
    const { max: maxEle } = maxElement(board);
    gameState.maxElement = maxEle;

    let cand = candidate;
    if (cand[0] === 0 && cand[1] === 0 && cand[2] === 0) {
        cand = [4, 4, 4];
    }

    const oneNum = cand[0];
    const twoNum = cand[1];
    const threeNum = cand[2];

    let total = oneNum + twoNum + threeNum;
    let hres = 0;

    if (maxEle >= 7) {
        const chance = maxEle - 6;
        for (let i = 0; i < chance; i++) {
            hres += heurSearch(gameState, board, cand, i + 4, move, changes, changeNum,
                              prob / chance / HIGHT_BRICK_FREQ);
        }
        hres /= chance * HIGHT_BRICK_FREQ;
        total *= HIGHT_BRICK_FREQ / (HIGHT_BRICK_FREQ - 1);
    }

    if (oneNum !== 0) {
        const c = [cand[0] - 1, cand[1], cand[2]];
        res += heurSearch(gameState, board, c, 1, move, changes, changeNum,
                          prob / total * oneNum) * oneNum;
    }
    if (twoNum !== 0) {
        const c = [cand[0], cand[1] - 1, cand[2]];
        res += heurSearch(gameState, board, c, 2, move, changes, changeNum,
                          prob / total * twoNum) * twoNum;
    }
    if (threeNum !== 0) {
        const c = [cand[0], cand[1], cand[2] - 1];
        res += heurSearch(gameState, board, c, 3, move, changes, changeNum,
                          prob / total * threeNum) * threeNum;
    }

    res /= total;
    res += hres;
    return res;
}

// 異なるタイル種類数 + 最大タイル位置と分散から動的に深さを決める
function deptLevel(board) {
    let dept = Math.max(3, findDiffCount(board) - 2);
    const { max: maxE, row: mi, col: mj } = maxElement(board);
    const qua = calculateVariance(board, mi, mj);
    if (maxE - qua <= 4 && maxE >= 9) dept += 2;
    return dept;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { expectSearch, deptSearch, heurSearch, insertHeurSearch, recursionDeptSearch, deptLevel };
}
