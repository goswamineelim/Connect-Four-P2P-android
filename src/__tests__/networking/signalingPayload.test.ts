import {
  MAX_SIGNAL_PAYLOAD_CHARS,
  decodeSignalPayload,
  encodeSignalPayload,
  type SignalDescription,
} from '../../networking/signalingPayload';

describe('QR signaling payload', () => {
  test('serializes and restores a completed Offer SDP', () => {
    // This checks that a completed Offer can travel through the QR payload and retain its ICE candidates.
    const offer: SignalDescription = {
      type: 'offer',
      sdp: 'v=0\r\na=ice-ufrag:host\r\na=candidate:host-candidate',
    };
    const payload = encodeSignalPayload('offer', offer);
    expect(payload).toContain('C4RTC1:');
    expect(decodeSignalPayload(payload, 'offer')).toEqual(offer);
  });

  test('serializes and restores a completed Answer SDP', () => {
    // This checks that an Answer uses the same versioned transport format as an Offer.
    const answer: SignalDescription = { type: 'answer', sdp: 'v=0\r\na=candidate:client-candidate' };
    expect(decodeSignalPayload(encodeSignalPayload('answer', answer), 'answer')).toEqual(answer);
  });

  test.each([
    ['unknown prefix', 'not-a-connect-four-payload'],
    ['truncated compressed data', 'C4RTC1:broken%%%'],
    ['payload beyond QR capacity', `C4RTC1:${'A'.repeat(MAX_SIGNAL_PAYLOAD_CHARS)}`],
  ])('rejects %s', (_reason, payload) => {
    // This checks that malformed or oversized camera input produces a safe validation error.
    expect(() => decodeSignalPayload(payload)).toThrow();
  });

  test('rejects a payload with a different role than the current scan step expects', () => {
    // This checks that a client cannot use an Answer QR where the host expects an Offer, or vice versa.
    const answer = encodeSignalPayload('answer', { type: 'answer', sdp: 'v=0' });
    expect(() => decodeSignalPayload(answer, 'offer')).toThrow(/offer/i);
  });

  test('rejects a payload whose declared kind does not match its SDP kind', () => {
    // This checks that changing the payload role cannot make an SDP of the wrong type acceptable.
    expect(() => encodeSignalPayload('offer', { type: 'answer', sdp: 'v=0' })).toThrow(/answer SDP/i);
  });
});
