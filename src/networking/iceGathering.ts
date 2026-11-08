export interface IceGatheringPeer {
  iceGatheringState: 'new' | 'gathering' | 'complete';
  addEventListener(type: 'icegatheringstatechange', listener: () => void): void;
  removeEventListener(type: 'icegatheringstatechange', listener: () => void): void;
}

export const ICE_GATHERING_TIMEOUT_MS = 20000;

export function waitForIceGatheringComplete(
  peer: IceGatheringPeer,
  timeoutMs = ICE_GATHERING_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error('ICE gathering was cancelled.'));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', onStateChange);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onStateChange = () => {
      if (peer.iceGatheringState === 'complete') finish();
    };
    const onAbort = () => finish(new Error('ICE gathering was cancelled.'));

    peer.addEventListener('icegatheringstatechange', onStateChange);
    signal?.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => finish(new Error('ICE gathering timed out. Please try again.')), timeoutMs);
    // Recheck after adding the listener so a completion event cannot be missed between checks.
    onStateChange();
  });
}
