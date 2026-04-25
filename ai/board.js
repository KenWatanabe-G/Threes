// halfrost/threes-ai gameboard.go の JavaScript 移植 (ビットボード版)
//
// 盤面表現: Uint16Array(4)
//   各要素 = 1 行 (4 セル × 各 4bit)。低位 nibble がカラム 0、高位 nibble がカラム 3。
//   例: row = c0 | (c1 << 4) | (c2 << 8) | (c3 << 12)
//
// セル値はランク (0..15):
//   0=空, 1=1, 2=2, 3=3, 4=6, 5=12, 6=24, 7=48, 8=96, 9=192,
//   10=384, 11=768, 12=1536, 13=3072, 14=6144, 15=12288

const BOARD_WIDTH = 4;
const BOARD_HEIGHT = 4;

const VALUE_MAP = {
    0: 0, 1: 1, 2: 2, 3: 3, 4: 6, 5: 12, 6: 24, 7: 48, 8: 96, 9: 192,
    10: 384, 11: 768, 12: 1536, 13: 3072, 14: 6144, 15: 12288
};

const RE_VALUE_MAP = {
    0: 0, 1: 1, 2: 2, 3: 3, 6: 4, 12: 5, 24: 6, 48: 7, 96: 8, 192: 9,
    384: 10, 768: 11, 1536: 12, 3072: 13, 6144: 14, 12288: 15
};

function valueToRank(value) {
    return RE_VALUE_MAP[value] ?? 0;
}

function rankToValue(rank) {
    return VALUE_MAP[rank] ?? 0;
}

// game.js の生値グリッド (4x4) → ビットボード Uint16Array(4)
function valuesToBB(grid) {
    const bb = new Uint16Array(4);
    for (let i = 0; i < 4; i++) {
        const r = grid[i] || [];
        let row = 0;
        for (let j = 0; j < 4; j++) {
            const rank = valueToRank(r[j] ?? 0);
            row |= (rank & 0xf) << (j * 4);
        }
        bb[i] = row;
    }
    return bb;
}

// 旧 API 互換: タイル値の 2D 配列 → ランクの 2D 配列 (テスト用に維持)
function valuesToRanks(grid) {
    const out = new Array(BOARD_HEIGHT);
    for (let i = 0; i < BOARD_HEIGHT; i++) {
        out[i] = new Array(BOARD_WIDTH);
        for (let j = 0; j < BOARD_WIDTH; j++) {
            out[i][j] = valueToRank(grid[i]?.[j] ?? 0);
        }
    }
    return out;
}

function cloneBB(bb) {
    const out = new Uint16Array(4);
    out[0] = bb[0]; out[1] = bb[1]; out[2] = bb[2]; out[3] = bb[3];
    return out;
}

// セル単位アクセサ
function getCell(bb, i, j) {
    return (bb[i] >> (j * 4)) & 0xf;
}

function setCell(bb, i, j, rank) {
    const shift = j * 4;
    bb[i] = (bb[i] & ~(0xf << shift)) | ((rank & 0xf) << shift);
}

// 1 行 (16 bit) の左方向 1 ステップスライド結果
//   gameboard.go の MakeMove case 2 (LEFT) を 1 行に閉じた処理として再現:
//   - 左から右へ y=0..2 を走査
//   - 空きセルは右から詰める
//   - 1+2 / 2+1 → 3
//   - 3 以上の同値 → +1 (15 で頭打ち)
//   - 1 ステップ進んだら break、残りを詰めて行末に 0
function slideRowLeft(row) {
    const c = [
        (row >> 0) & 0xf,
        (row >> 4) & 0xf,
        (row >> 8) & 0xf,
        (row >> 12) & 0xf
    ];
    let isChange = false;
    for (let y = 0; y < 3; y++) {
        if (c[y] === 0) {
            if (c[y + 1] !== 0) {
                isChange = true;
            }
            c[y] = c[y + 1];
            c[y + 1] = 0;
        } else if (
            (c[y] === 1 && c[y + 1] === 2) ||
            (c[y] === 2 && c[y + 1] === 1)
        ) {
            c[y] = 3;
            isChange = true;
        } else if (c[y] === c[y + 1] && c[y] >= 3) {
            if (c[y] !== 15) c[y]++;
            isChange = true;
        }
        if (isChange) {
            // 残りを左へ 1 つずつシフト
            for (let j = y + 1; j < 3; j++) c[j] = c[j + 1];
            c[3] = 0;
            break;
        }
    }
    const newRow = c[0] | (c[1] << 4) | (c[2] << 8) | (c[3] << 12);
    return { row: newRow, changed: isChange };
}

function slideRowRight(row) {
    const c = [
        (row >> 0) & 0xf,
        (row >> 4) & 0xf,
        (row >> 8) & 0xf,
        (row >> 12) & 0xf
    ];
    let isChange = false;
    for (let y = 3; y > 0; y--) {
        if (c[y] === 0) {
            if (c[y - 1] !== 0) {
                isChange = true;
            }
            c[y] = c[y - 1];
            c[y - 1] = 0;
        } else if (
            (c[y] === 1 && c[y - 1] === 2) ||
            (c[y] === 2 && c[y - 1] === 1)
        ) {
            c[y] = 3;
            isChange = true;
        } else if (c[y] === c[y - 1] && c[y] >= 3) {
            if (c[y] !== 15) c[y]++;
            isChange = true;
        }
        if (isChange) {
            for (let j = y - 1; j > 0; j--) c[j] = c[j - 1];
            c[0] = 0;
            break;
        }
    }
    const newRow = c[0] | (c[1] << 4) | (c[2] << 8) | (c[3] << 12);
    return { row: newRow, changed: isChange };
}

// 65536 エントリの事前計算テーブル
const ROW_LEFT = new Uint16Array(65536);
const ROW_LEFT_CHG = new Uint8Array(65536);
const ROW_RIGHT = new Uint16Array(65536);
const ROW_RIGHT_CHG = new Uint8Array(65536);
let moveTablesReady = false;

function initMoveTables() {
    if (moveTablesReady) return;
    for (let r = 0; r < 65536; r++) {
        const l = slideRowLeft(r);
        ROW_LEFT[r] = l.row;
        ROW_LEFT_CHG[r] = l.changed ? 1 : 0;
        const rr = slideRowRight(r);
        ROW_RIGHT[r] = rr.row;
        ROW_RIGHT_CHG[r] = rr.changed ? 1 : 0;
    }
    moveTablesReady = true;
}

// 4 行を列方向に転置: row i のカラム j → 出力 row j のカラム i
// すなわち各 nibble の (i, j) と (j, i) を入れ替え
function transpose(bb) {
    const out = new Uint16Array(4);
    for (let i = 0; i < 4; i++) {
        const r = bb[i];
        const c0 = (r >> 0) & 0xf;
        const c1 = (r >> 4) & 0xf;
        const c2 = (r >> 8) & 0xf;
        const c3 = (r >> 12) & 0xf;
        out[0] |= c0 << (i * 4);
        out[1] |= c1 << (i * 4);
        out[2] |= c2 << (i * 4);
        out[3] |= c3 << (i * 4);
    }
    return out;
}

// move: 0=UP, 1=DOWN, 2=LEFT, 3=RIGHT
//
// 戻り値: { board: Uint16Array(4), change: Uint8Array(4), changeNum }
//   change[i] === 1 はライン i が動いたことを示す:
//     - UP/DOWN: ライン index = 列 index (旧 API と互換: change[y])
//     - LEFT/RIGHT: ライン index = 行 index
function makeMove(bb, move) {
    const change = new Uint8Array(4);
    let changeNum = 0;

    if (move === 2) { // LEFT
        const out = new Uint16Array(4);
        for (let i = 0; i < 4; i++) {
            const r = bb[i];
            out[i] = ROW_LEFT[r];
            if (ROW_LEFT_CHG[r]) {
                change[i] = 1;
                changeNum++;
            }
        }
        return { board: out, change, changeNum };
    }
    if (move === 3) { // RIGHT
        const out = new Uint16Array(4);
        for (let i = 0; i < 4; i++) {
            const r = bb[i];
            out[i] = ROW_RIGHT[r];
            if (ROW_RIGHT_CHG[r]) {
                change[i] = 1;
                changeNum++;
            }
        }
        return { board: out, change, changeNum };
    }
    if (move === 0) { // UP: 転置 + LEFT + 転置
        const t = transpose(bb);
        const out = new Uint16Array(4);
        for (let i = 0; i < 4; i++) {
            const r = t[i];
            out[i] = ROW_LEFT[r];
            if (ROW_LEFT_CHG[r]) {
                change[i] = 1; // ここでの i は元の列 index
                changeNum++;
            }
        }
        return { board: transpose(out), change, changeNum };
    }
    // DOWN: 転置 + RIGHT + 転置
    const t = transpose(bb);
    const out = new Uint16Array(4);
    for (let i = 0; i < 4; i++) {
        const r = t[i];
        out[i] = ROW_RIGHT[r];
        if (ROW_RIGHT_CHG[r]) {
            change[i] = 1;
            changeNum++;
        }
    }
    return { board: transpose(out), change, changeNum };
}

// 移動方向に応じて、changeLine の位置 (新しく空いた端) にブリックを挿入
function insertBrick(bb, nextBrickRank, move, changeLine) {
    const out = cloneBB(bb);
    switch (move) {
        case 0: setCell(out, 3, changeLine, nextBrickRank); break; // UP → 下端
        case 1: setCell(out, 0, changeLine, nextBrickRank); break; // DOWN → 上端
        case 2: setCell(out, changeLine, 3, nextBrickRank); break; // LEFT → 右端
        case 3: setCell(out, changeLine, 0, nextBrickRank); break; // RIGHT → 左端
    }
    return out;
}

function maxElement(bb) {
    let max = 0, row = 0, col = 0;
    for (let i = 0; i < 4; i++) {
        const r = bb[i];
        for (let j = 0; j < 4; j++) {
            const v = (r >> (j * 4)) & 0xf;
            if (v > max) { max = v; row = i; col = j; }
        }
    }
    return { max, row, col };
}

// 0,1,2 を除いた distinct な値の数
function findDiffCount(bb) {
    let mask = 0;
    for (let i = 0; i < 4; i++) {
        const r = bb[i];
        for (let j = 0; j < 4; j++) {
            const v = (r >> (j * 4)) & 0xf;
            if (v > 2) mask |= 1 << v;
        }
    }
    // population count of 16-bit mask
    let count = 0;
    while (mask) { count += mask & 1; mask >>>= 1; }
    return count;
}

// 最大タイルがある象限と、その対角象限の値で分散を計算
// (旧実装と同じ式: sqrt(sqrt(sum / (2n-1))) を ceil)
function calculateVariance(bb, maxIndexI, maxIndexJ) {
    let quadrant = -1;
    if (maxIndexI < BOARD_HEIGHT / 2 && maxIndexJ < BOARD_WIDTH / 2) quadrant = 0;
    else if (maxIndexI < BOARD_HEIGHT / 2 && maxIndexJ > BOARD_WIDTH / 2) quadrant = 1;
    else if (maxIndexI > BOARD_HEIGHT / 2 && maxIndexJ < BOARD_WIDTH / 2) quadrant = 2;
    else if (maxIndexI > BOARD_HEIGHT / 2 && maxIndexJ > BOARD_WIDTH / 2) quadrant = 3;
    if (quadrant < 0) return 0;

    const ranges = [
        [0, 2, 0, 2],
        [0, 2, 2, 4],
        [2, 4, 0, 2],
        [2, 4, 2, 4]
    ];
    const [iStart, iEnd, jStart, jEnd] = ranges[quadrant];
    const quad = [];
    const requad = [];
    for (let i = iStart; i < iEnd; i++) {
        for (let j = jStart; j < jEnd; j++) {
            quad.push(getCell(bb, i, j));
            requad.push(getCell(bb, BOARD_HEIGHT - 1 - i, BOARD_WIDTH - 1 - j));
        }
    }

    let total = 0;
    for (let k = 0; k < quad.length; k++) total += quad[k] + requad[k];
    total = Math.floor(total / (2 * quad.length));

    let sum = 0;
    for (let k = 0; k < quad.length; k++) {
        sum += (quad[k] - total) * (quad[k] - total) + (requad[k] - total) * (requad[k] - total);
    }
    return Math.ceil(Math.sqrt(Math.sqrt(sum / (2 * quad.length - 1))));
}

// game.js の deck から候補数を作る (実際の残りカウント)
function candidateFromDeck(deck) {
    let one = 0, two = 0, three = 0;
    for (const v of deck) {
        if (v === 1) one++;
        else if (v === 2) two++;
        else if (v === 3) three++;
    }
    return [one, two, three];
}

// 起動時にテーブル初期化
initMoveTables();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        BOARD_WIDTH, BOARD_HEIGHT, VALUE_MAP, RE_VALUE_MAP,
        valueToRank, rankToValue,
        valuesToBB, valuesToRanks, cloneBB, getCell, setCell,
        makeMove, insertBrick, maxElement, findDiffCount, calculateVariance,
        candidateFromDeck, transpose, initMoveTables,
        ROW_LEFT, ROW_LEFT_CHG, ROW_RIGHT, ROW_RIGHT_CHG
    };
}
