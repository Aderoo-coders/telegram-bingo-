import { WebSocket } from 'ws';
import { 
  pool, 
  getBalance, 
  getMaintenanceMode,
  createGame,
  getActiveLobby,
  joinGameAtomic,
  updateGameStatus,
  payoutGameAtomic,
  refundGameAtomic
} from './database.js';
import { config } from './config.js';
import crypto from 'crypto';

export type GameSessionState = 
  | 'CREATED'
  | 'WAITING_FOR_PLAYERS'
  | 'COUNTDOWN'
  | 'LOCKED'
  | 'DRAWING'
  | 'WINNER_PENDING'
  | 'PAYOUT'
  | 'FINISHED'
  | 'ARCHIVED';

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
  ws: WebSocket | null;
}

interface GameSession {
  gameId: number;
  stake: number;
  status: GameSessionState;
  players: Player[];
  countdownTimer: NodeJS.Timeout | null;
  countdownSeconds: number;
  calledNumbers: number[];
  drawInterval: NodeJS.Timeout | null;
  availableNumbers: number[];
  rngSeed: string;
  createdAt: Date;
}

// Map keyed by unique gameId instead of stake
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

function isGameRunningForStake(stake: number): boolean {
  for (const s of sessions.values()) {
    if (s.stake === stake && ['LOCKED', 'DRAWING', 'WINNER_PENDING', 'PAYOUT'].includes(s.status)) {
      return true;
    }
  }
  return false;
}

function broadcastLobbyUpdate(session: GameSession) {
  const isRunning = isGameRunningForStake(session.stake);
  broadcast(session, {
    status: 'lobby_update',
    event: 'LOBBY_UPDATE',
    players: session.players.map(p => ({ userId: p.userId })),
    countdown: session.countdownSeconds,
    isCountdownActive: session.countdownTimer !== null,
    isGameRunning: isRunning
  });
}

function checkAndStartNextRound(stake: number) {
  for (const s of sessions.values()) {
    if (s.stake === stake && (s.status === 'WAITING_FOR_PLAYERS' || s.status === 'CREATED')) {
      broadcastLobbyUpdate(s);
      if (s.players.length >= 2 && s.status === 'WAITING_FOR_PLAYERS' && s.countdownTimer === null && !isGameRunningForStake(stake)) {
        startCountdown(s);
      }
    }
  }
}

/**
 * Transition session state safely and sync with PostgreSQL DB.
 */
async function transitionSessionState(session: GameSession, nextStatus: GameSessionState) {
  console.log(`🎮 [Game #${session.gameId}] State Transition: ${session.status} ➔ ${nextStatus}`);
  session.status = nextStatus;

  try {
    await updateGameStatus(session.gameId, nextStatus, null, session.calledNumbers);
  } catch (err) {
    console.error(`Error persisting status ${nextStatus} for game #${session.gameId}:`, err);
  }

  broadcast(session, {
    event: 'STATE_CHANGE',
    gameId: session.gameId,
    status: session.status
  });
}

/**
 * Finds an active joinable lobby or creates a new one (CREATED ➔ WAITING_FOR_PLAYERS).
 */
export async function getOrCreateLobby(stake: number): Promise<GameSession> {
  // Check active in-memory sessions for joinable room at this stake
  for (const session of sessions.values()) {
    if (
      session.stake === stake && 
      (session.status === 'WAITING_FOR_PLAYERS' || session.status === 'COUNTDOWN' || session.status === 'CREATED')
    ) {
      return session;
    }
  }

  // Check DB for active lobby
  let dbGame = await getActiveLobby(stake);
  if (!dbGame) {
    dbGame = await createGame(stake, 'CREATED');
  }

  const session: GameSession = {
    gameId: dbGame.id,
    stake: stake,
    status: 'CREATED',
    players: [],
    countdownTimer: null,
    countdownSeconds: 30,
    calledNumbers: [],
    drawInterval: null,
    availableNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
    rngSeed: crypto.randomBytes(16).toString('hex'),
    createdAt: new Date()
  };

  sessions.set(session.gameId, session);

  // Transition CREATED ➔ WAITING_FOR_PLAYERS
  await transitionSessionState(session, 'WAITING_FOR_PLAYERS');

  return session;
}

function startCountdown(session: GameSession) {
  if (session.status !== 'WAITING_FOR_PLAYERS') return;

  transitionSessionState(session, 'COUNTDOWN');
  session.countdownSeconds = 30;

  session.countdownTimer = setInterval(() => {
    session.countdownSeconds--;
    
    broadcast(session, {
      status: 'countdown',
      event: 'COUNTDOWN',
      secondsLeft: session.countdownSeconds
    });

    if (session.countdownSeconds <= 0) {
      if (session.countdownTimer) {
        clearInterval(session.countdownTimer);
        session.countdownTimer = null;
      }
      lockLobby(session);
    }
  }, 1000);
}

/**
 * COUNTDOWN ➔ LOCKED state
 */
async function lockLobby(session: GameSession) {
  await transitionSessionState(session, 'LOCKED');

  broadcast(session, {
    event: 'LOCKED',
    message: 'Lobby locked. Preparing game draw...'
  });

  // Short delay before starting draw
  setTimeout(() => {
    startGame(session).catch(err => console.error('Error starting game draw:', err));
  }, 1500);
}

/**
 *  LOCKED ➔ DRAWING state
 */
async function startGame(session: GameSession) {
  await transitionSessionState(session, 'DRAWING');

  broadcast(session, {
    status: 'game_start',
    event: 'DRAW_START',
    players: session.players.map(p => ({ userId: p.userId, username: p.username, numbers: p.numbers }))
  });

  session.availableNumbers = shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
  session.calledNumbers = [];

  session.drawInterval = setInterval(() => {
    if (session.availableNumbers.length === 0) {
      handleDrawRefund(session);
      return;
    }

    const drawn = session.availableNumbers.pop()!;
    session.calledNumbers.push(drawn);

    const winners: Player[] = [];
    for (const player of session.players) {
      const matchCount = player.numbers.filter(n => session.calledNumbers.includes(n)).length;
      const targetToWin = Math.min(12, player.numbers.length);
      if (matchCount >= targetToWin) {
        winners.push(player);
      }
    }

    if (winners.length > 0) {
      if (session.drawInterval) {
        clearInterval(session.drawInterval);
        session.drawInterval = null;
      }
      processWinnerVerificationPipeline(session, winners);
    } else {
      broadcast(session, {
        status: 'draw',
        event: 'NUMBER_DRAWN',
        number: drawn,
        calledNumbers: session.calledNumbers
      });
    }
  }, 2000);
}

/**
 * Backend-Only Winner Verification Pipeline:
 * 
 * 📥 [1. Winning Claim] ➔ 🔄 [2. Replay Called Numbers] ➔ 🔍 [3. Validate Ticket] ➔ ✅ [4. Approve] ➔ 💰 [5. Payout]
 */
export async function processWinnerVerificationPipeline(session: GameSession, claimedWinners: Player[]) {
  // Step 1: Winning Claim Received
  console.log(`📥 [Game #${session.gameId}] [1. Winning Claim] Received claim candidate(s): ${claimedWinners.map(p => p.username).join(', ')}`);
  await transitionSessionState(session, 'WINNER_PENDING');

  // Step 2: Replay Called Numbers
  // Reconstruct exact draw sequence from session history to eliminate frontend spoofing
  const drawnNumbersSequence = [...session.calledNumbers];
  const calledSet = new Set(drawnNumbersSequence);
  console.log(`🔄 [Game #${session.gameId}] [2. Replay Called Numbers] Replaying ${drawnNumbersSequence.length} drawn numbers sequence.`);

  // Step 3: Validate Ticket
  // Cross-reference candidate's server-stored selected numbers against replayed called numbers
  const verifiedWinners: Player[] = [];
  for (const candidate of claimedWinners) {
    const validMatches = candidate.numbers.filter(num => calledSet.has(num));
    const requiredTarget = Math.min(12, candidate.numbers.length);

    console.log(`🔍 [Game #${session.gameId}] [3. Validate Ticket] User: ${candidate.username} (${candidate.userId}) | Ticket: [${candidate.numbers.join(', ')}] | Matches: ${validMatches.length}/${requiredTarget}`);

    if (validMatches.length >= requiredTarget) {
      verifiedWinners.push(candidate);
    } else {
      console.warn(`❌ [Game #${session.gameId}] [3. Validate Ticket FAILED] User ${candidate.username} claim rejected (Insufficient valid matches).`);
    }
  }

  if (verifiedWinners.length === 0) {
    console.warn(`⚠️ [Game #${session.gameId}] All winner claims failed backend verification. Resuming drawing...`);
    await transitionSessionState(session, 'DRAWING');
    return;
  }

  // Step 4: Approve
  console.log(`✅ [Game #${session.gameId}] [4. Approve] Winner claim(s) APPROVED for: ${verifiedWinners.map(w => w.username).join(', ')}`);

  // Step 5: Payout
  await transitionSessionState(session, 'PAYOUT');
  console.log(`💰 [Game #${session.gameId}] [5. Payout] Executing atomic database payout...`);

  const totalStake = session.players.length * session.stake;
  const adminCommission = totalStake * 0.20;
  const prizePool = totalStake - adminCommission;
  const payoutPerWinner = prizePool / verifiedWinners.length;
  const primaryWinnerId = verifiedWinners[0].userId;

  try {
    await payoutGameAtomic(
      session.gameId,
      verifiedWinners.map(w => ({ userId: w.userId, payout: payoutPerWinner })),
      adminCommission,
      session.calledNumbers,
      primaryWinnerId
    );

    await transitionSessionState(session, 'FINISHED');

    broadcast(session, {
      status: 'finished',
      event: 'GAME_FINISHED',
      outcome: 'winner',
      winners: verifiedWinners.map(w => ({ userId: w.userId, username: w.username })),
      calledNumbers: session.calledNumbers,
      payout: payoutPerWinner,
      totalStake,
      adminCommission,
      prizePool
    });
  } catch (err) {
    console.error(`❌ [Game #${session.gameId}] Error processing atomic payout:`, err);
  } finally {
    checkAndStartNextRound(session.stake);
    // Schedule archiving after 60 seconds
    setTimeout(() => archiveSession(session), 60000);
  }
}

/**
 * DRAWING ➔ PAYOUT (Refund) ➔ FINISHED
 */
async function handleDrawRefund(session: GameSession) {
  if (session.drawInterval) {
    clearInterval(session.drawInterval);
    session.drawInterval = null;
  }

  await transitionSessionState(session, 'PAYOUT');

  try {
    await refundGameAtomic(
      session.gameId,
      session.players.map(p => ({ userId: p.userId, stake: session.stake })),
      session.calledNumbers
    );

    await transitionSessionState(session, 'FINISHED');

    broadcast(session, {
      status: 'finished',
      event: 'GAME_FINISHED',
      outcome: 'draw',
      message: 'Game ended in a draw. All player stakes have been refunded.'
    });
  } catch (err) {
    console.error(`Error refunding draw for game #${session.gameId}:`, err);
  } finally {
    checkAndStartNextRound(session.stake);
    setTimeout(() => archiveSession(session), 60000);
  }
}

/**
 * FINISHED ➔ ARCHIVED
 */
async function archiveSession(session: GameSession) {
  await transitionSessionState(session, 'ARCHIVED');
  sessions.delete(session.gameId);
}

/**
 * WebSocket Connection & Event Handler with Reconnection Support
 */
export function handleConnection(ws: WebSocket) {
  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);
      if (data.action === 'join') {
        const { initData, stake, numbers } = data;
        
        const telegramUser = verifyTelegramWebapp(initData, config.BOT_TOKEN);
        if (!telegramUser) {
          ws.send(JSON.stringify({ status: 'error', message: 'Authentication failed. Please launch app via Telegram.' }));
          ws.close();
          return;
        }

        const userId = telegramUser.id.toString();
        const username = telegramUser.username || telegramUser.first_name || 'Player';
        const parsedStake = parseInt(stake, 10);

        // Reconnection Check: check if user is already in an active session
        for (const session of sessions.values()) {
          const existingPlayer = session.players.find(p => p.userId === userId);
          if (existingPlayer && session.status !== 'FINISHED' && session.status !== 'ARCHIVED') {
            existingPlayer.ws = ws;
            sendToPlayer(existingPlayer, {
              status: 'reconnected',
              event: 'RECONNECT_SUCCESS',
              gameId: session.gameId,
              stake: session.stake,
              state: session.status,
              calledNumbers: session.calledNumbers,
              countdown: session.countdownSeconds,
              numbers: existingPlayer.numbers,
              players: session.players.map(p => ({ userId: p.userId }))
            });

            // Bind disconnect for reconnected player
            ws.on('close', () => {
              existingPlayer.ws = null;
            });
            return;
          }
        }

        // Input validation — bingo numbers from selected cartela tickets (1-75)
        if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > 75) {
          ws.send(JSON.stringify({ status: 'error', message: 'You must select at least one valid bingo card.' }));
          return;
        }
        const uniqueNumbers = [...new Set(numbers)];
        if (uniqueNumbers.length !== numbers.length || uniqueNumbers.some(n => n < 1 || n > 75)) {
          ws.send(JSON.stringify({ status: 'error', message: 'Invalid card numbers. Bingo values must be between 1 and 75 with no duplicates.' }));
          return;
        }

        // Maintenance check
        const isMaintenance = await getMaintenanceMode();
        const isAdmin = config.isAdmin(userId);
        if (isMaintenance && !isAdmin) {
          ws.send(JSON.stringify({ status: 'error', message: 'The game is under maintenance. Play is temporarily disabled.' }));
          return;
        }

        const session = await getOrCreateLobby(parsedStake);
        if (session.status !== 'WAITING_FOR_PLAYERS' && session.status !== 'COUNTDOWN') {
          ws.send(JSON.stringify({ status: 'error', message: 'Lobby is locked or game is already in progress. Please try again.' }));
          return;
        }

        if (session.players.some(p => p.userId === userId)) {
          ws.send(JSON.stringify({ status: 'error', message: 'You have already joined this lobby.' }));
          return;
        }

        // Atomic Balance Check, Stake Deduction, and DB Join (Auto-registers new players with 30 ETB bonus)
        let newBalance = 0;
        try {
          newBalance = await joinGameAtomic(session.gameId, userId, parsedStake, uniqueNumbers, username);
        } catch (err: any) {
          if (err.message === 'INSUFFICIENT_BALANCE') {
            ws.send(JSON.stringify({ status: 'error', message: 'Insufficient wallet balance.' }));
          } else {
            console.error('Atomic join error:', err);
            ws.send(JSON.stringify({ status: 'error', message: 'Failed to join game lobby.' }));
          }
          return;
        }

        const newPlayer: Player = {
          userId,
          username,
          numbers: uniqueNumbers,
          ws
        };
        session.players.push(newPlayer);

        sendToPlayer(newPlayer, { 
          status: 'joined', 
          event: 'JOIN_SUCCESS',
          gameId: session.gameId, 
          stake: parsedStake,
          numbers: uniqueNumbers,
          balance: newBalance
        });

        broadcastLobbyUpdate(session);

        if (session.players.length >= 2 && session.status === 'WAITING_FOR_PLAYERS' && !isGameRunningForStake(session.stake)) {
          startCountdown(session);
        }

        ws.on('close', () => {
          if (session.status === 'WAITING_FOR_PLAYERS' || session.status === 'COUNTDOWN') {
            session.players = session.players.filter(p => p.userId !== userId);
            
            // Refund stake if left before LOCKED
            refundGameAtomic(session.gameId, [{ userId, stake: parsedStake }], []).catch(err => console.error(err));
            
            broadcastLobbyUpdate(session);

            if (session.players.length < 2 && session.countdownTimer) {
              clearInterval(session.countdownTimer);
              session.countdownTimer = null;
              session.countdownSeconds = 45;
              transitionSessionState(session, 'WAITING_FOR_PLAYERS');
              broadcast(session, {
                status: 'countdown_stopped',
                event: 'COUNTDOWN_STOPPED'
              });
            }
          } else {
            const idx = session.players.findIndex(p => p.userId === userId);
            if (idx !== -1) {
              session.players[idx].ws = null;
            }
          }
        });
      }
    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });
}

export function getActiveGamesStatus(): string {
  const active: string[] = [];
  for (const session of sessions.values()) {
    if (session.status === 'DRAWING' || session.status === 'LOCKED') {
      active.push(`#${session.gameId} (${session.stake} ETB)`);
    }
  }
  return active.length > 0 ? active.join(', ') : 'None';
}
