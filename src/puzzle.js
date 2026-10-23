// Puzzle engine: generation, logical solving and difficulty rating.
//
// Rules: place one bunny in every row, every column and every colour region.
// No two bunnies may touch, not even diagonally. Every puzzle generated here
// is solvable by logic alone (no guessing) and has exactly one solution.

const UNKNOWN = 0;
const BUNNY = 1;
const BLOCKED = 2;

export { UNKNOWN, BUNNY, BLOCKED };

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// One bunny per row/column with no two in adjacent columns on adjacent rows.
function randomSolution(size, rand) {
  const cols = new Array(size).fill(-1);
  const used = new Array(size).fill(false);

  function place(row) {
    if (row === size) return true;
    const order = shuffle([...Array(size).keys()], rand);
    for (const c of order) {
      if (used[c]) continue;
      if (row > 0 && Math.abs(cols[row - 1] - c) < 2) continue;
      cols[row] = c;
      used[c] = true;
      if (place(row + 1)) return true;
      used[c] = false;
      cols[row] = -1;
    }
    return false;
  }

  return place(0) ? cols : null;
}

// Grow one region per bunny until every cell is claimed.
// `irregularity` biases growth away from size balance, giving jagged regions.
function growRegions(size, solution, rand, irregularity) {
  const n = size * size;
  const regions = new Int8Array(n).fill(-1);
  const frontiers = [];
  const counts = new Array(size).fill(1);

  const idx = (r, c) => r * size + c;
  const neighbours = (cell) => {
    const r = (cell / size) | 0;
    const c = cell % size;
    const out = [];
    if (r > 0) out.push(cell - size);
    if (r < size - 1) out.push(cell + size);
    if (c > 0) out.push(cell - 1);
    if (c < size - 1) out.push(cell + 1);
    return out;
  };

  for (let r = 0; r < size; r++) {
    const seed = idx(r, solution[r]);
    regions[seed] = r;
    frontiers.push(new Set(neighbours(seed)));
  }

  let remaining = n - size;
  while (remaining > 0) {
    const live = [];
    for (let i = 0; i < size; i++) {
      for (const cell of frontiers[i]) {
        if (regions[cell] !== -1) frontiers[i].delete(cell);
      }
      if (frontiers[i].size > 0) live.push(i);
    }
    if (live.length === 0) return null;

    let pick;
    if (rand() < irregularity) {
      pick = live[Math.floor(rand() * live.length)];
    } else {
      pick = live[0];
      for (const i of live) if (counts[i] < counts[pick]) pick = i;
    }

    const options = [...frontiers[pick]];
    const cell = options[Math.floor(rand() * options.length)];
    regions[cell] = pick;
    counts[pick]++;
    remaining--;
    for (const nb of neighbours(cell)) {
      if (regions[nb] === -1) frontiers[pick].add(nb);
    }
    frontiers[pick].delete(cell);
  }

  return regions;
}

// Units are the three constraint families: rows, columns, regions.
function buildUnits(size, regions) {
  const units = [];
  for (let r = 0; r < size; r++) {
    const cells = [];
    for (let c = 0; c < size; c++) cells.push(r * size + c);
    units.push(cells);
  }
  for (let c = 0; c < size; c++) {
    const cells = [];
    for (let r = 0; r < size; r++) cells.push(r * size + c);
    units.push(cells);
  }
  for (let g = 0; g < size; g++) units.push([]);
  for (let i = 0; i < regions.length; i++) units[2 * size + regions[i]].push(i);
  return units;
}

function unitsOfCell(size, regions) {
  const map = [];
  for (let i = 0; i < size * size; i++) {
    map.push([(i / size) | 0, size + (i % size), 2 * size + regions[i]]);
  }
  return map;
}

function touching(size, cell) {
  const r = (cell / size) | 0;
  const c = cell % size;
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

// ---------------------------------------------------------------------------
// Solving and difficulty rating
//
// Difficulty is modelled as the scanning work a player does. On each round the
// solver finds every deduction available at the easiest technique that works,
// and charges for the hunt: there are 3N units to look through, a harder
// technique costs more to check per unit, and the more units happen to be
// productive at that moment the sooner one is spotted.
//
//   T1 "only square left" - a row, column or patch with one candidate left.
//   T2 "confinement"      - every candidate of a unit sits inside one other
//                           unit, so that unit's other cells are clear.
//   T3 "every placement"  - a cell ruled out by every possible placement of
//                           some unit, wherever that bunny ends up.
//
// The resulting number is comparable across board sizes, which is what lets
// the level ladder keep climbing when the board grows.
// ---------------------------------------------------------------------------

const SCAN_COST = { 1: 1, 2: 3, 3: 9 };

export function analyse(size, regions, maxTechnique = 3) {
  const units = buildUnits(size, regions);
  const cellUnits = unitsOfCell(size, regions);
  const touches = [];
  for (let i = 0; i < size * size; i++) touches.push(touching(size, i));

  const state = new Int8Array(size * size).fill(UNKNOWN);
  const hasBunny = new Array(units.length).fill(false);
  let placed = 0;
  let rating = 0;
  let rounds = 0;
  let hardest = 0;
  let contradiction = false;

  function block(cell) {
    if (state[cell] !== UNKNOWN) return false;
    state[cell] = BLOCKED;
    return true;
  }

  function placeBunny(cell) {
    if (state[cell] === BLOCKED) {
      contradiction = true;
      return;
    }
    if (state[cell] === BUNNY) return;
    state[cell] = BUNNY;
    placed++;
    for (const u of cellUnits[cell]) {
      hasBunny[u] = true;
      for (const other of units[u]) if (other !== cell) block(other);
    }
    for (const nb of touches[cell]) block(nb);
  }

  // Does a bunny on `from` rule out `target`?
  function attacks(from, target) {
    if (from === target) return true;
    const a = cellUnits[from];
    const b = cellUnits[target];
    if (a[0] === b[0] || a[1] === b[1] || a[2] === b[2]) return true;
    return touches[from].includes(target);
  }

  function openUnits() {
    const out = [];
    for (let u = 0; u < units.length; u++) {
      if (hasBunny[u]) continue;
      out.push([u, units[u].filter((c) => state[c] === UNKNOWN)]);
    }
    return out;
  }

  // Each deduction is keyed by the unit that justifies it, because that is
  // what a player scans: "is this row/column/patch telling me anything?"
  function deductionsAt(technique, open) {
    const found = [];
    for (const [u, candidates] of open) {
      if (candidates.length === 0) {
        contradiction = true;
        return [];
      }
      if (technique === 1) {
        if (candidates.length === 1) found.push({ place: candidates[0] });
        continue;
      }
      if (technique === 2) {
        const clear = new Set();
        for (let slot = 0; slot < 3; slot++) {
          const target = cellUnits[candidates[0]][slot];
          if (target === u) continue;
          if (!candidates.every((c) => cellUnits[c][slot] === target)) continue;
          for (const cell of units[target]) {
            if (state[cell] === UNKNOWN && !candidates.includes(cell)) clear.add(cell);
          }
        }
        if (clear.size > 0) found.push({ clear: [...clear] });
        continue;
      }
      const clear = [];
      for (let cell = 0; cell < state.length; cell++) {
        if (state[cell] !== UNKNOWN || candidates.includes(cell)) continue;
        if (candidates.every((c) => attacks(c, cell))) clear.push(cell);
      }
      if (clear.length > 0) found.push({ clear });
    }
    return found;
  }

  while (placed < size && !contradiction) {
    const open = openUnits();
    let technique = 0;
    let deductions = [];

    for (let t = 1; t <= maxTechnique; t++) {
      deductions = deductionsAt(t, open);
      if (contradiction) break;
      if (deductions.length > 0) {
        technique = t;
        break;
      }
    }
    if (contradiction || technique === 0) break;

    // The hunt: 3N units to check, dearer per unit for a harder technique,
    // divided by however many of them are currently productive.
    rating += (3 * size * SCAN_COST[technique]) / deductions.length;
    rounds++;
    hardest = Math.max(hardest, technique);

    for (const deduction of deductions) {
      if (deduction.place !== undefined) placeBunny(deduction.place);
      else for (const cell of deduction.clear) block(cell);
    }
  }

  let resolved = 0;
  for (const s of state) if (s !== UNKNOWN) resolved++;

  return {
    solved: !contradiction && placed === size,
    resolved,
    rating: Math.round(rating),
    rounds,
    hardest,
    state,
  };
}

// Exhaustive count (capped at 2) used to confirm uniqueness.
export function countSolutions(size, regions, limit = 2) {
  const cols = new Array(size).fill(-1);
  const usedCol = new Array(size).fill(false);
  const usedRegion = new Array(size).fill(false);
  let found = 0;

  function recurse(row) {
    if (found >= limit) return;
    if (row === size) {
      found++;
      return;
    }
    for (let c = 0; c < size; c++) {
      if (usedCol[c]) continue;
      if (row > 0 && Math.abs(cols[row - 1] - c) < 2) continue;
      const g = regions[row * size + c];
      if (usedRegion[g]) continue;
      cols[row] = c;
      usedCol[c] = true;
      usedRegion[g] = true;
      recurse(row + 1);
      usedCol[c] = false;
      usedRegion[g] = false;
      cols[row] = -1;
    }
  }

  recurse(0);
  return found;
}

// ---------------------------------------------------------------------------
// Generation
//
// Random region layouts are almost never solvable by logic, so the shapes are
// hill-climbed in two phases: first nudge cells between neighbouring regions
// until the board falls out by deduction alone, then keep nudging to steer the
// rating towards the one the level ladder asked for. Shaping a puzzle to a
// target beats generating at random and hoping, which is what made the old
// ladder lurch between trivial and brutal.
// ---------------------------------------------------------------------------

function orthogonal(size, cell) {
  const r = (cell / size) | 0;
  const c = cell % size;
  const out = [];
  if (r > 0) out.push(cell - size);
  if (r < size - 1) out.push(cell + size);
  if (c > 0) out.push(cell - 1);
  if (c < size - 1) out.push(cell + 1);
  return out;
}

// Would region `region` stay in one piece if `drop` left it?
function staysConnected(size, regions, region, drop, seed) {
  const seen = new Set([seed]);
  const stack = [seed];
  while (stack.length) {
    for (const nb of orthogonal(size, stack.pop())) {
      if (regions[nb] !== region || nb === drop || seen.has(nb)) continue;
      seen.add(nb);
      stack.push(nb);
    }
  }
  let total = 0;
  for (let i = 0; i < regions.length; i++) {
    if (regions[i] === region && i !== drop) total++;
  }
  return seen.size === total;
}

// One random nudge of a cell into a neighbouring region. Returns an undo, or
// null if no legal nudge was available at that cell.
function nudge(size, regions, seeds, rand) {
  const cell = Math.floor(rand() * regions.length);
  const from = regions[cell];
  if (seeds[from] === cell) return null;

  const options = orthogonal(size, cell).filter((nb) => regions[nb] !== from);
  if (options.length === 0) return null;
  if (!staysConnected(size, regions, from, cell, seeds[from])) return null;

  regions[cell] = regions[options[Math.floor(rand() * options.length)]];
  return () => {
    regions[cell] = from;
  };
}

// Builds one puzzle of `size` aimed at `target` difficulty. Returns null when
// this starting layout could not be made solvable; callers simply try again.
export function shapePuzzle(size, target, rand = Math.random, irregularity = 0.6, iterations = 0) {
  iterations = iterations || 300 * size;
  const solution = randomSolution(size, rand);
  if (!solution) return null;
  const seeds = solution.map((c, r) => r * size + c);
  const grown = growRegions(size, solution, rand, irregularity);
  if (!grown) return null;

  const regions = Array.from(grown);

  // Phase one: make it solvable without guessing.
  let current = analyse(size, regions);
  for (let i = 0; i < iterations && !current.solved; i++) {
    const undo = nudge(size, regions, seeds, rand);
    if (!undo) continue;
    const next = analyse(size, regions);
    if (next.resolved >= current.resolved) current = next;
    else undo();
  }
  if (!current.solved) return null;

  // Phase two: steer the rating towards the target.
  let distance = Math.abs(current.rating - target);
  for (let i = 0; i < iterations && distance > 0; i++) {
    const undo = nudge(size, regions, seeds, rand);
    if (!undo) continue;
    const next = analyse(size, regions);
    const nextDistance = Math.abs(next.rating - target);
    if (next.solved && nextDistance <= distance) {
      current = next;
      distance = nextDistance;
    } else {
      undo();
    }
  }

  if (countSolutions(size, regions) !== 1) return null;

  return {
    size,
    regions,
    solution,
    rating: current.rating,
    rounds: current.rounds,
    hardest: current.hardest,
  };
}

// ---------------------------------------------------------------------------
// The level ladder
//
// Difficulty has to climb without ever dipping, so the ladder is one rising
// rating curve rather than a set of per-level rules. The board grows in
// blocks, and inside each block the target rating climbs geometrically, so
// equal-sized steps feel equal. Each block starts above where the last one
// ended, which means a bigger board never arrives as a breather.
// ---------------------------------------------------------------------------
const BLOCKS = [
  { size: 5, levels: 6, from: 12, to: 55 },
  { size: 6, levels: 8, from: 60, to: 130 },
  { size: 7, levels: 10, from: 140, to: 260 },
  { size: 8, levels: 12, from: 270, to: 430 },
  { size: 9, levels: 12, from: 440, to: 640 },
  { size: 10, levels: 12, from: 660, to: 950 },
];

export const LADDER_LENGTH = BLOCKS.reduce((sum, block) => sum + block.levels, 0);

export function levelSpec(level) {
  let first = 1;
  for (const block of BLOCKS) {
    if (level < first + block.levels) {
      const steps = block.levels - 1;
      const progress = steps === 0 ? 0 : (level - first) / steps;
      const rating = Math.round(block.from * (block.to / block.from) ** progress);
      return { size: block.size, rating, irregularity: 0.6 };
    }
    first += block.levels;
  }

  // Past the ladder the board stays at its largest and the climb continues,
  // easing off so it stays solvable rather than becoming a slog.
  const last = BLOCKS[BLOCKS.length - 1];
  const beyond = level - LADDER_LENGTH;
  return {
    size: last.size,
    rating: Math.min(Math.round(last.to * 1.03 ** beyond), 1400),
    irregularity: 0.6,
  };
}

// Five bands, for the difficulty pips shown on the board.
export function difficultyBand(rating) {
  if (rating < 105) return 1;
  if (rating < 262) return 2;
  if (rating < 432) return 3;
  if (rating < 642) return 4;
  return 5;
}

export function generatePuzzle(level, options = {}) {
  const { rand = Math.random, budgetMs = 2500, floor = 0 } = options;
  const { size, rating: target, irregularity } = levelSpec(level);
  const deadline = Date.now() + budgetMs;
  let best = null;
  let fallback = null;

  while (Date.now() < deadline) {
    const puzzle = shapePuzzle(size, target, rand, irregularity);
    if (!puzzle) continue;
    puzzle.level = level;

    // Never hand the player a puzzle rated below the one they just finished.
    if (puzzle.rating <= floor) {
      if (!fallback || puzzle.rating > fallback.rating) fallback = puzzle;
      continue;
    }
    if (!best || Math.abs(puzzle.rating - target) < Math.abs(best.rating - target)) {
      best = puzzle;
    }
    if (Math.abs(best.rating - target) <= target * 0.06) break;
  }

  return best || fallback;
}
