import { waitForIceGatheringComplete, ICE_GATHERING_TIMEOUT_MS } from './iceGathering';
import {
  decodeSignalPayload,
  encodeSignalPayload,
  type SignalDescription,
  type SignalRole,
} from './signalingPayload';

export type ConnectionPhase =
  | 'idle'
  | 'gathering'
  | 'showing-qr'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed';

export interface ConnectionSnapshot {
  phase: ConnectionPhase;
  role: 'host' | 'client' | null;
  signalType: SignalRole | null;
  signalPayload: string | null;
  error: string | null;
}

export interface PeerConnectionConfig {
  iceServers: Array<{ urls: string }>;
}

export type RtcEventHandler = (event?: { channel?: RtcDataChannelLike; data?: string }) => void;

export interface RtcDataChannelLike {
  readyState: string;
  addEventListener(type: string, listener: RtcEventHandler): void;
  removeEventListener(type: string, listener: RtcEventHandler): void;
  send(data: string): void;
  close(): void;
}

export interface RtcPeerConnectionLike {
  iceGatheringState: 'new' | 'gathering' | 'complete';
  connectionState: string;
  iceConnectionState: string;
  localDescription: SignalDescription | null;
  addEventListener(type: string, listener: RtcEventHandler): void;
  removeEventListener(type: string, listener: RtcEventHandler): void;
  createOffer(): Promise<SignalDescription>;
  createAnswer(): Promise<SignalDescription>;
  setLocalDescription(description: SignalDescription): Promise<void>;
  setRemoteDescription(description: SignalDescription): Promise<void>;
  createDataChannel(label: string): RtcDataChannelLike;
  close(): void;
}

export interface RtcPeerFactory {
  createPeerConnection(configuration: PeerConnectionConfig): RtcPeerConnectionLike;
}

export interface ConnectionSessionPort {
  getSnapshot(): ConnectionSnapshot;
  subscribe(listener: (snapshot: ConnectionSnapshot) => void): () => void;
  createOffer(): Promise<string>;
  acceptOffer(payload: string): Promise<string>;
  acceptAnswer(payload: string): Promise<void>;
  sendMessage(message: string): void;
  subscribeMessages(listener: (message: string) => void): () => void;
  dispose(): void;
}

export const DATA_CHANNEL_OPEN_TIMEOUT_MS = 30000;
export const DATA_CHANNEL_LABEL = 'connect-four';
export const PEER_CONFIGURATION: PeerConnectionConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const INITIAL_SNAPSHOT: ConnectionSnapshot = {
  phase: 'idle',
  role: null,
  signalType: null,
  signalPayload: null,
  error: null,
};

type ListenerTarget = {
  removeEventListener(type: string, listener: RtcEventHandler): void;
};

type RegisteredListener = {
  target: ListenerTarget;
  type: string;
  listener: RtcEventHandler;
};

function nativePeerFactory(): RtcPeerConnectionLike {
  // Keep the native module lazy so the UI and mocked Jest suites can load before the custom dev client is installed.
  const { RTCPeerConnection } = require('react-native-webrtc') as typeof import('react-native-webrtc');
  return new RTCPeerConnection(PEER_CONFIGURATION as never) as unknown as RtcPeerConnectionLike;
}

export class PeerSession implements ConnectionSessionPort {
  private peer: RtcPeerConnectionLike | null = null;
  private dataChannel: RtcDataChannelLike | null = null;
  private snapshot: ConnectionSnapshot = { ...INITIAL_SNAPSHOT };
  private listeners = new Set<(snapshot: ConnectionSnapshot) => void>();
  private messageListeners = new Set<(message: string) => void>();
  private registeredListeners: RegisteredListener[] = [];
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private iceGatheringController: AbortController | null = null;
  private resourcesReleased = false;
  private disposed = false;

  constructor(private readonly factory?: RtcPeerFactory) {}

  getSnapshot(): ConnectionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: ConnectionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendMessage(message: string): void {
    if (this.snapshot.phase !== 'connected' || this.dataChannel?.readyState !== 'open') {
      throw new Error('The game connection is not open.');
    }
    this.dataChannel.send(message);
  }

  subscribeMessages(listener: (message: string) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async createOffer(): Promise<string> {
    try {
      this.assertUnused();
      this.iceGatheringController = new AbortController();
      this.update({ ...INITIAL_SNAPSHOT, phase: 'gathering', role: 'host' });
      const peer = this.createPeer();
      this.attachPeerListeners(peer);
      this.dataChannel = peer.createDataChannel(DATA_CHANNEL_LABEL);
      this.attachDataChannel(this.dataChannel);

      const offer = await peer.createOffer();
      this.assertActive();
      await peer.setLocalDescription(offer);
      this.assertActive();
      await this.waitForIce(peer);
      this.assertActive();
      const description = this.requireLocalDescription(peer, 'offer');
      const signalPayload = encodeSignalPayload('offer', description);
      this.update({ phase: 'showing-qr', role: 'host', signalType: 'offer', signalPayload, error: null });
      return signalPayload;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async acceptOffer(payload: string): Promise<string> {
    try {
      this.assertUnused();
      const offer = decodeSignalPayload(payload, 'offer');
      this.iceGatheringController = new AbortController();
      this.update({ ...INITIAL_SNAPSHOT, phase: 'gathering', role: 'client' });
      const peer = this.createPeer();
      this.attachPeerListeners(peer);
      await peer.setRemoteDescription(offer);
      this.assertActive();
      const answer = await peer.createAnswer();
      this.assertActive();
      await peer.setLocalDescription(answer);
      this.assertActive();
      await this.waitForIce(peer);
      this.assertActive();
      const description = this.requireLocalDescription(peer, 'answer');
      const signalPayload = encodeSignalPayload('answer', description);
      this.update({ phase: 'connecting', role: 'client', signalType: 'answer', signalPayload, error: null });
      this.startOpenTimeout();
      return signalPayload;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async acceptAnswer(payload: string): Promise<void> {
    try {
      if (!this.peer || this.snapshot.role !== 'host') {
        throw new Error('Create an Offer before scanning an Answer.');
      }
      const answer = decodeSignalPayload(payload, 'answer');
      this.update({ phase: 'connecting', role: 'host', signalType: null, signalPayload: null, error: null });
      this.startOpenTimeout();
      await this.peer.setRemoteDescription(answer);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseResources();
    this.update({ ...INITIAL_SNAPSHOT, phase: 'closed' });
    this.listeners.clear();
    this.messageListeners.clear();
  }

  private assertUnused(): void {
    if (this.disposed || this.peer || this.snapshot.phase !== 'idle') {
      throw new Error('This connection attempt has already started.');
    }
  }

  private assertActive(): void {
    if (this.disposed || this.resourcesReleased || this.iceGatheringController?.signal.aborted) {
      throw new Error('The connection attempt was cancelled.');
    }
  }

  private createPeer(): RtcPeerConnectionLike {
    this.peer = this.factory
      ? this.factory.createPeerConnection(PEER_CONFIGURATION)
      : nativePeerFactory();
    return this.peer;
  }

  private requireLocalDescription(peer: RtcPeerConnectionLike, role: SignalRole): SignalDescription {
    const description = peer.localDescription;
    if (!description || description.type !== role || typeof description.sdp !== 'string') {
      throw new Error(`The completed ${role} description is unavailable.`);
    }
    return { type: role, sdp: description.sdp };
  }

  private async waitForIce(peer: RtcPeerConnectionLike): Promise<void> {
    const signal = this.iceGatheringController?.signal;
    if (!signal) throw new Error('The connection attempt was cancelled.');
    await waitForIceGatheringComplete(peer, ICE_GATHERING_TIMEOUT_MS, signal);
  }

  private attachPeerListeners(peer: RtcPeerConnectionLike): void {
    const onConnectionState = () => {
      if (peer.connectionState === 'disconnected' || peer.iceConnectionState === 'disconnected') {
        this.fail(new Error('The direct connection was disconnected.'));
      } else if (peer.connectionState === 'failed' || peer.iceConnectionState === 'failed') {
        this.fail(new Error('The direct connection failed.'));
      }
    };
    const onDataChannel = (event?: { channel?: RtcDataChannelLike }) => {
      if (event?.channel) {
        this.dataChannel = event.channel;
        this.attachDataChannel(event.channel);
      }
    };
    this.listen(peer, 'connectionstatechange', onConnectionState);
    this.listen(peer, 'iceconnectionstatechange', onConnectionState);
    this.listen(peer, 'datachannel', onDataChannel);
  }

  private attachDataChannel(channel: RtcDataChannelLike): void {
    const onOpen = () => {
      if (channel.readyState === 'open') {
        this.clearConnectTimeout();
        this.update({ ...this.snapshot, phase: 'connected', signalType: null, signalPayload: null, error: null });
      }
    };
    const onClose = () => {
      if (!this.disposed && this.snapshot.phase !== 'failed' && this.snapshot.phase !== 'closed') {
        this.fail(new Error('The DataChannel closed before the connection completed.'));
      }
    };
    const onError = () => this.fail(new Error('The DataChannel reported a connection error.'));
    const onMessage = (event?: { data?: string }) => {
      if (typeof event?.data === 'string') this.messageListeners.forEach((listener) => listener(event.data as string));
    };
    this.listen(channel, 'open', onOpen);
    this.listen(channel, 'close', onClose);
    this.listen(channel, 'error', onError);
    this.listen(channel, 'message', onMessage);
    onOpen();
  }

  private listen(target: ListenerTarget & { addEventListener(type: string, listener: RtcEventHandler): void }, type: string, listener: RtcEventHandler) {
    target.addEventListener(type, listener);
    this.registeredListeners.push({ target, type, listener });
  }

  private startOpenTimeout(): void {
    this.clearConnectTimeout();
    this.connectTimeout = setTimeout(() => {
      this.fail(new Error('The DataChannel did not open within 30 seconds. Check both devices and retry.'));
    }, DATA_CHANNEL_OPEN_TIMEOUT_MS);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout) clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
  }

  private fail(reason: unknown): void {
    if (this.disposed || this.snapshot.phase === 'closed' || this.snapshot.phase === 'failed') return;
    this.releaseResources();
    const message = reason instanceof Error ? reason.message : 'The direct connection failed. Please try again.';
    this.update({ phase: 'failed', role: this.snapshot.role, signalType: null, signalPayload: null, error: message });
  }

  private releaseResources(): void {
    if (this.resourcesReleased) return;
    this.resourcesReleased = true;
    this.clearConnectTimeout();
    this.iceGatheringController?.abort();
    this.iceGatheringController = null;
    for (const { target, type, listener } of this.registeredListeners) {
      target.removeEventListener(type, listener);
    }
    this.registeredListeners = [];
    try { this.dataChannel?.close(); } catch { /* A native close can race with failure cleanup. */ }
    try { this.peer?.close(); } catch { /* Keep cleanup idempotent if the native peer is already closed. */ }
    this.dataChannel = null;
    this.peer = null;
  }

  private update(snapshot: ConnectionSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
