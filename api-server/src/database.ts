import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// Use pg pool for connection management
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_URL.includes('localhost') || config.DATABASE_URL.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false }
});

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create users table (default 30 ETB welcome bonus for new players)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        phone TEXT,
        balance NUMERIC DEFAULT 30.0,
        joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure bonus column exists in users table
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus NUMERIC DEFAULT 0.0;
    `);

    // Create transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        description TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create withdrawals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        phone TEXT,
        status TEXT DEFAULT 'pending',
        request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_time TIMESTAMP,
        admin_note TEXT
      );
    `);

    // Create games table
    await client.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        stake NUMERIC NOT NULL,
        status TEXT DEFAULT 'waiting', -- 'waiting', 'playing', 'finished'
        called_numbers INTEGER[] DEFAULT '{}',
        winner_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create game_players table
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_players (
        game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
        user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
        selected_numbers INTEGER[] NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (game_id, user_id)
      );
    `);

    // Create deposits table
    await client.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        platform TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_time TIMESTAMP,
        admin_note TEXT
      );
    `);

    // Create settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    await client.query(`
      INSERT INTO settings (key, value) 
      VALUES ('maintenance_mode', 'OFF') 
      ON CONFLICT (key) DO NOTHING;
    `);

    // Performance Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_games_stake_status ON games(stake, status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id, timestamp DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id);`);

    await client.query('COMMIT');
    console.log('✅ PostgreSQL database tables and indexes initialized successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error initializing database tables:', err);
    throw err;
  } finally {
    client.release();
  }
}

// User Helper functions
export async function getUser(userId: number | string) {
  const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

export async function registerUser(userId: number | string, username: string | null, phone: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const checkRes = await client.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    const isNew = checkRes.rows.length === 0;

    let res = await client.query(
      `INSERT INTO users (user_id, username, phone, balance)
       VALUES ($1, $2, $3, 30.0)
       ON CONFLICT (user_id) DO UPDATE 
       SET username = EXCLUDED.username, phone = COALESCE(NULLIF($3, ''), users.phone)
       RETURNING *`,
      [userId, username, phone]
    );

    // Check if user has already received the welcome bonus transaction
    const txCheck = await client.query(
      "SELECT id FROM transactions WHERE user_id = $1 AND type = 'welcome_bonus'",
      [userId]
    );

    if (txCheck.rows.length === 0) {
      if (!isNew) {
        // Credit existing user who hasn't received welcome bonus yet
        const updateRes = await client.query(
          "UPDATE users SET balance = balance + 30.0 WHERE user_id = $1 RETURNING *",
          [userId]
        );
        if (updateRes.rows[0]) {
          res = updateRes;
        }
      }
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)`,
        [userId, 'welcome_bonus', 30.0, '🎁 Welcome Bonus for joining Bingo Spark!']
      );
    }

    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureUserExists(userId: number | string, username: string | null = null) {
  let user = await getUser(userId);
  if (!user) {
    user = await registerUser(userId, username, '');
  } else {
    // Ensure existing user receives welcome bonus if missing
    await registerUser(userId, username || user.username, user.phone || '');
    user = await getUser(userId);
  }
  return user;
}

async function ensureAdminBalance(userId: number | string): Promise<void> {
  if (!config.isAdmin(userId)) return;
  const checkRes = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
  if (checkRes.rows.length === 0 || parseFloat(checkRes.rows[0].balance) < 100000.0) {
    await pool.query(
      `INSERT INTO users (user_id, username, phone, balance) 
       VALUES ($1, 'Admin', 'Admin', 1000000.0) 
       ON CONFLICT (user_id) DO UPDATE SET balance = 1000000.0`,
      [userId]
    );
  }
}

export async function getBalance(userId: number | string): Promise<number> {
  await ensureAdminBalance(userId);
  const res = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) return 0.0;
  return parseFloat(res.rows[0].balance);
}

export async function getWalletBalances(userId: number | string): Promise<{ balance: number, bonus: number }> {
  await ensureAdminBalance(userId);
  const res = await pool.query('SELECT balance, bonus FROM users WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) return { balance: 0.0, bonus: 0.0 };
  return {
    balance: parseFloat(res.rows[0].balance || 0),
    bonus: parseFloat(res.rows[0].bonus || 0)
  };
}

export async function updateBalance(userId: number | string, amount: number) {
  const res = await pool.query(
    'UPDATE users SET balance = balance + $1 WHERE user_id = $2 RETURNING balance',
    [amount, userId]
  );
  return res.rows[0] ? parseFloat(res.rows[0].balance) : 0;
}

export async function updateBonus(userId: number | string, amount: number) {
  const res = await pool.query(
    'UPDATE users SET bonus = bonus + $1 WHERE user_id = $2 RETURNING bonus',
    [amount, userId]
  );
  return res.rows[0] ? parseFloat(res.rows[0].bonus) : 0;
}

export async function addTransaction(userId: number | string, type: string, amount: number, description: string) {
  const res = await pool.query(
    `INSERT INTO transactions (user_id, type, amount, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, type, amount, description]
  );
  return res.rows[0];
}

export async function getUserPhone(userId: number | string): Promise<string> {
  const res = await pool.query('SELECT phone FROM users WHERE user_id = $1', [userId]);
  return res.rows[0] ? res.rows[0].phone : 'Unknown';
}

// Withdrawal Helper functions
export async function createWithdrawal(userId: number | string, amount: number, phone: string) {
  const res = await pool.query(
    `INSERT INTO withdrawals (user_id, amount, phone, status)
     VALUES ($1, $2, $3, 'pending') RETURNING *`,
    [userId, amount, phone]
  );
  return res.rows[0];
}

export async function getPendingWithdrawals() {
  const res = await pool.query(
    `SELECT w.*, u.username FROM withdrawals w 
     JOIN users u ON w.user_id = u.user_id 
     WHERE w.status = 'pending' ORDER BY w.request_time DESC`
  );
  return res.rows;
}

export async function updateWithdrawalStatus(id: number, status: string, adminNote: string | null) {
  const paidTime = status === 'completed' ? new Date() : null;
  const res = await pool.query(
    `UPDATE withdrawals 
     SET status = $1, paid_time = $2, admin_note = $3 
     WHERE id = $4 RETURNING *`,
    [status, paidTime, adminNote, id]
  );
  return res.rows[0];
}

// Game / Lobby helper functions
export async function createGame(stake: number, status: string = 'CREATED') {
  const res = await pool.query(
    `INSERT INTO games (stake, status) VALUES ($1, $2) RETURNING *`,
    [stake, status]
  );
  return res.rows[0];
}

export async function getActiveLobby(stake: number) {
  const res = await pool.query(
    `SELECT * FROM games 
     WHERE stake = $1 AND status IN ('CREATED', 'WAITING_FOR_PLAYERS', 'COUNTDOWN') 
     ORDER BY created_at DESC LIMIT 1`,
    [stake]
  );
  return res.rows[0] || null;
}

export async function joinGame(gameId: number, userId: number | string, selectedNumbers: number[]) {
  const res = await pool.query(
    `INSERT INTO game_players (game_id, user_id, selected_numbers)
     VALUES ($1, $2, $3) RETURNING *`,
    [gameId, userId, selectedNumbers]
  );
  return res.rows[0];
}

/**
 * Atomically checks user balance, deducts stake, logs transaction, and joins game in a single DB transaction.
 * Automatically creates user with 30 ETB welcome bonus if not existing yet.
 * Prevents double-join balance race conditions.
 */
export async function joinGameAtomic(
  gameId: number, 
  userId: number | string, 
  stake: number, 
  selectedNumbers: number[],
  username: string | null = null
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if user exists in database
    let userRes = await client.query('SELECT balance FROM users WHERE user_id = $1 FOR UPDATE', [userId]);

    if (config.isAdmin(userId)) {
      if (userRes.rows.length === 0 || parseFloat(userRes.rows[0].balance) < 100000.0) {
        await client.query(
          `INSERT INTO users (user_id, username, phone, balance)
           VALUES ($1, 'Admin', 'Admin', 1000000.0)
           ON CONFLICT (user_id) DO UPDATE SET balance = 1000000.0`,
          [userId]
        );
        userRes = await client.query('SELECT balance FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
      }
    } else if (userRes.rows.length === 0) {
      // Auto-register missing user with 30 ETB welcome bonus
      await client.query(
        `INSERT INTO users (user_id, username, phone, balance)
         VALUES ($1, $2, '', 30.0)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, username || 'Player']
      );
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, description) 
         VALUES ($1, 'welcome_bonus', 30.0, '🎁 Welcome Bonus for joining Bingo Spark!')
         ON CONFLICT DO NOTHING`,
        [userId]
      );
      userRes = await client.query('SELECT balance FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
    }

    const currentBalance = parseFloat(userRes.rows[0]?.balance || '0');
    if (currentBalance < stake) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    // Deduct balance
    const updateRes = await client.query(
      'UPDATE users SET balance = balance - $1 WHERE user_id = $2 RETURNING balance',
      [stake, userId]
    );
    const newBalance = parseFloat(updateRes.rows[0].balance);

    // Log transaction
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)`,
      [userId, 'stake_deduct', -stake, `Staked on game #${gameId}`]
    );

    // Record game player safely
    await client.query(
      `INSERT INTO game_players (game_id, user_id, selected_numbers) 
       VALUES ($1, $2, $3)
       ON CONFLICT (game_id, user_id) DO UPDATE SET selected_numbers = EXCLUDED.selected_numbers`,
      [gameId, userId, selectedNumbers]
    );

    await client.query('COMMIT');
    return newBalance;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getGamePlayers(gameId: number) {
  const res = await pool.query(
    `SELECT gp.*, u.username, u.phone FROM game_players gp
     JOIN users u ON gp.user_id = u.user_id
     WHERE gp.game_id = $1`,
    [gameId]
  );
  return res.rows;
}

export async function updateGameStatus(gameId: number, status: string, winnerId: number | string | null = null, calledNumbers: number[] = []) {
  const res = await pool.query(
    `UPDATE games 
     SET status = $1, winner_id = $2, called_numbers = $3 
     WHERE id = $4 RETURNING *`,
    [status, winnerId, calledNumbers, gameId]
  );
  return res.rows[0];
}

/**
 * Atomically executes winner payouts and admin commission in a single DB transaction.
 */
export async function payoutGameAtomic(
  gameId: number,
  winners: { userId: string; payout: number }[],
  adminCommission: number,
  calledNumbers: number[],
  primaryWinnerId: string | null
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update game status
    await client.query(
      `UPDATE games SET status = 'FINISHED', winner_id = $1, called_numbers = $2 WHERE id = $3`,
      [primaryWinnerId, calledNumbers, gameId]
    );

    // Credit winners
    for (const winner of winners) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE user_id = $2',
        [winner.payout, winner.userId]
      );
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)`,
        [winner.userId, 'win_payout', winner.payout, `Won game #${gameId}`]
      );
    }

    // Credit admin commission if configured
    if (config.ADMIN_ID && adminCommission > 0) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE user_id = $2',
        [adminCommission, config.ADMIN_ID]
      );
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)`,
        [config.ADMIN_ID, 'admin_commission', adminCommission, `20% admin fee from game #${gameId}`]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically refunds stakes to all players if game ends in a draw.
 */
export async function refundGameAtomic(
  gameId: number,
  players: { userId: string; stake: number }[],
  calledNumbers: number[]
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE games SET status = 'FINISHED', winner_id = NULL, called_numbers = $1 WHERE id = $2`,
      [calledNumbers, gameId]
    );

    for (const player of players) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE user_id = $2',
        [player.stake, player.userId]
      );
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)`,
        [player.userId, 'refund', player.stake, `Refund for game #${gameId}`]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// User Game History helper
export async function getUserGameHistory(userId: number | string) {
  const res = await pool.query(
    `SELECT g.id, g.stake, g.status, g.winner_id, g.called_numbers, gp.joined_at, 
            u.username as winner_name,
            (SELECT COUNT(*) FROM unnest(gp.selected_numbers) num WHERE num = ANY(g.called_numbers)) as matches
     FROM game_players gp 
     JOIN games g ON gp.game_id = g.id 
     LEFT JOIN users u ON g.winner_id = u.user_id 
     WHERE gp.user_id = $1 
     ORDER BY gp.joined_at DESC LIMIT 20`,
    [userId]
  );
  return res.rows;
}

// User Transactions list helper
export async function getUserTransactions(userId: number | string, limit: number = 20) {
  const res = await pool.query(
    `SELECT type, amount, description, timestamp 
     FROM transactions 
     WHERE user_id = $1 
     ORDER BY timestamp DESC 
     LIMIT $2`,
    [userId, limit]
  );
  return res.rows;
}

export async function createDeposit(userId: number | string, amount: number, platform: string, referenceId: string) {
  const res = await pool.query(
    `INSERT INTO deposits (user_id, amount, platform, reference_id) 
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, amount, platform, referenceId]
  );
  return res.rows[0];
}

export async function getPendingDeposits() {
  const res = await pool.query(
    `SELECT d.*, u.username 
     FROM deposits d
     JOIN users u ON d.user_id = u.user_id 
     WHERE d.status = 'pending' 
     ORDER BY d.request_time DESC`
  );
  return res.rows;
}

export async function updateDepositStatus(id: number, status: string, adminNote: string = '') {
  const res = await pool.query(
    `UPDATE deposits 
     SET status = $1, processed_time = CURRENT_TIMESTAMP, admin_note = $2 
     WHERE id = $3 RETURNING *`,
    [status, adminNote, id]
  );
  return res.rows[0];
}

export async function getMaintenanceMode(): Promise<boolean> {
  try {
    const res = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_mode'");
    return res.rows[0]?.value === 'ON';
  } catch (err) {
    console.error('Error fetching maintenance mode:', err);
    return false;
  }
}

export async function setMaintenanceMode(on: boolean): Promise<void> {
  const value = on ? 'ON' : 'OFF';
  await pool.query(
    `INSERT INTO settings (key, value) 
     VALUES ('maintenance_mode', $1) 
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [value]
  );
}

export async function getSystemStats(): Promise<{ totalUsers: number; registeredUsers: number; totalEtb: number }> {
  const usersRes = await pool.query("SELECT COUNT(*)::integer AS count FROM users");
  const regRes = await pool.query("SELECT COUNT(*)::integer AS count FROM users WHERE phone IS NOT NULL AND phone != ''");
  const etbRes = await pool.query("SELECT COALESCE(SUM(balance + bonus), 0.0)::numeric AS total FROM users");
  
  return {
    totalUsers: usersRes.rows[0]?.count || 0,
    registeredUsers: regRes.rows[0]?.count || 0,
    totalEtb: parseFloat(etbRes.rows[0]?.total || 0)
  };
}

