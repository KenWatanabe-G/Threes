// halfrost/threes-ai ai.go の Expectimax 探索の JavaScript 移植
// board.js / heuristic.js (ビットボード版) に依存

// 各方向に動かしたとき盤面が変化するか (changeNum > 0) を 1 回の makeMove で判定。
// 合法手の数とリストを返す軽量チェック。
function legalMoves(bb) {
    const out = [];
    for (let m = 0; m < 4; m++) {
        if (makeMove(bb, m).changeNum > 0) out.push(m);
    }
    return out;
}

// nextBricks: 次に出るブリックの候補値 (ランク値) の配列
//   - 通常タイル: 1, 2, 3
//   - ボーナスタイル: 4 以上 (6, 12, 24, ...)
// candidate: [oneCount, twoCount, threeCount] - デッキの残数
// Returns: 0=UP, 1=DOWN, 2=LEFT, 3=RIGHT (動かせない場合は -1)
function expectSearch(bb, candidate, nextBricks) {
    // forced move ショートカット: 合法手が 1 つだけならそれを即返す
    const legal = legalMoves(bb);
    if (legal.length === 0) return -1;
    if (legal.length === 1) return legal[0];

    // ルートで 1 度だけ deptLevel を計算し、4 手で共有
    const deptMax = deptLevel(bb);
    // キャッシュもルート 4 手で共有 (単一スレッドなので常に有利)
    const gameState = {
        currentDept: 0,
        deptMax,
        cacheScore: new Map()
    };

    let bestScore = 0;
    let bestMove = -1;
    for (let m = 0; m < legal.length; m++) {
        const move = legal[m];
        const sc = deptSearch(gameState, bb, candidate, nextBricks, move);
        if (sc > bestScore) {
            bestScore = sc;
            bestMove = move;
        }
    }
    return bestMove;
}

// マルチ Worker 用: 単一の root move を評価してスコアを返す。
// 各 Worker が独立した gameState (キャッシュ) を持つ。
function rootEvaluate(bb, candidate, nextBricks, move) {
    const moved = makeMove(bb, move);
    if (moved.changeNum === 0) return 0;

    const gameState = {
        currentDept: 0,
        deptMax: deptLevel(bb),
        cacheScore: new Map()
    };
    return deptSearch(gameState, bb, candidate, nextBricks, move);
}

function deptSearch(gameState, bb, candidate, nextBricks, move) {
    const moved = makeMove(bb, move);
    if (moved.changeNum === 0) return 0;

    let result = 0;
    let chance = 0;
    for (let bi = 0; bi < nextBricks.length; bi++) {
        const brick = nextBricks[bi];
        if (brick === 1) {
            candidate[0]--;
            result += heurSearch(gameState, moved.board, candidate, brick, move,
                                  moved.change, moved.changeNum, 1.0);
            candidate[0]++;
        } else if (brick === 2) {
            candidate[1]--;
            result += heurSearch(gameState, moved.board, candidate, brick, move,
                                  moved.change, moved.changeNum, 1.0);
            candidate[1]++;
        } else if (brick === 3) {
            candidate[2]--;
            result += heurSearch(gameState, moved.board, candidate, brick, move,
                                  moved.change, moved.changeNum, 1.0);
            candidate[2]++;
        } else {
            // ボーナスブリック (4 以上) はデッキ消費なし
            result += heurSearch(gameState, moved.board, candidate, brick, move,
                                  moved.change, moved.changeNum, 1.0);
        }
        chance++;
    }
    return result / chance + 1e-6;
}

// 移動後に空いた端の各位置に nextBrickRank を挿入し、それぞれのスコアを平均
function heurSearch(gameState, bb, candidate, nextBrickRank, move, changes, changeNum, prob) {
    let res = 0;
    const factor = 1.0 / changeNum;
    const cprob = prob * factor;

    for (let changeIndex = 0; changeIndex < 4; changeIndex++) {
        if (changes[changeIndex] === 1) {
            const newBoard = insertBrick(bb, nextBrickRank, move, changeIndex);
            res += insertHeurSearch(gameState, newBoard, candidate, cprob);
        }
    }
    return res * factor;
}

function insertHeurSearch(gameState, bb, candidate, prob) {
    if (prob < CPROB_MIN || gameState.currentDept >= gameState.deptMax) {
        return getHeurWeightScore(bb);
    }

    const key = hashBoard(bb);
    const cached = gameState.cacheScore.get(key);
    if (cached !== undefined) return cached;

    let best = 0;
    gameState.currentDept++;

    for (let move = 0; move < 4; move++) {
        const moved = makeMove(bb, move);
        if (moved.changeNum !== 0) {
            const sc = recursionDeptSearch(gameState, moved.board, candidate, move,
                                           moved.change, moved.changeNum, prob);
            if (sc > best) best = sc;
        }
    }

    gameState.currentDept--;
    gameState.cacheScore.set(key, best);
    return best;
}

function recursionDeptSearch(gameState, bb, candidate, move, changes, changeNum, prob) {
    let res = 0;
    const maxEle = maxValue(bb);

    // 元の Go 実装と同じセマンティクス: 全部 0 のときは [4,4,4] とみなす
    let oneNum = candidate[0];
    let twoNum = candidate[1];
    let threeNum = candidate[2];
    let restored = false;
    if (oneNum === 0 && twoNum === 0 && threeNum === 0) {
        candidate[0] = 4; candidate[1] = 4; candidate[2] = 4;
        oneNum = 4; twoNum = 4; threeNum = 4;
        restored = true;
    }

    let total = oneNum + twoNum + threeNum;
    let hres = 0;

    if (maxEle >= 7) {
        const chance = maxEle - 6;
        // ボーナスブリック集約: chance >= 3 のとき (=maxEle >= 9 = 192) は
        // 候補 chance 個のうち中央ランクの 1 個だけを評価し、その値を
        // chance 倍に重み付けする。元の式は all-bricks の総和を chance*FREQ
        // で割るので、1 個 × chance 倍を chance*FREQ で割れば 1/FREQ となり、
        // 中央代表ブリックでの近似に変わる。late game の計算量を 1/3〜1/6 に削減。
        if (chance >= 3) {
            const repBrick = 4 + ((chance - 1) >> 1); // 中央ランク
            const single = heurSearch(gameState, bb, candidate, repBrick, move,
                                      changes, changeNum, prob / chance / HIGHT_BRICK_FREQ);
            hres = (single * chance) / (chance * HIGHT_BRICK_FREQ);
        } else {
            for (let i = 0; i < chance; i++) {
                hres += heurSearch(gameState, bb, candidate, i + 4, move, changes, changeNum,
                                  prob / chance / HIGHT_BRICK_FREQ);
            }
            hres /= chance * HIGHT_BRICK_FREQ;
        }
        total *= HIGHT_BRICK_FREQ / (HIGHT_BRICK_FREQ - 1);
    }

    if (oneNum !== 0) {
        candidate[0]--;
        res += heurSearch(gameState, bb, candidate, 1, move, changes, changeNum,
                          prob / total * oneNum) * oneNum;
        candidate[0]++;
    }
    if (twoNum !== 0) {
        candidate[1]--;
        res += heurSearch(gameState, bb, candidate, 2, move, changes, changeNum,
                          prob / total * twoNum) * twoNum;
        candidate[1]++;
    }
    if (threeNum !== 0) {
        candidate[2]--;
        res += heurSearch(gameState, bb, candidate, 3, move, changes, changeNum,
                          prob / total * threeNum) * threeNum;
        candidate[2]++;
    }

    if (restored) {
        candidate[0] = 0; candidate[1] = 0; candidate[2] = 0;
    }

    res /= total;
    res += hres;
    return res;
}

// 異なるタイル種類数 + 最大タイル位置と分散から動的に深さを決める
function deptLevel(bb) {
    let dept = Math.max(3, findDiffCount(bb) - 2);
    const { max: maxE, row: mi, col: mj } = maxElement(bb);
    const qua = calculateVariance(bb, mi, mj);
    if (maxE - qua <= 4 && maxE >= 9) dept += 2;
    return dept;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { expectSearch, rootEvaluate, legalMoves, deptSearch, heurSearch, insertHeurSearch, recursionDeptSearch, deptLevel };
}
