import { StatusBar } from 'react-native';
import { useState } from 'react';
import GameScreen from './src/screens/GameScreen';
import MainMenuScreen from './src/screens/MainMenuScreen';
import ConnectionScreen from './src/screens/ConnectionScreen';
import type { ConnectionSessionPort } from './src/networking/PeerSession';
import type { ConnectionRole } from './src/screens/MainMenuScreen';

type AppScreen = 'menu' | 'game' | 'connection';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('menu');
  const [connectionRole, setConnectionRole] = useState<ConnectionRole>('host');
  const [connectionSession, setConnectionSession] = useState<ConnectionSessionPort | null>(null);

  return (
    <>
      <StatusBar barStyle="light-content" />
      {screen === 'menu' && (
        <MainMenuScreen
          onPlayLocally={() => {
            setConnectionSession(null);
            setScreen('game');
          }}
          onConnect={(role) => {
            setConnectionRole(role);
            setScreen('connection');
          }}
        />
      )}
      {screen === 'connection' && (
        <ConnectionScreen
          initialRole={connectionRole}
          onClose={() => setScreen('menu')}
          onConnected={(session) => {
            setConnectionSession(session);
            setScreen('game');
          }}
        />
      )}
      {screen === 'game' && (
        <GameScreen
          connectionSession={connectionSession}
          onExit={() => {
            setConnectionSession(null);
            setScreen('menu');
          }}
        />
      )}
    </>
  );
}
