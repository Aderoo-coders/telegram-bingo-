import type { LobbyPlayer } from '../types';

interface Props {
  visible: boolean;
  statusText: string;
  players: LobbyPlayer[];
  myUserId: string;
  countdownVisible: boolean;
  countdownSeconds: number;
}

export default function LobbyOverlay({ visible, statusText, players, myUserId, countdownVisible, countdownSeconds }: Props) {
  return (
    <div id="lobby-waiting" className={`lobby-overlay${visible ? '' : ' hidden'}`}>
      <div className="loader-spinner" />
      <h2 id="lobby-waiting-status">{statusText}</h2>
      <div className="waiting-details">Minimum 2 players required to begin</div>
      <ul id="joined-players-list" className="joined-players-list">
        {players.map((p, index) => (
          <li key={p.userId} style={p.userId === myUserId ? { color: 'var(--color-primary)' } : undefined}>
            {p.userId === myUserId ? `Player ${index + 1} (You)` : `Player ${index + 1}`}
          </li>
        ))}
      </ul>
      <div id="lobby-countdown-box" className={`countdown-box${countdownVisible ? '' : ' hidden'}`}>
        ⏳ Game starts in: <span id="lobby-seconds" className="countdown-seconds">{countdownSeconds}</span>s
      </div>
    </div>
  );
}
