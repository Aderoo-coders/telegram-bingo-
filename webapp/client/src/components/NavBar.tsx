import type { TabName } from '../types';

const TABS: { id: TabName; icon: string; label: string }[] = [
  { id: 'play', icon: '🏠', label: 'Game' },
  { id: 'history', icon: '🕒', label: 'History' },
  { id: 'wallet', icon: '💳', label: 'Wallet' },
  { id: 'settings', icon: '👤', label: 'Profile' },
];

interface Props {
  activeTab: TabName;
  onSelect: (tab: TabName) => void;
}

export default function NavBar({ activeTab, onSelect }: Props) {
  return (
    <div className="nav-bar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`nav-item${activeTab === tab.id ? ' active' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          <span className="nav-icon">{tab.icon}</span>
          <span className="nav-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
