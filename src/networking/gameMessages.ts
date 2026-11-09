export type GameMessage = { type: 'move'; column: number } | { type: 'forfeit' };

export function encodeGameMessage(message: GameMessage): string {
  return JSON.stringify(message);
}

export function decodeGameMessage(raw: string): GameMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const message = value as Record<string, unknown>;
    if (message.type === 'forfeit') return { type: 'forfeit' };
    if (message.type === 'move' && Number.isInteger(message.column) && (message.column as number) >= 0 && (message.column as number) <= 6) {
      return { type: 'move', column: message.column as number };
    }
  } catch { /* Ignore malformed or unrelated peer data. */ }
  return null;
}
