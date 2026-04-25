// halfrost/threes-ai gameboard.go の JavaScript 移植
// 盤面はランク表現 (0-15) で扱う:
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

function cloneBoard(board) {
    const out = new Array(BOARD_HEIGHT);
    for (let i = 0; i < BOARD_HEIGHT; i++) {
        out[i] = board[i].slice();
    }
    return out;
}

// move: 0=UP, 1=DOWN, 2=LEFT, 3=RIGHT
// Returns { board, change[4], num }: change[i] === 1 means line i had a movement
//   - UP/DOWN: line index = column y
//   - LEFT/RIGHT: line index = row x
function makeMove(board, move) {
    const newBoard = cloneBoard(board);
    const change = [0, 0, 0, 0];
    let changeNum = 0;
    let isChange;

    switch (move) {
        case 0: // UP
            for (let y = 0; y < 4; y++) {
                isChange = false;
                for (let x = 0; x < 3; x++) {
                    if (newBoard[x][y] === 0) {
                        if (newBoard[x + 1][y] !== 0) {
                            changeNum++;
                            change[y] = 1;
                            isChange = true;
                        }
                        newBoard[x][y] = newBoard[x + 1][y];
                        newBoard[x + 1][y] = 0;
                    } else if (
                        (newBoard[x][y] === 1 && newBoard[x + 1][y] === 2) ||
                        (newBoard[x][y] === 2 && newBoard[x + 1][y] === 1)
                    ) {
                        newBoard[x][y] = 3;
                        changeNum++;
                        change[y] = 1;
                        isChange = true;
                    } else if (newBoard[x][y] === newBoard[x + 1][y] && newBoard[x][y] >= 3) {
                        if (newBoard[x][y] !== 15) newBoard[x][y]++;
                        changeNum++;
                        change[y] = 1;
                        isChange = true;
                    }
                    if (isChange) {
                        for (let j = x + 1; j < 3; j++) {
                            newBoard[j][y] = newBoard[j + 1][y];
                        }
                        newBoard[3][y] = 0;
                        break;
                    }
                }
            }
            break;
        case 1: // DOWN
            for (let y = 0; y < 4; y++) {
                isChange = false;
                for (let x = 3; x > 0; x--) {
                    if (newBoard[x][y] === 0) {
                        if (newBoard[x - 1][y] !== 0) {
                            changeNum++;
                            change[y] = 1;
                            isChange = true;
                        }
                        newBoard[x][y] = newBoard[x - 1][y];
                        newBoard[x - 1][y] = 0;
                    } else if (
                        (newBoard[x][y] === 1 && newBoard[x - 1][y] === 2) ||
                        (newBoard[x][y] === 2 && newBoard[x - 1][y] === 1)
                    ) {
                        newBoard[x][y] = 3;
                        changeNum++;
                        change[y] = 1;
                        isChange = true;
                    } else if (newBoard[x][y] === newBoard[x - 1][y] && newBoard[x][y] >= 3) {
                        if (newBoard[x][y] !== 15) newBoard[x][y]++;
                        changeNum++;
                        change[y] = 1;
                        isChange = true;
                    }
                    if (isChange) {
                        for (let j = x - 1; j > 0; j--) {
                            newBoard[j][y] = newBoard[j - 1][y];
                        }
                        newBoard[0][y] = 0;
                        break;
                    }
                }
            }
            break;
        case 2: // LEFT
            for (let x = 0; x < 4; x++) {
                isChange = false;
                for (let y = 0; y < 3; y++) {
                    if (newBoard[x][y] === 0) {
                        if (newBoard[x][y + 1] !== 0) {
                            changeNum++;
                            change[x] = 1;
                            isChange = true;
                        }
                        newBoard[x][y] = newBoard[x][y + 1];
                        newBoard[x][y + 1] = 0;
                    } else if (
                        (newBoard[x][y] === 1 && newBoard[x][y + 1] === 2) ||
                        (newBoard[x][y] === 2 && newBoard[x][y + 1] === 1)
                    ) {
                        newBoard[x][y] = 3;
                        changeNum++;
                        change[x] = 1;
                        isChange = true;
                    } else if (newBoard[x][y] === newBoard[x][y + 1] && newBoard[x][y] >= 3) {
                        if (newBoard[x][y] !== 15) newBoard[x][y]++;
                        changeNum++;
                        change[x] = 1;
                        isChange = true;
                    }
                    if (isChange) {
                        for (let j = y + 1; j < 3; j++) {
                            newBoard[x][j] = newBoard[x][j + 1];
                        }
                        newBoard[x][3] = 0;
                        break;
                    }
                }
            }
            break;
        case 3: // RIGHT
            for (let x = 0; x < 4; x++) {
                isChange = false;
                for (let y = 3; y > 0; y--) {
                    if (newBoard[x][y] === 0) {
                        if (newBoard[x][y - 1] !== 0) {
                            changeNum++;
                            change[x] = 1;
                            isChange = true;
                        }
                        newBoard[x][y] = newBoard[x][y - 1];
                        newBoard[x][y - 1] = 0;
                    } else if (
                        (newBoard[x][y] === 1 && newBoard[x][y - 1] === 2) ||
                        (newBoard[x][y] === 2 && newBoard[x][y - 1] === 1)
                    ) {
                        newBoard[x][y] = 3;
                        changeNum++;
                        change[x] = 1;
                        isChange = true;
                    } else if (newBoard[x][y] === newBoard[x][y - 1] && newBoard[x][y] >= 3) {
                        if (newBoard[x][y] !== 15) newBoard[x][y]++;
                        changeNum++;
                        change[x] = 1;
                        isChange = true;
                    }
                    if (isChange) {
                        for (let j = y - 1; j > 0; j--) {
                            newBoard[x][j] = newBoard[x][j - 1];
                        }
                        newBoard[x][0] = 0;
                        break;
                    }
                }
            }
            break;
    }

    return { board: newBoard, change, changeNum };
}

// 移動方向に応じて、changeLine の位置 (新しく空いた端) にブリックを挿入
function insertBrick(board, nextBrickRank, move, changeLine) {
    const newBoard = cloneBoard(board);
    switch (move) {
        case 0: newBoard[3][changeLine] = nextBrickRank; break;
        case 1: newBoard[0][changeLine] = nextBrickRank; break;
        case 2: newBoard[changeLine][3] = nextBrickRank; break;
        case 3: newBoard[changeLine][0] = nextBrickRank; break;
    }
    return newBoard;
}

function maxElement(board) {
    let max = 0;
    let row = 0;
    let col = 0;
    for (let i = 0; i < BOARD_HEIGHT; i++) {
        for (let j = 0; j < BOARD_WIDTH; j++) {
            if (board[i][j] > max) {
                max = board[i][j];
                row = i;
                col = j;
            }
        }
    }
    return { max, row, col };
}

// 0,1,2 を除いた distinct な値の数
function findDiffCount(board) {
    const seen = new Array(16).fill(0);
    for (let i = 0; i < BOARD_HEIGHT; i++) {
        for (let j = 0; j < BOARD_WIDTH; j++) {
            const v = board[i][j];
            if (v > 2) seen[v] = 1;
        }
    }
    let count = 0;
    for (let i = 0; i < 16; i++) if (seen[i]) count++;
    return count;
}

// 最大タイルがある象限と、その対角象限の値で分散を計算
function calculateVariance(board, maxIndexI, maxIndexJ) {
    let quadrant = -1;
    if (maxIndexI < BOARD_HEIGHT / 2 && maxIndexJ < BOARD_WIDTH / 2) quadrant = 0;
    else if (maxIndexI < BOARD_HEIGHT / 2 && maxIndexJ > BOARD_WIDTH / 2) quadrant = 1;
    else if (maxIndexI > BOARD_HEIGHT / 2 && maxIndexJ < BOARD_WIDTH / 2) quadrant = 2;
    else if (maxIndexI > BOARD_HEIGHT / 2 && maxIndexJ > BOARD_WIDTH / 2) quadrant = 3;
    if (quadrant < 0) return 0;

    const quad = [];
    const requad = [];
    const ranges = [
        [0, BOARD_HEIGHT / 2, 0, BOARD_WIDTH / 2],
        [0, BOARD_HEIGHT / 2, BOARD_WIDTH / 2, BOARD_WIDTH],
        [BOARD_HEIGHT / 2, BOARD_HEIGHT, 0, BOARD_WIDTH / 2],
        [BOARD_HEIGHT / 2, BOARD_HEIGHT, BOARD_WIDTH / 2, BOARD_WIDTH]
    ];
    const [iStart, iEnd, jStart, jEnd] = ranges[quadrant];
    for (let i = iStart; i < iEnd; i++) {
        for (let j = jStart; j < jEnd; j++) {
            quad.push(board[i][j]);
            requad.push(board[BOARD_HEIGHT - 1 - i][BOARD_WIDTH - 1 - j]);
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

// game.js のグリッド (タイル値の2D配列) → ランク表現の2D配列
function valuesToRanks(grid) {
    const out = new Array(BOARD_HEIGHT);
    for (let i = 0; i < BOARD_HEIGHT; i++) {
        out[i] = new Array(BOARD_WIDTH);
        for (let j = 0; j < BOARD_WIDTH; j++) {
            out[i][j] = valueToRank(grid[i][j] ?? 0);
        }
    }
    return out;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        BOARD_WIDTH, BOARD_HEIGHT, VALUE_MAP, RE_VALUE_MAP,
        valueToRank, rankToValue, cloneBoard,
        makeMove, insertBrick, maxElement, findDiffCount, calculateVariance,
        candidateFromDeck, valuesToRanks
    };
}
