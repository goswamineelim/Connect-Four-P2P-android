import { waitForIceGatheringComplete } from '../../networking/iceGathering';
import type { IceGatheringPeer } from '../../networking/iceGathering';

function createFakePeer(initialState: IceGatheringPeer['iceGatheringState'] = 'gathering') {
  const listeners = new Set<() => void>();
  const peer: IceGatheringPeer = {
    iceGatheringState: initialState,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    peer,
    complete: () => {
      peer.iceGatheringState = 'complete';
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

describe('ICE gathering wait', () => {
  test('returns immediately when ICE gathering is already complete', async () => {
    // This checks that an already-complete PeerConnection does not wait for an event that has passed.
    const fake = createFakePeer('complete');
    await expect(waitForIceGatheringComplete(fake.peer, 100)).resolves.toBeUndefined();
    expect(fake.listenerCount()).toBe(0);
  });

  test('resolves when the PeerConnection reports gathering complete and removes its listener', async () => {
    // This checks the non-trickle handoff waits for all candidates before producing the QR payload.
    const fake = createFakePeer();
    const waiting = waitForIceGatheringComplete(fake.peer, 1000);
    fake.complete();
    await expect(waiting).resolves.toBeUndefined();
    expect(fake.listenerCount()).toBe(0);
  });

  test('rejects when gathering exceeds its deadline and removes its listener', async () => {
    // This checks that a stuck ICE gather ends in a visible error instead of waiting forever.
    jest.useFakeTimers();
    const fake = createFakePeer();
    const waiting = waitForIceGatheringComplete(fake.peer, 20000);
    jest.advanceTimersByTime(20000);
    await expect(waiting).rejects.toThrow(/ICE gathering timed out/i);
    expect(fake.listenerCount()).toBe(0);
    jest.useRealTimers();
  });
});
