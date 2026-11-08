import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ConnectionScreen from '../../screens/ConnectionScreen';
import type { ConnectionSnapshot, ConnectionSessionPort } from '../../networking/PeerSession';

jest.mock('expo-camera', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    CameraView: (props: Record<string, unknown>) => ReactModule.createElement(View, {
      testID: 'qr-camera',
      onBarcodeScanned: props.onBarcodeScanned,
    }),
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});

jest.mock('react-native-qrcode-svg', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return (props: Record<string, unknown>) => ReactModule.createElement(View, {
    testID: 'qr-renderer',
    accessibilityLabel: props.value,
  });
});

class FakeSession implements ConnectionSessionPort {
  snapshot: ConnectionSnapshot = { phase: 'idle', role: null, signalType: null, signalPayload: null, error: null };
  listeners = new Set<(snapshot: ConnectionSnapshot) => void>();
  createOffer = jest.fn(async () => {
    this.update({ phase: 'showing-qr', role: 'host', signalType: 'offer', signalPayload: 'offer-code', error: null });
    return 'offer-code';
  });
  acceptOffer = jest.fn(async () => {
    this.update({ phase: 'showing-qr', role: 'client', signalType: 'answer', signalPayload: 'answer-code', error: null });
    return 'answer-code';
  });
  acceptAnswer = jest.fn(async () => {
    this.update({ phase: 'connected', role: 'host', signalType: null, signalPayload: null, error: null });
  });
  sendMessage = jest.fn();
  subscribeMessages = jest.fn(() => () => undefined);
  dispose = jest.fn(() => {
    this.update({ phase: 'closed', role: null, signalType: null, signalPayload: null, error: null });
  });
  getSnapshot = () => this.snapshot;
  subscribe = (listener: (snapshot: ConnectionSnapshot) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  update(snapshot: ConnectionSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

function renderConnection(session = new FakeSession()) {
  const onClose = jest.fn();
  render(<ConnectionScreen onClose={onClose} createSession={() => session} />);
  return { session, onClose };
}

describe('ConnectionScreen', () => {
  test('shows the host and client choices before a session starts', () => {
    // This checks a player can choose whether to display an Offer or scan the other device's Offer.
    renderConnection();
    expect(screen.getByText('Host a connection')).toBeTruthy();
    expect(screen.getByText('Join a connection')).toBeTruthy();
  });

  test('displays the host Offer QR and provides a scan step for the Answer', async () => {
    // This checks the host creates and displays the Offer before opening its Answer scanner.
    const { session } = renderConnection();
    fireEvent.press(screen.getByText('Host a connection'));
    await waitFor(() => expect(screen.getByTestId('signal-qr')).toBeTruthy());
    expect(screen.getByText('Show this Offer QR to the other device')).toBeTruthy();
    expect(screen.getByText('Scan Answer QR')).toBeTruthy();
    expect(session.createOffer).toHaveBeenCalledTimes(1);
  });

  test('scans an Offer, then displays the client Answer QR', async () => {
    // This checks the client scanner passes QR contents to signaling and moves to Answer display.
    const { session } = renderConnection();
    fireEvent.press(screen.getByText('Join a connection'));
    const camera = await screen.findByTestId('qr-camera');
    fireEvent(camera, 'onBarcodeScanned', { data: 'offer-code' });
    await waitFor(() => expect(screen.getByTestId('signal-qr')).toBeTruthy());
    expect(session.acceptOffer).toHaveBeenCalledWith('offer-code');
    expect(screen.getByText('Show this Answer QR to the host')).toBeTruthy();
  });

  test('scans an Answer and shows connecting followed by connected', async () => {
    // This checks the host applies the scanned Answer and reports the DataChannel state.
    const { session } = renderConnection();
    fireEvent.press(screen.getByText('Host a connection'));
    await screen.findByTestId('signal-qr');
    fireEvent.press(screen.getByText('Scan Answer QR'));
    expect(await screen.findByText('Scanning Answer QR')).toBeTruthy();
    const camera = screen.getByTestId('qr-camera');
    fireEvent(camera, 'onBarcodeScanned', { data: 'answer-code' });
    await waitFor(() => expect(session.acceptAnswer).toHaveBeenCalledWith('answer-code'));
    expect(await screen.findByText('Connected')).toBeTruthy();
  });

  test('shows validation errors and offers retry after an invalid scan', async () => {
    // This checks invalid camera data is shown as a recoverable error without crashing the connection screen.
    const session = new FakeSession();
    session.acceptOffer.mockRejectedValueOnce(new Error('Invalid Offer QR payload'));
    renderConnection(session);
    fireEvent.press(screen.getByText('Join a connection'));
    const camera = await screen.findByTestId('qr-camera');
    fireEvent(camera, 'onBarcodeScanned', { data: 'invalid-code' });
    expect(await screen.findByText('Invalid Offer QR payload')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  test('retry disposes a failed session and returns to role selection', async () => {
    // This checks retry releases the failed PeerConnection before a fresh host/client attempt.
    const session = new FakeSession();
    session.createOffer.mockRejectedValueOnce(new Error('ICE gathering timed out'));
    renderConnection(session);
    fireEvent.press(screen.getByText('Host a connection'));
    expect(await screen.findByText('ICE gathering timed out')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(session.dispose).toHaveBeenCalled();
    expect(screen.getByText('Join a connection')).toBeTruthy();
  });

  test('closes and disposes the PeerSession when the player exits the connection screen', async () => {
    // This checks the modal close path releases native resources rather than leaving listeners active.
    const { session, onClose } = renderConnection();
    fireEvent.press(screen.getByText('Host a connection'));
    await screen.findByTestId('signal-qr');
    fireEvent.press(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalled();
  });
});
