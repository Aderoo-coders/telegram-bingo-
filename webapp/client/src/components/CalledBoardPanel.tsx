import { BINGO_RANGES } from '../lib/tickets';

interface Props {
  calledNumbers: number[];
  currentBall: number | null;
}

export default function CalledBoardPanel({ calledNumbers, currentBall }: Props) {
  const rows = Array.from({ length: 15 }, (_, row) => row);

  return (
    <div className="called-board-panel">
      <div className="bingo-header-circles">
        {BINGO_RANGES.map(({ letter }) => (
          <div key={letter} className={`bingo-circle ${letter.toLowerCase()}`}>{letter}</div>
        ))}
      </div>
      <div id="main-grid" className="called-board-grid" aria-label="Called Board 1-75">
        {rows.map((row) =>
          BINGO_RANGES.map(({ letter, start }) => {
            const num = start + row;
            const isCalled = calledNumbers.includes(num);
            const classNames = ['board-cell', `letter-${letter.toLowerCase()}`];
            if (isCalled) classNames.push('called');
            if (num === currentBall) classNames.push('latest');
            return (
              <button key={num} type="button" id={`board-num-${num}`} className={classNames.join(' ')} disabled>
                {num}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
