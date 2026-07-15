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
    
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        phone TEXT,
        balance NUMERIC DEFAULT 0.0,
        joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
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

    await client.query('COMMIT');
    console.log('✅ PostgreSQL database tables initialized successfully.');
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
  const res = await pool.query(
    `INSERT INTO users (user_id, username, phone, balance)
     VALUES ($1, $2, $3, 0.0)
     ON CONFLICT (user_id) DO UPDATE 
     SET username = EXCLUDED.username, phone = EXCLUDED.phone
     RETURNING *`,
    [userId, username, phone]
  );
  return res.rows[0];
}

export async function getBalance(userId: number | string): Promise<number> {
  const res = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) return 0.0;
  return parseFloat(res.rows[0].balance);
}

export async function updateBalance(userId: number | string, amount: number) {
  const res = await pool.query(
    'UPDATE users SET balance = balance + $1 WHERE user_id = $2 RETURNING balance',
    [amount, userId]
  );
  return res.rows[0] ? parseFloat(res.rows[0].balance) : 0;
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
export async function createGame(stake: number) {
  const res = await pool.query(
    `INSERT INTO games (stake, status) VALUES ($1, 'waiting') RETURNING *`,
    [stake]
  );
  return res.rows[0];
}

export async function getActiveLobby(stake: number) {
  const res = await pool.query(
    `SELECT * FROM games WHERE stake = $1 AND status = 'waiting' 
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

export async function getGamePlayers(gameId: number) {
  const res = await pool.query(
    `SELECT gp.*, u.username, u.phone FROM game_players gp
     JOIN users u ON gp.user_id = u.user_id
     WHERE gp.game_id = $1`,
    [gameId]
  );
  return res.rows;
}

export async function updateGameStatus(gameId: number, status: string, winnerId: number | string | null, calledNumbers: number[]) {
  const res = await pool.query(
    `UPDATE games 
     SET status = $1, winner_id = $2, called_numbers = $3 
     WHERE id = $4 RETURNING *`,
    [status, winnerId, calledNumbers, gameId]
  );
  return res.rows[0];
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

