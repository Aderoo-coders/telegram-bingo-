import { useState } from 'react';
import type { useWallet } from '../hooks/useWallet';
import WalletMainView from './WalletMainView';
import DepositView from './DepositView';
import WithdrawView from './WithdrawView';

type SubView = 'main' | 'deposit' | 'withdraw';

interface Props {
  wallet: ReturnType<typeof useWallet>;
}

export default function WalletTab({ wallet }: Props) {
  const [subView, setSubView] = useState<SubView>('main');

  if (subView === 'deposit') {
    return <DepositView wallet={wallet} onBack={() => setSubView('main')} />;
  }
  if (subView === 'withdraw') {
    return <WithdrawView wallet={wallet} onBack={() => setSubView('main')} />;
  }
  return (
    <WalletMainView wallet={wallet} onGotoDeposit={() => setSubView('deposit')} onGotoWithdraw={() => setSubView('withdraw')} />
  );
}
