import { BINGO_RANGES, FREE_SPACE } from '../lib/tickets';
import type { TicketEntry } from '../types';

interface Props {
  ticketHistory: TicketEntry[];
}

export default function MiniTicketStack({ ticketHistory }: Props) {
  return (
    <div className="mini-ticket-preview-card">
      <div className="mini-ticket-stack">
        {ticketHistory.map((entry) => (
          <div className="mini-ticket-card" key={entry.number}>
            <div className="mini-ticket-header">
              {BINGO_RANGES.map(({ letter }) => (
                <span key={letter} className={`mini-ticket-header-cell ${letter.toLowerCase()}`}>
                  {letter}
                </span>
              ))}
            </div>
            <div className="mini-ticket-grid">
              {entry.ticketMatrix.flat().map((value, idx) => (
                <div key={idx} className={value === FREE_SPACE ? 'mini-ticket-cell free-space' : 'mini-ticket-cell'}>
                  {value === FREE_SPACE ? 'FREE' : value ?? ''}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
