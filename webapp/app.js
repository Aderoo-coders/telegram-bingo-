const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

let selectedNumbers = [];
const MAX_SELECT = 10;
const TOTAL_CARDS = 200;
const BINGO_RANGES = [
  { letter: 'B', start: 1, end: 15 },
  { letter: 'I', start: 16, end: 30 },
  { letter: 'N', start: 31, end: 45 },
  { letter: 'G', start: 46, end: 60 },
  { letter: 'O', start: 61, end: 75 },
];
const FREE_SPACE = 'FREE';
let ticketHistory = [];
let stake = 10;
let userBalance = 0.0;
let userBonus = 0.0;
let myNumbers = [];
let myUserId = null;
let currentTheme = localStorage.getItem('bingo-theme') || 'neon';

const formatBirr = (val) => Number.isInteger(val) ? val.toString() : val.toFixed(2);

function ticketMatrixKey(matrix) {
  return matrix.flat().map((value) => (value === FREE_SPACE ? 'F' : value)).join(',');
}

function createFixedMiniTicket(seed) {
  const matrix = Array.from({ length: 5 }, () => Array(5).fill(null));
  let randomState = (seed * 1664525 + 1013904223) >>> 0;

  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };

  BINGO_RANGES.forEach(({ start, end }, colIndex) => {
    const pool = [];
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
function generateUniqueMiniTickets() {
  const ticketsByNumber = Object.create(null);
  const usedKeys = new Set();
  let seed = 1;

  for (let num = 1; num <= TOTAL_CARDS; num++) {
    let matrix;
    let key;
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

function getMiniTicketForNumber(num) {
  return PRE_GENERATED_TICKETS[num];
}

function getNumbersFromTicketMatrix(matrix) {
  return matrix.flat().filter((value) => typeof value === 'number');
}

/** Bingo numbers (1-75) from all selected cards — used when joining. */
function getPlayNumbersFromSelectedCards() {
  const nums = new Set();
  ticketHistory.forEach((entry) => {
    getNumbersFromTicketMatrix(entry.ticketMatrix).forEach((n) => nums.add(n));
  });
  return [...nums].sort((a, b) => a - b);
}

// Parse stake selection
const urlParams = new URLSearchParams(window.location.search);
let startedWithUrlStake = false;
if (urlParams.get('stake')) {
  stake = parseInt(urlParams.get('stake'), 10);
  startedWithUrlStake = true;
}
document.getElementById('stake-amount').textContent = stake;

// Fetch user profile and balance
async function fetchUserBalance() {
  try {
    const initData = tg.initData || "";
    const response = await fetch(`/api/user-balance?initData=${encodeURIComponent(initData)}`);
    if (response.ok) {
      const data = await response.json();
      userBalance = parseFloat(data.balance || 0);
      userBonus = parseFloat(data.bonus || 0);
      document.getElementById('selection-wallet').textContent = userBalance.toFixed(2);
      document.getElementById('welcome-balance-amount').textContent = userBalance.toFixed(2);
      document.getElementById('playing-wallet').textContent = userBalance.toFixed(2) + " ETB";
      
      const balNewEl = document.getElementById('wallet-tab-balance-new');
      if (balNewEl) balNewEl.textContent = formatBirr(userBalance);
      const bonusNewEl = document.getElementById('wallet-tab-bonus-new');
      if (bonusNewEl) bonusNewEl.textContent = formatBirr(userBonus);
      const depositBalEl = document.getElementById('deposit-current-balance');
      if (depositBalEl) depositBalEl.textContent = `${formatBirr(userBalance)} ETB`;
      const withdrawBalEl = document.getElementById('withdraw-current-balance');
      if (withdrawBalEl) withdrawBalEl.textContent = `${formatBirr(userBalance)} ETB`;
      
      myUserId = tg.initDataUnsafe?.user?.id?.toString() || "me";
    }
  } catch (err) {
    console.error("Error fetching balance:", err);
  }
}

// Generate selection grid — 200 cards in a 10×20 layout
function initSelectionGrid() {
  const grid = document.getElementById('numbers-grid');
  grid.innerHTML = '';
  grid.classList.add('cards-grid-200');

  for (let i = 1; i <= TOTAL_CARDS; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = i;
    btn.id = `select-num-${i}`;
    btn.addEventListener('click', () => {
      toggleNumber(i);
    });
    grid.appendChild(btn);
  }
}

function buildTicketMatrix(selectedNumbersList) {
  const sorted = [...selectedNumbersList].sort((a, b) => a - b);
  const matrix = Array.from({ length: 5 }, () => Array(5).fill(null));

  BINGO_RANGES.forEach(({ start, end }, colIndex) => {
    const columnNumbers = sorted.filter(num => num >= start && num <= end).slice(0, 3);
    columnNumbers.forEach((num, rowIndex) => {
      matrix[rowIndex][colIndex] = num;
    });
  });

  matrix[2][2] = FREE_SPACE;
  return matrix;
}

function renderMiniTicketStack() {
  const container = document.getElementById('mini-ticket-stack');
  if (!container) return;

  container.innerHTML = '';

  if (!ticketHistory.length) {
    return;
  }

  ticketHistory.forEach((entry, index) => {
    const ticket = document.createElement('div');
    ticket.className = 'mini-ticket-card';

    const ticketHeader = document.createElement('div');
    ticketHeader.className = 'mini-ticket-header';
    BINGO_RANGES.forEach(({ letter }) => {
      const cell = document.createElement('span');
      cell.className = `mini-ticket-header-cell ${letter.toLowerCase()}`;
      cell.textContent = letter;
      ticketHeader.appendChild(cell);
    });
    ticket.appendChild(ticketHeader);

    const ticketGrid = document.createElement('div');
    ticketGrid.className = 'mini-ticket-grid';

    entry.ticketMatrix.flat().forEach((value) => {
      const cell = document.createElement('div');
      cell.className = value === FREE_SPACE ? 'mini-ticket-cell free-space' : 'mini-ticket-cell';
      cell.textContent = value === FREE_SPACE ? 'FREE' : value || '';
      ticketGrid.appendChild(cell);
    });

    ticket.appendChild(ticketGrid);
    container.appendChild(ticket);
  });
}

function toggleNumber(num) {
  const btn = document.getElementById(`select-num-${num}`);
  const wasSelected = selectedNumbers.includes(num);

  if (wasSelected) {
    selectedNumbers = selectedNumbers.filter(n => n !== num);
    btn.classList.remove('selected');
    ticketHistory = ticketHistory.filter(entry => entry.number !== num);
  } else if (selectedNumbers.length < MAX_SELECT) {
    selectedNumbers.push(num);
    btn.classList.add('selected');
    ticketHistory.push({
      number: num,
      ticketMatrix: getMiniTicketForNumber(num),
    });
  } else {
    if (tg.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('warning');
    }
  }

  renderMiniTicketStack();
  updateSelectionUI();
}

function updateSelectionUI() {
  document.getElementById('selected-count').textContent = selectedNumbers.length;
  const joinBtn = document.getElementById('join-btn');
  joinBtn.disabled = selectedNumbers.length < 1 || selectedNumbers.length > MAX_SELECT;
}

// Auto Pick (Quick Pick)
document.getElementById('quick-pick-btn').addEventListener('click', () => {
  clearSelection();
  const nums = [];
  while (nums.length < MAX_SELECT) {
    const r = Math.floor(Math.random() * TOTAL_CARDS) + 1;
    if (!nums.includes(r)) {
      nums.push(r);
    }
  }
  nums.sort((a, b) => a - b);
  nums.forEach(num => {
    selectedNumbers.push(num);
    const btn = document.getElementById(`select-num-${num}`);
    if (btn) btn.classList.add('selected');
    ticketHistory.push({
      number: num,
      ticketMatrix: getMiniTicketForNumber(num),
    });
  });
  renderMiniTicketStack();
  updateSelectionUI();
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('medium');
  }
});

function clearSelection() {
  selectedNumbers = [];
  ticketHistory = [];
  const buttons = document.querySelectorAll('.grid button');
  buttons.forEach(btn => btn.classList.remove('selected'));
  renderMiniTicketStack();
  updateSelectionUI();
}

document.getElementById('refresh-selection').addEventListener('click', () => {
  clearSelection();
});

// WebSocket client logic
let socket = null;
const joinBtn = document.getElementById('join-btn');

joinBtn.addEventListener('click', () => {
  if (selectedNumbers.length < 1 || selectedNumbers.length > MAX_SELECT) return;

  // Balance check at game start
  if (userBalance < stake) {
    if (tg.showAlert) {
      tg.showAlert(`❌ Not enough balance! You need at least ${stake} ETB to play. Please deposit and try again.`);
    } else {
      alert(`❌ Not enough balance! You need at least ${stake} ETB to play. Please deposit and try again.`);
    }
    return;
  }
  
  // Keep nav visible like the game board room layout
  document.querySelector('.nav-bar').style.display = 'flex';

  document.getElementById('selection-page').classList.add('hidden');
  document.getElementById('playing-page').classList.remove('hidden');

  initPlayingGrid();
  initPlayerCard();
  resetBoardRoomUI();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    socket.send(JSON.stringify({
      action: "join",
      initData: tg.initData,
      stake: stake,
      numbers: getPlayNumbersFromSelectedCards()
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

function getBingoLetter(num) {
  for (const range of BINGO_RANGES) {
    if (num >= range.start && num <= range.end) {
      return range.letter.toLowerCase();
    }
  }
  return 'b';
}

function updateBoardStats({ gameId, players, calledCount } = {}) {
  if (typeof gameId !== 'undefined' && gameId !== null) {
    document.getElementById('cartela-count').textContent = String(gameId);
  }
  if (typeof players === 'number') {
    document.getElementById('board-players').textContent = String(players);
    const derash = Math.floor(players * stake * 0.8);
    document.getElementById('board-derash').textContent = `${derash} Birr`;
  }
  document.getElementById('board-stake').textContent = `${stake} Birr`;
  if (typeof calledCount === 'number') {
    document.getElementById('called-count').textContent = String(calledCount);
    document.getElementById('live-progress').textContent = `${calledCount}/75`;
  }
}

function updateBingoActionButton(matchCount) {
  const btn = document.getElementById('bingo-action-btn');
  const target = Math.min(12, myNumbers.length || selectedNumbers.length);
  document.getElementById('match-target').textContent = String(target);

  if (!myNumbers.length && !selectedNumbers.length) {
    btn.textContent = 'NO CARD';
    btn.disabled = true;
    btn.classList.remove('ready');
    return;
  }

  if (matchCount >= target && target > 0) {
    btn.textContent = 'BINGO!';
    btn.disabled = false;
    btn.classList.add('ready');
  } else {
    btn.textContent = `${matchCount}/${target} MATCH`;
    btn.disabled = true;
    btn.classList.remove('ready');
  }
}

function resetBoardRoomUI() {
  updateBoardStats({ gameId: '--', players: 0, calledCount: 0 });
  document.getElementById('match-score').textContent = '0';
  document.getElementById('board-status-text').textContent = 'Waiting for players...';
  const curBall = document.getElementById('current-ball');
  curBall.textContent = '-';
  curBall.className = 'current-call-ball';
  document.getElementById('ball-history-row').innerHTML = '';
  updateBingoActionButton(0);
}

function initPlayingGrid() {
  const grid = document.getElementById('main-grid');
  grid.innerHTML = '';

  // Column-major BINGO board: B(1-15), I(16-30), N(31-45), G(46-60), O(61-75)
  for (let row = 0; row < 15; row++) {
    BINGO_RANGES.forEach(({ letter, start }) => {
      const num = start + row;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = num;
      btn.id = `board-num-${num}`;
      btn.className = `board-cell letter-${letter.toLowerCase()}`;
      btn.disabled = true;
      grid.appendChild(btn);
    });
  }
}

// Format card grid from selected cartela ticket(s)
function initPlayerCard() {
  const grid = document.getElementById('player-cartela');
  grid.innerHTML = '';

  myNumbers = getPlayNumbersFromSelectedCards();
  const matrix = ticketHistory[0]?.ticketMatrix || buildTicketMatrix(myNumbers);

  matrix.flat().forEach((value) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = value === FREE_SPACE ? 'FREE' : (value ?? '');
    btn.id = value === FREE_SPACE ? 'card-num-free' : (value ? `card-num-${value}` : '');
    if (value === FREE_SPACE) {
      btn.classList.add('free-space');
    }
    grid.appendChild(btn);
  });

  document.getElementById('match-target').textContent = String(Math.min(12, myNumbers.length));
  updateBingoActionButton(0);
}

function handleServerMessage(msg) {
  switch (msg.status) {
    case 'joined':
      document.getElementById('cartela-count').textContent = String(msg.gameId);
      document.getElementById('playing-wallet').textContent = `${parseFloat(msg.balance).toFixed(2)} ETB`;
      updateBoardStats({ gameId: msg.gameId, players: 1, calledCount: 0 });
      document.getElementById('lobby-waiting').classList.remove('hidden');
      document.getElementById('lobby-waiting-status').textContent = "Waiting for other players to join...";
      document.getElementById('board-status-text').textContent = 'Waiting for players...';
      break;

    case 'lobby_update':
      const listContainer = document.getElementById('joined-players-list');
      if (listContainer) {
        listContainer.innerHTML = '';
        msg.players.forEach((p, index) => {
          const li = document.createElement('li');
          if (p.userId === myUserId) {
            li.textContent = `Player ${index + 1} (You)`;
            li.style.color = "var(--color-primary)";
          } else {
            li.textContent = `Player ${index + 1}`;
          }
          listContainer.appendChild(li);
        });
      }

      updateBoardStats({ players: msg.players.length });

      const countdownBox = document.getElementById('lobby-countdown-box');
      const lobbyStatusText = document.getElementById('lobby-waiting-status');

      if (msg.isGameRunning) {
        if (lobbyStatusText) lobbyStatusText.textContent = "Current game in progress. Waiting for next round...";
        if (countdownBox) countdownBox.classList.add('hidden');
        document.getElementById('board-status-text').textContent = 'Waiting for next round...';
      } else if (msg.players.length < 2) {
        if (lobbyStatusText) lobbyStatusText.textContent = "Waiting for other players to join...";
        if (countdownBox) countdownBox.classList.add('hidden');
        document.getElementById('board-status-text').textContent = 'Waiting for players...';
      } else if (msg.isCountdownActive) {
        if (countdownBox) countdownBox.classList.remove('hidden');
        document.getElementById('lobby-seconds').textContent = msg.countdown;
        if (lobbyStatusText) lobbyStatusText.textContent = "Players ready! Game starting soon...";
        document.getElementById('board-status-text').textContent = 'Game starting soon...';
      } else {
        if (countdownBox) countdownBox.classList.add('hidden');
      }
      break;

    case 'countdown':
      document.getElementById('lobby-waiting').classList.remove('hidden');
      const cBox = document.getElementById('lobby-countdown-box');
      if (cBox) cBox.classList.remove('hidden');
      document.getElementById('lobby-seconds').textContent = msg.secondsLeft;
      const statusHeading = document.getElementById('lobby-waiting-status');
      if (statusHeading) statusHeading.textContent = "Game starting soon!";
      document.getElementById('board-status-text').textContent = `Starting in ${msg.secondsLeft}s...`;
      if (tg.HapticFeedback && msg.secondsLeft <= 5) {
        tg.HapticFeedback.impactOccurred('light');
      }
      break;

    case 'countdown_stopped':
      const stopBox = document.getElementById('lobby-countdown-box');
      if (stopBox) stopBox.classList.add('hidden');
      const resetStatus = document.getElementById('lobby-waiting-status');
      if (resetStatus) resetStatus.textContent = "Waiting for other players to join...";
      document.getElementById('board-status-text').textContent = 'Waiting for players...';
      break;

    case 'game_start':
      document.getElementById('lobby-waiting').classList.add('hidden');
      document.getElementById('board-status-text').textContent = 'Waiting for the next number...';
      if (msg.players) {
        updateBoardStats({ players: msg.players.length, calledCount: 0 });
      }
      if (tg.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
      }
      break;

    case 'draw':
      const num = msg.number;
      const letter = getBingoLetter(num);
      const curBall = document.getElementById('current-ball');
      curBall.textContent = num;
      curBall.className = `current-call-ball letter-${letter}`;
      curBall.classList.remove('animate');
      void curBall.offsetWidth;
      curBall.classList.add('animate');

      updateBoardStats({ calledCount: msg.calledNumbers.length });

      document.querySelectorAll('.called-board-grid .board-cell.latest').forEach((el) => {
        el.classList.remove('latest');
      });

      const historyRow = document.getElementById('ball-history-row');
      historyRow.innerHTML = '';
      const history = msg.calledNumbers.slice().reverse().slice(0, 3);
      history.forEach(n => {
        const item = document.createElement('div');
        item.className = `ball-history-item letter-${getBingoLetter(n)}`;
        item.textContent = n;
        historyRow.appendChild(item);
      });

      const boardBtn = document.getElementById(`board-num-${num}`);
      if (boardBtn) {
        boardBtn.classList.add('called', 'latest');
      }

      // Mark previously called cells (reconnect / missed frames safety)
      msg.calledNumbers.forEach((n) => {
        const cell = document.getElementById(`board-num-${n}`);
        if (cell) cell.classList.add('called');
      });

      const autoMark = document.getElementById('auto-mark-toggle')?.checked !== false;
      if (autoMark && myNumbers.includes(num)) {
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
      updateBingoActionButton(matchCount);

      const letterLabel = letter.toUpperCase();
      document.getElementById('board-status-text').textContent =
        myNumbers.includes(num)
          ? `${letterLabel}-${num} hit your card!`
          : `Called ${letterLabel}-${num}`;
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

let gameOverReturnTimer = null;
let gameOverCountdownTimer = null;

function clearGameOverReturnTimers() {
  if (gameOverReturnTimer) {
    clearTimeout(gameOverReturnTimer);
    gameOverReturnTimer = null;
  }
  if (gameOverCountdownTimer) {
    clearInterval(gameOverCountdownTimer);
    gameOverCountdownTimer = null;
  }
}

function showGameOver(msg) {
  const overlay = document.getElementById('game-over-overlay');
  overlay.classList.remove('hidden');

  const isWinner = msg.winners && msg.winners.some(w => w.userId === myUserId);
  const title = document.getElementById('game-outcome-title');
  const winnerP = document.getElementById('winner-name-p');
  const payoutP = document.getElementById('payout-amount-p');
  const hint = document.getElementById('auto-return-hint');

  if (msg.outcome === 'draw') {
    title.textContent = "GAME OVER";
    winnerP.textContent = "Outcome: Draw / No Winner";
    payoutP.textContent = "Stakes refunded.";
    if (tg.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('warning');
    }
  } else {
    const winnerNames = (msg.winners || []).map(w => w.username).join(', ');
    if (isWinner) {
      title.textContent = "🏆 BINGO! 🏆";
      title.style.background = "linear-gradient(135deg, var(--color-primary), var(--color-gold-dark))";
      title.style.webkitBackgroundClip = "text";
      winnerP.textContent = `You won!`;
      payoutP.textContent = `+${parseFloat(msg.payout).toFixed(2)} Birr`;
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

  // Auto-return to home/menu 3s after winners are announced
  clearGameOverReturnTimers();
  let secondsLeft = 3;
  if (hint) {
    hint.classList.remove('hidden');
    hint.textContent = `Returning to menu in ${secondsLeft}s…`;
  }
  gameOverCountdownTimer = setInterval(() => {
    secondsLeft -= 1;
    if (hint && secondsLeft > 0) {
      hint.textContent = `Returning to menu in ${secondsLeft}s…`;
    }
  }, 1000);
  gameOverReturnTimer = setTimeout(() => {
    clearGameOverReturnTimers();
    returnToSelection();
  }, 3000);
}

function returnToSelection() {
  clearGameOverReturnTimers();

  if (socket) {
    socket.close();
    socket = null;
  }
  // Re-show navigation bar when returning to selection
  document.querySelector('.nav-bar').style.display = 'flex';

  document.getElementById('playing-page').classList.add('hidden');
  document.getElementById('game-over-overlay').classList.add('hidden');
  document.getElementById('lobby-waiting').classList.remove('hidden');
  
  if (startedWithUrlStake) {
    document.getElementById('selection-page').classList.remove('hidden');
    document.getElementById('welcome-page').classList.add('hidden');
  } else {
    document.getElementById('welcome-page').classList.remove('hidden');
    document.getElementById('selection-page').classList.add('hidden');
  }
  clearSelection();
}

document.getElementById('lobby-return-btn').addEventListener('click', returnToSelection);

const boardBackBtn = document.getElementById('board-back-btn');
if (boardBackBtn) {
  boardBackBtn.addEventListener('click', () => {
    if (tg.showConfirm) {
      tg.showConfirm('Leave this game board?', (confirmed) => {
        if (confirmed) returnToSelection();
      });
    } else if (confirm('Leave this game board?')) {
      returnToSelection();
    }
  });
}

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
    const wMain = document.getElementById('wallet-main-view');
    const wDep = document.getElementById('wallet-deposit-view');
    const wWith = document.getElementById('wallet-withdraw-view');
    if (wMain) wMain.classList.remove('hidden');
    if (wDep) wDep.classList.add('hidden');
    if (wWith) wWith.classList.add('hidden');
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
      userBalance = parseFloat(profile.balance || 0);
      userBonus = parseFloat(profile.bonus || 0);
      
      const balNewEl = document.getElementById('wallet-tab-balance-new');
      if (balNewEl) balNewEl.textContent = formatBirr(userBalance);
      const bonusNewEl = document.getElementById('wallet-tab-bonus-new');
      if (bonusNewEl) bonusNewEl.textContent = formatBirr(userBonus);
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
        card.className = 'transaction-card-new';

        // Left Icon Circle with down chevron icon
        const iconCircle = document.createElement('div');
        iconCircle.className = 'tx-icon-circle';
        iconCircle.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>';

        // Details Column
        const details = document.createElement('div');
        details.className = 'tx-details-new';

        const title = document.createElement('span');
        title.className = 'tx-title-new';
        let displayType = tx.type.replace('_', ' ');
        if (tx.type === 'cashback_bonus') displayType = 'Bonus';
        else if (tx.type === 'withdrawal_request') displayType = 'Withdrawal';
        else if (tx.type === 'withdrawal_refund') displayType = 'Refund';
        title.textContent = displayType;

        const meta = document.createElement('span');
        meta.className = 'tx-meta-new';
        
        // Format Date like: May 18, 10:58 PM
        const options = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
        const dateStr = new Date(tx.timestamp).toLocaleString('en-US', options);
        
        // Determine Status
        let statusText = 'Processed';
        if (tx.description && tx.description.toLowerCase().includes('pending')) {
          statusText = 'Pending';
        } else if (tx.description && tx.description.toLowerCase().includes('rejected')) {
          statusText = 'Rejected';
        }
        meta.textContent = `${dateStr} · ${statusText}`;

        details.appendChild(title);
        details.appendChild(meta);

        // Right Amount Column
        const amount = document.createElement('div');
        const amtVal = parseFloat(tx.amount);
        const isPos = amtVal >= 0;
        amount.className = `tx-amount-new ${isPos ? 'positive' : 'negative'}`;
        amount.textContent = `${isPos ? '+' : ''}${formatBirr(amtVal)} Birr`;

        card.appendChild(iconCircle);
        card.appendChild(details);
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
      document.querySelectorAll('.withdraw-preset-btn').forEach(el => el.classList.remove('active'));
      
      // Update UI balance state
      userBalance = parseFloat(data.newBalance);
      document.getElementById('selection-wallet').textContent = userBalance.toFixed(2);
      document.getElementById('playing-wallet').textContent = userBalance.toFixed(2) + " ETB";
      fetchUserBalance();

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

// Bind welcome page stake buttons
document.querySelectorAll('.welcome-stake-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedStake = parseInt(btn.getAttribute('data-stake'), 10);

    stake = selectedStake;
    document.getElementById('stake-amount').textContent = stake;
    
    // Transition to Selection Page
    document.getElementById('welcome-page').classList.add('hidden');
    document.getElementById('selection-page').classList.remove('hidden');
    
    if (tg.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('medium');
    }
  });
});

// Bind selection page back button
document.getElementById('selection-back-btn').addEventListener('click', () => {
  document.getElementById('selection-page').classList.add('hidden');
  document.getElementById('welcome-page').classList.remove('hidden');
  clearSelection();
  
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }
});

// Determine initial screen visibility based on whether we started with a URL parameter stake
if (startedWithUrlStake) {
  document.getElementById('welcome-page').classList.add('hidden');
  document.getElementById('selection-page').classList.remove('hidden');
} else {
  document.getElementById('welcome-page').classList.remove('hidden');
  document.getElementById('selection-page').classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────
// DEPOSIT MODAL AND PAYMENT PLATFORMS LOGIC
// ─────────────────────────────────────────────────────────────

const paymentDetails = {
  telebirr: {
    title: "Deposit via Telebirr",
    target: "0912345678",
    name: "Bingo Spark Admin",
    type: "Telebirr Mobile Money",
    refLabel: "Transaction ID / Reference Number",
    refPlaceholder: "Enter 10-digit Telebirr Ref (e.g. TX...)"
  },
  cbe: {
    title: "Deposit via CBE Birr",
    target: "1000123456789",
    name: "Bingo Spark Admin",
    type: "CBE Bank Transfer",
    refLabel: "CBE Transaction Reference / FT ID",
    refPlaceholder: "Enter CBE Ref (e.g. FT...)"
  },
  amole: {
    title: "Deposit via Amole",
    target: "0912345678",
    name: "Bingo Spark Admin",
    type: "Amole Mobile Wallet",
    refLabel: "Amole Transaction Reference",
    refPlaceholder: "Enter Amole Ref"
  },
  bank: {
    title: "Deposit via Bank Transfer",
    target: "1000123456789",
    name: "Bingo Spark Admin",
    type: "Bank Transfer",
    refLabel: "Bank Transaction Reference",
    refPlaceholder: "Enter bank transfer ref"
  }
};

let currentPlatform = null;

// Bind payment item clicks
document.querySelectorAll('.payment-item').forEach(item => {
  item.addEventListener('click', () => {
    const platform = item.getAttribute('data-platform');
    const details = paymentDetails[platform];
    if (!details) return;

    currentPlatform = platform;
    document.querySelectorAll('.payment-item').forEach(el => el.classList.toggle('selected', el === item));

    document.getElementById('deposit-target-val').textContent = details.target;
    document.getElementById('deposit-target-name').textContent = details.name;
    document.getElementById('deposit-target-type').textContent = details.type;

    const refLabel = document.getElementById('deposit-ref-label');
    const refInput = document.getElementById('deposit-ref-input');
    refLabel.textContent = details.refLabel;
    refInput.placeholder = details.refPlaceholder;

    document.getElementById('deposit-details-card').classList.add('hidden');
    document.getElementById('deposit-message').classList.add('hidden');
    document.getElementById('deposit-message').textContent = '';

    if (tg.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('medium');
    }
  });
});

// Preset amount buttons for deposit
document.querySelectorAll('.deposit-quick-amounts .preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const amount = btn.getAttribute('data-amount');
    document.getElementById('deposit-amount-input').value = amount;
    document.querySelectorAll('.deposit-quick-amounts .preset-btn').forEach(el => el.classList.toggle('active', el === btn));
  });
});

// Preset amount buttons for withdraw
document.querySelectorAll('.withdraw-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const amount = btn.getAttribute('data-amount');
    document.getElementById('withdraw-amount-input').value = amount;
    document.querySelectorAll('.withdraw-preset-btn').forEach(el => el.classList.toggle('active', el === btn));
    if (tg.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('light');
    }
  });
});

// Copy target to clipboard
document.getElementById('copy-deposit-target-btn').addEventListener('click', async () => {
  const targetText = document.getElementById('deposit-target-val').textContent;
  const btn = document.getElementById('copy-deposit-target-btn');
  try {
    await navigator.clipboard.writeText(targetText);
    btn.textContent = "✅ Copied!";
    setTimeout(() => {
      btn.textContent = "📋 Copy";
    }, 2000);
    if (tg.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('success');
    }
  } catch (err) {
    console.error("Failed to copy:", err);
  }
});

// Submit Deposit Request
document.getElementById('submit-deposit-btn').addEventListener('click', async () => {
  const amountInput = document.getElementById('deposit-amount-input');
  const refInput = document.getElementById('deposit-ref-input');
  const msgBox = document.getElementById('deposit-message');
  
  const amount = parseFloat(amountInput.value);
  let refId = refInput.value.trim();
  
  msgBox.classList.add('hidden');
  msgBox.textContent = '';
  
  if (!currentPlatform) {
    msgBox.textContent = "❌ Select a payment platform first.";
    msgBox.className = "message-box error";
    msgBox.classList.remove('hidden');
    return;
  }

  if (isNaN(amount) || amount < 50) {
    msgBox.textContent = "❌ Minimum deposit amount is 50 ETB.";
    msgBox.className = "message-box error";
    msgBox.classList.remove('hidden');
    return;
  }
  
  if (!refId) {
    refId = `AUTO-${currentPlatform}-${Date.now()}`;
  }
  
  try {
    const initData = tg.initData || "";
    const response = await fetch('/api/request-deposit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        initData: initData,
        amount: amount,
        platform: currentPlatform,
        referenceId: refId
      })
    });
    
    const data = await response.json();
    if (response.ok && data.success) {
      msgBox.textContent = `✅ Request Submitted! Ref ID: #${data.refId}. Balance will update once verified by Admin.`;
      msgBox.className = "message-box success";
      msgBox.classList.remove('hidden');
      
      amountInput.value = '';
      refInput.value = '';
      currentPlatform = null;
      document.querySelectorAll('.payment-item').forEach(el => el.classList.remove('selected'));
      document.getElementById('deposit-details-card').classList.add('hidden');
      
      if (tg.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
      }
    } else {
      msgBox.textContent = `❌ ${data.error || 'Submission failed.'}`;
      msgBox.className = "message-box error";
      msgBox.classList.remove('hidden');
    }
  } catch (err) {
    console.error("Error submitting deposit:", err);
    msgBox.textContent = "❌ Network error. Please try again.";
    msgBox.className = "message-box error";
    msgBox.classList.remove('hidden');
  }
});

// Sub-view transition buttons
document.getElementById('wallet-goto-deposit-btn').addEventListener('click', () => {
  document.getElementById('wallet-main-view').classList.add('hidden');
  document.getElementById('wallet-deposit-view').classList.remove('hidden');
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('medium');
  }
});

document.getElementById('wallet-goto-withdraw-btn').addEventListener('click', () => {
  document.getElementById('wallet-main-view').classList.add('hidden');
  document.getElementById('wallet-withdraw-view').classList.remove('hidden');
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('medium');
  }
});

// Sub-view back buttons
document.getElementById('deposit-back-btn').addEventListener('click', () => {
  document.getElementById('wallet-deposit-view').classList.add('hidden');
  document.getElementById('wallet-main-view').classList.remove('hidden');
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }
});

document.getElementById('withdraw-back-btn').addEventListener('click', () => {
  document.getElementById('wallet-withdraw-view').classList.add('hidden');
  document.getElementById('wallet-main-view').classList.remove('hidden');
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }
});

// Initial loading
fetchUserBalance();
initSelectionGrid();
