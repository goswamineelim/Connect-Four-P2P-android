import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import QrScanner from 'qr-scanner';
import { QRCodeCanvas } from 'qrcode.react';
import { COLUMN_COUNT, ROW_COUNT, createGameState, playMove } from '../../src/game';
import type { GameState } from '../../src/game';
import { PeerSession } from '../../src/networking/PeerSession';
import type { ConnectionSessionPort, ConnectionSnapshot } from '../../src/networking/PeerSession';
import { decodeGameMessage, encodeGameMessage } from '../../src/networking/gameMessages';

type Screen = 'menu' | 'game' | 'connect';
type Role = 'host' | 'client';
type ScanRole = 'offer' | 'answer';
type CropPixels = { x: number; y: number; width: number; height: number };
const emptySnapshot: ConnectionSnapshot = { phase: 'idle', role: null, signalType: null, signalPayload: null, error: null };

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [game, setGame] = useState<GameState>(() => createGameState());
  const [role, setRole] = useState<Role>('host');
  const [scanRole, setScanRole] = useState<ScanRole | null>(null);
  const [session, setSession] = useState<ConnectionSessionPort | null>(null);
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [galleryImage, setGalleryImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<CropPixels | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const scanLockedRef = useRef(false);
  const sessionRef = useRef<ConnectionSessionPort | null>(null);

  useEffect(() => {
    sessionRef.current = session;
    if (!session) return;
    const unsubscribe = session.subscribe((next) => {
      setSnapshot(next);
      if (next.phase === 'connected') {
        setScanRole(null);
        setScreen('game');
      }
    });
    const unsubscribeMessages = session.subscribeMessages((raw) => {
      const message = decodeGameMessage(raw);
      if (!message) return;
      if (message.type === 'move') setGame((current) => playMove(current, message.column));
      if (message.type === 'forfeit') setError('Opponent left the game. You win!');
    });
    return () => { unsubscribe(); unsubscribeMessages(); };
  }, [session]);

  useEffect(() => () => session?.dispose(), [session]);

  const processScannedData = useCallback(async (data: string) => {
    if (scanLockedRef.current || !data) return;
    scanLockedRef.current = true;
    setScanRole(null);
    setBusy(true);
    setError('');
    const active = sessionRef.current;
    if (!active) { setBusy(false); return; }
    try {
      if (role === 'client') await active.acceptOffer(data);
      else await active.acceptAnswer(data);
    } catch (reason) {
      scanLockedRef.current = false;
      setError(reason instanceof Error ? reason.message : 'The scanned QR code could not be used.');
    } finally { setBusy(false); }
  }, [role]);

  useEffect(() => {
    const video = videoRef.current;
    if (!scanRole || !video) return;
    scanLockedRef.current = false;
    const scanner = new QrScanner(video, (result) => { void processScannedData(result.data); }, {
      preferredCamera: 'environment',
      returnDetailedScanResult: true,
      onDecodeError: () => { /* Keep scanning until a QR is found. */ },
    });
    scannerRef.current = scanner;
    void scanner.start().catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : 'The camera could not start.';
      setError(`${message} Camera access requires permission and a secure page (HTTPS or localhost).`);
    });
    return () => {
      scannerRef.current = null;
      scanner.stop();
      scanner.destroy();
    };
  }, [scanRole, processScannedData]);

  useEffect(() => {
    if (!galleryImage) return;
    return () => URL.revokeObjectURL(galleryImage);
  }, [galleryImage]);

  const startConnection = async (nextRole: Role) => {
    session?.dispose();
    const next = new PeerSession();
    sessionRef.current = next;
    setRole(nextRole);
    setSession(next);
    setSnapshot(next.getSnapshot());
    setInput('');
    setError('');
    setScanRole(nextRole === 'client' ? 'offer' : null);
    scanLockedRef.current = false;
    setScreen('connect');
    if (nextRole === 'host') {
      setBusy(true);
      try { await next.createOffer(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create the Offer.'); }
      finally { setBusy(false); }
    }
  };

  const acceptPastedSignal = async () => {
    if (!session || !input.trim()) return;
    setScanRole(null);
    setBusy(true);
    setError('');
    try {
      if (role === 'client') await session.acceptOffer(input.trim());
      else await session.acceptAnswer(input.trim());
      setInput('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not use that signal.'); }
    finally { setBusy(false); }
  };

  const goMenu = () => {
    scannerRef.current?.stop();
    session?.dispose();
    sessionRef.current = null;
    setSession(null);
    setSnapshot(emptySnapshot);
    setScanRole(null);
    setError('');
    setGame(createGameState());
    setScreen('menu');
  };

  const move = (column: number) => {
    if (screen === 'game' && session && session.getSnapshot().phase !== 'connected') return;
    if (session && (role === 'host' ? game.currentPlayer !== 1 : game.currentPlayer !== 2)) return;
    const next = playMove(game, column);
    if (next === game) return;
    setGame(next);
    if (session) {
      try { session.sendMessage(encodeGameMessage({ type: 'move', column })); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send move.'); }
    }
  };

  const handleGalleryFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image containing the connection QR code.'); return; }
    setError('');
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropPixels(null);
    setGalleryImage(URL.createObjectURL(file));
  };

  const scanGalleryCrop = async () => {
    if (!galleryImage || !cropPixels) return;
    setBusy(true);
    setError('');
    try {
      const image = new Image();
      image.src = galleryImage;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropPixels.width);
      canvas.height = Math.round(cropPixels.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare that image crop.');
      context.drawImage(image, cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height, 0, 0, canvas.width, canvas.height);
      const result = await QrScanner.scanImage(canvas, { returnDetailedScanResult: true });
      setGalleryImage(null);
      await processScannedData(result.data);
    } catch {
      setError('No QR code was found in that crop. Choose the image again and crop tightly around the QR, or scan with the camera.');
    } finally { setBusy(false); }
  };

  const shareQr = async () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    setBusy(true);
    setError('');
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not create QR image.')), 'image/png'));
      const file = new File([blob], 'connect-four-connection.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Connect Four connection QR' });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (reason) {
      if (reason instanceof Error && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Could not share the QR code. Try downloading it instead.');
    } finally { setBusy(false); }
  };

  const signalLabel = snapshot.signalType === 'answer' ? 'Answer' : 'Offer';
  const statusText = error || snapshot.error ? 'Connection failed'
    : busy ? 'Preparing the connection'
    : scanRole ? `Scanning ${scanRole === 'offer' ? 'Offer' : 'Answer'} QR`
    : snapshot.phase === 'showing-qr' ? 'Connection QR ready'
    : snapshot.phase === 'connecting' ? 'Connecting...'
    : 'Starting connection';

  return (
    <main className="app-shell">
      <header className="topbar"><span className="brand-mark">4</span><span>CONNECT FOUR</span><span className="topbar-note">WEB TEST BUILD</span></header>
      {screen === 'menu' && <section className="menu panel">
        <p className="eyebrow">TWO PLAYERS / ONE BOARD</p><h1>Connect Four</h1><p className="muted">Choose how you want to play</p>
        <div className="menu-actions">
          <button className="button primary" onClick={() => { setGame(createGameState()); setScreen('game'); }}>Play locally<span>Pass and play on this device</span></button>
          <button className="button" onClick={() => void startConnection('host')}>Host a game<span>Show an Offer QR to the other device</span></button>
          <button className="button" onClick={() => void startConnection('client')}>Join a game<span>Scan the host's Offer QR</span></button>
        </div>
      </section>}
      {screen === 'connect' && <section className="connect panel">
        <button className="text-button" onClick={goMenu}>&larr; Back</button><p className="eyebrow">DIRECT CONNECTION</p><h1>Connect devices</h1>
        <p className="muted connection-status" role="status">{statusText}</p>

        {scanRole && <div className="scanner-panel">
          <div className="camera-frame"><video ref={videoRef} muted playsInline /></div>
          <button className="button" onClick={() => galleryInputRef.current?.click()}>Choose from gallery</button>
          <input ref={galleryInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => { handleGalleryFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          <p className="hint">Allow camera access, or choose a QR image and crop around the code.</p>
        </div>}

        {snapshot.signalPayload && <div className="qr-panel">
          <p className="instruction">{snapshot.signalType === 'offer' ? 'Show this Offer QR to the other device' : 'Show this Answer QR to the host'}</p>
          <div className="qr-frame"><QRCodeCanvas ref={qrCanvasRef} value={snapshot.signalPayload} size={320} level="L" marginSize={4} /></div>
          <button className="button primary compact" onClick={() => void shareQr()} disabled={busy}>Share QR</button>
          {snapshot.phase === 'connecting' && <p className="hint">Keep this QR visible while the host scans it.</p>}
        </div>}

        {role === 'host' && snapshot.phase === 'showing-qr' && !scanRole && <button className="button primary compact" onClick={() => { setError(''); setScanRole('answer'); }}>Scan Answer QR</button>}
        {role === 'client' && snapshot.phase === 'connecting' && <p className="hint">Offer scanned. Show the Answer QR to the host.</p>}
        {error && !scanRole && snapshot.phase !== 'failed' && <button className="button compact" onClick={() => { setError(''); setScanRole(role === 'host' ? 'answer' : 'offer'); }}>Scan QR again</button>}

        <details className="paste-fallback"><summary>Use copy and paste instead</summary>
          {snapshot.signalPayload && <div className="signal-block"><label>{signalLabel} payload</label><textarea readOnly value={snapshot.signalPayload} /><button className="button primary compact" onClick={() => void navigator.clipboard.writeText(snapshot.signalPayload || '')}>Copy {signalLabel}</button></div>}
          <div className="signal-block"><label>{role === 'host' ? 'Paste the Answer from the other device' : 'Paste the Offer from the host'}</label><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste connection payload here" /><button className="button primary compact" disabled={busy || !input.trim()} onClick={() => void acceptPastedSignal()}>{role === 'host' ? 'Accept Answer' : 'Accept Offer'}</button></div>
        </details>
        {(error || snapshot.error) && <div className="error-box" role="alert"><p>{error || snapshot.error}</p>{!scanRole && snapshot.phase === 'failed' && <button className="text-button" onClick={() => void startConnection(role)}>Try again</button>}</div>}
        {scanRole && <button className="text-button cancel-scan" onClick={() => setScanRole(null)}>Cancel scan</button>}
      </section>}
      {screen === 'game' && <section className="game-layout">
        <div className="game-heading"><div><p className="eyebrow">{session ? 'ONLINE MATCH' : 'LOCAL MATCH'}</p><h1>Connect Four</h1></div><button className="text-button" onClick={goMenu}>Leave game</button></div>
        <div className="turn-pill"><i className={`player-dot p${game.currentPlayer}`} />{game.status === 'won' ? `Player ${game.winner} wins!` : game.status === 'draw' ? 'It is a draw' : `Player ${game.currentPlayer}'s turn`}{session && <small> · You are Player {role === 'host' ? '1' : '2'}</small>}</div>
        <div className="board" role="grid" aria-label="Connect Four board">{Array.from({ length: ROW_COUNT }, (_, row) => Array.from({ length: COLUMN_COUNT }, (_, column) => {
          const value = game.board[row][column];
          const winning = game.winningCells.some((cell) => cell.row === row && cell.column === column);
          return <button key={`${row}-${column}`} className="cell" role="gridcell" aria-label={`Row ${row + 1}, column ${column + 1}${value ? `, player ${value}` : ''}`} onClick={() => move(column)} disabled={game.status !== 'playing'}><span className={`disc ${value ? `p${value}` : ''} ${winning ? 'winning' : ''}`} /></button>;
        }))}</div>
        {error && <p className="error">{error}</p>}
        <p className="hint">{session ? 'Moves sync directly between the connected browsers.' : 'Tap any hole to drop a disc.'}</p>
      </section>}

      {galleryImage && <div className="modal-scrim" role="presentation"><section className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <h2 id="crop-title">Crop connection QR</h2><p className="hint">Move and zoom until the Offer or Answer QR fills the square.</p>
        <div className="crop-stage"><Cropper image={galleryImage} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCropPixels(pixels)} /></div>
        <label className="zoom-control">Zoom<input type="range" min="1" max="4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <div className="crop-actions"><button className="button" onClick={() => setGalleryImage(null)}>Cancel</button><button className="button primary" disabled={busy || !cropPixels} onClick={() => void scanGalleryCrop()}>{busy ? 'Scanning...' : 'Scan QR'}</button></div>
      </section></div>}
    </main>
  );
}
