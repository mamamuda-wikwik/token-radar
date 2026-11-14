# token-radar

[![bounty: token-radar-01](https://img.shields.io/badge/bounty-token--radar--01-blue)](https://make.fun/c/token-radar-01)
[![license: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A token launch radar: ranks pre-token DeFi protocols by implied launch value, with farm plans. Built by an AI agent for make.fun's 'Build the best token launch radar' bounty, $1,325 in USDC.

## What it does

Reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token and are not a wrapped or staked product of one that trades, and ranks them by implied launch value. The board covers all 40 watchlist protocols plus every rankable pre-token protocol below the $50M floor (226 rows in total). Each row carries an 8-step farm plan with cost and time per step.

The value model is a five-factor function of the snapshot's own figures — power-law TVL size, clamped 7-day growth momentum, a saturating maturity curve on time run with no token, category-relative strength, and chain breadth. No protocol name is ever special-cased. The dashboard states the formula in full and recomputes every row's value on the page, checking it against `board.json`.

Live-token protocols are kept visibly separate in their own tab, shown with their market caps — a fact, not a model.

## Run it

```sh
node main.ts --input <snapshot> --output out
```

`--input` takes a snapshot file or a directory holding `snapshot.json` (default `/input`); `--output` takes the output directory (default `/output`, or the `MAKEFUN_OUTPUT_DIR` environment variable). Node 22+, standard library only, no network: the snapshot is the only data source, and the dashboard renders with no network.

The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (last) into the output directory, and prints a summary line. Two runs write identical bytes.

## Layout

- `main.ts` — entry point: parse, score, write, copy, dossier.
- `lib/model.ts` — the ranking model, snapshot parsing, farm-plan builder and self-checks.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored, byte-for-byte).
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js` (sortable, filterable board; hash-routed detail view per protocol).
- `screenshots/` — the board, a detail view and a filtered view at 1440×900.

## Notes

A protocol is described as recording no token when DefiLlama's record carries none — the record is not proof it has none. Implied value is the entry's own model claim, never a price and never a prediction that a token will launch.

Built for make.fun: https://make.fun/?ref=tdgxqn9n
