import { generatePuzzle, difficultyBand } from './puzzle.js';

const EMPTY = 0;
const MARKED = 1;
const BUNNY = 2;
const STATE_NAMES = ['empty', 'marked', 'bunny'];
const STORAGE_KEY = 'lesleydoku.v2';
const PACK_URL = 'data/levels.json';

const el = {
  board: document.getElementById('board'),
  boardWrap: document.querySelector('.board-wrap'),
  levelNumber: document.getElementById('level-number'),
  boardSize: document.getElementById('board-size'),
  pips: document.getElementById('pips'),
  clock: document.getElementById('clock'),
  hint: document.getElementById('hint'),
  win: document.getElementById('win'),
  winTitle: document.getElementById('win-title'),
  winSub: document.getElementById('win-sub'),
  nextBtn: document.getElementById('next-btn'),
  undoBtn: document.getElementById('undo-btn'),
  clearBtn: document.getElementById('clear-btn'),
  rulesBtn: document.getElementById('rules-btn'),
  rules: document.getElementById('rules'),
  rulesClose: document.getElementById('rules-close'),
  loading: document.getElementById('loading'),
};

const game = {
  level: 1,
  puzzle: null,
  states: [],
  history: [],
  cells: [],
  solved: false,
  elapsed: 0,
  tickFrom: 0,
  floor: 0,
};

let pack = null;

// --- board geometry -------------------------------------------------------

function cellUnits(puzzle, index) {
  return {
    row: (index / puzzle.size) | 0,
    col: index % puzzle.size,
    region: puzzle.regions[index],
  };
}

function touching(size, index) {
  const r = (index / size) | 0;
  const c = index % size;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) out.push(nr * size + nc);
    }
  }
  return out;
}

// --- rendering ------------------------------------------------------------

function buildBoard() {
  const { size, regions } = game.puzzle;
  el.board.style.setProperty('--cells', size);
  el.board.innerHTML = '';
  game.cells = [];

  for (let i = 0; i < size * size; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.dataset.index = String(i);
    cell.dataset.state = 'empty';
    cell.style.setProperty('--cell', `var(--r${regions[i] + 1})`);
    cell.setAttribute('role', 'gridcell');

    const row = (i / size) | 0;
    const col = i % size;
    if (row > 0 && regions[i - size] !== regions[i]) cell.classList.add('edge-t');
    if (col > 0 && regions[i - 1] !== regions[i]) cell.classList.add('edge-l');

    cell.innerHTML =
      '<span class="mark"></span>' +
      '<svg class="glyph" aria-hidden="true"><use href="#bunny"></use></svg>';

    el.board.appendChild(cell);
    game.cells.push(cell);
  }

  sizeBoard();
}

const BAND_NAMES = ['Gentle', 'Easy', 'Steady', 'Tricky', 'Tough'];

// Five pips next to the level number, so the climb is visible and not just
// felt. The band comes from the puzzle's own rating, never from the level.
function renderDifficulty() {
  const band = game.puzzle.band || difficultyBand(game.puzzle.rating || 0);
  el.pips.innerHTML = '';
  for (let i = 1; i <= BAND_NAMES.length; i++) {
    const pip = document.createElement('span');
    pip.className = i <= band ? 'pip on' : 'pip';
    el.pips.appendChild(pip);
  }
  el.pips.setAttribute('aria-label', `Difficulty: ${BAND_NAMES[band - 1]}`);
  el.pips.title = BAND_NAMES[band - 1];
}

function sizeBoard() {
  const wrap = el.boardWrap;
  const available = Math.min(wrap.clientWidth, wrap.clientHeight, 520);
  if (available > 0) el.board.style.setProperty('--board-size', `${Math.floor(available)}px`);
}

// The wrapper only has its final height once the surrounding layout settles.
new ResizeObserver(sizeBoard).observe(el.boardWrap);

function paint() {
  const { size } = game.puzzle;
  const conflicts = findConflicts();

  for (let i = 0; i < game.states.length; i++) {
    const cell = game.cells[i];
    cell.dataset.state = STATE_NAMES[game.states[i]];
    cell.classList.toggle('conflict', conflicts.has(i));
    cell.setAttribute(
      'aria-label',
      `Row ${((i / size) | 0) + 1}, column ${(i % size) + 1}: ${STATE_NAMES[game.states[i]]}`
    );
  }

  el.undoBtn.disabled = game.history.length === 0;
  el.clearBtn.disabled = game.states.every((s) => s === EMPTY);

  const placed = game.states.filter((s) => s === BUNNY).length;
  if (conflicts.size > 0) {
    el.hint.textContent = 'Those bunnies clash — same line, same patch, or touching.';
  } else if (placed === 0) {
    el.hint.textContent = 'Tap once to rule a cell out, twice to place a bunny.';
  } else {
    el.hint.textContent = `${placed} of ${size} bunnies placed.`;
  }
}

// --- rules checking -------------------------------------------------------

function findConflicts() {
  const { size } = game.puzzle;
  const bunnies = [];
  for (let i = 0; i < game.states.length; i++) if (game.states[i] === BUNNY) bunnies.push(i);

  const bad = new Set();
  for (let a = 0; a < bunnies.length; a++) {
    for (let b = a + 1; b < bunnies.length; b++) {
      const x = cellUnits(game.puzzle, bunnies[a]);
      const y = cellUnits(game.puzzle, bunnies[b]);
      const clash =
        x.row === y.row ||
        x.col === y.col ||
        x.region === y.region ||
        touching(size, bunnies[a]).includes(bunnies[b]);
      if (clash) {
        bad.add(bunnies[a]);
        bad.add(bunnies[b]);
      }
    }
  }
  return bad;
}

function isSolved() {
  const { size } = game.puzzle;
  const placed = game.states.filter((s) => s === BUNNY).length;
  return placed === size && findConflicts().size === 0;
}

// --- interaction ----------------------------------------------------------

let dragging = null;

function applyChange(index, next, group) {
  if (game.states[index] === next) return;
  group.push({ index, from: game.states[index] });
  game.states[index] = next;
}

function cellFromPoint(x, y) {
  const node = document.elementFromPoint(x, y);
  const cell = node && node.closest ? node.closest('.cell') : null;
  return cell && el.board.contains(cell) ? Number(cell.dataset.index) : null;
}

function onPointerDown(event) {
  if (game.solved) return;
  const index = cellFromPoint(event.clientX, event.clientY);
  if (index === null) return;

  event.preventDefault();
  const group = [];
  const current = game.states[index];
  const next = current === EMPTY ? MARKED : current === MARKED ? BUNNY : EMPTY;
  applyChange(index, next, group);
  game.history.push(group);

  // Dragging on from an empty cell rules out a whole run in one gesture.
  dragging = { group, painting: current === EMPTY, last: index };
  el.board.setPointerCapture?.(event.pointerId);

  paint();
  save();
  checkWin();
}

function onPointerMove(event) {
  if (!dragging || !dragging.painting) return;
  const index = cellFromPoint(event.clientX, event.clientY);
  if (index === null || index === dragging.last) return;
  dragging.last = index;
  if (game.states[index] !== EMPTY) return;
  applyChange(index, MARKED, dragging.group);
  paint();
  save();
}

function onPointerUp() {
  dragging = null;
}

function checkWin() {
  if (game.solved || !isSolved()) return;
  game.solved = true;
  stopClock();
  el.board.classList.add('solved');
  el.win.hidden = false;
  el.winTitle.textContent = `Level ${game.level} cleared`;
  el.winSub.textContent = `${game.puzzle.size} × ${game.puzzle.size} in ${formatTime(game.elapsed)}.`;
  el.board.style.opacity = '0.35';
  navigator.vibrate?.(30);
  save();
}

function undo() {
  const group = game.history.pop();
  if (!group) return;
  for (const change of group.slice().reverse()) game.states[change.index] = change.from;
  paint();
  save();
}

function clearBoard() {
  const group = [];
  for (let i = 0; i < game.states.length; i++) applyChange(i, EMPTY, group);
  if (group.length) game.history.push(group);
  paint();
  save();
}

// --- clock ----------------------------------------------------------------

let clockTimer = null;

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function startClock() {
  stopClock();
  game.tickFrom = Date.now();
  clockTimer = setInterval(() => {
    const now = Date.now();
    game.elapsed += now - game.tickFrom;
    game.tickFrom = now;
    el.clock.textContent = formatTime(game.elapsed);
    save();
  }, 1000);
}

function stopClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  el.clock.textContent = formatTime(game.elapsed);
}

// --- persistence ----------------------------------------------------------

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        level: game.level,
        puzzle: game.puzzle,
        states: game.states.join(''),
        elapsed: game.elapsed,
        solved: game.solved,
        floor: game.floor,
      })
    );
  } catch (err) {
    /* private mode or full storage: play on without saving */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

// --- puzzle supply --------------------------------------------------------

async function loadPack() {
  if (pack) return pack;
  try {
    const response = await fetch(PACK_URL, { cache: 'force-cache' });
    pack = await response.json();
  } catch (err) {
    pack = { levels: [] };
  }
  return pack;
}

async function puzzleForLevel(level) {
  const data = await loadPack();
  const entry = data.levels.find((item) => item.l === level);
  if (entry) {
    return {
      level,
      size: entry.n,
      regions: entry.r.split('').map(Number),
      solution: entry.s,
      rating: entry.d,
      band: entry.b,
    };
  }

  el.loading.hidden = false;
  el.loading.textContent = 'Building a puzzle…';
  await new Promise((resolve) => setTimeout(resolve, 30));
  const made = generatePuzzle(level, { floor: game.floor || 0 });
  el.loading.hidden = true;
  made.band = difficultyBand(made.rating);
  return made;
}

async function startLevel(level) {
  game.level = level;
  game.puzzle = await puzzleForLevel(level);
  game.floor = Math.max(game.floor || 0, game.puzzle.rating || 0);
  game.states = new Array(game.puzzle.size * game.puzzle.size).fill(EMPTY);
  game.history = [];
  game.solved = false;
  game.elapsed = 0;

  el.levelNumber.textContent = String(level);
  el.boardSize.textContent = `${game.puzzle.size} × ${game.puzzle.size}`;
  renderDifficulty();
  el.win.hidden = true;
  el.board.classList.remove('solved');
  el.board.style.opacity = '1';

  buildBoard();
  paint();
  startClock();
  save();
}

function restore(saved) {
  game.level = saved.level;
  game.puzzle = saved.puzzle;
  game.states = saved.states.split('').map(Number);
  game.history = [];
  game.solved = Boolean(saved.solved);
  game.elapsed = saved.elapsed || 0;
  game.floor = saved.floor || game.puzzle.rating || 0;

  el.levelNumber.textContent = String(game.level);
  el.boardSize.textContent = `${game.puzzle.size} × ${game.puzzle.size}`;
  renderDifficulty();
  buildBoard();
  paint();

  if (game.solved) {
    el.board.style.opacity = '0.35';
    el.win.hidden = false;
    el.winTitle.textContent = `Level ${game.level} cleared`;
    el.winSub.textContent = `${game.puzzle.size} × ${game.puzzle.size} in ${formatTime(game.elapsed)}.`;
    stopClock();
  } else {
    startClock();
  }
}

// --- wiring ---------------------------------------------------------------

el.board.addEventListener('pointerdown', onPointerDown);
el.board.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);
el.board.addEventListener('contextmenu', (e) => e.preventDefault());

el.undoBtn.addEventListener('click', undo);
el.clearBtn.addEventListener('click', clearBoard);
el.nextBtn.addEventListener('click', () => startLevel(game.level + 1));
el.rulesBtn.addEventListener('click', () => (el.rules.hidden = false));
el.rulesClose.addEventListener('click', () => (el.rules.hidden = true));
el.rules.addEventListener('click', (e) => {
  if (e.target === el.rules) el.rules.hidden = true;
});

window.addEventListener('resize', sizeBoard);
window.addEventListener('orientationchange', () => setTimeout(sizeBoard, 150));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (clockTimer) {
      game.elapsed += Date.now() - game.tickFrom;
      stopClock();
    }
  } else if (!game.solved && game.puzzle) {
    startClock();
  }
});

const saved = load();
if (saved && saved.puzzle && saved.states) restore(saved);
else startLevel(1);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
