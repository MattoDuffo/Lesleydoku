// Checks every shipped level: one solution, reachable by logic, right size.
// Usage: node tools/verify-pack.mjs
import { readFileSync } from 'node:fs';
import { logicSolve, countSolutions, levelSpec } from '../src/puzzle.js';

const pack = JSON.parse(readFileSync(new URL('../data/levels.json', import.meta.url)));
let failures = 0;

for (const entry of pack.levels) {
  const regions = entry.r.split('').map(Number);
  const spec = levelSpec(entry.l);
  const problems = [];

  if (entry.n !== spec.size) problems.push(`size ${entry.n}, expected ${spec.size}`);
  if (regions.length !== entry.n * entry.n) problems.push('region map is the wrong length');
  if (new Set(regions).size !== entry.n) problems.push('wrong number of regions');
  if (countSolutions(entry.n, regions) !== 1) problems.push('solution is not unique');

  const solved = logicSolve(entry.n, regions, 3);
  if (!solved.solved) problems.push('not solvable by logic alone');
  else {
    for (let row = 0; row < entry.n; row++) {
      if (solved.state[row * entry.n + entry.s[row]] !== 1) {
        problems.push('stored solution disagrees with the solver');
        break;
      }
    }
  }

  if (problems.length) {
    failures++;
    console.error(`level ${entry.l}: ${problems.join('; ')}`);
  }
}

console.log(`${pack.levels.length} levels checked, ${failures} failed`);
process.exit(failures ? 1 : 0);
