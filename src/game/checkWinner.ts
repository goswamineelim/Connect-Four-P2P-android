import { COLUMN_COUNT, ROW_COUNT } from './board';
import type { Board, Player, Position } from './types';

const DIRECTIONS = [
  [0, 1], // Horizontal.
  [1, 0], // Vertical.
  [1, 1], // Diagonal from top-left to bottom-right.
  [1, -1], // Diagonal from top-right to bottom-left.
] as const;

export function getWinningCells(board: Board, origin: Position, player: Player): Position[] {
  const matches = new Map<string, Position>();

  for (const [rowStep, columnStep] of DIRECTIONS) {
    const line: Position[] = [origin];

    for (const sign of [-1, 1]) {
      let row = origin.row + rowStep * sign;
      let column = origin.column + columnStep * sign;
      while (
        row >= 0 && row < ROW_COUNT &&
        column >= 0 && column < COLUMN_COUNT &&
        board[row][column] === player
      ) {
        line.push({ row, column });
        row += rowStep * sign;
        column += columnStep * sign;
      }
    }

    if (line.length >= 4) {
      for (const cell of line) matches.set(`${cell.row}:${cell.column}`, cell);
    }
  }

  return [...matches.values()].sort((a, b) => a.row - b.row || a.column - b.column);
}
