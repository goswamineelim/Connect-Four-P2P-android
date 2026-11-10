import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
    useCameraPermissions: jest.fn(() => [{ granted: true }, jest.fn().mockResolvedValue({ granted: true })]),
    scanFromURLAsync: jest.fn(),
  };
});

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(() => ({
      localUri: 'file:///scanner/qr-scanner-bridge.html',
      uri: 'file:///scanner/qr-scanner-bridge.html',
      downloadAsync: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('react-native-webview', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    WebView: ReactModule.forwardRef((props: Record<string, any>, ref: unknown) => {
      ReactModule.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() }));
      return ReactModule.createElement(View, {
        testID: 'gallery-scanner-webview',
        onLoadEnd: props.onLoadEnd,
        onMessage: props.onMessage,
        onError: props.onError,
        onHttpError: props.onHttpError,
      });
    }),
  };
});

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}), { virtual: true });

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('file:///cache/connection-qr.png'),
}), { virtual: true });

jest.mock('react-native-qrcode-svg', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return (props: Record<string, unknown>) => ReactModule.createElement(View, {
    testID: 'qr-renderer',
    accessibilityLabel: props.value,
    size: props.size,
    quietZone: props.quietZone,
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

function renderConnection(session = new FakeSession(), initialRole: 'host' | 'client' = 'host') {
  const onClose = jest.fn();
  render(<ConnectionScreen initialRole={initialRole} onClose={onClose} createSession={() => session} />);
  return { session, onClose };
}

async function completeGalleryScan(result: { ok: boolean; data?: string; message?: string }) {
  const webView = await screen.findByTestId('gallery-scanner-webview');
  await act(async () => {
    fireEvent(webView, 'loadEnd');
    fireEvent(webView, 'message', { nativeEvent: { data: 'bridge-ready' } });
    fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify(result) } });
  });
}

describe('ConnectionScreen', () => {
  test('does not show a duplicate host and join choice screen', async () => {
    // This checks the main menu is the only place players choose which connection role to start.
    renderConnection();
    expect(await screen.findByTestId('signal-qr')).toBeTruthy();
    expect(screen.queryByText('Host a connection')).toBeNull();
    expect(screen.queryByText('Join a connection')).toBeNull();
  });

  test('starts hosting immediately when launched from the Host game menu choice', async () => {
    // This checks selecting Host game in the main menu skips the second role-selection step and creates an Offer.
    const session = new FakeSession();
    render(<ConnectionScreen initialRole="host" onClose={jest.fn()} createSession={() => session} />);
    await waitFor(() => expect(session.createOffer).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('signal-qr')).toBeTruthy();
  });

  test('starts the Offer scanner immediately when launched from the Join game menu choice', async () => {
    // This checks selecting Join game in the main menu opens the camera scanner for the host's Offer.
    const session = new FakeSession();
    render(<ConnectionScreen initialRole="client" onClose={jest.fn()} createSession={() => session} />);
    expect(await screen.findByTestId('qr-camera')).toBeTruthy();
    expect(screen.getByText('Scanning Offer QR')).toBeTruthy();
  });

  test('scans an Offer QR selected from the image gallery', async () => {
    // This checks a saved Offer screenshot enters the same signaling flow as a live camera scan.
    const { session } = renderConnection(new FakeSession(), 'client');
    const imagePicker = require('expo-image-picker');
    const camera = require('expo-camera');
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///offer-qr.png', base64: 'aGVsbG8=', mimeType: 'image/png' }],
    });

    fireEvent.press(await screen.findByTestId('choose-from-gallery'));
    await completeGalleryScan({ ok: true, data: 'offer-code' });

    await waitFor(() => expect(session.acceptOffer).toHaveBeenCalledWith('offer-code'));
    expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
    }));
    expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ base64: true }));
    expect(await screen.findByTestId('signal-qr')).toBeTruthy();
  });

  test('keeps the camera scanner available and explains when a selected image has no QR code', async () => {
    // This checks a non-QR image is recoverable and does not consume or close the active connection attempt.
    renderConnection(new FakeSession(), 'client');
    const imagePicker = require('expo-image-picker');
    const camera = require('expo-camera');
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///holiday-photo.png', base64: 'aGVsbG8=', mimeType: 'image/png' }],
    });

    fireEvent.press(await screen.findByTestId('choose-from-gallery'));
    await completeGalleryScan({ ok: false, message: 'No QR code found.' });

    expect(await screen.findByText('No QR code was found in that crop. Choose the image again and crop tightly around the QR, or scan with the camera.')).toBeTruthy();
    expect(screen.getByTestId('qr-camera')).toBeTruthy();
  });

  test('shows a failure if the gallery scanner bridge never replies', async () => {
    // This ensures a WebView or decoder failure cannot leave gallery scanning with no feedback.
    renderConnection(new FakeSession(), 'client');
    const imagePicker = require('expo-image-picker');
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///offer-qr.png', base64: 'aGVsbG8=', mimeType: 'image/png' }],
    });
    await screen.findByTestId('choose-from-gallery');
    jest.useFakeTimers();
    await act(async () => {
      fireEvent.press(screen.getByTestId('choose-from-gallery'));
      await Promise.resolve();
      await Promise.resolve();
    });
    const webView = screen.getByTestId('gallery-scanner-webview');
    fireEvent(webView, 'loadEnd');
    fireEvent(webView, 'message', { nativeEvent: { data: 'bridge-ready' } });
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(screen.getByText('The gallery QR scanner did not respond. Try another image or use the camera.')).toBeTruthy();
    jest.useRealTimers();
  });

  test('does nothing when the player cancels the gallery picker', async () => {
    // This checks dismissing the system image picker leaves the current scanner active without an error.
    renderConnection(new FakeSession(), 'client');
    const imagePicker = require('expo-image-picker');
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });

    fireEvent.press(await screen.findByTestId('choose-from-gallery'));

    expect(screen.getByTestId('qr-camera')).toBeTruthy();
    expect(screen.queryByTestId('connection-error')).toBeNull();
  });

  test('can scan a gallery QR even when camera permission is denied', async () => {
    // This checks gallery scanning remains usable when the player cannot or does not grant camera access.
    const camera = require('expo-camera');
    const imagePicker = require('expo-image-picker');
    const session = new FakeSession();
    camera.useCameraPermissions.mockReturnValueOnce([
      { granted: false },
      jest.fn().mockResolvedValue({ granted: false }),
    ]);
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///offer-qr.png', base64: 'aGVsbG8=', mimeType: 'image/png' }],
    });
    renderConnection(session, 'client');

    fireEvent.press(await screen.findByTestId('choose-from-gallery'));
    await completeGalleryScan({ ok: true, data: 'offer-code' });

    await waitFor(() => expect(session.acceptOffer).toHaveBeenCalledWith('offer-code'));
    expect(screen.queryByTestId('qr-camera')).toBeNull();
  });

  test('scans an Answer QR from the gallery for the host', async () => {
    // This checks both signaling roles can process QR images from the device gallery.
    const { session } = renderConnection();
    const imagePicker = require('expo-image-picker');
    const camera = require('expo-camera');
    await screen.findByTestId('signal-qr');
    fireEvent.press(screen.getByText('Scan Answer QR'));
    await screen.findByTestId('qr-camera');
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///answer-qr.png', base64: 'aGVsbG8=', mimeType: 'image/png' }],
    });

    fireEvent.press(screen.getByTestId('choose-from-gallery'));
    await completeGalleryScan({ ok: true, data: 'answer-code' });

    await waitFor(() => expect(session.acceptAnswer).toHaveBeenCalledWith('answer-code'));
    expect(await screen.findByText('Connected')).toBeTruthy();
  });

  test('displays the host Offer QR and provides a scan step for the Answer', async () => {
    // This checks the host creates and displays the Offer before opening its Answer scanner.
    const { session } = renderConnection();
    await waitFor(() => expect(screen.getByTestId('signal-qr')).toBeTruthy());
    expect(screen.getByText('Show this Offer QR to the other device')).toBeTruthy();
    expect(screen.getByText('Scan Answer QR')).toBeTruthy();
    expect(session.createOffer).toHaveBeenCalledTimes(1);
  });

  test('shares the visible connection QR as an image', async () => {
    // This checks the host can send the actual QR image through the system share sheet.
    renderConnection();
    await screen.findByTestId('signal-qr');
    const viewShot = require('react-native-view-shot');
    const sharing = require('expo-sharing');

    fireEvent.press(screen.getByTestId('share-qr'));

    await waitFor(() => expect(sharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/connection-qr.png',
      expect.objectContaining({ mimeType: 'image/png' }),
    ));
    expect(viewShot.captureRef).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: 'png' }));
    const qr = screen.getByTestId('qr-renderer');
    expect(qr.props.size).toBeGreaterThanOrEqual(400);
    expect(qr.props.quietZone).toBeGreaterThanOrEqual(20);
  });

  test('shows an actionable error if the QR image cannot be prepared for sharing', async () => {
    // This checks a native snapshot failure does not crash the connection screen or replace its Offer.
    renderConnection();
    await screen.findByTestId('signal-qr');
    const viewShot = require('react-native-view-shot');
    viewShot.captureRef.mockRejectedValueOnce(new Error('Capture failed'));

    fireEvent.press(screen.getByTestId('share-qr'));

    expect(await screen.findByText('Could not share the QR code. Try again.')).toBeTruthy();
    expect(screen.getByTestId('signal-qr')).toBeTruthy();
  });

  test('scans an Offer, then displays the client Answer QR', async () => {
    // This checks the client scanner passes QR contents to signaling and moves to Answer display.
    const { session } = renderConnection(new FakeSession(), 'client');
    const camera = await screen.findByTestId('qr-camera');
    fireEvent(camera, 'onBarcodeScanned', { data: 'offer-code' });
    await waitFor(() => expect(screen.getByTestId('signal-qr')).toBeTruthy());
    expect(session.acceptOffer).toHaveBeenCalledWith('offer-code');
    expect(screen.getByText('Show this Answer QR to the host')).toBeTruthy();
  });

  test('scans an Answer and shows connecting followed by connected', async () => {
    // This checks the host applies the scanned Answer and reports the DataChannel state.
    const { session } = renderConnection();
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
    renderConnection(session, 'client');
    const camera = await screen.findByTestId('qr-camera');
    fireEvent(camera, 'onBarcodeScanned', { data: 'invalid-code' });
    expect(await screen.findByText('Invalid Offer QR payload')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  test('retry creates a fresh session using the same connection role', async () => {
    // This checks retry cleans up the failed attempt without bringing back the removed role-selection screen.
    const failedSession = new FakeSession();
    failedSession.createOffer.mockRejectedValueOnce(new Error('ICE gathering timed out'));
    const nextSession = new FakeSession();
    const createSession = jest.fn().mockReturnValueOnce(failedSession).mockReturnValueOnce(nextSession);
    render(<ConnectionScreen initialRole="host" onClose={jest.fn()} createSession={createSession} />);
    expect(await screen.findByText('ICE gathering timed out')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(failedSession.dispose).toHaveBeenCalled();
    expect(await screen.findByTestId('signal-qr')).toBeTruthy();
    expect(nextSession.createOffer).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Join a connection')).toBeNull();
  });

  test('canceling the join scan closes the connection flow and returns to the menu', async () => {
    // This checks canceling the Offer scan exits the connection screen instead of returning to role choices.
    const { session, onClose } = renderConnection(new FakeSession(), 'client');
    await screen.findByTestId('qr-camera');
    fireEvent.press(screen.getByTestId('cancel-scan'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalled();
  });

  test('canceling the host Answer scan also exits the connection flow', async () => {
    // This checks canceling either scanner consistently returns the host to the main menu.
    const { session, onClose } = renderConnection();
    await screen.findByTestId('signal-qr');
    fireEvent.press(screen.getByText('Scan Answer QR'));
    await screen.findByText('Scanning Answer QR');
    fireEvent.press(screen.getByTestId('cancel-scan'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalled();
  });

  test('closes and disposes the PeerSession when the player exits the connection screen', async () => {
    // This checks the modal close path releases native resources rather than leaving listeners active.
    const { session, onClose } = renderConnection();
    await screen.findByTestId('signal-qr');
    fireEvent.press(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalled();
  });
});
