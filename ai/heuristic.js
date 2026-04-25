// halfrost/threes-ai utils.go の評価関数の JavaScript 移植 (ビットボード版)
// 1 行 (4 セル × 各 4bit) の状態 0..65535 ごとにスコアを事前計算する

const LOST_PENALTY_WEIGHT = 10000.0;
const MONOTONICITY_POWER_WEIGHT = 2.0;
const MONOTONICITY_WEIGHT = 40.0;
const SUM_POWER_WEIGHT = 1.0;
const SUM_WEIGHT = 100.0;
const MERGES_WEIGHT = 200.0;
const ONE_TWO_MERGES_WEIGHT = 700.0;
const EMPTY_WEIGHT = 500.0;

// 確率が CPROB_MIN を下回る枝は leaf eval で打ち切り。
// halfrost オリジナルは 0.0001。0.001 へ引き上げて 1 桁分のテイル枝を刈り、
// 棋力への寄与が < 0.1% の深い分岐を除外する。
const CPROB_MIN = 0.001;
const CACHE_DEPT_LEVEL = 6;
const HIGHT_BRICK_FREQ = 21;

const heurScoreTable = new Float64Array(65536);
let scoreTableInitialized = false;

function initHeurScoreTable() {
    if (scoreTableInitialized) return;
    for (let row = 0; row < 65536; row++) {
        const c0 = (row >> 0) & 0xf;
        const c1 = (row >> 4) & 0xf;
        const c2 = (row >> 8) & 0xf;
        const c3 = (row >> 12) & 0xf;
        const line = [c0, c1, c2, c3];

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

// ビットボード (Uint16Array(4)) を行と列のスコアに分解して合算
function getHeurWeightScore(bb) {
    // 行は packed value をそのまま参照
    let res = heurScoreTable[bb[0]] + heurScoreTable[bb[1]] +
              heurScoreTable[bb[2]] + heurScoreTable[bb[3]];
    // 列を packed value に組み直してテーブル参照
    const r0 = bb[0], r1 = bb[1], r2 = bb[2], r3 = bb[3];
    const col0 = ((r0 >> 0) & 0xf)
               | (((r1 >> 0) & 0xf) << 4)
               | (((r2 >> 0) & 0xf) << 8)
               | (((r3 >> 0) & 0xf) << 12);
    const col1 = ((r0 >> 4) & 0xf)
               | (((r1 >> 4) & 0xf) << 4)
               | (((r2 >> 4) & 0xf) << 8)
               | (((r3 >> 4) & 0xf) << 12);
    const col2 = ((r0 >> 8) & 0xf)
               | (((r1 >> 8) & 0xf) << 4)
               | (((r2 >> 8) & 0xf) << 8)
               | (((r3 >> 8) & 0xf) << 12);
    const col3 = ((r0 >> 12) & 0xf)
               | (((r1 >> 12) & 0xf) << 4)
               | (((r2 >> 12) & 0xf) << 8)
               | (((r3 >> 12) & 0xf) << 12);
    res += heurScoreTable[col0] + heurScoreTable[col1] +
           heurScoreTable[col2] + heurScoreTable[col3];
    return res;
}

// 盤面 (4 行 × 16bit) を 4 文字の文字列キーへ。
// String.fromCharCode は 16bit code unit を保持するため衝突なし。
// V8 の Map は短い文字列キーを高速に扱える。
function hashBoard(bb) {
    return String.fromCharCode(bb[0], bb[1], bb[2], bb[3]);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LOST_PENALTY_WEIGHT, MONOTONICITY_POWER_WEIGHT, MONOTONICITY_WEIGHT,
        SUM_POWER_WEIGHT, SUM_WEIGHT, MERGES_WEIGHT, ONE_TWO_MERGES_WEIGHT, EMPTY_WEIGHT,
        CPROB_MIN, CACHE_DEPT_LEVEL, HIGHT_BRICK_FREQ,
        heurScoreTable, initHeurScoreTable, getHeurWeightScore, hashBoard
    };
}
