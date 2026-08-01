import type { TicketEntry, TicketMatrix } from '../types';

export const MAX_SELECT = 10;
export const TOTAL_CARDS = 200;
export const FREE_SPACE = 'FREE' as const;

export const BINGO_RANGES = [
  { letter: 'B', start: 1, end: 15 },
  { letter: 'I', start: 16, end: 30 },
  { letter: 'N', start: 31, end: 45 },
  { letter: 'G', start: 46, end: 60 },
  { letter: 'O', start: 61, end: 75 },
] as const;

export function getBingoLetter(num: number): string {
  for (const range of BINGO_RANGES) {
    if (num >= range.start && num <= range.end) {
      return range.letter.toLowerCase();
    }
  }
  return 'b';
}

function ticketMatrixKey(matrix: TicketMatrix): string {
  return matrix.flat().map((value) => (value === FREE_SPACE ? 'F' : value)).join(',');
}

function createFixedMiniTicket(seed: number): TicketMatrix {
  const matrix: TicketMatrix = Array.from({ length: 5 }, () => Array(5).fill(null) as TicketMatrix[number]);
  let randomState = (seed * 1664525 + 1013904223) >>> 0;

  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };

  BINGO_RANGES.forEach(({ start, end }, colIndex) => {
    const pool: number[] = [];
    for (let value = start; value <= end; value++) {
      pool.push(value);
    }

    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (let row = 0; row < 5; row++) {
      matrix[row][colIndex] = shuffled[row];
    }
  });

  matrix[2][2] = FREE_SPACE;
  return matrix;
}

/** One unique mini-ticket card for every available card (1-200). */
function generateUniqueMiniTickets(): Record<number, TicketMatrix> {
  const ticketsByNumber: Record<number, TicketMatrix> = Object.create(null);
  const usedKeys = new Set<string>();
  let seed = 1;

  for (let num = 1; num <= TOTAL_CARDS; num++) {
    let matrix: TicketMatrix;
    let key: string;
    do {
      matrix = createFixedMiniTicket(seed++);
      key = ticketMatrixKey(matrix);
    } while (usedKeys.has(key));

    usedKeys.add(key);
    ticketsByNumber[num] = matrix;
  }

  return ticketsByNumber;
}

const PRE_GENERATED_TICKETS = generateUniqueMiniTickets();

export function getMiniTicketForNumber(num: number): TicketMatrix {
  return PRE_GENERATED_TICKETS[num];
}

function getNumbersFromTicketMatrix(matrix: TicketMatrix): number[] {
  return matrix.flat().filter((value): value is number => typeof value === 'number');
}

/** Bingo numbers (1-75) from all selected cards — used when joining. */
export function getPlayNumbersFromSelectedCards(ticketHistory: TicketEntry[]): number[] {
  const nums = new Set<number>();
  ticketHistory.forEach((entry) => {
    getNumbersFromTicketMatrix(entry.ticketMatrix).forEach((n) => nums.add(n));
  });
  return [...nums].sort((a, b) => a - b);
}

export function buildTicketMatrix(selectedNumbersList: number[]): TicketMatrix {
  const sorted = [...selectedNumbersList].sort((a, b) => a - b);
  const matrix: TicketMatrix = Array.from({ length: 5 }, () => Array(5).fill(null) as TicketMatrix[number]);

  BINGO_RANGES.forEach(({ start, end }, colIndex) => {
    const columnNumbers = sorted.filter((num) => num >= start && num <= end).slice(0, 3);
    columnNumbers.forEach((num, rowIndex) => {
      matrix[rowIndex][colIndex] = num;
    });
  });

  matrix[2][2] = FREE_SPACE;
  return matrix;
}

export const formatBirr = (val: number): string => (Number.isInteger(val) ? val.toString() : val.toFixed(2));
