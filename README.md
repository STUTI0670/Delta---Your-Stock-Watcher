# Delta

**A personal market attention system.** Delta exists to answer one question:

> *"I was away. Tell me what changed."*

It is not a stock dashboard. It remembers exactly where your watchlist stood the last time you looked, then shows you only what moved since — so you never scan a table of tickers again.

Built on the [Signalist](https://github.com/adrianhajdin/signalist_stock-tracker-app) starter, whose auth, MongoDB and Inngest integrations are reused. The product framing, information architecture, data model, business logic, market-data layer, UI and visual identity are Delta's own.

**No API keys required.** Market data comes from Yahoo Finance's public endpoints, so `npm run dev` works immediately.

---

## The core idea: checkpoints

A **checkpoint** is the market state as it stood the last time you actually reviewed your watchlist. It lives in MongoDB, not the browser, so it survives refreshes, logouts and device switches.

Every brief follows a strict order:

1. **Read** the previous checkpoint.
2. **Compare** current prices against it.
3. **Render** the differences.
4. **Only then** advance the checkpoint.

Advancing before comparing would compare the present against itself and permanently destroy the answer. A 30-minute minimum interval between checkpoints also means a quick refresh will not erase the comparison you just started reading.

---

## Information architecture

The interface reveals detail progressively, one level per click:

| Level | Question | Where |
| --- | --- | --- |
| 1 | What changed? | The hero — how long you were away, and a tally of what happened |
| 2 | Which stocks changed? | **Needs your attention** — ranked, with the reason under each |
| 3 | Why did it matter? | Stock page — **Why this matters**, stating the rules that fired |
| 4 | Show me the data | Price history, volume, the actual news stories |

Four sections, no more:

- **Brief** (`/`) — since you last checked → needs your attention → watchlist → alerts
- **My Watchlist** (`/watchlist`) — everything tracked, deliberately quieter
- **Price Alerts** (`/alerts`) — thresholds and what has triggered
- **Stock** (`/stocks/[symbol]`) — what changed for one symbol

Search is a verb, not a page: `⌘K` finds a stock and puts it under watch in one step.

---

## Design system

A near-monochrome, editorial sheet of ink. The rules are in [`app/globals.css`](app/globals.css):

- **Hairlines and vertical rhythm, not cards.** There is no grid of rounded boxes.
- **Priority is achromatic.** A critical item is larger, brighter, has a thicker left rail, a rank numeral and the word *Critical*. The hierarchy survives in greyscale.
- **Colour means direction only.** Mint for up, coral for down — never importance.
- **Numerals are tabular mono**, so columns of figures scan vertically.

Three attention levels, from a deterministic floor combined with a score:

| Level | Rule |
| --- | --- |
| **Critical** | move ≥ 6% since your checkpoint, **or** attention score ≥ 6 |
| **Worth watching** | move ≥ 3%, volume ≥ 2× its average, **or** score ≥ 3 |
| **Normal** | everything else — listed, never promoted |

The score may only *escalate* attention, never demote it, so a large move stays
critical even when no other signal fired ([`attention-level.ts`](lib/market/attention-level.ts)).

---

## Features

### Since you last checked
The largest thing on the page is how long you were away, followed by a tally: meaningful changes, major moves, unusual volume days, thresholds reached, related stories.

### Meaningful-change rules
Deterministic and explainable, no AI. All thresholds live in [`lib/market/config.ts`](lib/market/config.ts). Volume and news reinforce a price signal; news never promotes a flat stock on its own.

### Why this matters
Every surfaced change can state the rules that fired, with the measured numbers behind them — composed from the same measurements the level is derived from, so the explanation cannot disagree with the decision.

### Price alerts
Buy ("tell me when it falls to X") and sell ("tell me when it rises to X"), composed as a sentence with ±5%/±10% shortcuts from the current price.

**No notification spam.** Alerts are a state machine, not a schedule:

```
armed + threshold crossed        -> FIRE, then disarm
disarmed + still past threshold  -> silent
disarmed + price recovered 2%    -> re-arm silently
```

A buy alert at $165 fires once at $165 and stays silent at $164 and $163. It becomes eligible again only above $168.30. A 6-hour cooldown backstops any flapping.

### Attention score
Four independent signals, summed:

```
attentionScore = priceMovement + volume + relatedNews + yourAlerts
```

A price move scores by size, and earns an extra point when it is unusual *for
that stock* — a 3% day is routine for one symbol and remarkable for another.
Bands: 0–2 normal, 3–5 worth watching, 6+ critical.

### Why you're seeing this
Every point that is added also records the measurement that added it, so the
total is always fully accounted for and the explanation can never drift from the
score. A signal that could not be measured is reported as *unavailable* rather
than as zero — "we did not look" and "nothing happened" are different answers.

### How closely to watch
Each stock gets a monitoring cadence — *check more often* / *as usual* / *less
often* — from its own average daily movement, how often it moved 4%+, and how
often it tripped your own alerts. This is a recommendation about **your
attention, not your money**: the module can only emit those three phrases, and a
test asserts it never produces buy/sell language.

### Tuning what you see
Thumbs on each factor tell Delta whether that kind of signal is worth your
attention. Votes reweight how much a signal contributes, clamped to 0.5×–1.5× so
no signal can be silenced or allowed to dominate, and expiring after 90 days.
Feedback reorders real measurements; it never invents or suppresses one.

### Bundled alerts
Alerts arrive individually by default, or as a single periodic summary. Either
way the crossing is written to history, so switching modes changes only how
loudly you are told.

### Honest data freshness
A quote carries a value, a provider timestamp and an error state. Fresh data shows its age; delayed data is flagged; a failed refresh keeps the last known price but marks it **Not live** with its true age; a total outage says so, preserves your checkpoint, and never advances it.

---

## Architecture

```
app/(root)/                    Brief · Watchlist · Alerts · Stock detail
components/
  shell/                       Top bar, nav, ⌘K search, account
  brief/                       The hero and the attention list
  watchlist/  alerts/  stock/  Section components
  common/                      Sparkline, formatting, headings, skeletons

lib/market/                    Pure business logic — no React, DB or network
  config.ts                    All tunable thresholds
  change-detection.ts          "What meaningfully changed?"
  alert-rules.ts               Trigger / re-arm state machine
  volume.ts                    Volume baseline and sparkline series
  attention-score.ts           Score + the factors that justify it
  attention-level.ts           P1 floor combined with the P2 band
  price-behavior.ts            Volatility, average move, large-move counts
  monitoring-cadence.ts        How often to check — never advice
  personalization.ts           Feedback folded into signal weights
  explain.ts                   "Why this matters"
  freshness.ts                 Staleness, age and elapsed formatting
  yahoo-parse.ts               Pure parsing of Yahoo chart payloads
  providers/yahoo.ts           Yahoo fetching: quotes, history, search, news

lib/services/                  Orchestration
  repositories.ts              Persistence interfaces + MongoDB implementations
  checkpoint.service.ts        Read -> compare -> advance
  attention.service.ts         Assembles the brief
  alert.service.ts             Alert CRUD + the poller's sweep
  watchlist.service.ts         Watchlist operations
  news.service.ts              Related stories since the checkpoint
  insight.service.ts           Behaviour stats + cadence per symbol
  feedback.service.ts          Votes in, signal weights out
  digest.service.ts            Alert delivery mode and bundling
  notification.service.ts      Email delivery for triggered alerts

lib/actions/                   Thin server-action wrappers (session-scoped)
lib/inngest/alert-poller.ts    Background sweep, every 5 minutes
database/models/               watch_items, checkpoints, price_alerts, alert_events
```

Business logic is separated from both UI and persistence. Services take their repositories as an argument (defaulting to the MongoDB ones), which is what lets checkpoint and alert behaviour be tested exhaustively without a database.

### Data model

| Collection | Purpose |
| --- | --- |
| `watch_items` | One row per (user, symbol). Unique index prevents duplicates. |
| `checkpoints` | One row per user: `checkedAt` plus a price snapshot per symbol. |
| `price_alerts` | Threshold, direction, `isEnabled`, `isArmed`, last-trigger stamps. |
| `alert_events` | Immutable history of crossings that fired, with delivery status. |
| `change_feedback` | One vote per (user, symbol, signal); a newer opinion replaces the old. |
| `notification_preferences` | Per-user alert delivery mode and last-digest marker. |

### Market data

Yahoo Finance is the single provider, and needs no API key.

| Endpoint | Used for |
| --- | --- |
| `/v8/finance/chart` | Live price, previous close, daily OHLCV — one call per symbol serves the price comparison, volume baseline and sparkline |
| `/v1/finance/search` | Symbol lookup for `⌘K`, and related stories per ticker |

Payload parsing lives in [`lib/market/yahoo-parse.ts`](lib/market/yahoo-parse.ts), separated from fetching so the shape-handling is unit tested. One subtlety it encodes: the day change is derived from the daily bars, **not** from `meta.chartPreviousClose`, which on a multi-month range holds the close from before the whole range and would report a quarterly move as if it happened today.

---

## Getting started

```bash
npm install
cp .env.example .env      # fill in MONGODB_URI and BETTER_AUTH_SECRET
npm run dev
```

No MongoDB installed? Start a throwaway one in another terminal:

```bash
npm run dev:db            # mongodb://127.0.0.1:27017/watchpoint
```

To run the background alert poller locally, start the Inngest dev server:

```bash
npx inngest-cli@latest dev
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the app |
| `npm run build` | Production build |
| `npm test` | Unit suite (pure logic, no DB) |
| `npm run test:integration` | Integration suite (needs `MONGODB_URI`) |
| `npm run typecheck` | TypeScript check |
| `npm run dev:db` | Throwaway local MongoDB |

---

## Testing

**217 unit tests** cover the business rules with no database or network:

- meaningful vs. insignificant price changes, at and around the threshold
- comparison against a checkpoint (day-change vs. since-check divergence)
- buy and sell threshold triggering
- the `$166 → $165 → $164 → $163` sequence producing exactly one notification
- re-arm hysteresis, cooldowns, enable/disable, deletion
- alert history persistence and per-user isolation
- volume baselines, spike detection, sparkline normalisation
- freshness, staleness, elapsed-time phrasing, degraded quotes
- "why this matters" never contradicting the severity it was given
- Yahoo payload parsing: padded sessions, float32 bar closes vs cent-rounded quotes, and the previous-close regression above
- attention scoring, its banding, and that the explanation always accounts for exactly the total
- that scoring can never demote what P1 already flagged, across every severity/signal combination
- cadence recommendations, including that they never produce buy/sell language
- feedback weighting: clamped, expiring, per-signal, and unable to erase a measurement
- digest bundling, and that digest mode changes delivery without losing history

**18 integration tests** run the same contracts against a real MongoDB — checkpoint durability across a disconnect/reconnect, unique indexing, upsert semantics and user scoping.

```bash
npm test
MONGODB_URI=mongodb://127.0.0.1:27017/watchpoint_test npm run test:integration
```

---

## Known limitations

- Alert notifications are email-only and need SMTP credentials; delivery failures are recorded on the history row rather than retried.
- The alert poller runs every 5 minutes, so a crossing is detected within that window rather than instantly.
- Intraday volume is not available, so the volume signal compares the latest *daily* session against its 20-session average.
