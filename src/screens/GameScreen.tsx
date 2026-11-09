import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { COLUMN_COUNT, ROW_COUNT, createGameState, playMove } from '../game';
import type { GameState, Player } from '../game';
import type { ConnectionSessionPort } from '../networking/PeerSession';
import { decodeGameMessage, encodeGameMessage } from '../networking/gameMessages';

const COLORS = {
  background: '#091326',
  board: '#1769E8',
  hole: '#071124',
  playerOne: '#F04452',
  playerTwo: '#FFD34E',
  winningRing: '#FF233F',
  text: '#F7FAFF',
  muted: '#AAB8D0',
};

interface GameScreenProps {
  connectionSession?: ConnectionSessionPort | null;
  onExit?: () => void;
}

function playerColor(player: Player): string {
  return player === 1 ? COLORS.playerOne : COLORS.playerTwo;
}

export default function GameScreen({ connectionSession = null, onExit }: GameScreenProps) {
  const { width } = useWindowDimensions();
  const [game, setGame] = useState<GameState>(() => createGameState());
  const [winnerRevealed, setWinnerRevealed] = useState(false);
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [opponentForfeited, setOpponentForfeited] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [peerSession, setPeerSession] = useState<ConnectionSessionPort | null>(connectionSession);
  const boardOpacity = useRef(new Animated.Value(1)).current;
  const dropProgress = useRef(new Animated.Value(1)).current;
  const winnerCellKeys = useMemo(
    () => new Set(game.winningCells.map(({ row, column }) => `${row}:${column}`)),
    [game.winningCells],
  );

  const boardWidth = Math.min(width - 32, 490);
  const cellSize = boardWidth / COLUMN_COUNT;
  const discSize = cellSize * 0.72;
  const boardHeight = cellSize * ROW_COUNT;

  const confirmLeave = () => {
    setShowLeaveConfirmation(false);
    if (peerSession) {
      try {
        peerSession.sendMessage(encodeGameMessage({ type: 'forfeit' }));
      } catch {
        // The peer may already be unreachable; still close the local connection and leave the game.
      }
      peerSession.dispose();
    }
    onExit?.();
  };

  useEffect(() => {
    if (!game.lastMove) return;
    dropProgress.setValue(0);
    Animated.spring(dropProgress, {
      toValue: 1,
      speed: 16,
      bounciness: 3,
      useNativeDriver: true,
    }).start();
  }, [game.lastMove, dropProgress]);

  useEffect(() => {
    if (game.status !== 'won' && !opponentForfeited && !connectionLost) {
      boardOpacity.stopAnimation();
      boardOpacity.setValue(1);
      setWinnerRevealed(false);
      return;
    }

    setWinnerRevealed(false);
    boardOpacity.setValue(1);
    const fade = Animated.timing(boardOpacity, {
      toValue: 0,
      delay: 1300,
      duration: 1600,
      useNativeDriver: true,
    });
    fade.start();
    const revealTimeout = setTimeout(() => setWinnerRevealed(true), 2900);
    const returnTimeout = opponentForfeited || connectionLost ? setTimeout(() => onExit?.(), 4900) : null;
    return () => {
      clearTimeout(revealTimeout);
      if (returnTimeout) clearTimeout(returnTimeout);
      fade.stop();
    };
  }, [game.status, opponentForfeited, connectionLost, boardOpacity, onExit]);

  const dropPiece = (column: number) => {
    if (opponentForfeited) return;
    const localPlayer: Player = peerSession?.getSnapshot().role === 'client' ? 2 : 1;
    if (peerSession && game.currentPlayer !== localPlayer) return;
    const next = playMove(game, column);
    if (next === game) return;
    if (peerSession) peerSession.sendMessage(encodeGameMessage({ type: 'move', column }));
    setGame(next);
  };

  useEffect(() => {
    if (!peerSession) return;
    const handleConnectionSnapshot = (snapshot: ReturnType<ConnectionSessionPort['getSnapshot']>) => {
      if (snapshot.phase === 'failed') {
        setConnectionLost(true);
        peerSession.dispose();
      }
    };
    const unsubscribeConnection = peerSession.subscribe(handleConnectionSnapshot);
    const unsubscribe = peerSession.subscribeMessages((raw) => {
      const message = decodeGameMessage(raw);
      if (!message) return;
      if (message.type === 'forfeit') {
        setOpponentForfeited(true);
        peerSession.dispose();
        return;
      }
      const remotePlayer: Player = peerSession.getSnapshot().role === 'host' ? 2 : 1;
      setGame((current) => current.currentPlayer === remotePlayer ? playMove(current, message.column) : current);
    });
    if (peerSession.getSnapshot().phase === 'failed') {
      setConnectionLost(true);
      peerSession.dispose();
    }
    return () => {
      unsubscribeConnection();
      unsubscribe();
      peerSession.dispose();
    };
  }, [peerSession]);

  const currentStatus = connectionLost
    ? 'Connection lost with opponent'
    : opponentForfeited
      ? 'Opponent forfeited'
    : game.status === 'playing'
    ? `Player ${game.currentPlayer}'s turn`
    : game.status === 'draw'
      ? "It's a draw"
      : 'Winning line!';

  return (
    <ScrollView contentContainerStyle={styles.screen} style={styles.scroll}>
      <Text style={styles.eyebrow}>{peerSession ? 'ONLINE MATCH' : 'PASS & PLAY'}</Text>
      <Text style={styles.title}>Connect Four</Text>
      <View style={styles.turnBadge} accessibilityLiveRegion="polite">
        {game.status === 'playing' && !opponentForfeited && !connectionLost && (
          <View style={[styles.turnDot, { backgroundColor: playerColor(game.currentPlayer) }]} />
        )}
        <Text style={styles.turnText}>{currentStatus}</Text>
      </View>

      <View style={[styles.boardFrame, { width: boardWidth, height: boardHeight }]}>
        <Animated.View
          testID="game-board"
          style={[styles.board, { opacity: boardOpacity, transform: [{ scale: boardOpacity }] }]}
        >
          {Array.from({ length: ROW_COUNT }, (_, row) => (
            <View key={row} style={styles.row}>
              {Array.from({ length: COLUMN_COUNT }, (_, column) => {
                const player = game.board[row][column];
                const isWinning = winnerCellKeys.has(`${row}:${column}`);
                const isLastMove = game.lastMove?.row === row && game.lastMove.column === column;
                const isAnimatedPiece = isLastMove && game.status !== 'draw';
                const label = `${player ? `Player ${player} piece` : 'empty'}, row ${row + 1}, column ${column + 1}${isWinning ? ', winning piece' : ''}`;

                return (
                  <Pressable
                    key={column}
                    testID={`cell-${row}-${column}`}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ disabled: game.status !== 'playing' || opponentForfeited || connectionLost }}
                    disabled={game.status !== 'playing' || opponentForfeited || connectionLost}
                    onPress={() => dropPiece(column)}
                    style={[styles.cell, { width: cellSize, height: cellSize }]}
                  >
                    <View style={[styles.hole, { width: discSize, height: discSize }]}>
                      {player !== null && !isAnimatedPiece && (
                        <View style={[styles.disc, { backgroundColor: playerColor(player) }]} />
                      )}
                      {isWinning && <View style={styles.winningRing} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {game.lastMove && game.status !== 'draw' && (
            <Animated.View
              pointerEvents="none"
              testID="falling-piece"
              style={[
                styles.fallingPiece,
                {
                  width: discSize,
                  height: discSize,
                  left: game.lastMove.column * cellSize + (cellSize - discSize) / 2,
                  top: game.lastMove.row * cellSize + (cellSize - discSize) / 2,
                  backgroundColor: playerColor(game.board[game.lastMove.row][game.lastMove.column] as Player),
                  transform: [
                    {
                      translateY: dropProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-boardHeight, 0],
                      }),
                    },
                  ],
                },
              ]}
            />
          )}
        </Animated.View>
        {(game.status === 'won' || opponentForfeited || connectionLost) && winnerRevealed && (
          <View testID="winner-message" style={[styles.winnerCard, styles.winnerOverlay, { top: boardHeight / 2 - 44 }]}>
            <Text style={styles.winnerKicker}>{connectionLost ? 'CONNECTION ENDED' : 'GAME OVER'}</Text>
            {connectionLost
              ? <Text testID="connection-lost-message" style={styles.winnerText}>Connection lost with opponent</Text>
              : opponentForfeited
              ? <Text testID="forfeit-message" style={styles.winnerText}>You won by forfeit</Text>
              : <Text style={styles.winnerText}>Player {game.winner} won</Text>}
          </View>
        )}
      </View>

      {!opponentForfeited && !connectionLost && (
        <Pressable
          testID="leave-game"
          accessibilityRole="button"
          onPress={() => setShowLeaveConfirmation(true)}
          style={styles.leaveButton}
        >
          <Text style={styles.leaveText}>Leave game</Text>
        </Pressable>
      )}
      <Text style={styles.footer}>Tap any hole to drop into that column</Text>
      <Modal visible={showLeaveConfirmation} transparent animationType="fade" onRequestClose={() => setShowLeaveConfirmation(false)}>
        <View style={styles.confirmationOverlay}>
          <View testID="leave-confirmation" style={styles.confirmationCard}>
            <Text style={styles.confirmationTitle}>Leave this game?</Text>
            <Text style={styles.confirmationText}>
              {peerSession ? 'Leaving will end the connection and your opponent will win by forfeit.' : 'Are you sure you want to leave this local game?'}
            </Text>
            <Pressable testID="confirm-leave" accessibilityRole="button" onPress={confirmLeave} style={styles.confirmLeaveButton}>
              <Text style={styles.leaveText}>Leave game</Text>
            </Pressable>
            <Pressable testID="cancel-leave" accessibilityRole="button" onPress={() => setShowLeaveConfirmation(false)} style={styles.cancelLeaveButton}>
              <Text style={styles.cancelLeaveText}>Keep playing</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.background },
  screen: {
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 16,
    backgroundColor: COLORS.background,
  },
  eyebrow: { color: '#76A8FF', fontSize: 12, fontWeight: '800', letterSpacing: 3 },
  title: { marginTop: 6, color: COLORS.text, fontSize: 34, lineHeight: 40, fontWeight: '900' },
  turnBadge: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 12,
    marginBottom: 20,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: '#15233A',
  },
  turnDot: { width: 12, height: 12, borderRadius: 6 },
  turnText: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  boardFrame: {
    position: 'relative',
    overflow: 'visible',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 9,
  },
  board: {
    flex: 1,
    position: 'relative',
    borderRadius: 14,
    backgroundColor: COLORS.board,
  },
  row: { flex: 1, flexDirection: 'row' },
  cell: { alignItems: 'center', justifyContent: 'center' },
  hole: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: COLORS.hole,
    shadowColor: '#79B0FF',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 1, height: 1 },
  },
  disc: { width: '100%', height: '100%', borderRadius: 999 },
  winningRing: {
    position: 'absolute',
    width: '112%',
    height: '112%',
    top: '-6%',
    left: '-6%',
    borderRadius: 999,
    borderWidth: 3,
    borderColor: COLORS.winningRing,
    shadowColor: '#FFF',
    shadowOpacity: 0.85,
    shadowRadius: 5,
    elevation: 4,
  },
  fallingPiece: { position: 'absolute', zIndex: 2, borderRadius: 999 },
  winnerCard: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#172842',
    borderColor: '#34527C',
    borderWidth: 1,
  },
  winnerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 5,
  },
  winnerKicker: { color: '#8CA9D1', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  winnerText: { marginTop: 3, color: COLORS.text, fontSize: 25, fontWeight: '900' },
  leaveButton: {
    minWidth: 190,
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#B42332',
  },
  leaveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  confirmationOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: 'rgba(4, 10, 20, 0.78)' },
  confirmationCard: { width: '100%', maxWidth: 360, alignItems: 'center', padding: 24, borderRadius: 20, backgroundColor: '#15233A', borderWidth: 1, borderColor: '#334A6C' },
  confirmationTitle: { color: COLORS.text, fontSize: 22, fontWeight: '900' },
  confirmationText: { marginTop: 10, color: COLORS.muted, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  confirmLeaveButton: { width: '100%', alignItems: 'center', marginTop: 22, paddingVertical: 13, borderRadius: 12, backgroundColor: '#B42332' },
  cancelLeaveButton: { width: '100%', alignItems: 'center', marginTop: 10, paddingVertical: 13, borderRadius: 12, backgroundColor: '#24436E' },
  cancelLeaveText: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  footer: { marginTop: 15, color: COLORS.muted, fontSize: 13 },
});
