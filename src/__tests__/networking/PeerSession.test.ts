import {
  PeerSession,
  type PeerConnectionConfig,
  type RtcDataChannelLike,
  type RtcPeerConnectionLike,
} from '../../networking/PeerSession';
import { decodeSignalPayload, encodeSignalPayload } from '../../networking/signalingPayload';

type Handler = (event?: { channel?: RtcDataChannelLike; data?: string }) => void;

class FakeDataChannel implements RtcDataChannelLike {
  readyState = 'connecting';
  close = jest.fn(() => { this.readyState = 'closed'; });
  send = jest.fn();
  private listeners = new Map<string, Set<Handler>>();

  addEventListener(type: string, listener: Handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: Handler) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event?: { data?: string }) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  open() {
    this.readyState = 'open';
    this.emit('open');
  }
}

class FakePeerConnection implements RtcPeerConnectionLike {
  iceGatheringState: 'complete' | 'gathering' = 'complete';
  connectionState = 'new';
  iceConnectionState = 'new';
  localDescription: { type: 'offer' | 'answer'; sdp: string } | null = null;
  remoteDescription: { type: 'offer' | 'answer'; sdp: string } | null = null;
  dataChannel = new FakeDataChannel();
  createOffer = jest.fn(async () => ({ type: 'offer' as const, sdp: 'v=0\r\na=offer' }));
  createAnswer = jest.fn(async () => ({ type: 'answer' as const, sdp: 'v=0\r\na=answer' }));
  setLocalDescription = jest.fn(async (description: { type: 'offer' | 'answer'; sdp: string }) => {
    this.localDescription = { ...description, sdp: `${description.sdp}\r\na=candidate:complete` };
  });
  setRemoteDescription = jest.fn(async (description: { type: 'offer' | 'answer'; sdp: string }) => {
    this.remoteDescription = description;
  });
  createDataChannel = jest.fn(() => this.dataChannel);
  close = jest.fn();
  private listeners = new Map<string, Set<Handler>>();

  addEventListener(type: string, listener: Handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: Handler) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }

  emit(type: string, event?: { channel?: RtcDataChannelLike; data?: string }) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  deliverDataChannel(channel: RtcDataChannelLike) {
    this.emit('datachannel', { channel });
  }
}

function createFactory(peers: FakePeerConnection[]) {
  const configurations: PeerConnectionConfig[] = [];
  return {
    configurations,
    factory: {
      createPeerConnection: (configuration: PeerConnectionConfig) => {
        configurations.push(configuration);
        const peer = peers.shift();
        if (!peer) throw new Error('No fake PeerConnection available');
        return peer;
      },
    },
  };
}

describe('PeerSession signaling lifecycle', () => {
  test('creates an Offer QR only after setting the local description with gathered ICE', async () => {
    // This checks host setup creates its DataChannel and serializes the final local Offer SDP.
    const peer = new FakePeerConnection();
    const { factory, configurations } = createFactory([peer]);
    const session = new PeerSession(factory);
    const qr = await session.createOffer();
    expect(peer.createDataChannel).toHaveBeenCalledWith('connect-four');
    expect(peer.setLocalDescription).toHaveBeenCalled();
    expect(configurations[0].iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    expect(decodeSignalPayload(qr, 'offer').sdp).toContain('candidate:complete');
    expect(session.getSnapshot().phase).toBe('showing-qr');
  });

  test('accepts an Offer, applies it remotely, and returns a gathered Answer QR', async () => {
    // This checks the client applies the scanned Offer before creating its local Answer.
    const peer = new FakePeerConnection();
    const { factory } = createFactory([peer]);
    const session = new PeerSession(factory);
    const offer = encodeSignalPayload('offer', { type: 'offer', sdp: 'v=0\r\na=remote-offer' });
    const answerQr = await session.acceptOffer(offer);
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'v=0\r\na=remote-offer' });
    expect(decodeSignalPayload(answerQr, 'answer').sdp).toContain('candidate:complete');
    expect(session.getSnapshot().phase).toBe('connecting');
    session.dispose();
  });

  test('rejects an invalid QR before allocating a PeerConnection', async () => {
    // This checks untrusted scan data cannot create a native session or reach setRemoteDescription.
    const { factory } = createFactory([]);
    const session = new PeerSession(factory);
    await expect(session.acceptOffer('not a signaling code')).rejects.toThrow();
    expect(session.getSnapshot().phase).toBe('failed');
  });

  test('applies a scanned Answer remotely and transitions when the host DataChannel opens', async () => {
    // This checks the host enters connecting after applying Answer SDP and connected only on channel open.
    const peer = new FakePeerConnection();
    const { factory } = createFactory([peer]);
    const session = new PeerSession(factory);
    await session.createOffer();
    const answer = encodeSignalPayload('answer', { type: 'answer', sdp: 'v=0\r\na=remote-answer' });
    await session.acceptAnswer(answer);
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'v=0\r\na=remote-answer' });
    expect(session.getSnapshot().phase).toBe('connecting');
    peer.dataChannel.open();
    expect(session.getSnapshot().phase).toBe('connected');
  });

  test('reports PeerConnection failure and closes the session resources', async () => {
    // This checks native ICE/connection failure moves the UI to failed and releases native resources.
    const peer = new FakePeerConnection();
    const { factory } = createFactory([peer]);
    const session = new PeerSession(factory);
    await session.createOffer();
    peer.connectionState = 'failed';
    peer.emit('connectionstatechange');
    expect(session.getSnapshot().phase).toBe('failed');
    expect(peer.dataChannel.close).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
  });

  test('fails after the DataChannel open deadline and cleans up the host connection', async () => {
    // This checks that a peer which never opens its channel times out instead of remaining stuck on connecting.
    jest.useFakeTimers();
    const peer = new FakePeerConnection();
    const { factory } = createFactory([peer]);
    const session = new PeerSession(factory);
    await session.createOffer();
    const answer = encodeSignalPayload('answer', { type: 'answer', sdp: 'v=0\r\na=remote-answer' });
    await session.acceptAnswer(answer);
    jest.advanceTimersByTime(30000);
    expect(session.getSnapshot().phase).toBe('failed');
    expect(peer.dataChannel.close).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('disposes the DataChannel and PeerConnection once even when cleanup is repeated', async () => {
    // This checks cleanup is idempotent when close, retry, and unmount paths overlap.
    const peer = new FakePeerConnection();
    const { factory } = createFactory([peer]);
    const session = new PeerSession(factory);
    await session.createOffer();
    session.dispose();
    session.dispose();
    expect(peer.dataChannel.close).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().phase).toBe('closed');
  });

  test('cancels ICE gathering and removes the ICE listener when the screen closes mid-offer', async () => {
    // This checks closing during candidate gathering aborts the wait and releases every native resource promptly.
    const peer = new FakePeerConnection();
    peer.iceGatheringState = 'gathering';
    const { factory } = createFactory([peer]);
    const session = new PeerSession(factory);
    const offerAttempt = session.createOffer();
    for (let attempt = 0; attempt < 5 && peer.listenerCount('icegatheringstatechange') === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(peer.listenerCount('icegatheringstatechange')).toBe(1);
    session.dispose();
    await expect(offerAttempt).rejects.toThrow(/cancelled/i);
    expect(peer.listenerCount('icegatheringstatechange')).toBe(0);
    expect(peer.dataChannel.close).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
  });

  test('connects a mocked host and client when both native DataChannels open', async () => {
    // This checks the complete QR Offer/Answer exchange joins the host channel to the client's incoming channel.
    const hostPeer = new FakePeerConnection();
    const clientPeer = new FakePeerConnection();
    const hostFactory = createFactory([hostPeer]);
    const clientFactory = createFactory([clientPeer]);
    const host = new PeerSession(hostFactory.factory);
    const client = new PeerSession(clientFactory.factory);
    const offer = await host.createOffer();
    const answer = await client.acceptOffer(offer);
    await host.acceptAnswer(answer);
    const clientChannel = new FakeDataChannel();
    clientPeer.deliverDataChannel(clientChannel);
    hostPeer.dataChannel.open();
    clientChannel.open();
    expect(host.getSnapshot().phase).toBe('connected');
    expect(client.getSnapshot().phase).toBe('connected');
    const hostMessages: string[] = [];
    const clientMessages: string[] = [];
    host.subscribeMessages((message) => hostMessages.push(message));
    client.subscribeMessages((message) => clientMessages.push(message));
    host.sendMessage('host move');
    expect(hostPeer.dataChannel.send).toHaveBeenCalledWith('host move');
    clientChannel.emit('message', { data: 'client move' });
    expect(hostMessages).toEqual([]);
    expect(clientMessages).toEqual(['client move']);
    host.dispose();
    client.dispose();
  });
});
