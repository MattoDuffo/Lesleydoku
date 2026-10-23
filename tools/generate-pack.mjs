// Pre-generates the shipped level pack so the game starts instantly offline.
//
// Every level is shaped to the rating its spot on the ladder asks for, and is
// required to rate strictly above the level before it: the pack is the ramp,
// so nothing is left to chance at play time.
//
// Usage: node tools/generate-pack.mjs [count] > data/levels.json
import { shapePuzzle, levelSpec, difficultyBand, analyse, countSolutions } from '../src/puzzle.js';

const count = Number(process.argv[2] || 60);
const levels = [];
let previous = 0;

for (let level = 1; level <= count; level++) {
  const spec = levelSpec(level);
  const tolerance = Math.max(3, spec.rating * 0.04);
  let best = null;

  for (let attempt = 0; attempt < 400 && !best; attempt++) {
    const puzzle = shapePuzzle(spec.size, spec.rating);
    if (!puzzle) continue;
    if (puzzle.rating <= previous) continue;
    if (Math.abs(puzzle.rating - spec.rating) > tolerance) continue;
    best = puzzle;
  }

  if (!best) throw new Error(`level ${level}: could not hit rating ${spec.rating} above ${previous}`);

  const check = analyse(best.size, best.regions);
  if (!check.solved) throw new Error(`level ${level} is not solvable by logic`);
  if (countSolutions(best.size, best.regions) !== 1) {
    throw new Error(`level ${level} does not have a unique solution`);
  }

  previous = best.rating;
  levels.push({
    l: level,
    n: best.size,
    r: best.regions.join(''),
    s: best.solution,
    d: best.rating,
    b: difficultyBand(best.rating),
  });
  process.stderr.write(
    `level ${level}: ${best.size}x${best.size} rating ${best.rating} ` +
      `(target ${spec.rating}, band ${difficultyBand(best.rating)}, ${best.rounds} rounds)\n`
  );
}

process.stdout.write(JSON.stringify({ version: 2, levels }) + '\n');
