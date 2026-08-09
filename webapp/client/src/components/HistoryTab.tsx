import type { useWallet } from '../hooks/useWallet';

interface Props {
  wallet: ReturnType<typeof useWallet>;
  myUserId: string;
}

export default function HistoryTab({ wallet, myUserId }: Props) {
  const history = wallet.history;

  return (
    <div className="card">
      <h2 className="section-title">📜 Game History</h2>
      <p className="desc">Your recent 20 matches showing stake, results, and matching status.</p>

      <div id="history-games-list" className="history-list">
        {history === null ? null : history.length === 0 ? (
          <div className="desc" style={{ textAlign: 'center', padding: '20px' }}>You haven't played any games yet.</div>
        ) : (
          history.map((game) => {
            const won = game.winner_id === myUserId;
            const badgeClass = won ? 'win' : 'loss';
            const badgeText = won ? 'WON' : game.winner_id ? 'LOST' : 'DRAW';
            return (
              <div className="history-card" key={game.id}>
                <div className="history-header-row">
                  <span className="history-game-id">Game #{game.id}</span>
                  <span className={`history-outcome-badge ${badgeClass}`}>{badgeText}</span>
                </div>
                <div className="history-details-row">
                  <span>Stake: {parseFloat(String(game.stake)).toFixed(2)} ETB</span>
                  <span>Matches: {game.matches}/15</span>
                </div>
                <div className="history-drawings-text">
                  {game.called_numbers && game.called_numbers.length > 0
                    ? `Called numbers: ${game.called_numbers.join(', ')}`
                    : 'Called numbers: None'}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
