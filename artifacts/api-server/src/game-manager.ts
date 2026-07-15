import { WebSocket } from 'ws';
import { 
  pool, 
  getBalance, 
  updateBalance, 
  addTransaction, 
  createGame, 
  getActiveLobby, 
  joinGame, 
  updateGameStatus 
} from './database.js';
import { config } from './config.js';
import crypto from 'crypto';

export function verifyTelegramWebapp(initData: string, botToken: string): any {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    const keys = Array.from(params.keys()).filter(k => k !== 'hash').sort();
    const dataCheckString = keys.map(k => `${k}=${params.get(k)}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash === hash) {
      const userStr = params.get('user');
      if (userStr) {
        return JSON.parse(userStr);
      }
    }
  } catch (err) {
    console.error('Error verifying telegram initData:', err);
  }
  return null;
}

interface Player {
  userId: string;
  username: string;
  numbers: number[];
  ws: WebSocket;
}

interface GameSession {
  gameId: number;
  stake: number;
  status: 'waiting' | 'playing' | 'finished';
  players: Player[];
  countdownTimer: NodeJS.Timeout | null;
  countdownSeconds: number;
  calledNumbers: number[];
  drawInterval: NodeJS.Timeout | null;
  availableNumbers: number[];
}

const sessions: Map<number, GameSession> = new Map();

function broadcast(session: GameSession, message: any) {
  const payload = JSON.stringify(message);
  for (const player of session.players) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(payload);
    }
  }
}

function sendToPlayer(player: Player, message: any) {
  if (player.ws && player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(message));
  }
}

function shuffle(array: number[]) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function getOrCreateLobby(stake: number): Promise<GameSession> {
  let session = sessions.get(stake);
  if (!session || session.status === 'finished') {
    let dbGame = await getActiveLobby(stake);
    if (!dbGame) {
      dbGame = await createGame(stake);
    }
    session = {
      gameId: dbGame.id,
      stake: stake,
      status: 'waiting',
      players: [],
      countdownTimer: null,
      countdownSeconds: 30,
      calledNumbers: [],
      drawInterval: null,
      availableNumbers: Array.from({ length: 130 }, (_, i) => i + 1)
    };
    sessions.set(stake, session);
  }
  return session;
}

function startCountdown(session: GameSession) {
  session.countdownSeconds = 30;
  session.countdownTimer = setInterval(() => {
    session.countdownSeconds--;
    
    broadcast(session, {
      status: 'countdown',
      secondsLeft: session.countdownSeconds
    });

    if (session.countdownSeconds <= 0) {
      if (session.countdownTimer) {
        clearInterval(session.countdownTimer);
        session.countdownTimer = null;
      }
      startGame(session).catch(err => console.error('Error starting game:', err));
    }
  }, 1000);
}

async function startGame(session: GameSession) {
  session.status = 'playing';
  await updateGameStatus(session.gameId, 'playing', null, []);

  broadcast(session, {
    status: 'game_start',
    players: session.players.map(p => ({ userId: p.userId, username: p.username, numbers: p.numbers }))
  });

  session.availableNumbers = shuffle(Array.from({ length: 130 }, (_, i) => i + 1));
  session.calledNumbers = [];

  session.drawInterval = setInterval(() => {
    if (session.availableNumbers.length === 0) {
      endGameDraw(session);
      return;
    }

    const drawn = session.availableNumbers.pop()!;
    session.calledNumbers.push(drawn);

    const winners: Player[] = [];
    for (const player of session.players) {
      const matchCount = player.numbers.filter(n => session.calledNumbers.includes(n)).length;
      if (matchCount >= 12) {
        winners.push(player);
      }
    }

    if (winners.length > 0) {
      if (session.drawInterval) {
        clearInterval(session.drawInterval);
        session.drawInterval = null;
      }
      resolveWinner(session, winners).catch(err => console.error('Winner payout error:', err));
    } else {
      broadcast(session, {
        status: 'draw',
        number: drawn,
        calledNumbers: session.calledNumbers
      });
    }
  }, 2000);
}

function endGameDraw(session: GameSession) {
  if (session.drawInterval) {
    clearInterval(session.drawInterval);
    session.drawInterval = null;
  }
  session.status = 'finished';
  updateGameStatus(session.gameId, 'finished', null, session.calledNumbers).catch(err => console.error(err));
  
  for (const player of session.players) {
    updateBalance(player.userId, session.stake).catch(err => console.error(err));
    addTransaction(player.userId, 'refund', session.stake, `No winner in game #${session.gameId}`).catch(err => console.error(err));
  }

  broadcast(session, {
    status: 'finished',
    outcome: 'draw',
    message: 'Game ended in a draw. Stakes have been refunded.'
  });

  sessions.delete(session.stake);
}

async function resolveWinner(session: GameSession, winners: Player[]) {
  session.status = 'finished';
  
  const totalStake = session.players.length * session.stake;
  const adminCommission = totalStake * 0.20;
  const prizePool = totalStake - adminCommission;
  const payoutPerWinner = prizePool / winners.length;

  const winnerIds = winners.map(w => w.userId);
  const primaryWinnerId = winnerIds[0];

  await updateGameStatus(session.gameId, 'finished', primaryWinnerId, session.calledNumbers);

  for (const winner of winners) {
    await updateBalance(winner.userId, payoutPerWinner);
    await addTransaction(winner.userId, 'win_payout', payoutPerWinner, `Won game #${session.gameId}`);
  }

  if (config.ADMIN_ID) {
    await updateBalance(config.ADMIN_ID, adminCommission);
    await addTransaction(config.ADMIN_ID, 'admin_commission', adminCommission, `20% admin fee from game #${session.gameId}`);
  }

  broadcast(session, {
    status: 'finished',
    outcome: 'winner',
    winners: winners.map(w => ({ userId: w.userId, username: w.username })),
    calledNumbers: session.calledNumbers,
    payout: payoutPerWinner,
    totalStake,
    adminCommission,
    prizePool
  });

  sessions.delete(session.stake);
}

export function handleConnection(ws: WebSocket) {
  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);
      if (data.action === 'join') {
        const { initData, stake, numbers } = data;
        
        const telegramUser = verifyTelegramWebapp(initData, config.BOT_TOKEN);
        if (!telegramUser) {
          ws.send(JSON.stringify({ status: 'error', message: 'Authentication failed. Please launch the app from the Telegram Bot.' }));
          ws.close();
          return;
        }

        const userId = telegramUser.id.toString();
        const username = telegramUser.username || telegramUser.first_name || 'Player';
        const parsedStake = parseInt(stake, 10);

        if (!Array.isArray(numbers) || numbers.length !== 15) {
          ws.send(JSON.stringify({ status: 'error', message: 'You must select exactly 15 numbers.' }));
          return;
        }
        const uniqueNumbers = [...new Set(numbers)];
        if (uniqueNumbers.length !== 15 || uniqueNumbers.some(n => n < 1 || n > 130)) {
          ws.send(JSON.stringify({ status: 'error', message: 'Invalid selection. Numbers must be between 1 and 130.' }));
          return;
        }

        const session = await getOrCreateLobby(parsedStake);
        if (session.status !== 'waiting') {
          ws.send(JSON.stringify({ status: 'error', message: 'A game is already in progress for this stake. Please wait.' }));
          return;
        }

        if (session.players.some(p => p.userId === userId)) {
          ws.send(JSON.stringify({ status: 'error', message: 'You have already joined this lobby.' }));
          return;
        }

        const balance = await getBalance(userId);
        if (balance < parsedStake) {
          ws.send(JSON.stringify({ status: 'error', message: 'Insufficient balance to join.' }));
          return;
        }

        // Deduct stake and add player
        await updateBalance(userId, -parsedStake);
        await addTransaction(userId, 'stake_deduct', -parsedStake, `Staked on game #${session.gameId}`);
        await joinGame(session.gameId, userId, uniqueNumbers);

        const newPlayer: Player = {
          userId,
          username,
          numbers: uniqueNumbers,
          ws
        };
        session.players.push(newPlayer);

        sendToPlayer(newPlayer, { 
          status: 'joined', 
          gameId: session.gameId, 
          stake: parsedStake,
          numbers: uniqueNumbers,
          balance: balance - parsedStake
        });

        broadcast(session, {
          status: 'lobby_update',
          players: session.players.map(p => ({ userId: p.userId, username: p.username })),
          countdown: session.countdownSeconds,
          isCountdownActive: session.countdownTimer !== null
        });

        if (session.players.length >= 2 && !session.countdownTimer) {
          startCountdown(session);
        }

        ws.on('close', () => {
          if (session.status === 'waiting') {
            session.players = session.players.filter(p => p.userId !== userId);
            
            updateBalance(userId, parsedStake).catch(err => console.error(err));
            addTransaction(userId, 'refund', parsedStake, `Refund for game #${session.gameId}`).catch(err => console.error(err));
            
            broadcast(session, {
              status: 'lobby_update',
              players: session.players.map(p => ({ userId: p.userId, username: p.username })),
              countdown: session.countdownSeconds,
              isCountdownActive: session.countdownTimer !== null
            });

            if (session.players.length < 2 && session.countdownTimer) {
              clearInterval(session.countdownTimer);
              session.countdownTimer = null;
              session.countdownSeconds = 30;
              broadcast(session, {
                status: 'countdown_stopped'
              });
            }
          } else if (session.status === 'playing') {
            const idx = session.players.findIndex(p => p.userId === userId);
            if (idx !== -1) {
              session.players[idx].ws = null as any;
            }
          }
        });
      }
    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });
}
