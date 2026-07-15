const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

let selectedNumbers = [];
const MAX_SELECT = 15;
let stake = 50;
let userBalance = 0.0;
let myNumbers = [];
let myUserId = null;
let currentTheme = localStorage.getItem('bingo-theme') || 'neon';

// Parse stake selection
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('stake')) stake = parseInt(urlParams.get('stake'), 10);
document.getElementById('stake-amount').textContent = stake;

// Fetch user profile and balance
async function fetchUserBalance() {
  try {
    const initData = tg.initData || "";
    const response = await fetch(`/api/user-balance?initData=${encodeURIComponent(initData)}`);
    if (response.ok) {
      const data = await response.json();
      userBalance = parseFloat(data.balance);
      document.getElementById('selection-wallet').textContent = userBalance.toFixed(2);
      document.getElementById('playing-wallet').textContent = userBalance.toFixed(2) + " ETB";
      document.getElementById('wallet-tab-balance').textContent = userBalance.toFixed(2) + " ETB";
      myUserId = tg.initDataUnsafe?.user?.id?.toString() || "me";
    }
  } catch (err) {
    console.error("Error fetching balance:", err);
  }
}

// Generate selection grid
function initSelectionGrid() {
  const grid = document.getElementById('numbers-grid');
  grid.innerHTML = '';
  for (let i = 1; i <= 130; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.id = `select-num-${i}`;
    btn.addEventListener('click', () => {
      toggleNumber(i);
    });
    grid.appendChild(btn);
  }
}

function toggleNumber(num) {
  const btn = document.getElementById(`select-num-${num}`);
  if (selectedNumbers.includes(num)) {
    selectedNumbers = selectedNumbers.filter(n => n !== num);
    btn.classList.remove('selected');
  } else if (selectedNumbers.length < MAX_SELECT) {
    selectedNumbers.push(num);
    btn.classList.add('selected');
  } else {
    if (tg.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('warning');
    }
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  document.getElementById('selected-count').textContent = selectedNumbers.length;
  const joinBtn = document.getElementById('join-btn');
  const hasEnoughBalance = userBalance >= stake;
  joinBtn.disabled = selectedNumbers.length !== MAX_SELECT || !hasEnoughBalance;
}

// Auto Pick (Quick Pick)
document.getElementById('quick-pick-btn').addEventListener('click', () => {
  clearSelection();
  const nums = [];
  while (nums.length < 15) {
    const r = Math.floor(Math.random() * 130) + 1;
    if (!nums.includes(r)) {
      nums.push(r);
    }
  }
  nums.sort((a, b) => a - b);
  nums.forEach(num => {
    selectedNumbers.push(num);
    const btn = document.getElementById(`select-num-${num}`);
    if (btn) btn.classList.add('selected');
  });
  updateSelectionUI();
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('medium');
  }
});

function clearSelection() {
  selectedNumbers = [];
  const buttons = document.querySelectorAll('.grid button');
  buttons.forEach(btn => btn.classList.remove('selected'));
  updateSelectionUI();
}

document.getElementById('refresh-selection').addEventListener('click', () => {
  clearSelection();
});

// WebSocket client logic
let socket = null;
const joinBtn = document.getElementById('join-btn');

joinBtn.addEventListener('click', () => {
  if (selectedNumbers.length !== MAX_SELECT) return;
  
  // Hide Navigation bar during gameplay to maximize screen space
  document.querySelector('.nav-bar').style.display = 'none';

  document.getElementById('selection-page').classList.add('hidden');
  document.getElementById('playing-page').classList.remove('hidden');

  initPlayingGrid();
  initPlayerCard();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    socket.send(JSON.stringify({
      action: "join",
      initData: tg.initData,
      stake: stake,
      numbers: selectedNumbers
    }));
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };

  socket.onerror = (err) => {
    console.error("WS error:", err);
  };

  socket.onclose = () => {
    console.log("WebSocket connection closed.");
  };
});

function initPlayingGrid() {
  const grid = document.getElementById('main-grid');
  grid.innerHTML = '';
  for (let i = 1; i <= 130; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.id = `board-num-${i}`;
    grid.appendChild(btn);
  }
}

// Format card grid
function initPlayerCard() {
  const grid = document.getElementById('player-cartela');
  grid.innerHTML = '';
  
  const sorted = [...selectedNumbers].sort((a, b) => a - b);
  myNumbers = sorted;

  sorted.forEach(num => {
    const btn = document.createElement('button');
    btn.textContent = num;
    btn.id = `card-num-${num}`;
    grid.appendChild(btn);
  });
}

function handleServerMessage(msg) {
  switch (msg.status) {
    case 'joined':
      document.getElementById('cartela-count').textContent = `#${msg.gameId}`;
      document.getElementById('playing-wallet').textContent = `${parseFloat(msg.balance).toFixed(2)} ETB`;
      break;

    case 'lobby_update':
      const listContainer = document.getElementById('joined-players-list');
      listContainer.innerHTML = '';
      msg.players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.username;
        if (p.userId === myUserId) {
          li.textContent += " (You)";
          li.style.color = "var(--color-primary)";
        }
        listContainer.appendChild(li);
      });

      const countdownBox = document.getElementById('lobby-countdown-box');
      if (msg.isCountdownActive) {
        countdownBox.classList.remove('hidden');
        document.getElementById('lobby-seconds').textContent = msg.countdown;
      } else {
        countdownBox.classList.add('hidden');
      }
      break;

    case 'countdown':
      const cBox = document.getElementById('lobby-countdown-box');
      cBox.classList.remove('hidden');
      document.getElementById('lobby-seconds').textContent = msg.secondsLeft;
      if (tg.HapticFeedback && msg.secondsLeft <= 5) {
        tg.HapticFeedback.impactOccurred('light');
      }
      break;

    case 'countdown_stopped':
      document.getElementById('lobby-countdown-box').classList.add('hidden');
      break;

    case 'game_start':
      document.getElementById('lobby-waiting').classList.add('hidden');
      if (tg.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
      }
      break;

    case 'draw':
      const num = msg.number;
      const curBall = document.getElementById('current-ball');
      curBall.textContent = num;
      curBall.classList.remove('animate');
      void curBall.offsetWidth; // trigger reflow
      curBall.classList.add('animate');

      document.getElementById('called-count').textContent = msg.calledNumbers.length;

      const historyRow = document.getElementById('ball-history-row');
      historyRow.innerHTML = '';
      
      const history = msg.calledNumbers.slice(0, -1).reverse().slice(0, 5);
      history.forEach(n => {
        const item = document.createElement('div');
        item.className = 'ball-history-item';
        item.textContent = n;
        historyRow.appendChild(item);
      });

      const boardBtn = document.getElementById(`board-num-${num}`);
      if (boardBtn) {
        boardBtn.classList.add('called');
      }

      if (myNumbers.includes(num)) {
        const cardBtn = document.getElementById(`card-num-${num}`);
        if (cardBtn) {
          cardBtn.classList.add('matched');
        }
        if (tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('success');
        }
      }

      const matchCount = myNumbers.filter(n => msg.calledNumbers.includes(n)).length;
      document.getElementById('match-score').textContent = matchCount;
      break;

    case 'finished':
      showGameOver(msg);
      break;

    case 'error':
      if (tg.showAlert) {
        tg.showAlert(msg.message);
      } else {
        alert(msg.message);
      }
      returnToSelection();
      break;
  }
}

function showGameOver(msg) {
  const overlay = document.getElementById('game-over-overlay');
  overlay.classList.remove('hidden');

  const isWinner = msg.winners && msg.winners.some(w => w.userId === myUserId);
  const title = document.getElementById('game-outcome-title');
  const winnerP = document.getElementById('winner-name-p');
  const payoutP = document.getElementById('payout-amount-p');

  if (msg.outcome === 'draw') {
    title.textContent = "GAME OVER";
    winnerP.textContent = "Outcome: Draw / No Winner";
    payoutP.textContent = "Stakes refunded.";
    if (tg.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('warning');
    }
  } else {
    const winnerNames = msg.winners.map(w => w.username).join(', ');
    if (isWinner) {
      title.textContent = "🏆 BINGO! 🏆";
      title.style.background = "linear-gradient(135deg, #00ffaa, #00e1ff)";
      title.style.webkitBackgroundClip = "text";
      winnerP.textContent = `You won!`;
      payoutP.textContent = `+${parseFloat(msg.payout).toFixed(2)} ETB`;
      if (tg.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
      }
    } else {
      title.textContent = "GAME OVER";
      title.style.background = "linear-gradient(135deg, #ff3c70, #ff8000)";
      title.style.webkitBackgroundClip = "text";
      winnerP.textContent = `Winner: ${winnerNames}`;
      payoutP.textContent = `Hard luck!`;
      if (tg.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('error');
      }
    }
  }

  fetchUserBalance();
}

function returnToSelection() {
  if (socket) {
    socket.close();
    socket = null;
  }
  // Re-show navigation bar when returning to selection
  document.querySelector('.nav-bar').style.display = 'flex';

  document.getElementById('playing-page').classList.add('hidden');
  document.getElementById('game-over-overlay').classList.add('hidden');
  document.getElementById('lobby-waiting').classList.remove('hidden');
  document.getElementById('selection-page').classList.remove('hidden');
  clearSelection();
}

document.getElementById('lobby-return-btn').addEventListener('click', returnToSelection);

// -------------------------------------------------------------
// NEW FEATURE LOGIC: TABS NAVIGATION, WALLET, HISTORY & SETTINGS
// -------------------------------------------------------------

const tabs = ['play', 'wallet', 'history', 'settings'];

// Tab switching controller
function switchTab(activeTab) {
  tabs.forEach(tab => {
    const content = document.getElementById(`tab-${tab}`);
    const navBtn = document.getElementById(`nav-${tab}-btn`);
    
    if (tab === activeTab) {
      content.classList.remove('hidden');
      navBtn.classList.add('active');
    } else {
      content.classList.add('hidden');
      navBtn.classList.remove('active');
    }
  });

  // Trigger loads based on active tab
  if (activeTab === 'wallet') {
    fetchUserTransactions();
  } else if (activeTab === 'history') {
    fetchGameHistory();
  } else if (activeTab === 'settings') {
    fetchUserProfile();
  }
}

// Bind Navigation clicks
tabs.forEach(tab => {
  document.getElementById(`nav-${tab}-btn`).addEventListener('click', () => {
    // Prevent switching tab if inside a running game
    const playingPage = document.getElementById('playing-page');
    if (!playingPage.classList.contains('hidden')) {
      if (tg.showAlert) {
        tg.showAlert("⚠️ Cannot switch screens while playing in a running game!");
      }
      return;
    }
    switchTab(tab);
    if (tg.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('light');
    }
  });
});

// Fetch user profile settings
async function fetchUserProfile() {
  try {
    const initData = tg.initData || "";
    const response = await fetch(`/api/user-profile?initData=${encodeURIComponent(initData)}`);
    if (response.ok) {
      const profile = await response.json();
      document.getElementById('profile-username').textContent = profile.username ? `@${profile.username}` : 'N/A';
      document.getElementById('profile-userid').textContent = profile.userId;
      document.getElementById('profile-phone').textContent = profile.phone || 'Not Registered';
      
      // Update local values
      userBalance = parseFloat(profile.balance);
      document.getElementById('wallet-tab-balance').textContent = userBalance.toFixed(2) + " ETB";
    }
  } catch (err) {
    console.error("Error fetching user profile:", err);
  }
}

// Fetch user transaction history list
async function fetchUserTransactions() {
  try {
    const initData = tg.initData || "";
    const response = await fetch(`/api/user-transactions?initData=${encodeURIComponent(initData)}`);
    if (response.ok) {
      const data = await response.json();
      const txList = document.getElementById('wallet-transactions-list');
      txList.innerHTML = '';

      if (data.transactions.length === 0) {
        txList.innerHTML = '<div class="desc" style="text-align:center; padding: 20px;">No transactions recorded yet.</div>';
        return;
      }

      data.transactions.forEach(tx => {
        const card = document.createElement('div');
        card.className = 'transaction-card';

        const left = document.createElement('div');
        left.className = 'tx-left';

        const type = document.createElement('span');
        type.className = 'tx-type';
        type.textContent = tx.type.replace('_', ' ');

        const desc = document.createElement('span');
        desc.className = 'tx-desc';
        desc.textContent = tx.description || '';

        const date = document.createElement('span');
        date.className = 'tx-date';
        date.textContent = new Date(tx.timestamp).toLocaleString();

        left.appendChild(type);
        left.appendChild(desc);
        left.appendChild(date);

        const amount = document.createElement('div');
        const isPos = parseFloat(tx.amount) >= 0;
        amount.className = `tx-amount ${isPos ? 'positive' : 'negative'}`;
        amount.textContent = `${isPos ? '+' : ''}${parseFloat(tx.amount).toFixed(2)} ETB`;

        card.appendChild(left);
        card.appendChild(amount);
        txList.appendChild(card);
      });
    }
    // Sync balance display
    fetchUserBalance();
  } catch (err) {
    console.error("Error fetching transactions:", err);
  }
}

// Fetch historical games
async function fetchGameHistory() {
  try {
    const initData = tg.initData || "";
    const response = await fetch(`/api/user-history?initData=${encodeURIComponent(initData)}`);
    if (response.ok) {
      const data = await response.json();
      const list = document.getElementById('history-games-list');
      list.innerHTML = '';

      if (data.history.length === 0) {
        list.innerHTML = '<div class="desc" style="text-align:center; padding: 20px;">You haven\'t played any games yet.</div>';
        return;
      }

      data.history.forEach(game => {
        const card = document.createElement('div');
        card.className = 'history-card';

        const headerRow = document.createElement('div');
        headerRow.className = 'history-header-row';

        const title = document.createElement('span');
        title.className = 'history-game-id';
        title.textContent = `Game #${game.id}`;

        const badge = document.createElement('span');
        const won = game.winner_id === myUserId;
        badge.className = `history-outcome-badge ${won ? 'win' : 'loss'}`;
        badge.textContent = won ? 'WON' : (game.winner_id ? 'LOST' : 'DRAW');

        headerRow.appendChild(title);
        headerRow.appendChild(badge);

        const detailsRow = document.createElement('div');
        detailsRow.className = 'history-details-row';

        const stakeText = document.createElement('span');
        stakeText.textContent = `Stake: ${parseFloat(game.stake).toFixed(2)} ETB`;

        const matchCountText = document.createElement('span');
        matchCountText.textContent = `Matches: ${game.matches}/15`;

        detailsRow.appendChild(stakeText);
        detailsRow.appendChild(matchCountText);

        const drawings = document.createElement('div');
        drawings.className = 'history-drawings-text';
        if (game.called_numbers && game.called_numbers.length > 0) {
          drawings.textContent = `Called numbers: ${game.called_numbers.join(', ')}`;
        } else {
          drawings.textContent = `Called numbers: None`;
        }

        card.appendChild(headerRow);
        card.appendChild(detailsRow);
        card.appendChild(drawings);

        list.appendChild(card);
      });
    }
  } catch (err) {
    console.error("Error fetching game history:", err);
  }
}

// Withdrawal POST request handler
document.getElementById('submit-withdrawal-btn').addEventListener('click', async () => {
  const input = document.getElementById('withdraw-amount-input');
  const messageBox = document.getElementById('withdraw-message');
  const amount = parseFloat(input.value);

  messageBox.classList.add('hidden');

  if (isNaN(amount) || amount < 50) {
    messageBox.textContent = "❌ Minimum withdrawal amount is 50 ETB.";
    messageBox.className = "message-box error";
    messageBox.classList.remove('hidden');
    return;
  }

  if (amount > userBalance) {
    messageBox.textContent = "❌ Insufficient balance in your wallet.";
    messageBox.className = "message-box error";
    messageBox.classList.remove('hidden');
    return;
  }

  try {
    const initData = tg.initData || "";
    const response = await fetch('/api/request-withdrawal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ initData, amount })
    });

    const data = await response.json();
    if (response.ok && data.success) {
      messageBox.textContent = `✅ Request submitted! Ref: #${data.refId}. Balance deducted.`;
      messageBox.className = "message-box success";
      messageBox.classList.remove('hidden');
      input.value = '';
      
      // Update UI balance state
      userBalance = parseFloat(data.newBalance);
      document.getElementById('selection-wallet').textContent = userBalance.toFixed(2);
      document.getElementById('playing-wallet').textContent = userBalance.toFixed(2) + " ETB";
      document.getElementById('wallet-tab-balance').textContent = userBalance.toFixed(2) + " ETB";

      if (tg.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
      }

      // Reload transactions list
      fetchUserTransactions();
    } else {
      messageBox.textContent = `❌ ${data.error || 'Request failed.'}`;
      messageBox.className = "message-box error";
      messageBox.classList.remove('hidden');
    }
  } catch (err) {
    console.error("Error processing withdrawal:", err);
    messageBox.textContent = "❌ Network error. Please try again.";
    messageBox.className = "message-box error";
    messageBox.classList.remove('hidden');
  }
});

// Theme Management Helper
function applyTheme(theme) {
  document.body.classList.remove('light-theme', 'obsidian-theme');
  document.getElementById('theme-dark-neon').classList.remove('active');
  document.getElementById('theme-obsidian').classList.remove('active');
  document.getElementById('theme-light').classList.remove('active');

  if (theme === 'light') {
    document.body.classList.add('light-theme');
    document.getElementById('theme-light').classList.add('active');
  } else if (theme === 'obsidian') {
    document.body.classList.add('obsidian-theme');
    document.getElementById('theme-obsidian').classList.add('active');
  } else {
    document.getElementById('theme-dark-neon').classList.add('active');
  }

  localStorage.setItem('bingo-theme', theme);
  currentTheme = theme;
}

// Bind Theme selection clicks
document.getElementById('theme-dark-neon').addEventListener('click', () => applyTheme('neon'));
document.getElementById('theme-obsidian').addEventListener('click', () => applyTheme('obsidian'));
document.getElementById('theme-light').addEventListener('click', () => applyTheme('light'));

// Set Saved Theme on Startup
applyTheme(currentTheme);

// Initial loading
fetchUserBalance();
initSelectionGrid();
