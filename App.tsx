import { StatusBar } from 'react-native';
import GameScreen from './src/screens/GameScreen';

export default function App() {
  return (
    <>
      <StatusBar barStyle="light-content" />
      <GameScreen />
    </>
  );
}
