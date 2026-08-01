interface Props {
  balance: number;
  onSelectStake: (stake: number) => void;
}

const STAKES = [10, 20];

export default function WelcomePage({ balance, onSelectStake }: Props) {
  return (
    <div id="welcome-page" className="card welcome-card">
      <div className="welcome-header">
        <div className="welcome-ghost-container">
          <svg className="welcome-ghost-svg" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M20 50 C20 20, 80 20, 80 50 C80 50, 85 85, 80 90 C75 95, 70 85, 65 90 C60 95, 55 85, 50 90 C45 85, 40 95, 35 90 C30 85, 25 95, 20 90 C15 85, 20 50, 20 50 Z"
              fill="#ffffff"
              filter="drop-shadow(0 0 15px rgba(255, 255, 255, 0.4))"
            />
            <path d="M34 44 C34 40, 42 40, 42 44" stroke="#111" strokeWidth="4.5" strokeLinecap="round" fill="none" />
            <ellipse cx="64" cy="45" rx="5.5" ry="6.5" fill="#111" />
            <circle cx="66" cy="43" r="2" fill="#ffffff" />
            <ellipse cx="28" cy="54" rx="6" ry="3.5" fill="#ff4d94" opacity="0.5" />
            <ellipse cx="68" cy="54" rx="6" ry="3.5" fill="#ff4d94" opacity="0.5" />
            <path d="M 44 54 Q 49 63 54 54 Z" fill="#111" />
            <path d="M 46 57 Q 49 65 52 57 Z" fill="#ff3366" />
          </svg>
        </div>
        <div className="welcome-title-small">Welcome to</div>
        <div className="welcome-title-large">BINGO SPARK</div>
        <div className="welcome-subtitle">Choose your stake and start playing</div>
      </div>

      <div className="welcome-stake-container">
        <div className="welcome-stake-header">
          <span className="stake-header-arrow">▶</span> Choose Your Stake
        </div>

        <div className="welcome-stake-buttons">
          {STAKES.map((stake) => (
            <button key={stake} type="button" className="welcome-stake-btn" onClick={() => onSelectStake(stake)}>
              <span className="welcome-btn-arrow">▶</span> Play {stake} Birr
            </button>
          ))}
        </div>
      </div>

      <div className="welcome-balance-capsule">💰 Balance: <span>{balance.toFixed(2)}</span> ETB</div>

      <div className="welcome-bot-footer">@BingoSparkbot</div>
    </div>
  );
}
