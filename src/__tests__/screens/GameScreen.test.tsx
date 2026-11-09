import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import GameScreen from '../../screens/GameScreen';
import type { ConnectionSessionPort, ConnectionSnapshot } from '../../networking/PeerSession';

function createFakeSession() {
  let snapshot: ConnectionSnapshot = { phase: 'connected', role: 'host', signalType: null, signalPayload: null, error: null };
  let messageListener: ((message: string) => void) | undefined;
  const snapshotListeners = new Set<(value: ConnectionSnapshot) => void>();
  const session = {
    getSnapshot: jest.fn(() => snapshot),
    subscribe: jest.fn((listener: (value: ConnectionSnapshot) => void) => {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    }),
    createOffer: jest.fn(),
    acceptOffer: jest.fn(),
    acceptAnswer: jest.fn(),
    sendMessage: jest.fn(),
    subscribeMessages: jest.fn((listener: (message: string) => void) => {
      messageListener = listener;
      return () => { messageListener = undefined; };
    }),
    dispose: jest.fn(() => {
      snapshot = { ...snapshot, phase: 'closed' };
      snapshotListeners.forEach((listener) => listener(snapshot));
    }),
  } as unknown as ConnectionSessionPort;
  return {
    session,
    receive: (message: string) => messageListener?.(message),
    setPhase: (phase: ConnectionSnapshot['phase']) => {
      snapshot = { ...snapshot, phase };
      snapshotListeners.forEach((listener) => listener(snapshot));
    },
  };
}

describe('GameScreen', () => {
  test('does not show the duplicate in-game device connection entry', () => {
    // This checks host and join choices stay on the main menu instead of opening a second chooser mid-game.
    render(<GameScreen />);
    expect(screen.queryByTestId('open-connection')).toBeNull();
    expect(screen.getByText("Player 1's turn")).toBeTruthy();
  });

  test('tapping any hole selects that column and drops the piece to its lowest open row', () => {
    // This checks that a tap in the top hole still targets the full column and gravity chooses the bottom cell.
    render(<GameScreen />);
    fireEvent.press(screen.getByTestId('cell-0-5'));
    expect(screen.getByTestId('cell-5-5').props.accessibilityLabel).toContain('Player 1');
    expect(screen.getByText("Player 2's turn")).toBeTruthy();
  });

  test('shows the winner only after the board exit transition finishes', () => {
    // This checks that winning discs can be highlighted and the winner message follows the board fade.
    jest.useFakeTimers();
    render(<GameScreen />);
    for (const column of [0, 0, 1, 1, 2, 2, 3]) {
      fireEvent.press(screen.getByTestId(`cell-0-${column}`));
    }
    expect(screen.queryByText('Player 1 won')).toBeNull();
    expect(screen.getByTestId('cell-5-0').props.accessibilityLabel).toContain('winning piece');
    act(() => jest.advanceTimersByTime(3000));
    expect(screen.getByText('Player 1 won')).toBeTruthy();
    jest.useRealTimers();
  });

  test('removes restart and presents a red Leave game action instead', () => {
    // This checks neither local nor online players can unilaterally reset a match from the board.
    render(<GameScreen />);
    expect(screen.queryByTestId('restart-button')).toBeNull();
    expect(screen.getByTestId('leave-game')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('leave-game').props.style).backgroundColor).toBe('#B42332');
  });

  test('canceling the leave confirmation keeps the game and connection active', () => {
    // This checks an accidental leave tap can be canceled without notifying or disconnecting the opponent.
    const { session } = createFakeSession();
    const onExit = jest.fn();
    render(<GameScreen connectionSession={session} onExit={onExit} />);
    fireEvent.press(screen.getByTestId('leave-game'));
    expect(screen.getByTestId('leave-confirmation')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cancel-leave'));
    expect(screen.queryByTestId('leave-confirmation')).toBeNull();
    expect(session.sendMessage).not.toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  test('confirmed local leave returns to the menu without sending a forfeit message', () => {
    // This checks the shared leave confirmation exits pass-and-play without using online signaling.
    const onExit = jest.fn();
    render(<GameScreen onExit={onExit} />);
    fireEvent.press(screen.getByTestId('leave-game'));
    fireEvent.press(screen.getByTestId('confirm-leave'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test('confirmed online leave sends a forfeit, disposes the connection, and exits', () => {
    // This checks only explicit confirmation forfeits the match and severs this player's peer session.
    const { session } = createFakeSession();
    const onExit = jest.fn();
    render(<GameScreen connectionSession={session} onExit={onExit} />);
    fireEvent.press(screen.getByTestId('leave-game'));
    fireEvent.press(screen.getByTestId('confirm-leave'));
    expect(session.sendMessage).toHaveBeenCalledWith('{"type":"forfeit"}');
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test('shows the forfeit win animation and returns to the menu after the result is shown', () => {
    // This checks the remaining player sees the forfeit result instead of being removed from the game immediately.
    jest.useFakeTimers();
    const { session, receive } = createFakeSession();
    const onExit = jest.fn();
    render(<GameScreen connectionSession={session} onExit={onExit} />);
    act(() => receive('{"type":"forfeit"}'));
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(2900));
    expect(screen.getByTestId('forfeit-message')).toBeTruthy();
    expect(screen.getByText('You won by forfeit')).toBeTruthy();
    expect(onExit).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(2000));
    expect(onExit).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('shows a connection-lost message when the peer session disconnects', () => {
    // This checks unexpected transport loss is reported clearly without claiming a forfeit win.
    jest.useFakeTimers();
    const { session, setPhase } = createFakeSession();
    const onExit = jest.fn();
    render(<GameScreen connectionSession={session} onExit={onExit} />);
    act(() => setPhase('failed'));
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(2900));
    expect(screen.getByTestId('connection-lost-message')).toBeTruthy();
    act(() => jest.advanceTimersByTime(2000));
    expect(onExit).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('does not treat intentional local disposal as an opponent disconnect', () => {
    // This checks confirming the player's own leave does not start a second local forfeit animation.
    jest.useFakeTimers();
    const { session } = createFakeSession();
    const onExit = jest.fn();
    render(<GameScreen connectionSession={session} onExit={onExit} />);
    fireEvent.press(screen.getByTestId('leave-game'));
    fireEvent.press(screen.getByTestId('confirm-leave'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('forfeit-message')).toBeNull();
    jest.useRealTimers();
  });
});
