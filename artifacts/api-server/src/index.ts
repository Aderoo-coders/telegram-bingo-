import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from './config.js';
import { 
  initDb, 
  getBalance, 
  getUser, 
  updateBalance, 
  createWithdrawal, 
  addTransaction, 
  getUserGameHistory, 
  getUserTransactions 
} from './database.js';
import { bot } from './bot/index.js';
import { handleConnection, verifyTelegramWebapp } from './game-manager.js';

import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  try {
    // 1. Initialize PostgreSQL tables
    await initDb();

    // 2. Create Express app
    const app = express();
    const server = http.createServer(app);

    // Enable JSON parsing middleware
    app.use(express.json());

    // Serve webapp static folder dynamically
    let webappPath = path.resolve(__dirname, '../../../../webapp');
    if (!fs.existsSync(webappPath)) {
      webappPath = path.resolve(__dirname, '../../../webapp');
    }
    console.log(`📂 Serving static webapp from: ${webappPath}`);
    app.use('/webapp', express.static(webappPath));

    // SECURE WALLET BALANCE API
    app.get('/api/user-balance', async (req, res) => {
      try {
        const initData = req.query.initData as string;
        if (!initData) {
          return res.status(400).json({ error: 'Missing initData' });
        }
        const user = verifyTelegramWebapp(initData, config.BOT_TOKEN);
        if (!user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const balance = await getBalance(user.id);
        res.json({ balance });
      } catch (err) {
        console.error('Error in user-balance API:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // SECURE PROFILE API
    app.get('/api/user-profile', async (req, res) => {
      try {
        const initData = req.query.initData as string;
        if (!initData) {
          return res.status(400).json({ error: 'Missing initData' });
        }
        const userObj = verifyTelegramWebapp(initData, config.BOT_TOKEN);
        if (!userObj) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = await getUser(userObj.id);
        if (!user) {
          return res.status(404).json({ error: 'User profile not found.' });
        }
        res.json({
          userId: user.user_id,
          username: user.username,
          phone: user.phone,
          balance: parseFloat(user.balance)
        });
      } catch (err) {
        console.error('Error in user-profile API:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // SECURE HISTORY API
    app.get('/api/user-history', async (req, res) => {
      try {
        const initData = req.query.initData as string;
        if (!initData) {
          return res.status(400).json({ error: 'Missing initData' });
        }
        const userObj = verifyTelegramWebapp(initData, config.BOT_TOKEN);
        if (!userObj) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const history = await getUserGameHistory(userObj.id);
        res.json({ history });
      } catch (err) {
        console.error('Error in user-history API:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // SECURE TRANSACTIONS API
    app.get('/api/user-transactions', async (req, res) => {
      try {
        const initData = req.query.initData as string;
        if (!initData) {
          return res.status(400).json({ error: 'Missing initData' });
        }
        const userObj = verifyTelegramWebapp(initData, config.BOT_TOKEN);
        if (!userObj) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const transactions = await getUserTransactions(userObj.id);
        res.json({ transactions });
      } catch (err) {
        console.error('Error in user-transactions API:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // SECURE WITHDRAWAL TRIGGER
    app.post('/api/request-withdrawal', async (req, res) => {
      try {
        const { initData, amount } = req.body;
        if (!initData || !amount) {
          return res.status(400).json({ error: 'Missing parameters' });
        }
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount < 50) {
          return res.status(400).json({ error: 'Minimum withdrawal is 50 ETB.' });
        }

        const userObj = verifyTelegramWebapp(initData, config.BOT_TOKEN);
        if (!userObj) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const userId = userObj.id;
        const user = await getUser(userId);
        if (!user || !user.phone) {
          return res.status(400).json({ error: 'User registration not completed.' });
        }

        const balance = parseFloat(user.balance);
        if (balance < parsedAmount) {
          return res.status(400).json({ error: 'Insufficient balance.' });
        }

        // Lock funds and create request
        await updateBalance(userId, -parsedAmount);
        const withdrawal = await createWithdrawal(userId, parsedAmount, user.phone);
        await addTransaction(userId, 'withdrawal_request', -parsedAmount, `Pending withdrawal to ${user.phone} (Ref ID: ${withdrawal.id})`);

        // Notify Admin
        if (config.ADMIN_ID) {
          const adminText = `🔔 *New WebApp Withdrawal Request*\n\n` +
            `👤 *Ref ID:* \`${withdrawal.id}\`\n` +
            `👤 *User ID:* \`${userId}\`\n` +
            `👤 *Username:* @${user.username || 'N/A'}\n` +
            `📱 *Phone:* ${user.phone}\n` +
            `💰 *Amount:* ${parsedAmount.toFixed(2)} ETB\n\n` +
            `To approve, use: \`/approve_withdraw ${withdrawal.id}\`\n` +
            `To reject, use: \`/reject_withdraw ${withdrawal.id}\``;
          bot.api.sendMessage(config.ADMIN_ID, adminText, { parse_mode: 'Markdown' }).catch(err => {
            console.error('Error notifying admin of withdrawal from WebApp:', err);
          });
        }

        res.json({ success: true, refId: withdrawal.id, newBalance: balance - parsedAmount });
      } catch (err) {
        console.error('Error in request-withdrawal API:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Simple status endpoint
    app.get('/status', (req, res) => {
      res.json({ status: 'ok', bot: 'active' });
    });

    // Default redirect to webapp
    app.get('/', (req, res) => {
      res.redirect('/webapp/index.html');
    });

    // 3. Setup WebSocket Server on the same HTTP server
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      try {
        const urlObj = new URL(request.url || '', `http://${request.headers.host}`);
        if (urlObj.pathname === '/ws') {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        } else {
          socket.destroy();
        }
      } catch (err) {
        console.error('Error handling WebSocket upgrade:', err);
        socket.destroy();
      }
    });

    wss.on('connection', (ws) => {
      handleConnection(ws);
    });

    // 4. Start HTTP Server
    server.listen(config.PORT, () => {
      console.log(`🚀 API Server + WebSockets running on port ${config.PORT}`);
    });

    // 5. Start Telegram Bot
    bot.start({
      onStart: (botInfo) => {
        console.log(`🤖 Telegram Bot started successfully as @${botInfo.username}`);
      }
    }).catch(err => {
      console.error('❌ Failed to start Telegram Bot polling:', err);
    });

  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
