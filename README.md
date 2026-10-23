# Lesleydoku

A bunny logic puzzle for the phone. One puzzle at a time: solve it, move on, the
next one is a little harder.

## Rules

- Place exactly one bunny in every row, every column and every coloured patch.
- No two bunnies may touch — not even corner to corner.
- Tap a cell once to rule it out, again to place a bunny, again to clear it.
  Drag from an empty cell to rule out a whole run.
- Every puzzle is solvable by logic alone. Guessing is never required.

## Running it locally

No build step, no dependencies — it is plain HTML, CSS and ES modules.

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

It has to be served over HTTP; opening `index.html` from the filesystem breaks
module imports.

## Deploying

Push to GitHub and turn on Pages: **Settings → Pages → Build and deployment →
Deploy from a branch**, branch `master`, folder `/ (root)`. The site lands at
`https://<user>.github.io/Lesleydoku/`.

On the iPhone, open that URL in Safari and use **Share → Add to Home Screen**.
It then launches full screen with its own icon, and the service worker keeps it
playable with no signal. Progress is stored on the device.

## How the puzzles are made

`src/puzzle.js` holds the whole engine.

1. Pick a valid bunny placement: one per row and column, none touching.
2. Grow one coloured region out of each bunny until the board is covered.
3. Hill-climb the region boundaries — move a single cell from one region to a
   neighbouring one, keep the move if the logical solver can now resolve more
   of the board — until the board falls out by deduction alone.
4. Keep nudging, now steering the puzzle's rating towards the figure the level
   ladder asked for.

Random region layouts are almost never solvable without guessing, which is why
step 3 exists; step 4 is what makes the difficulty curve a curve rather than a
lottery. Each puzzle is then confirmed to have exactly one solution.

## How difficulty is rated

A puzzle is rated by the scanning work it asks of a player, not by how clever
its hardest step is. `analyse()` replays the solve. On each round it finds
every deduction available at the easiest technique that works:

- **only square left** — a row, column or patch with one candidate left;
- **confinement** — every candidate of a unit sits inside one other unit, so
  that unit's other cells are clear;
- **every placement** — a cell ruled out by every possible placement of some
  unit, wherever that bunny ends up.

The round is charged `3N × cost(technique) ÷ (productive units)`: there are 3N
rows, columns and patches to look through, a harder technique costs more to
check against each one, and the more of them are productive at that moment the
sooner a player spots one. Summing the rounds gives a number that is
comparable across board sizes, which is what lets the ladder keep climbing
when the board grows.

## The level ladder

`levelSpec()` is one rising rating curve rather than a pile of per-level rules.
The board grows in blocks — 5×5 for six levels, then 6×6 for eight, up to 10×10
— and inside each block the target rating climbs geometrically, so equal-sized
steps feel equal. Every block starts above where the last one ended, so a
bigger board never arrives as a breather.

Levels 1–60 run from rating 10 to 948 and are pre-generated into
`data/levels.json`, each one verified to rate strictly above the level before
it. Past level 60 the device generates its own, still climbing, and refuses
anything rated below the level just cleared. The five pips beside the level
number show which band the current puzzle falls in.

## Project layout

```
index.html             markup and the bunny sprite
styles.css             all styling, light and dark
src/puzzle.js          generator, logical solver, difficulty rating
src/game.js            board rendering, input, progression, saving
data/levels.json       pre-generated levels 1-60, rated and ordered
sw.js                  offline cache
tools/generate-pack.mjs  node tools/generate-pack.mjs 60 > data/levels.json
tools/verify-pack.mjs    checks every shipped level
tools/make-icons.mjs     redraws the app icons
```
