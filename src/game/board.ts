import type { Board } from './types';

export const ROW_COUNT = 6;
export const COLUMN_COUNT = 7;

export function createBoard(): Board {
  return Array.from({ length: ROW_COUNT }, () => Array(COLUMN_COUNT).fill(null));
}
