import { formatBirr } from '../lib/tickets';
import type { useWallet } from '../hooks/useWallet';

interface Props {
  wallet: ReturnType<typeof useWallet>;
  onGotoDeposit: () => void;
  onGotoWithdraw: () => void;
}

const TX_LABELS: Record<string, string> = {
  cashback_bonus: 'Bonus',
  withdrawal_request: 'Withdrawal',
  withdrawal_refund: 'Refund',
};

function txDisplayType(type: string): string {
  return TX_LABELS[type] || type.replace('_', ' ');
}

function txStatus(description?: string): string {
  const desc = (description || '').toLowerCase();
  if (desc.includes('pending')) return 'Pending';
  if (desc.includes('rejected')) return 'Rejected';
  return 'Processed';
}

export default function WalletMainView({ wallet, onGotoDeposit, onGotoWithdraw }: Props) {
  const transactions = wallet.transactions;

  return (
    <div id="wallet-main-view" className="card">
      <h2 className="section-title">💼 Wallet Dashboard</h2>

      <div className="wallet-balance-card-new">
        <div className="balance-card-left">
          <div className="balance-line">
            <span className="card-label">Balance</span>
            <span className="card-value-large"><span id="wallet-tab-balance-new">{formatBirr(wallet.balance)}</span> Birr</span>
          </div>
          <div className="balance-divider" />
          <div className="balance-line">
            <span className="card-label">Bonus</span>
            <span className="card-value-small"><span id="wallet-tab-bonus-new">{formatBirr(wallet.bonus)}</span> Birr</span>
          </div>
        </div>
        <div className="balance-card-right">
          <div className="etb-coin"><span>ETB</span></div>
        </div>
      </div>

      <div className="wallet-action-row">
        <button id="wallet-goto-deposit-btn" className="btn btn-deposit" onClick={onGotoDeposit}>Deposit</button>
        <button id="wallet-goto-withdraw-btn" className="btn btn-withdraw" onClick={onGotoWithdraw}>Withdraw</button>
      </div>

      <div className="transactions-section">
        <h3>Transactions</h3>
        <div id="wallet-transactions-list" className="transactions-list">
          {transactions === null ? null : transactions.length === 0 ? (
            <div className="desc" style={{ textAlign: 'center', padding: '20px' }}>No transactions recorded yet.</div>
          ) : (
            transactions.map((tx, idx) => {
              const amtVal = parseFloat(String(tx.amount));
              const isPos = amtVal >= 0;
              const dateStr = new Date(tx.timestamp).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              });
              return (
                <div className="transaction-card-new" key={idx}>
                  <div className="tx-icon-circle">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" />
                    </svg>
                  </div>
                  <div className="tx-details-new">
                    <span className="tx-title-new">{txDisplayType(tx.type)}</span>
                    <span className="tx-meta-new">{dateStr} · {txStatus(tx.description)}</span>
                  </div>
                  <div className={`tx-amount-new ${isPos ? 'positive' : 'negative'}`}>
                    {isPos ? '+' : ''}{formatBirr(amtVal)} Birr
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
