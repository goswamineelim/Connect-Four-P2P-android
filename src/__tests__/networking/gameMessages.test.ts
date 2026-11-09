import { decodeGameMessage, encodeGameMessage } from '../../networking/gameMessages';

describe('game message protocol', () => {
  test('round trips a legal move and a forfeit notice', () => {
    // This checks both peers can exchange moves and notify one another when a player resigns.
    expect(decodeGameMessage(encodeGameMessage({ type: 'move', column: 3 }))).toEqual({ type: 'move', column: 3 });
    expect(decodeGameMessage(encodeGameMessage({ type: 'forfeit' }))).toEqual({ type: 'forfeit' });
  });

  test('ignores malformed, unrelated, and out of range peer data', () => {
    // This checks arbitrary DataChannel input cannot become an invalid board move.
    expect(decodeGameMessage('not json')).toBeNull();
    expect(decodeGameMessage('{"type":"move","column":99}')).toBeNull();
    expect(decodeGameMessage('{"type":"restart"}')).toBeNull();
    expect(decodeGameMessage('{"type":"something-else"}')).toBeNull();
  });
});
