import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import App from '../../../App';

jest.mock('../../screens/GameScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockGameScreen(props: { onExit?: () => void; connectionSession?: unknown }) {
    return ReactModule.createElement(View, { testID: 'game-screen' },
      ReactModule.createElement(Text, null, props.connectionSession ? 'Connected game' : 'Local game'),
      ReactModule.createElement(Pressable, { testID: 'game-back', onPress: props.onExit },
        ReactModule.createElement(Text, null, 'Back to menu')));
  };
});

jest.mock('../../screens/ConnectionScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockConnectionScreen(props: { initialRole: string; onClose: () => void; onConnected: (session: unknown) => void }) {
    return ReactModule.createElement(View, { testID: 'connection-screen', accessibilityLabel: props.initialRole },
      ReactModule.createElement(Text, null, `Connection role: ${props.initialRole}`),
      ReactModule.createElement(Pressable, { testID: 'connection-close', onPress: props.onClose },
        ReactModule.createElement(Text, null, 'Close')),
      ReactModule.createElement(Pressable, { testID: 'connection-connected', onPress: () => props.onConnected({ id: 'session' }) },
        ReactModule.createElement(Text, null, 'Connected')));
  };
});

describe('App main menu flow', () => {
  test('starts on a menu with local play, join, and host choices', () => {
    // This checks a new player sees all three destinations instead of loading into a game board.
    render(<App />);
    expect(screen.getByText('Play locally')).toBeTruthy();
    expect(screen.getByText('Join game')).toBeTruthy();
    expect(screen.getByText('Host game')).toBeTruthy();
    expect(screen.queryByTestId('game-screen')).toBeNull();
  });

  test('opens a local game and returns to the menu', () => {
    // This checks the local option starts the existing board and its back action returns to the menu.
    render(<App />);
    fireEvent.press(screen.getByText('Play locally'));
    expect(screen.getByText('Local game')).toBeTruthy();
    fireEvent.press(screen.getByTestId('game-back'));
    expect(screen.getByText('Host game')).toBeTruthy();
  });

  test.each([
    ['Join game', 'client'],
    ['Host game', 'host'],
  ])('%s opens the connection flow in the %s role and can return to the menu', (choice, role) => {
    // This checks menu choices start the intended connection role directly and closing returns to the menu.
    render(<App />);
    fireEvent.press(screen.getByText(choice));
    expect(screen.getByText(`Connection role: ${role}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId('connection-close'));
    expect(screen.getByText('Play locally')).toBeTruthy();
  });

  test('opens the game with the negotiated session after connection succeeds', () => {
    // This checks connection ownership passes from the connection flow into the online game screen.
    render(<App />);
    fireEvent.press(screen.getByText('Host game'));
    fireEvent.press(screen.getByTestId('connection-connected'));
    expect(screen.getByText('Connected game')).toBeTruthy();
  });
});
