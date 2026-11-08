import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

export type SignalRole = 'offer' | 'answer';

export interface SignalDescription {
  type: SignalRole;
  sdp: string;
}

interface SignalEnvelope {
  version: 1;
  role: SignalRole;
  sdp: string;
}

const PREFIX = 'C4RTC1:';
export const MAX_SIGNAL_PAYLOAD_CHARS = 2900;
const MAX_SDP_CHARS = 20000;

export class SignalPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignalPayloadError';
  }
}

export function encodeSignalPayload(role: SignalRole, description: SignalDescription): string {
  if (description.type !== role) {
    throw new SignalPayloadError(`Expected ${role} SDP, received ${description.type} SDP.`);
  }
  if (typeof description.sdp !== 'string' || description.sdp.trim().length === 0) {
    throw new SignalPayloadError('The SDP description is empty.');
  }
  if (description.sdp.length > MAX_SDP_CHARS) {
    throw new SignalPayloadError('The SDP description is too large to transfer by QR code.');
  }

  const envelope: SignalEnvelope = { version: 1, role, sdp: description.sdp };
  const compressed = compressToEncodedURIComponent(JSON.stringify(envelope));
  if (!compressed) throw new SignalPayloadError('The SDP description could not be compressed.');

  const payload = `${PREFIX}${compressed}`;
  if (payload.length > MAX_SIGNAL_PAYLOAD_CHARS) {
    throw new SignalPayloadError('This connection description is too large for one QR code.');
  }
  return payload;
}

export function decodeSignalPayload(payload: string, expectedRole?: SignalRole): SignalDescription {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > MAX_SIGNAL_PAYLOAD_CHARS) {
    throw new SignalPayloadError('This QR code is empty or too large.');
  }
  if (!payload.startsWith(PREFIX)) {
    throw new SignalPayloadError('This is not a Connect Four connection QR code.');
  }

  const json = decompressFromEncodedURIComponent(payload.slice(PREFIX.length));
  if (!json) throw new SignalPayloadError('The connection QR code is damaged or incomplete.');

  let envelope: Partial<SignalEnvelope>;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') throw new Error('Payload is not an object.');
    envelope = parsed as Partial<SignalEnvelope>;
  } catch {
    throw new SignalPayloadError('The connection QR code contains invalid data.');
  }

  if (envelope.version !== 1) throw new SignalPayloadError('This connection QR code version is not supported.');
  if (envelope.role !== 'offer' && envelope.role !== 'answer') {
    throw new SignalPayloadError('The connection QR code has an invalid role.');
  }
  if (expectedRole && envelope.role !== expectedRole) {
    throw new SignalPayloadError(`This step requires an ${expectedRole.toUpperCase()} QR code.`);
  }
  if (typeof envelope.sdp !== 'string' || envelope.sdp.trim().length === 0 || envelope.sdp.length > MAX_SDP_CHARS) {
    throw new SignalPayloadError('The connection QR code does not contain valid SDP.');
  }

  return { type: envelope.role, sdp: envelope.sdp };
}
