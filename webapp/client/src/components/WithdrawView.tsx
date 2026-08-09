import { useState } from 'react';
import { useTelegram } from '../hooks/useTelegram';
import { formatBirr } from '../lib/tickets';
import type { useWallet } from '../hooks/useWallet';

const PRESETS = [50, 100, 200, 500];

interface Props {
  wallet: ReturnType<typeof useWallet>;
  onBack: () => void;
}

export default function WithdrawView({ wallet, onBack }: Props) {
  const tg = useTelegram();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handlePreset = (value: number) => {
    setAmount(String(value));
    tg.HapticFeedback?.impactOccurred('light');
  };

  const handleSubmit = async () => {
    setMessage(null);
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount < 50) {
      setMessage({ text: '❌ Minimum withdrawal amount is 50 ETB.', type: 'error' });
      return;
    }
    if (parsedAmount > wallet.balance) {
      setMessage({ text: '❌ Insufficient balance in your wallet.', type: 'error' });
      return;
    }

    const { ok, data } = await wallet.submitWithdrawal(parsedAmount);
    if (ok && data.success) {
      setMessage({ text: `✅ Request submitted! Ref: #${data.refId}. Balance deducted.`, type: 'success' });
      setAmount('');
      tg.HapticFeedback?.notificationOccurred('success');
    } else {
      setMessage({ text: `❌ ${data.error || 'Request failed.'}`, type: 'error' });
    }
  };

  return (
    <div id="wallet-withdraw-view" className="card">
      <div className="sub-view-header">
        <button type="button" id="withdraw-back-btn" className="btn-sub-back" onClick={onBack}>←</button>
        <span className="sub-view-title">Withdraw funds</span>
      </div>

      <div className="deposit-balance-card">
        <div className="deposit-balance-label">Current balance</div>
        <div id="withdraw-current-balance" className="deposit-balance-value">{formatBirr(wallet.balance)} ETB</div>
      </div>

      <div className="deposit-form modern-deposit-form modern-withdraw-form">
        <div className="deposit-amount-control">
          <label htmlFor="withdraw-amount-input">Amount (ETB)</label>
          <input
            type="number"
            id="withdraw-amount-input"
            placeholder="Enter amount"
            min={50}
            step={10}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="preset-buttons deposit-quick-amounts withdraw-quick-amounts">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`preset-btn withdraw-preset-btn${amount === String(preset) ? ' active' : ''}`}
              onClick={() => handlePreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <p className="withdraw-info-text">Withdrawals are processed within 24 hours by an admin.</p>

        <button id="submit-withdrawal-btn" className="btn btn-primary btn-block deposit-submit-btn" onClick={handleSubmit}>
          Request withdrawal
        </button>
      </div>

      {message && (
        <div id="withdraw-message" className={`message-box ${message.type}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
