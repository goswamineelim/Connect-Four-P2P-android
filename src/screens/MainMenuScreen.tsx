import { Pressable, StyleSheet, Text, View } from 'react-native';

export type ConnectionRole = 'host' | 'client';

interface MainMenuScreenProps {
  onPlayLocally: () => void;
  onConnect: (role: ConnectionRole) => void;
}

export default function MainMenuScreen({ onPlayLocally, onConnect }: MainMenuScreenProps) {
  return (
    <View style={styles.screen}>
      <Text style={styles.eyebrow}>TWO PLAYERS / ONE BOARD</Text>
      <Text style={styles.title}>Connect Four</Text>
      <Text style={styles.subtitle}>Choose how you want to play</Text>
      <View style={styles.choices}>
        <Pressable testID="play-locally" accessibilityRole="button" onPress={onPlayLocally} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Play locally</Text>
          <Text style={styles.detail}>Pass and play on this device</Text>
        </Pressable>
        <Pressable testID="join-game" accessibilityRole="button" onPress={() => onConnect('client')} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Join game</Text>
          <Text style={styles.detail}>Scan the host's Offer QR</Text>
        </Pressable>
        <Pressable testID="host-game" accessibilityRole="button" onPress={() => onConnect('host')} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Host game</Text>
          <Text style={styles.detail}>Show an Offer QR to your friend</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, backgroundColor: '#091326' },
  eyebrow: { color: '#76A8FF', fontSize: 11, fontWeight: '800', letterSpacing: 2.2 },
  title: { marginTop: 12, color: '#F7FAFF', fontSize: 38, lineHeight: 46, fontWeight: '900' },
  subtitle: { marginTop: 8, marginBottom: 32, color: '#AAB8D0', fontSize: 16 },
  choices: { width: '100%', maxWidth: 420, gap: 14 },
  primaryButton: { minHeight: 76, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 16, backgroundColor: '#1769E8' },
  secondaryButton: { minHeight: 76, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 16, backgroundColor: '#15233A', borderWidth: 1, borderColor: '#263B5B' },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  secondaryText: { color: '#F7FAFF', fontSize: 17, fontWeight: '900' },
  detail: { marginTop: 4, color: '#B5C4DD', fontSize: 13 },
});
