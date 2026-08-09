import { useState } from 'react';
import { useTelegram } from '../hooks/useTelegram';
import { formatBirr } from '../lib/tickets';
import type { useWallet } from '../hooks/useWallet';

const PRESETS = [50, 100, 200, 500];
const PLATFORMS = [
  { id: 'telebirr', label: 'Telebirr' },
  { id: 'cbe', label: 'CBE Birr' },
  { id: 'amole', label: 'Amole' },
  { id: 'bank', label: 'Bank Transfer' },
];

interface Props {
  wallet: ReturnType<typeof useWallet>;
  onBack: () => void;
}

export default function DepositView({ wallet, onBack }: Props) {
  const tg = useTelegram();
  const [amount, setAmount] = useState('');
  const [platform, setPlatform] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handlePreset = (value: number) => {
    setAmount(String(value));
  };

  const handlePlatform = (id: string) => {
    setPlatform(id);
    setMessage(null);
    tg.HapticFeedback?.impactOccurred('medium');
  };

  const handleSubmit = async () => {
    setMessage(null);
    const parsedAmount = parseFloat(amount);

    if (!platform) {
      setMessage({ text: '❌ Select a payment platform first.', type: 'error' });
      return;
    }
    if (isNaN(parsedAmount) || parsedAmount < 50) {
      setMessage({ text: '❌ Minimum deposit amount is 50 ETB.', type: 'error' });
      return;
    }

    const refId = `AUTO-${platform}-${Date.now()}`;
    const { ok, data } = await wallet.submitDeposit(parsedAmount, platform, refId);

    if (ok && data.success) {
      setMessage({ text: `✅ Request Submitted! Ref ID: #${data.refId}. Balance will update once verified by Admin.`, type: 'success' });
      setAmount('');
      setPlatform(null);
      tg.HapticFeedback?.notificationOccurred('success');
    } else {
      setMessage({ text: `❌ ${data.error || 'Submission failed.'}`, type: 'error' });
    }
  };

  return (
    <div id="wallet-deposit-view" className="card">
      <div className="sub-view-header">
        <button type="button" id="deposit-back-btn" className="btn-sub-back" onClick={onBack}>←</button>
        <span className="sub-view-title">Deposit funds</span>
      </div>

      <div className="deposit-balance-card">
        <div className="deposit-balance-label">Current balance</div>
        <div id="deposit-current-balance" className="deposit-balance-value">{formatBirr(wallet.balance)} ETB</div>
      </div>

      <div className="deposit-form modern-deposit-form">
        <div className="deposit-amount-control">
          <label htmlFor="deposit-amount-input">Amount (ETB)</label>
          <input
            type="number"
            id="deposit-amount-input"
            placeholder="Enter amount"
            min={50}
            step={10}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="preset-buttons deposit-quick-amounts">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`preset-btn${amount === String(preset) ? ' active' : ''}`}
              onClick={() => handlePreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="deposit-pay-via-title">Pay via</div>
        <div className="deposit-platform-grid">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`payment-item deposit-pay-option${platform === p.id ? ' selected' : ''}`}
              onClick={() => handlePlatform(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button id="submit-deposit-btn" className="btn btn-primary btn-block deposit-submit-btn" onClick={handleSubmit}>
          Deposit
        </button>
      </div>

      {message && (
        <div id="deposit-message" className={`message-box ${message.type}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
