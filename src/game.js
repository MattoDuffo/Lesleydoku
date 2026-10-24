import { generatePuzzle, difficultyBand, nextDeduction } from './puzzle.js';

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
  hintBtn: document.getElementById('hint-btn'),
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
  hintsUsed: 0,
};

// A hint is revealed in three presses: where to look, why, then play it.
const hint = { stage: 0, deduction: null, mistake: null };

function clearHint() {
  hint.stage = 0;
  hint.deduction = null;
  hint.mistake = null;
}

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

  const lit = new Set(hint.deduction && hint.stage >= 1 ? hint.deduction.unitCells : []);
  const ringed = new Set(hintTargets());
  el.board.classList.toggle('hinting', lit.size > 0);

  for (let i = 0; i < game.states.length; i++) {
    const cell = game.cells[i];
    cell.dataset.state = STATE_NAMES[game.states[i]];
    cell.classList.toggle('conflict', conflicts.has(i));
    cell.classList.toggle('hint-unit', lit.has(i));
    cell.classList.toggle('hint-target', ringed.has(i));
    cell.setAttribute(
      'aria-label',
      `Row ${((i / size) | 0) + 1}, column ${(i % size) + 1}: ${STATE_NAMES[game.states[i]]}`
    );
  }

  el.undoBtn.disabled = game.history.length === 0;
  el.clearBtn.disabled = game.states.every((s) => s === EMPTY);
  el.hintBtn.disabled = game.solved;
  el.hintBtn.textContent = hintLabel();

  const placed = game.states.filter((s) => s === BUNNY).length;
  const message = hintMessage();
  el.hint.classList.toggle('live', Boolean(message));
  if (message) {
    el.hint.textContent = message;
  } else if (conflicts.size > 0) {
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

// --- hints ----------------------------------------------------------------
//
// A hint never just hands over an answer. First press lights up the row,
// column or patch that yields the next move; second explains the reasoning;
// third plays it. If the board has gone wrong, that is said instead, because
// no deduction from a false premise is worth showing.

const ENGINE_UNKNOWN = 0;
const ENGINE_BUNNY = 1;
const ENGINE_BLOCKED = 2;

function engineState() {
  const out = new Int8Array(game.states.length);
  for (let i = 0; i < game.states.length; i++) {
    out[i] = game.states[i] === BUNNY ? ENGINE_BUNNY
      : game.states[i] === MARKED ? ENGINE_BLOCKED
      : ENGINE_UNKNOWN;
  }
  return out;
}

function unitName(index, near = true) {
  const { size } = game.puzzle;
  if (index < size) return `row ${index + 1}`;
  if (index < 2 * size) return `column ${index - size + 1}`;
  return near ? 'this patch' : 'that patch';
}

// Anything the player has done that the one true solution rules out.
function findMistake() {
  const { size, solution } = game.puzzle;
  if (!solution) return null;
  const answer = new Set(solution.map((col, row) => row * size + col));

  const wrongBunnies = [];
  const wrongMarks = [];
  for (let i = 0; i < game.states.length; i++) {
    if (game.states[i] === BUNNY && !answer.has(i)) wrongBunnies.push(i);
    if (game.states[i] === MARKED && answer.has(i)) wrongMarks.push(i);
  }

  if (wrongBunnies.length) return { kind: 'bunny', cells: wrongBunnies };
  if (wrongMarks.length) return { kind: 'ruled-out', cells: wrongMarks };
  return null;
}

function hintTargets() {
  if (hint.mistake) return hint.stage >= 2 ? hint.mistake.cells : [];
  if (!hint.deduction || hint.stage < 2) return [];
  const { place, clear } = hint.deduction;
  return place !== undefined ? [place] : clear;
}

function hintLabel() {
  if (hint.mistake) return hint.stage >= 2 ? 'Hint' : 'Show me';
  if (hint.stage === 1) return 'Why?';
  if (hint.stage >= 2) return 'Play it';
  return 'Hint';
}

function hintMessage() {
  if (hint.mistake) {
    const many = hint.mistake.cells.length > 1;
    if (hint.mistake.kind === 'bunny') {
      return hint.stage >= 2
        ? `The ringed ${many ? 'bunnies cannot' : 'bunny cannot'} be right — clear ${many ? 'them' : 'it'} and carry on.`
        : `${many ? 'Some bunnies are' : 'A bunny is'} in the wrong place, so nothing else here will add up.`;
    }
    return hint.stage >= 2
      ? `${many ? 'Those ringed squares hold' : 'That ringed square holds'} a bunny — clear the mark.`
      : `${many ? 'Some squares you have ruled out hold' : 'A square you have ruled out holds'} a bunny.`;
  }

  if (!hint.deduction) return '';
  const { technique, unit, confinedTo, place } = hint.deduction;
  const here = unitName(unit);

  if (hint.stage === 1) return `Have another look at ${here}.`;

  if (place !== undefined) {
    return `Only one square is left in ${here} — the bunny goes there.`;
  }
  if (technique === 2 && confinedTo !== undefined) {
    const there = unitName(confinedTo, false);
    return `Every square still free in ${here} also sits in ${there}, so the rest of ${there} is clear.`;
  }
  return `Wherever ${here} puts its bunny, the ringed squares are ruled out.`;
}

function onHint() {
  if (game.solved) return;

  if (hint.stage === 0) {
    hint.mistake = findMistake();
    hint.deduction = hint.mistake
      ? null
      : nextDeduction(game.puzzle.size, game.puzzle.regions, engineState());
    if (!hint.mistake && !hint.deduction) {
      el.hint.textContent = 'Nothing left to work out — place the last bunnies.';
      return;
    }
    hint.stage = 1;
    paint();
    return;
  }

  if (hint.mistake) {
    if (hint.stage === 1) hint.stage = 2;
    else clearHint();
    paint();
    return;
  }

  if (hint.stage === 1) {
    hint.stage = 2;
    paint();
    return;
  }

  // Third press: play the move, as an ordinary undoable change.
  const { place, clear } = hint.deduction;
  const group = [];
  if (place !== undefined) applyChange(place, BUNNY, group);
  else for (const cell of clear) applyChange(cell, MARKED, group);
  if (group.length) game.history.push(group);

  game.hintsUsed++;
  clearHint();
  paint();
  save();
  checkWin();
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
  clearHint();

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

function winSummary() {
  const board = `${game.puzzle.size} × ${game.puzzle.size}`;
  const time = formatTime(game.elapsed);
  if (game.hintsUsed === 0) return `${board} in ${time}, no hints.`;
  return `${board} in ${time}, with ${game.hintsUsed} hint${game.hintsUsed === 1 ? '' : 's'}.`;
}

function checkWin() {
  if (game.solved || !isSolved()) return;
  game.solved = true;
  stopClock();
  el.board.classList.add('solved');
  el.win.hidden = false;
  el.winTitle.textContent = `Level ${game.level} cleared`;
  el.winSub.textContent = winSummary();
  el.board.style.opacity = '0.35';
  navigator.vibrate?.(30);
  save();
}

function undo() {
  clearHint();
  const group = game.history.pop();
  if (!group) return;
  for (const change of group.slice().reverse()) game.states[change.index] = change.from;
  paint();
  save();
}

function clearBoard() {
  clearHint();
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
        hintsUsed: game.hintsUsed,
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
  game.hintsUsed = 0;
  clearHint();

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
  game.hintsUsed = saved.hintsUsed || 0;
  clearHint();

  el.levelNumber.textContent = String(game.level);
  el.boardSize.textContent = `${game.puzzle.size} × ${game.puzzle.size}`;
  renderDifficulty();
  buildBoard();
  paint();

  if (game.solved) {
    el.board.style.opacity = '0.35';
    el.win.hidden = false;
    el.winTitle.textContent = `Level ${game.level} cleared`;
    el.winSub.textContent = winSummary();
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
el.hintBtn.addEventListener('click', onHint);
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
