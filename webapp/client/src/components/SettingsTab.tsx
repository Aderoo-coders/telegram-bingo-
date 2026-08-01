import type { useWallet } from '../hooks/useWallet';
import type { Theme } from '../types';

interface Props {
  wallet: ReturnType<typeof useWallet>;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'neon', label: 'Neon Space' },
  { id: 'obsidian', label: 'Obsidian Blue' },
  { id: 'light', label: 'Light Cyber' },
];

export default function SettingsTab({ wallet, theme, onThemeChange }: Props) {
  return (
    <div className="card">
      <h2 className="section-title">⚙️ Settings</h2>

      <div className="settings-group">
        <h3>👤 Player Profile</h3>
        <div className="profile-details">
          <div className="profile-row">
            <span className="detail-label">Username:</span>
            <span className="detail-value" id="profile-username">{wallet.username ? `@${wallet.username}` : 'N/A'}</span>
          </div>
          <div className="profile-row">
            <span className="detail-label">User ID:</span>
            <span className="detail-value" id="profile-userid">{wallet.userId}</span>
          </div>
          <div className="profile-row">
            <span className="detail-label">Phone:</span>
            <span className="detail-value" id="profile-phone">{wallet.phone || 'Not Registered'}</span>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h3>🎨 Appearance Theme</h3>
        <p className="desc">Choose color aesthetics style:</p>
        <div className="theme-selectors">
          {THEMES.map((t) => (
            <button
              key={t.id}
              id={`theme-${t.id === 'neon' ? 'dark-neon' : t.id}`}
              className={`theme-btn${theme === t.id ? ' active' : ''}`}
              onClick={() => onThemeChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <h3>🤝 Support & Contact</h3>
        <p className="desc">Need help or want to deposit manual funds?</p>
        <div className="settings-actions">
          <a href="https://t.me/Alexbdujebar" target="_blank" rel="noreferrer" className="btn btn-secondary">💬 Contact Admin</a>
          <a href="https://t.me/Alexbdujebar" target="_blank" rel="noreferrer" className="btn btn-warning">💳 Deposit Wallet</a>
        </div>
        <div className="faq-box">
          <h4>💡 FAQ</h4>
          <div className="faq-item">
            <div className="faq-q">How does the payout work?</div>
            <div className="faq-a">
              Admin commission (20%) is automatically deducted from every game stake. The winner gets the remaining 80% pool.
              If multiple players win on the same draw, the reward is split.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
