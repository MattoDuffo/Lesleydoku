// Pre-generates the shipped level pack so the game starts instantly offline.
// Usage: node tools/generate-pack.mjs [count] > data/levels.json
import { generatePuzzle, logicSolve, countSolutions } from '../src/puzzle.js';

const count = Number(process.argv[2] || 60);
const levels = [];

for (let level = 1; level <= count; level++) {
  let puzzle = null;
  for (let tries = 0; tries < 3 && !puzzle; tries++) puzzle = generatePuzzle(level, Math.random, 8000);
  if (!puzzle) throw new Error(`failed to generate level ${level}`);

  if (!logicSolve(puzzle.size, puzzle.regions, 3).solved) {
    throw new Error(`level ${level} is not solvable by logic`);
  }
  if (countSolutions(puzzle.size, puzzle.regions) !== 1) {
    throw new Error(`level ${level} does not have a unique solution`);
  }

  levels.push({
    l: level,
    n: puzzle.size,
    r: puzzle.regions.join(''),
    s: puzzle.solution,
    t: puzzle.tier,
    h: puzzle.hardSteps,
  });
  process.stderr.write(`level ${level}: ${puzzle.size}x${puzzle.size} tier ${puzzle.tier} hardSteps ${puzzle.hardSteps}\n`);
}

process.stdout.write(JSON.stringify({ version: 1, levels }) + '\n');
