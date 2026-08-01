import { useTelegram } from '../hooks/useTelegram';
import type { useSelection } from '../hooks/useSelection';
import { MAX_SELECT, TOTAL_CARDS } from '../lib/tickets';
import MiniTicketStack from './MiniTicketStack';

interface Props {
  stake: number;
  balance: number;
  selection: ReturnType<typeof useSelection>;
  onBack: () => void;
  onJoin: () => void;
}

const ALL_CARD_NUMBERS = Array.from({ length: TOTAL_CARDS }, (_, i) => i + 1);

export default function SelectionPage({ stake, balance, selection, onBack, onJoin }: Props) {
  const tg = useTelegram();
  const { selectedNumbers, ticketHistory, toggleNumber, quickPick, clear } = selection;

  const handleJoinClick = () => {
    if (selectedNumbers.length < 1 || selectedNumbers.length > MAX_SELECT) return;
    if (balance < stake) {
      const message = `❌ Not enough balance! You need at least ${stake} ETB to play. Please deposit and try again.`;
      if (tg.showAlert) tg.showAlert(message);
      else alert(message);
      return;
    }
    onJoin();
  };

  const handleBack = () => {
    clear();
    tg.HapticFeedback?.impactOccurred('light');
    onBack();
  };

  const joinDisabled = selectedNumbers.length < 1 || selectedNumbers.length > MAX_SELECT;

  return (
    <div id="selection-page" className="card">
      <div className="selection-header">
        <button type="button" id="selection-back-btn" className="selection-back-btn" onClick={handleBack}>
          ◀ Back
        </button>
        <div className="stake-badge">Stake: <span id="stake-amount">{stake}</span> Birr</div>
      </div>

      <div className="selection-status-bar">
        <div className="wallet-info">Balance: <span id="selection-wallet">{balance.toFixed(2)}</span> ETB</div>
        <div className="selected-info">Selected: <span id="selected-count" className="counter">{selectedNumbers.length}</span>/10</div>
      </div>

      <div className="instructions">Select 1 to 10 cards from the 200-card grid below:</div>

      <div className="grid-container">
        <div className="grid cards-grid-200" id="numbers-grid">
          {ALL_CARD_NUMBERS.map((num) => (
            <button
              key={num}
              type="button"
              className={selectedNumbers.includes(num) ? 'selected' : ''}
              onClick={() => toggleNumber(num)}
            >
              {num}
            </button>
          ))}
        </div>
      </div>

      <MiniTicketStack ticketHistory={ticketHistory} />

      <div className="bottom-actions">
        <button type="button" id="quick-pick-btn" className="btn btn-secondary" onClick={quickPick}>
          ⚡ Auto Pick
        </button>
        <button type="button" id="refresh-selection" className="btn btn-warning" onClick={clear}>
          🔄 Clear
        </button>
        <button type="button" id="join-btn" className="btn btn-primary" disabled={joinDisabled} onClick={handleJoinClick}>
          Join Game
        </button>
      </div>
    </div>
  );
}
