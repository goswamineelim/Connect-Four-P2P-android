import { fireEvent, render, screen, act } from '@testing-library/react-native';
import GameScreen from '../../screens/GameScreen';

describe('GameScreen', () => {
  test('opens the device connection flow without replacing the local board', () => {
    // This checks the networking screen is reachable while preserving the current game screen.
    render(<GameScreen />);
    fireEvent.press(screen.getByTestId('open-connection'));
    expect(screen.getByText('Host a connection')).toBeTruthy();
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

  test('restart clears the board and restores Player 1 as the current player', () => {
    // This checks that the restart control begins a clean game after a move.
    render(<GameScreen />);
    fireEvent.press(screen.getByTestId('cell-0-2'));
    fireEvent.press(screen.getByTestId('restart-button'));
    expect(screen.getByText("Player 1's turn")).toBeTruthy();
    expect(screen.getByTestId('cell-5-2').props.accessibilityLabel).toContain('empty');
  });
});
