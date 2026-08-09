import { useTelegram } from '../hooks/useTelegram';

interface Props {
  gameId: number | string;
  playersCount: number;
  stake: number;
  calledCount: number;
  onBack: () => void;
}

export default function BoardStatsBar({ gameId, playersCount, stake, calledCount, onBack }: Props) {
  const tg = useTelegram();
  const derash = Math.floor(playersCount * stake * 0.8);

  const handleBack = () => {
    if (tg.showConfirm) {
      tg.showConfirm('Leave this game board?', (confirmed) => {
        if (confirmed) onBack();
      });
    } else if (confirm('Leave this game board?')) {
      onBack();
    }
  };

  return (
    <div className="board-stats-bar">
      <button type="button" id="board-back-btn" className="board-back-btn" aria-label="Back" onClick={handleBack}>
        ‹
      </button>
      <div className="board-stat">
        <span className="board-stat-label">DERASH</span>
        <span className="board-stat-value" id="board-derash">{derash} Birr</span>
      </div>
      <div className="board-stat">
        <span className="board-stat-label">PLAYERS</span>
        <span className="board-stat-value" id="board-players">{playersCount}</span>
      </div>
      <div className="board-stat">
        <span className="board-stat-label">STAKE</span>
        <span className="board-stat-value" id="board-stake">{stake} Birr</span>
      </div>
      <div className="board-stat">
        <span className="board-stat-label">CALLED</span>
        <span className="board-stat-value" id="called-count">{calledCount}</span>
      </div>
      <div className="board-stat">
        <span className="board-stat-label">GAME NO</span>
        <span className="board-stat-value" id="cartela-count">{gameId}</span>
      </div>
    </div>
  );
}
