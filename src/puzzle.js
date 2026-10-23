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

// Human-style solver, using the techniques a player actually applies.
//
//   T1 "forced single" - a row, column or region with one candidate left.
//   T2 "confinement"   - every candidate of a unit sits inside one other
//                        unit, so that unit's other cells are clear.
//   T3 "elimination"   - a cell attacked by every possible placement of
//                        some unit is clear.
//
// `techniques` caps how deep the solver may go, which is how a puzzle gets
// rated: solvable with 2 is gentle, needing 3 is harder.
export function logicSolve(size, regions, techniques = 3) {
  const units = buildUnits(size, regions);
  const cellUnits = unitsOfCell(size, regions);
  const touches = [];
  for (let i = 0; i < size * size; i++) touches.push(touching(size, i));

  const state = new Int8Array(size * size).fill(UNKNOWN);
  const hasBunny = new Array(units.length).fill(false);
  let placed = 0;
  let hardSteps = 0;
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

  const openUnits = () => {
    const out = [];
    for (let u = 0; u < units.length; u++) {
      if (hasBunny[u]) continue;
      const candidates = units[u].filter((c) => state[c] === UNKNOWN);
      out.push([u, candidates]);
    }
    return out;
  };

  while (placed < size && !contradiction) {
    let progress = false;

    for (const [, candidates] of openUnits()) {
      if (candidates.length === 0) {
        contradiction = true;
        break;
      }
      if (candidates.length === 1) {
        placeBunny(candidates[0]);
        progress = true;
      }
    }
    if (progress || contradiction) continue;

    if (techniques >= 2) {
      for (const [u, candidates] of openUnits()) {
        for (let slot = 0; slot < 3; slot++) {
          const target = cellUnits[candidates[0]][slot];
          if (target === u) continue;
          if (!candidates.every((c) => cellUnits[c][slot] === target)) continue;
          for (const cell of units[target]) {
            if (state[cell] === UNKNOWN && !candidates.includes(cell) && block(cell)) {
              progress = true;
            }
          }
        }
      }
      if (progress || contradiction) continue;
    }

    if (techniques >= 3) {
      for (const [, candidates] of openUnits()) {
        for (let cell = 0; cell < state.length; cell++) {
          if (state[cell] !== UNKNOWN || candidates.includes(cell)) continue;
          if (candidates.every((c) => attacks(c, cell)) && block(cell)) {
            progress = true;
            hardSteps++;
          }
        }
      }
      if (progress || contradiction) continue;
    }

    break;
  }

  return { solved: !contradiction && placed === size, hardSteps, state };
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
// hill-climbed: nudge one cell from one region into a neighbouring region,
// keep the nudge if logic can now resolve at least as much of the board, and
// repeat until the whole board falls out by deduction alone.
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

function progressScore(size, regions) {
  const result = logicSolve(size, regions, 3);
  let resolved = 0;
  for (const s of result.state) if (s !== UNKNOWN) resolved++;
  return { resolved, solved: result.solved, hardSteps: result.hardSteps };
}

function climb(size, irregularity, maxIterations, rand) {
  const solution = randomSolution(size, rand);
  if (!solution) return null;
  const seeds = solution.map((c, r) => r * size + c);
  const grown = growRegions(size, solution, rand, irregularity);
  if (!grown) return null;

  const regions = Array.from(grown);
  let current = progressScore(size, regions);

  for (let i = 0; i < maxIterations && !current.solved; i++) {
    const cell = Math.floor(rand() * regions.length);
    const from = regions[cell];
    if (seeds[from] === cell) continue;

    const options = orthogonal(size, cell).filter((nb) => regions[nb] !== from);
    if (options.length === 0) continue;
    if (!staysConnected(size, regions, from, cell, seeds[from])) continue;

    regions[cell] = regions[options[Math.floor(rand() * options.length)]];
    const next = progressScore(size, regions);
    if (next.resolved >= current.resolved) current = next;
    else regions[cell] = from;
  }

  if (!current.solved) return null;
  if (countSolutions(size, regions) !== 1) return null;

  const gentle = logicSolve(size, regions, 2).solved;
  return {
    size,
    regions,
    solution,
    tier: gentle ? 1 : 2,
    hardSteps: current.hardSteps,
  };
}

// Board size and difficulty preference for a given level. Difficulty grows on
// two axes: the board gets bigger, and the solve needs more of the awkward
// eliminations (`hardSteps`) rather than straightforward forced moves.
const LADDER = [5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9];

export function levelSpec(level) {
  if (level <= LADDER.length) {
    const size = LADDER[level - 1];
    let step = 0;
    while (level - step > 1 && LADDER[level - step - 2] === size) step++;
    return {
      size,
      preferredTier: step === 0 ? 1 : 2,
      minHardSteps: step === 0 ? 0 : 2 * step,
      maxHardSteps: step === 0 ? Infinity : 2 * step + 6,
      irregularity: Math.min(0.3 + level * 0.03, 0.75),
    };
  }
  const beyond = level - LADDER.length;
  return {
    size: 10,
    preferredTier: 2,
    minHardSteps: Math.min(2 + Math.floor(beyond / 3), 10),
    maxHardSteps: Math.min(2 + Math.floor(beyond / 3), 10) + 5,
    irregularity: 0.75,
  };
}

export function generatePuzzle(level, rand = Math.random, budgetMs = 2500) {
  const { size, preferredTier, minHardSteps, maxHardSteps, irregularity } = levelSpec(level);
  const deadline = Date.now() + budgetMs;
  const iterations = 400 * size;
  let best = null;

  while (Date.now() < deadline) {
    const puzzle = climb(size, irregularity, iterations, rand);
    if (!puzzle) continue;
    puzzle.level = level;
    const inBand = puzzle.hardSteps >= minHardSteps && puzzle.hardSteps <= maxHardSteps;
    if (puzzle.tier === preferredTier && inBand) return puzzle;
    if (!best || rank(puzzle) > rank(best)) best = puzzle;
  }

  return best;

  function rank(p) {
    return (p.tier === preferredTier ? 100 : 0) + Math.min(p.hardSteps, minHardSteps);
  }
}
