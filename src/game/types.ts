export type Player = 1 | 2;
export type Cell = Player | null;
export type Board = Cell[][];

export interface Position {
  row: number;
  column: number;
}

export type GameStatus = 'playing' | 'won' | 'draw';

export interface GameState {
  board: Board;
  currentPlayer: Player;
  status: GameStatus;
  winner: Player | null;
  lastMove: Position | null;
  winningCells: Position[];
}
