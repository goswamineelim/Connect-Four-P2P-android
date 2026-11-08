import {
  COLUMN_COUNT,
  ROW_COUNT,
  createGameState,
  getWinningCells,
  playMove,
  type Board,
  type GameState,
  type Player,
} from '../../game';

const position = (row: number, column: number) => ({ row, column });

function stateWithBoard(board: Board, currentPlayer: Player = 1): GameState {
  return {
    board,
    currentPlayer,
    status: 'playing',
    winner: null,
    lastMove: null,
    winningCells: [],
  };
}

describe('Connect Four rules', () => {
  test('creates exactly six rows and seven columns, all initially empty', () => {
    // This checks the board dimensions and that a new game starts without pieces.
    const state = createGameState();
    expect(state.board).toHaveLength(ROW_COUNT);
    expect(state.board.every((row) => row.length === COLUMN_COUNT)).toBe(true);
    expect(state.board.flat().every((cell) => cell === null)).toBe(true);
  });

  test('drops a piece to the lowest open row and alternates the active player', () => {
    // This checks gravity and turn handoff after each accepted move.
    let state = createGameState();
    state = playMove(state, 3);
    state = playMove(state, 3);
    expect(state.board[ROW_COUNT - 1][3]).toBe(1);
    expect(state.board[ROW_COUNT - 2][3]).toBe(2);
    expect(state.currentPlayer).toBe(1);
  });

  test('does not change the game when a move targets a full or invalid column', () => {
    // This checks that columns outside the board and columns with no space are rejected.
    let state = createGameState();
    for (let row = 0; row < ROW_COUNT; row += 1) state = playMove(state, 0);
    const fullColumnState = state;
    expect(playMove(state, 0)).toBe(fullColumnState);
    expect(playMove(state, -1)).toBe(fullColumnState);
    expect(playMove(state, COLUMN_COUNT)).toBe(fullColumnState);
  });

  test('detects a horizontal four and reports its four positions', () => {
    // This checks horizontal win detection through the newly placed piece.
    let state = createGameState();
    for (const column of [0, 0, 1, 1, 2, 2, 3]) state = playMove(state, column);
    expect(state.status).toBe('won');
    expect(state.winner).toBe(1);
    expect(state.winningCells).toEqual([0, 1, 2, 3].map((column) => position(5, column)));
  });

  test('detects a vertical four and reports its four positions', () => {
    // This checks vertical win detection when four pieces stack in one column.
    let state = createGameState();
    for (const column of [0, 1, 0, 1, 0, 1, 0]) state = playMove(state, column);
    expect(state.status).toBe('won');
    expect(state.winningCells).toEqual([2, 3, 4, 5].map((row) => position(row, 0)));
  });

  test.each([
    {
      name: 'rising diagonal',
      cells: [[5, 0], [4, 1], [3, 2], [2, 3]] as const,
      move: [2, 3] as const,
    },
    {
      name: 'falling diagonal',
      cells: [[2, 0], [3, 1], [4, 2], [5, 3]] as const,
      move: [5, 3] as const,
    },
  ])('detects a $name four through the latest piece', ({ cells, move }) => {
    // This checks that each diagonal slope is searched through the last move.
    const board = Array.from({ length: ROW_COUNT }, () => Array<Player | null>(COLUMN_COUNT).fill(null));
    for (const [row, column] of cells.slice(0, 3)) board[row][column] = 1;
    // These opponent pieces make the target column land exactly on the intended diagonal cell.
    if (move[0] === 2) {
      for (let row = 3; row < ROW_COUNT; row += 1) board[row][3] = 2;
      board[5][1] = 2;
      board[4][2] = 2;
      board[5][2] = 2;
    } else {
      for (let row = 3; row < ROW_COUNT; row += 1) board[row][0] = 2;
      board[4][1] = 2;
      board[5][1] = 2;
      board[5][2] = 2;
    }
    const state = stateWithBoard(board, 1);
    const next = playMove(state, move[1]);
    expect(next.board[move[0]][move[1]]).toBe(1);
    expect(next.status).toBe('won');
    expect(next.winningCells).toHaveLength(4);
    expect(next.winningCells.map(({ row, column }) => `${row},${column}`).sort()).toEqual(
      cells.map(([row, column]) => `${row},${column}`).sort(),
    );
  });

  test('returns the complete winning run when a move makes more than four connected pieces', () => {
    // This checks that every piece in a longer connected winning line is marked for the UI.
    const board = Array.from({ length: ROW_COUNT }, () => Array<Player | null>(COLUMN_COUNT).fill(null));
    for (const column of [0, 1, 2, 3]) board[5][column] = 1;
    board[5][4] = 1;
    expect(getWinningCells(board, position(5, 4), 1)).toHaveLength(5);
  });

  test('ends in a draw when all 42 cells fill without any four in a row', () => {
    // This checks the full-board draw condition using a checkerboard that has no four-piece line.
    const board: Board = Array.from({ length: ROW_COUNT }, (_, row) =>
      Array.from({ length: COLUMN_COUNT }, (_, column) => ((row + 2 * column) % 4 < 2 ? 1 : 2) as Player),
    );
    board[0][0] = null;
    const state = stateWithBoard(board, 1);
    const finalState = playMove(state, 0);
    expect(finalState.status).toBe('draw');
    expect(finalState.winner).toBeNull();
  });

  test('ignores moves after a win and can create a fresh Player 1 game for restart', () => {
    // This checks finished games cannot accept moves and a restart clears the board and result.
    let state = createGameState();
    for (const column of [0, 0, 1, 1, 2, 2, 3]) state = playMove(state, column);
    const wonState = state;
    expect(playMove(state, 4)).toBe(wonState);
    const restarted = createGameState();
    expect(restarted.board.flat().every((cell) => cell === null)).toBe(true);
    expect(restarted.currentPlayer).toBe(1);
    expect(restarted.status).toBe('playing');
    expect(restarted.winner).toBeNull();
  });
});
