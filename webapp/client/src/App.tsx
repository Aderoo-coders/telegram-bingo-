import { useEffect, useMemo, useState } from 'react';
import { useTelegram } from './hooks/useTelegram';
import { useWallet } from './hooks/useWallet';
import { useSelection } from './hooks/useSelection';
import { buildTicketMatrix } from './lib/tickets';
import { loadTheme, saveTheme, themeBodyClass } from './lib/theme';
import type { PlayPhase, TabName, Theme, TicketMatrix } from './types';
import NavBar from './components/NavBar';
import WelcomePage from './components/WelcomePage';
import SelectionPage from './components/SelectionPage';
import GameBoardRoom from './components/GameBoardRoom';
import WalletTab from './components/WalletTab';
import HistoryTab from './components/HistoryTab';
import SettingsTab from './components/SettingsTab';

export default function App() {
  const tg = useTelegram();
  const wallet = useWallet(tg.initData);
  const selection = useSelection(tg);

  const startedWithUrlStake = useMemo(() => new URLSearchParams(window.location.search).has('stake'), []);
  const initialStake = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('stake');
    return raw ? parseInt(raw, 10) : 10;
  }, []);

  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [activeTab, setActiveTab] = useState<TabName>('play');
  const [phase, setPhase] = useState<PlayPhase>(startedWithUrlStake ? 'selection' : 'welcome');
  const [stake, setStake] = useState(initialStake);
  const [joinedNumbers, setJoinedNumbers] = useState<number[]>([]);
  const [joinedMatrix, setJoinedMatrix] = useState<TicketMatrix>([]);
  const myUserId = tg.initDataUnsafe?.user?.id?.toString() || 'me';

  useEffect(() => {
    document.body.className = themeBodyClass(theme);
  }, [theme]);

  useEffect(() => {
    wallet.refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleThemeChange = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
  };

  const handleSelectTab = (tab: TabName) => {
    if (phase === 'playing') {
      const message = '⚠️ Cannot switch screens while playing in a running game!';
      if (tg.showAlert) tg.showAlert(message);
      else alert(message);
      return;
    }
    setActiveTab(tab);
    tg.HapticFeedback?.impactOccurred('light');
    if (tab === 'wallet') wallet.refreshTransactions();
    else if (tab === 'history') wallet.refreshHistory();
    else if (tab === 'settings') wallet.refreshProfile();
  };

  const handleSelectStake = (selectedStake: number) => {
    setStake(selectedStake);
    setPhase('selection');
    tg.HapticFeedback?.impactOccurred('medium');
  };

  const handleJoin = () => {
    setJoinedNumbers(selection.selectedNumbers);
    setJoinedMatrix(selection.ticketHistory[0]?.ticketMatrix || buildTicketMatrix(selection.selectedNumbers));
    setPhase('playing');
  };

  const handleExitGame = () => {
    selection.clear();
    setPhase(startedWithUrlStake ? 'selection' : 'welcome');
  };

  return (
    <div className="app-container">
      <div id="tab-play" className={`tab-content${activeTab === 'play' ? '' : ' hidden'}`}>
        {phase === 'welcome' && <WelcomePage balance={wallet.balance} onSelectStake={handleSelectStake} />}
        {phase === 'selection' && (
          <SelectionPage
            stake={stake}
            balance={wallet.balance}
            selection={selection}
            onBack={() => setPhase('welcome')}
            onJoin={handleJoin}
          />
        )}
        {phase === 'playing' && (
          <GameBoardRoom stake={stake} myNumbers={joinedNumbers} ticketMatrix={joinedMatrix} onExit={handleExitGame} />
        )}
      </div>

      <div id="tab-wallet" className={`tab-content${activeTab === 'wallet' ? '' : ' hidden'}`}>
        {activeTab === 'wallet' && <WalletTab wallet={wallet} />}
      </div>

      <div id="tab-history" className={`tab-content${activeTab === 'history' ? '' : ' hidden'}`}>
        {activeTab === 'history' && <HistoryTab wallet={wallet} myUserId={myUserId} />}
      </div>

      <div id="tab-settings" className={`tab-content${activeTab === 'settings' ? '' : ' hidden'}`}>
        {activeTab === 'settings' && <SettingsTab wallet={wallet} theme={theme} onThemeChange={handleThemeChange} />}
      </div>

      <NavBar activeTab={activeTab} onSelect={handleSelectTab} />
    </div>
  );
}
