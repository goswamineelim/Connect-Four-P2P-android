import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { PeerSession } from '../networking/PeerSession';
import type { ConnectionSessionPort, ConnectionSnapshot } from '../networking/PeerSession';
import type { SignalRole } from '../networking/signalingPayload';

interface ConnectionScreenProps {
  initialRole?: 'host' | 'client';
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
  const sessionRef = useRef<ConnectionSessionPort | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const scanLockedRef = useRef(false);

  useEffect(() => () => {
    unsubscribeRef.current?.();
    sessionRef.current?.dispose();
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
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setSession(null);
    setSnapshot(EMPTY_SNAPSHOT);
    setScanningRole(null);
    setLocalError(null);
    scanLockedRef.current = false;
  };

  const beginScan = async (role: SignalRole) => {
    setLocalError(null);
    scanLockedRef.current = false;
    if (!permission?.granted) {
      const response = await requestPermission();
      if (!response.granted) {
        setLocalError('Camera permission is needed to scan a connection QR code.');
        return;
      }
    }
    setScanningRole(role);
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
    else if (initialRole === 'client') void join();
    // The role is a launch instruction; retries remain under the player's control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onBarcodeScanned = async ({ data }: { data: string }) => {
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
                : 'Choose how to connect';

  const errorText = localError || snapshot.error;
  const signalTypeText = snapshot.signalType === 'offer'
    ? 'Show this Offer QR to the other device'
    : snapshot.signalType === 'answer'
      ? 'Show this Answer QR to the host'
      : null;

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View style={styles.screen}>
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

        {!session && (
          <View style={styles.choices}>
            <Pressable testID="role-host" accessibilityRole="button" onPress={host} style={styles.primaryButton}>
              <Text style={styles.primaryText}>Host a connection</Text>
            </Pressable>
            <Pressable testID="role-client" accessibilityRole="button" onPress={join} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Join a connection</Text>
            </Pressable>
          </View>
        )}

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

        {snapshot.signalPayload && (
          <View style={styles.qrPanel}>
            <Text style={styles.instruction}>{signalTypeText}</Text>
            <View testID="signal-qr" style={styles.qrFrame}>
              <QRCode value={snapshot.signalPayload} size={250} ecl="L" quietZone={12} />
            </View>
            {snapshot.phase === 'connecting' && (
              <Text style={styles.helper}>Keep this QR visible while the host scans it.</Text>
            )}
          </View>
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
            onPress={() => snapshot.role === 'host' ? setScanningRole(null) : retry()}
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32, backgroundColor: '#091326' },
  header: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: '#76A8FF', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  closeButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#15233A' },
  closeText: { color: '#F7FAFF', fontSize: 14, fontWeight: '700' },
  title: { marginTop: 20, color: '#F7FAFF', fontSize: 28, fontWeight: '900' },
  status: { marginTop: 10, marginBottom: 22, color: '#D4DFF1', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  choices: { width: '100%', gap: 12 },
  primaryButton: { minWidth: 190, alignItems: 'center', marginTop: 14, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 12, backgroundColor: '#1769E8' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: { minWidth: 190, alignItems: 'center', marginTop: 12, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 12, backgroundColor: '#1B2C47' },
  secondaryText: { color: '#E7EEFB', fontSize: 15, fontWeight: '800' },
  scannerFrame: { width: '100%', maxWidth: 340, height: 340, overflow: 'hidden', borderRadius: 20, backgroundColor: '#15233A' },
  camera: { flex: 1 },
  qrPanel: { alignItems: 'center', marginTop: 8 },
  instruction: { marginBottom: 14, color: '#F7FAFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  qrFrame: { padding: 14, borderRadius: 16, backgroundColor: '#FFFFFF' },
  helper: { maxWidth: 280, marginTop: 12, color: '#AAB8D0', fontSize: 13, textAlign: 'center' },
  error: { maxWidth: 320, marginTop: 16, color: '#FF8590', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
