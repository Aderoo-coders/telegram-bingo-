import { FREE_SPACE } from '../lib/tickets';
import type { TicketMatrix } from '../types';
import { getBingoLetter } from '../lib/tickets';

interface Props {
  calledCount: number;
  currentBall: number | null;
  currentBallLetter: string;
  ballAnimKey: number;
  ballHistory: number[];
  autoMark: boolean;
  onAutoMarkChange: (value: boolean) => void;
  boardStatusText: string;
  matchCount: number;
  myNumbers: number[];
  ticketMatrix: TicketMatrix;
  matchedNumbers: number[];
  playingBalance: number;
}

export default function LiveCallPanel({
  calledCount,
  currentBall,
  currentBallLetter,
  ballAnimKey,
  ballHistory,
  autoMark,
  onAutoMarkChange,
  boardStatusText,
  matchCount,
  myNumbers,
  ticketMatrix,
  matchedNumbers,
  playingBalance,
}: Props) {
  const matchTarget = Math.min(12, myNumbers.length);
  const hasCard = myNumbers.length > 0;
  const isReady = hasCard && matchTarget > 0 && matchCount >= matchTarget;

  let bingoBtnLabel = 'NO CARD';
  if (hasCard) {
    bingoBtnLabel = isReady ? 'BINGO!' : `${matchCount}/${matchTarget} MATCH`;
  }

  return (
    <aside className="live-call-panel">
      <div className="live-call-top">
        <div className="live-indicator">
          <span className="live-dot" />
          <span>LIVE <span id="live-progress">{calledCount}/75</span></span>
        </div>
        <label className="auto-toggle" title="Auto mark">
          <span>AUTO</span>
          <input
            type="checkbox"
            id="auto-mark-toggle"
            checked={autoMark}
            onChange={(e) => onAutoMarkChange(e.target.checked)}
          />
          <span className="auto-slider" />
        </label>
      </div>

      <div
        key={ballAnimKey}
        id="current-ball"
        className={`current-call-ball${currentBall !== null ? ` letter-${currentBallLetter} animate` : ''}`}
      >
        {currentBall ?? '-'}
      </div>
      <div className="ball-history" id="ball-history-row">
        {ballHistory.map((n) => (
          <div key={n} className={`ball-history-item letter-${getBingoLetter(n)}`}>
            {n}
          </div>
        ))}
      </div>

      <div className="board-status-box">
        <div className="board-status-icon">⏱</div>
        <p id="board-status-text">{boardStatusText}</p>
        <p className="board-match-line">Matches: <span id="match-score">{matchCount}</span>/<span id="match-target">{matchTarget}</span></p>
      </div>

      <div id="player-cartela" className="player-cartela-grid board-room-cartela">
        {ticketMatrix.flat().map((value, idx) => {
          const isFree = value === FREE_SPACE;
          const isMatched = typeof value === 'number' && matchedNumbers.includes(value);
          const classNames = [isFree ? 'free-space' : '', isMatched ? 'matched' : ''].filter(Boolean).join(' ');
          return (
            <button
              key={idx}
              type="button"
              id={isFree ? 'card-num-free' : value ? `card-num-${value}` : undefined}
              className={classNames || undefined}
            >
              {isFree ? 'FREE' : value ?? ''}
            </button>
          );
        })}
      </div>

      <button type="button" id="bingo-action-btn" className={`bingo-action-btn${isReady ? ' ready' : ''}`} disabled={!isReady}>
        {bingoBtnLabel}
      </button>
      <span id="playing-wallet" className="visually-hidden">{playingBalance.toFixed(2)} ETB</span>
    </aside>
  );
}
