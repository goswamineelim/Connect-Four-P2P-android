import { COLUMN_COUNT, ROW_COUNT, createBoard } from './board';
import { getWinningCells } from './checkWinner';
import type { GameState, Player } from './types';

export function createGameState(): GameState {
  return {
    board: createBoard(),
    currentPlayer: 1,
    status: 'playing',
    winner: null,
    lastMove: null,
    winningCells: [],
  };
}

export function playMove(state: GameState, column: number): GameState {
  if (state.status !== 'playing' || !Number.isInteger(column) || column < 0 || column >= COLUMN_COUNT) {
    return state;
  }

  let row = ROW_COUNT - 1;
  while (row >= 0 && state.board[row][column] !== null) row -= 1;
  if (row < 0) return state;

  const player = state.currentPlayer;
  const board = state.board.map((cells) => [...cells]);
  board[row][column] = player;
  const lastMove = { row, column };
  const winningCells = getWinningCells(board, lastMove, player);

  if (winningCells.length > 0) {
    return { ...state, board, lastMove, winningCells, status: 'won', winner: player };
  }

  const isFull = board.every((cells) => cells.every((cell) => cell !== null));
  if (isFull) {
    return { ...state, board, lastMove, winningCells: [], status: 'draw' };
  }

  const nextPlayer: Player = player === 1 ? 2 : 1;
  return { ...state, board, currentPlayer: nextPlayer, lastMove, winningCells: [] };
}
