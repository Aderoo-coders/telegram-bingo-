import type { GameOverInfo } from '../hooks/useGameSocket';

interface Props {
  gameOver: GameOverInfo | null;
  hintSecondsLeft: number;
}

export default function GameOverOverlay({ gameOver, hintSecondsLeft }: Props) {
  const titleClass = gameOver
    ? gameOver.outcome === 'draw'
      ? ''
      : gameOver.isWinner
        ? 'winner-title'
        : 'loss-title'
    : '';

  return (
    <div id="game-over-overlay" className={`game-over-overlay${gameOver ? '' : ' hidden'}`}>
      <div className="game-over-box">
        <h1 id="game-outcome-title" className={titleClass}>{gameOver?.title ?? 'BINGO!'}</h1>
        <div className="trophy">🏆</div>
        <p id="winner-name-p">{gameOver?.winnerText ?? 'Winner: user123'}</p>
        <p id="payout-amount-p">{gameOver?.payoutText ?? 'Won: 0.00 ETB'}</p>
        <p id="auto-return-hint" className="auto-return-hint">
          Returning to menu in {hintSecondsLeft}s…
        </p>
        <button id="lobby-return-btn" className="btn btn-primary hidden">Return to Menu</button>
      </div>
    </div>
  );
}
