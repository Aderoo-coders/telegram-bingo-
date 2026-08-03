import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getBingoLetter } from '../lib/tickets';
import { wsUrl } from '../lib/apiBase';
import type { LobbyPlayer, ServerMessage } from '../types';
import type { TelegramWebApp } from '../telegram';

export interface GameOverInfo {
  isWinner: boolean;
  outcome: 'draw' | 'winner';
  title: string;
  winnerText: string;
  payoutText: string;
}

interface GameState {
  gameId: number | string;
  stake: number;
  playersCount: number;
  calledNumbers: number[];
  calledCount: number;
  currentBall: number | null;
  currentBallLetter: string;
  ballAnimKey: number;
  ballHistory: number[];
  myNumbers: number[];
  matchedNumbers: number[];
  matchCount: number;
  playingBalance: number;
  myUserId: string;
  lobbyVisible: boolean;
  lobbyStatusText: string;
  lobbyPlayers: LobbyPlayer[];
  countdownVisible: boolean;
  countdownSeconds: number;
  boardStatusText: string;
  gameOver: GameOverInfo | null;
}

type Action =
  | { type: 'JOIN_START'; stake: number; myNumbers: number[]; myUserId: string }
  | { type: 'SERVER_MESSAGE'; msg: ServerMessage; autoMark: boolean }
  | { type: 'RESET' };

function initialState(): GameState {
  return {
    gameId: '--',
    stake: 0,
    playersCount: 0,
    calledNumbers: [],
    calledCount: 0,
    currentBall: null,
    currentBallLetter: 'b',
    ballAnimKey: 0,
    ballHistory: [],
    myNumbers: [],
    matchedNumbers: [],
    matchCount: 0,
    playingBalance: 0,
    myUserId: 'me',
    lobbyVisible: true,
    lobbyStatusText: 'Waiting for players...',
    lobbyPlayers: [],
    countdownVisible: false,
    countdownSeconds: 30,
    boardStatusText: 'Waiting for players...',
    gameOver: null,
  };
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'RESET':
      return initialState();

    case 'JOIN_START':
      return {
        ...initialState(),
        stake: action.stake,
        myNumbers: action.myNumbers,
        myUserId: action.myUserId,
      };

    case 'SERVER_MESSAGE': {
      const { msg, autoMark } = action;
      switch (msg.status) {
        case 'joined':
          return {
            ...state,
            gameId: msg.gameId,
            playingBalance: parseFloat(String(msg.balance)),
            playersCount: 1,
            calledCount: 0,
            lobbyVisible: true,
            lobbyStatusText: 'Waiting for other players to join...',
            boardStatusText: 'Waiting for players...',
          };

        case 'lobby_update': {
          let lobbyStatusText = state.lobbyStatusText;
          let countdownVisible = state.countdownVisible;
          let boardStatusText = state.boardStatusText;
          let countdownSeconds = state.countdownSeconds;

          if (msg.isGameRunning) {
            lobbyStatusText = 'Current game in progress. Waiting for next round...';
            countdownVisible = false;
            boardStatusText = 'Waiting for next round...';
          } else if (msg.players.length < 2) {
            lobbyStatusText = 'Waiting for other players to join...';
            countdownVisible = false;
            boardStatusText = 'Waiting for players...';
          } else if (msg.isCountdownActive) {
            countdownVisible = true;
            countdownSeconds = msg.countdown;
            lobbyStatusText = 'Players ready! Game starting soon...';
            boardStatusText = 'Game starting soon...';
          } else {
            countdownVisible = false;
          }

          return {
            ...state,
            playersCount: msg.players.length,
            lobbyPlayers: msg.players,
            lobbyStatusText,
            countdownVisible,
            countdownSeconds,
            boardStatusText,
          };
        }

        case 'countdown':
          return {
            ...state,
            lobbyVisible: true,
            countdownVisible: true,
            countdownSeconds: msg.secondsLeft,
            lobbyStatusText: 'Game starting soon!',
            boardStatusText: `Starting in ${msg.secondsLeft}s...`,
          };

        case 'countdown_stopped':
          return {
            ...state,
            countdownVisible: false,
            lobbyStatusText: 'Waiting for other players to join...',
            boardStatusText: 'Waiting for players...',
          };

        case 'game_start':
          return {
            ...state,
            lobbyVisible: false,
            boardStatusText: 'Waiting for the next number...',
            calledNumbers: [],
            calledCount: 0,
            playersCount: msg.players ? msg.players.length : state.playersCount,
          };

        case 'draw': {
          const num = msg.number;
          const letter = getBingoLetter(num);
          const calledNumbers = msg.calledNumbers;
          const ballHistory = calledNumbers.slice().reverse().slice(0, 3);
          const matchedNumbers =
            autoMark && state.myNumbers.includes(num) && !state.matchedNumbers.includes(num)
              ? [...state.matchedNumbers, num]
              : state.matchedNumbers;
          const matchCount = state.myNumbers.filter((n) => calledNumbers.includes(n)).length;
          const letterLabel = letter.toUpperCase();

          return {
            ...state,
            currentBall: num,
            currentBallLetter: letter,
            ballAnimKey: state.ballAnimKey + 1,
            calledNumbers,
            calledCount: calledNumbers.length,
            ballHistory,
            matchedNumbers,
            matchCount,
            boardStatusText: state.myNumbers.includes(num)
              ? `${letterLabel}-${num} hit your card!`
              : `Called ${letterLabel}-${num}`,
          };
        }

        case 'finished': {
          const isWinner = !!msg.winners?.some((w) => w.userId === state.myUserId);
          if (msg.outcome === 'draw') {
            return {
              ...state,
              gameOver: {
                isWinner: false,
                outcome: 'draw',
                title: 'GAME OVER',
                winnerText: 'Outcome: Draw / No Winner',
                payoutText: 'Stakes refunded.',
              },
            };
          }
          const winnerNames = (msg.winners || []).map((w) => w.username).join(', ');
          if (isWinner) {
            return {
              ...state,
              gameOver: {
                isWinner: true,
                outcome: 'winner',
                title: '🏆 BINGO! 🏆',
                winnerText: 'You won!',
                payoutText: `+${parseFloat(String(msg.payout ?? 0)).toFixed(2)} Birr`,
              },
            };
          }
          return {
            ...state,
            gameOver: {
              isWinner: false,
              outcome: 'winner',
              title: 'GAME OVER',
              winnerText: `Winner: ${winnerNames}`,
              payoutText: 'Hard luck!',
            },
          };
        }

        default:
          return state;
      }
    }

    default:
      return state;
  }
}

export function useGameSocket(tg: TelegramWebApp, onExitGame: () => void) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [autoMark, setAutoMark] = useState(true);
  const autoMarkRef = useRef(autoMark);
  autoMarkRef.current = autoMark;
  const socketRef = useRef<WebSocket | null>(null);
  const [hintSecondsLeft, setHintSecondsLeft] = useState(3);

  const leave = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  const join = useCallback(
    (stake: number, numbers: number[], initData: string) => {
      const myUserId = tg.initDataUnsafe?.user?.id?.toString() || 'me';
      dispatch({ type: 'JOIN_START', stake, myNumbers: numbers, myUserId });

      const socket = new WebSocket(wsUrl('/ws'));
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ action: 'join', initData, stake, numbers }));
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.status === 'draw' && tg.HapticFeedback && autoMarkRef.current && numbers.includes(msg.number)) {
          tg.HapticFeedback.notificationOccurred('success');
        }
        if (msg.status === 'countdown' && tg.HapticFeedback && msg.secondsLeft <= 5) {
          tg.HapticFeedback.impactOccurred('light');
        }
        if (msg.status === 'game_start' && tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('success');
        }
        if (msg.status === 'finished' && tg.HapticFeedback) {
          const isWinner = !!msg.winners?.some((w) => w.userId === myUserId);
          tg.HapticFeedback.notificationOccurred(msg.outcome === 'draw' ? 'warning' : isWinner ? 'success' : 'error');
        }
        if (msg.status === 'error') {
          if (tg.showAlert) tg.showAlert(msg.message);
          else alert(msg.message);
          leave();
          onExitGame();
          return;
        }

        dispatch({ type: 'SERVER_MESSAGE', msg, autoMark: autoMarkRef.current });
      };

      socket.onerror = (err) => {
        console.error('WS error:', err);
      };
    },
    [tg, leave, onExitGame],
  );

  // Auto-return to menu 3s after a game-over overlay appears.
  useEffect(() => {
    if (!state.gameOver) {
      setHintSecondsLeft(3);
      return;
    }
    setHintSecondsLeft(3);
    const interval = setInterval(() => {
      setHintSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    const timeout = setTimeout(() => {
      leave();
      onExitGame();
    }, 3000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gameOver]);

  useEffect(() => () => leave(), [leave]);

  return { state, autoMark, setAutoMark, join, leave, hintSecondsLeft };
}
