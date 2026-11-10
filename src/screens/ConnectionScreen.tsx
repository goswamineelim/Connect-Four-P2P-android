import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import QRCode from 'react-native-qrcode-svg';
import { WebView } from 'react-native-webview';
import { PeerSession } from '../networking/PeerSession';
import type { ConnectionSessionPort, ConnectionSnapshot } from '../networking/PeerSession';
import type { SignalRole } from '../networking/signalingPayload';

interface ConnectionScreenProps {
  initialRole: 'host' | 'client';
  onClose: () => void;
  onConnected?: (session: ConnectionSessionPort) => void;
  createSession?: () => ConnectionSessionPort;
}

const EMPTY_SNAPSHOT: ConnectionSnapshot = {
  phase: 'idle',
  role: null,
  signalType: null,
  signalPayload: null,
  error: null,
};

export default function ConnectionScreen({ initialRole, onClose, onConnected, createSession = () => new PeerSession() }: ConnectionScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [session, setSession] = useState<ConnectionSessionPort | null>(null);
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(EMPTY_SNAPSHOT);
  const [scanningRole, setScanningRole] = useState<SignalRole | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sharingQr, setSharingQr] = useState(false);
  const [galleryScanDataUrl, setGalleryScanDataUrl] = useState<string | null>(null);
  const [galleryScannerUri, setGalleryScannerUri] = useState<string | null>(null);
  const webViewRef = useRef<WebView<{}> | null>(null);
  const galleryScanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrImageRef = useRef<any>(null);
  const sessionRef = useRef<ConnectionSessionPort | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const scanLockedRef = useRef(false);

  useEffect(() => () => {
    unsubscribeRef.current?.();
    sessionRef.current?.dispose();
    if (galleryScanTimeoutRef.current) clearTimeout(galleryScanTimeoutRef.current);
  }, []);

  const createNewSession = () => {
    unsubscribeRef.current?.();
    sessionRef.current?.dispose();
    const next = createSession();
    sessionRef.current = next;
    setSession(next);
    setSnapshot(next.getSnapshot());
    setLocalError(null);
    unsubscribeRef.current = next.subscribe((value) => {
      setSnapshot(value);
      if (value.phase === 'connected' && sessionRef.current === next) {
        sessionRef.current = null; // Transfer ownership to the game screen.
        onConnected?.(next);
      }
    });
    return next;
  };

  const close = () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setSession(null);
    setScanningRole(null);
    onClose();
  };

  const retry = () => {
    setSnapshot(EMPTY_SNAPSHOT);
    setScanningRole(null);
    setLocalError(null);
    scanLockedRef.current = false;
    if (initialRole === 'host') void host();
    else void join();
  };

  const beginScan = async (role: SignalRole) => {
    setLocalError(null);
    scanLockedRef.current = false;
    setScanningRole(role);
    if (!permission?.granted) {
      const response = await requestPermission();
      if (!response.granted) {
        setLocalError('Camera permission is needed to scan a connection QR code.');
        return;
      }
    }
  };

  const host = async () => {
    const active = createNewSession();
    try {
      await active.createOffer();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Could not create the Offer.');
    }
  };

  const join = async () => {
    createNewSession();
    await beginScan('offer');
  };

  useEffect(() => {
    if (initialRole === 'host') void host();
    else void join();
    // The role is a launch instruction; retries remain under the player's control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processScannedData = async (data: string) => {
    if (scanLockedRef.current || !data) return;
    scanLockedRef.current = true;
    const role = scanningRole;
    setScanningRole(null);
    const active = sessionRef.current;
    if (!active || !role) return;

    try {
      if (role === 'offer') await active.acceptOffer(data);
      else await active.acceptAnswer(data);
      setLocalError(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'The scanned QR code could not be used.');
    }
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    void processScannedData(data);
  };

  const chooseFromGallery = async () => {
    setLocalError(null);
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        // Cropping isolates the QR from chat screenshots and gallery margins before the one-shot scan.
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        base64: true,
      });
      if (selection.canceled) return;

      const image = selection.assets[0];
      if (!image?.base64) {
        setLocalError('Could not read that image. Choose another image or scan with the camera.');
        return;
      }

      // Run the same qr-scanner image decoder as the web build inside a local WebView.
      // The image picker has already applied the mobile square crop at this point.
      const bridgeAsset = Asset.fromModule(require('../assets/qr-scanner-bridge.html'));
      await bridgeAsset.downloadAsync();
      if (!bridgeAsset.localUri) throw new Error('The local scanner page is not available.');
      setGalleryScannerUri(bridgeAsset.localUri || bridgeAsset.uri);
      setGalleryScanDataUrl(`data:${image.mimeType || 'image/jpeg'};base64,${image.base64}`);
    } catch {
      setLocalError('Could not prepare the gallery image scanner. Choose another image or scan with the camera.');
    }
  };

  const onGalleryScanMessage = (event: { nativeEvent: { data: string } }) => {
    if (galleryScanTimeoutRef.current) clearTimeout(galleryScanTimeoutRef.current);
    galleryScanTimeoutRef.current = null;
    if (event.nativeEvent.data === 'bridge-missing') {
      setGalleryScannerUri(null);
      setGalleryScanDataUrl(null);
      setLocalError('The gallery QR scanner did not load. Try another image or use the camera.');
      return;
    }
    if (event.nativeEvent.data === 'bridge-ready') {
      const imageData = galleryScanDataUrl;
      if (!imageData) return;
      const encodedImage = JSON.stringify(imageData);
      webViewRef.current?.injectJavaScript(`(function(){try{if(typeof window.scanQr!=="function")throw new Error("Scanner function is missing");window.scanQr(${encodedImage});}catch(error){window.ReactNativeWebView.postMessage(JSON.stringify({ok:false,message:String(error)}));}})();true;`);
      galleryScanTimeoutRef.current = setTimeout(() => {
        setGalleryScannerUri(null);
        setGalleryScanDataUrl(null);
        setLocalError('The gallery QR scanner did not respond. Try another image or use the camera.');
      }, 15000);
      return;
    }
    setGalleryScannerUri(null);
    setGalleryScanDataUrl(null);
    try {
      const result = JSON.parse(event.nativeEvent.data) as { ok?: boolean; data?: string; message?: string };
      if (result.ok && result.data) {
        void processScannedData(result.data);
        return;
      }
      if (result.message && !result.message.toLowerCase().includes('no qr code found')) {
        setLocalError(`Could not scan that image: ${result.message}`);
        return;
      }
    } catch { /* Treat malformed bridge output as a QR scan failure. */ }
    setLocalError('No QR code was found in that crop. Choose the image again and crop tightly around the QR, or scan with the camera.');
  };

  const onGalleryScannerLoadEnd = () => {
    // Wait for the bundled HTML script to install the scanner and signal that the WebView bridge is ready.
    webViewRef.current?.injectJavaScript(`window.ReactNativeWebView.postMessage(typeof window.scanQr === 'function' ? 'bridge-ready' : 'bridge-missing'); true;`);
    if (galleryScanTimeoutRef.current) clearTimeout(galleryScanTimeoutRef.current);
    galleryScanTimeoutRef.current = setTimeout(() => {
      setGalleryScannerUri(null);
      setGalleryScanDataUrl(null);
      setLocalError('The gallery QR scanner could not start. Try another image or use the camera.');
    }, 15000);
  };

  const shareQr = async () => {
    if (!qrImageRef.current || sharingQr) return;
    setSharingQr(true);
    setLocalError(null);
    try {
      if (!await Sharing.isAvailableAsync()) {
        setLocalError('Sharing is not available on this device.');
        return;
      }
      const imageUri = await captureRef(qrImageRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      await Sharing.shareAsync(imageUri, {
        mimeType: 'image/png',
        dialogTitle: 'Share connection QR code',
      });
    } catch {
      setLocalError('Could not share the QR code. Try again.');
    } finally {
      setSharingQr(false);
    }
  };

  const statusText = localError || snapshot.error
    ? 'Connection failed'
    : scanningRole
      ? `Scanning ${scanningRole === 'offer' ? 'Offer' : 'Answer'} QR`
      : snapshot.phase === 'gathering'
        ? 'Preparing the connection QR'
        : snapshot.phase === 'showing-qr'
          ? 'Offer ready — scan it with the other device'
          : snapshot.phase === 'connecting'
            ? 'Connecting…'
            : snapshot.phase === 'connected'
              ? 'Connected'
              : snapshot.phase === 'failed'
                ? 'Connection failed'
                : 'Starting connection';

  const errorText = localError || snapshot.error;
  const signalTypeText = snapshot.signalType === 'offer'
    ? 'Show this Offer QR to the other device'
    : snapshot.signalType === 'answer'
      ? 'Show this Answer QR to the host'
      : null;

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>DIRECT CONNECTION</Text>
          <Pressable testID="connection-close" accessibilityRole="button" onPress={close} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>Connect devices</Text>
        <Text testID="connection-status" accessibilityLiveRegion="polite" style={styles.status}>
          {statusText}
        </Text>

        {scanningRole && permission?.granted && (
          <View style={styles.scannerFrame}>
            <CameraView
              testID="qr-camera"
              style={styles.camera}
              facing="back"
              active
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcodeScanned}
              onMountError={(event) => setLocalError(event.message || 'The camera could not start.')}
            />
          </View>
        )}

        {scanningRole && (
          <Pressable testID="choose-from-gallery" accessibilityRole="button" onPress={chooseFromGallery} style={styles.primaryButton}>
            <Text style={styles.primaryText}>Choose from gallery</Text>
          </Pressable>
        )}

        {snapshot.signalPayload && (
          <View style={styles.qrPanel}>
            <Text style={styles.instruction}>{signalTypeText}</Text>
            <View testID="signal-qr" ref={qrImageRef} collapsable={false} style={styles.qrFrame}>
              <QRCode value={snapshot.signalPayload} size={420} ecl="L" quietZone={24} />
            </View>
            <Pressable
              testID="share-qr"
              accessibilityRole="button"
              accessibilityState={{ disabled: sharingQr }}
              disabled={sharingQr}
              onPress={shareQr}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryText}>{sharingQr ? 'Preparing QR image…' : 'Share QR'}</Text>
            </Pressable>
            {snapshot.phase === 'connecting' && (
              <Text style={styles.helper}>Keep this QR visible while the host scans it.</Text>
            )}
          </View>
        )}

        {galleryScannerUri && galleryScanDataUrl && (
          <WebView<{}>
            ref={webViewRef}
            source={{ uri: galleryScannerUri }}
            javaScriptEnabled
            originWhitelist={['*']}
            allowFileAccess
            onLoadEnd={onGalleryScannerLoadEnd}
            onError={(event) => {
              if (galleryScanTimeoutRef.current) clearTimeout(galleryScanTimeoutRef.current);
              galleryScanTimeoutRef.current = null;
              setGalleryScannerUri(null);
              setGalleryScanDataUrl(null);
              setLocalError(`The gallery QR scanner page failed to load: ${event.nativeEvent.description || 'unknown WebView error'}`);
            }}
            onHttpError={(event) => {
              if (galleryScanTimeoutRef.current) clearTimeout(galleryScanTimeoutRef.current);
              galleryScanTimeoutRef.current = null;
              setGalleryScannerUri(null);
              setGalleryScanDataUrl(null);
              setLocalError(`The gallery QR scanner page returned HTTP ${event.nativeEvent.statusCode}.`);
            }}
            onMessage={onGalleryScanMessage}
            style={styles.hiddenGalleryScanner}
          />
        )}

        {session && snapshot.phase === 'showing-qr' && snapshot.signalType === 'offer' && !scanningRole && (
          <Pressable testID="scan-answer" accessibilityRole="button" onPress={() => beginScan('answer')} style={styles.primaryButton}>
            <Text style={styles.primaryText}>Scan Answer QR</Text>
          </Pressable>
        )}

        {errorText && <Text testID="connection-error" accessibilityRole="alert" style={styles.error}>{errorText}</Text>}

        {scanningRole && (
          <Pressable
            testID="cancel-scan"
            accessibilityRole="button"
            onPress={close}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>Cancel scan</Text>
          </Pressable>
        )}
        {(snapshot.phase === 'failed' || localError) && (
          <Pressable testID="connection-retry" accessibilityRole="button" onPress={retry} style={styles.primaryButton}>
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
        )}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32, backgroundColor: '#091326' },
  header: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: '#76A8FF', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  closeButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#15233A' },
  closeText: { color: '#F7FAFF', fontSize: 14, fontWeight: '700' },
  title: { marginTop: 20, color: '#F7FAFF', fontSize: 28, fontWeight: '900' },
  status: { marginTop: 10, marginBottom: 22, color: '#D4DFF1', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  primaryButton: { minWidth: 190, alignItems: 'center', marginTop: 14, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 12, backgroundColor: '#1769E8' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: { minWidth: 190, alignItems: 'center', marginTop: 12, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 12, backgroundColor: '#1B2C47' },
  secondaryText: { color: '#E7EEFB', fontSize: 15, fontWeight: '800' },
  scannerFrame: { width: '100%', maxWidth: 340, height: 340, overflow: 'hidden', borderRadius: 20, backgroundColor: '#15233A' },
  camera: { flex: 1 },
  qrPanel: { alignItems: 'center', marginTop: 8 },
  instruction: { marginBottom: 14, color: '#F7FAFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  qrFrame: { padding: 24, borderRadius: 16, backgroundColor: '#FFFFFF' },
  helper: { maxWidth: 280, marginTop: 12, color: '#AAB8D0', fontSize: 13, textAlign: 'center' },
  error: { maxWidth: 320, marginTop: 16, color: '#FF8590', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  hiddenGalleryScanner: { position: 'absolute', left: -2, top: -2, width: 1, height: 1, opacity: 0 },
});
