import { decodeGameMessage, encodeGameMessage } from '../../networking/gameMessages';

describe('game message protocol', () => {
  test('round trips a legal column move and restart', () => {
    // This checks both peers can encode the same small set of game actions.
    expect(decodeGameMessage(encodeGameMessage({ type: 'move', column: 3 }))).toEqual({ type: 'move', column: 3 });
    expect(decodeGameMessage(encodeGameMessage({ type: 'restart' }))).toEqual({ type: 'restart' });
  });

  test('ignores malformed, unrelated, and out of range peer data', () => {
    // This checks arbitrary DataChannel input cannot become an invalid board move.
    expect(decodeGameMessage('not json')).toBeNull();
    expect(decodeGameMessage('{"type":"move","column":99}')).toBeNull();
    expect(decodeGameMessage('{"type":"something-else"}')).toBeNull();
  });
});
