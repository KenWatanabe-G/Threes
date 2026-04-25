// halfrost/threes-ai utils.go の評価関数の JavaScript 移植
// 1行 (4セル × 各4bit) の状態 0..65535 ごとにスコアを事前計算する

const LOST_PENALTY_WEIGHT = 10000.0;
const MONOTONICITY_POWER_WEIGHT = 2.0;
const MONOTONICITY_WEIGHT = 40.0;
const SUM_POWER_WEIGHT = 1.0;
const SUM_WEIGHT = 100.0;
const MERGES_WEIGHT = 200.0;
const ONE_TWO_MERGES_WEIGHT = 700.0;
const EMPTY_WEIGHT = 500.0;

const CPROB_MIN = 0.0001;
const CACHE_DEPT_LEVEL = 6;
const HIGHT_BRICK_FREQ = 21;

const heurScoreTable = new Float64Array(65536);
let scoreTableInitialized = false;

function initHeurScoreTable() {
    if (scoreTableInitialized) return;
    const line = [0, 0, 0, 0];
    for (let row = 0; row < 65536; row++) {
        line[0] = (row >> 0) & 0xf;
        line[1] = (row >> 4) & 0xf;
        line[2] = (row >> 8) & 0xf;
        line[3] = (row >> 12) & 0xf;

        let sum = 0;
        let empty = 0;
        let merges = 0;
        let oneTwoMerges = 0;

        let prev = 0;
        let counter = 0;
        for (let i = 0; i < 4; i++) {
            const rank = line[i];
            sum += Math.pow(rank, SUM_POWER_WEIGHT);
            if (rank === 0) {
                empty++;
            } else {
                if (prev === rank) {
                    counter++;
                } else if (counter > 0) {
                    merges += 1 + counter;
                    counter = 0;
                }
                prev = rank;
            }
        }
        if (counter > 0) merges += 1 + counter;

        for (let i = 1; i < 4; i++) {
            if ((line[i - 1] === 1 && line[i] === 2) ||
                (line[i - 1] === 2 && line[i] === 1)) {
                oneTwoMerges++;
            }
        }

        let monotonicityLeft = 0;
        let monotonicityRight = 0;
        for (let i = 1; i < 4; i++) {
            if (line[i - 1] > line[i]) {
                monotonicityLeft += Math.pow(line[i - 1], MONOTONICITY_POWER_WEIGHT) -
                                    Math.pow(line[i], MONOTONICITY_POWER_WEIGHT);
            } else {
                monotonicityRight += Math.pow(line[i], MONOTONICITY_POWER_WEIGHT) -
                                     Math.pow(line[i - 1], MONOTONICITY_POWER_WEIGHT);
            }
        }

        heurScoreTable[row] =
            LOST_PENALTY_WEIGHT
            + EMPTY_WEIGHT * empty
            + MERGES_WEIGHT * merges
            + ONE_TWO_MERGES_WEIGHT * oneTwoMerges
            - MONOTONICITY_WEIGHT * Math.min(monotonicityLeft, monotonicityRight)
            - SUM_WEIGHT * sum;
    }
    scoreTableInitialized = true;
}

// 行 + 列の各ラインのスコアを合算
function getHeurWeightScore(board) {
    let res = 0;
    // 行
    for (let i = 0; i < 4; i++) {
        let stream = 0;
        for (let j = 3; j >= 0; j--) {
            stream += board[i][j] << (j * 4);
        }
        res += heurScoreTable[stream & 0xffff];
    }
    // 列
    for (let j = 0; j < 4; j++) {
        let stream = 0;
        for (let i = 3; i >= 0; i--) {
            stream += board[i][j] << (i * 4);
        }
        res += heurScoreTable[stream & 0xffff];
    }
    return res;
}

// 盤面 (4x4 のランク) を 64bit ハッシュへ
// JavaScript の Number は 53bit 精度なので BigInt を使う
function hashBoard(board) {
    let hash = 0n;
    for (let i = 3; i >= 0; i--) {
        for (let j = 3; j >= 0; j--) {
            const shift = BigInt((i * 4 + j) * 4);
            hash += BigInt(board[i][j] & 0xf) << shift;
        }
    }
    return hash;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LOST_PENALTY_WEIGHT, MONOTONICITY_POWER_WEIGHT, MONOTONICITY_WEIGHT,
        SUM_POWER_WEIGHT, SUM_WEIGHT, MERGES_WEIGHT, ONE_TWO_MERGES_WEIGHT, EMPTY_WEIGHT,
        CPROB_MIN, CACHE_DEPT_LEVEL, HIGHT_BRICK_FREQ,
        heurScoreTable, initHeurScoreTable, getHeurWeightScore, hashBoard
    };
}
