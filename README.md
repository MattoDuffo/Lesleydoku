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
   neighbouring one, keep the move if the logical solver can now resolve more of
   the board — until the board falls out by deduction alone.

Random region layouts are almost never solvable without guessing, which is why
step 3 exists. Each puzzle is then confirmed to have exactly one solution.

Difficulty grows on two axes: the board gets bigger (5×5 up to 10×10), and the
solve needs more of the awkward eliminations rather than straightforward forced
moves. `levelSpec()` sets the target for each level.

Levels 1–60 are pre-generated into `data/levels.json` so the game starts
instantly and works offline; past level 60 the device generates its own.

## Project layout

```
index.html             markup and the bunny sprite
styles.css             all styling, light and dark
src/puzzle.js          generator, logical solver, difficulty rating
src/game.js            board rendering, input, progression, saving
data/levels.json       pre-generated levels 1-60
sw.js                  offline cache
tools/generate-pack.mjs  node tools/generate-pack.mjs 60 > data/levels.json
tools/verify-pack.mjs    checks every shipped level
tools/make-icons.mjs     redraws the app icons
```
