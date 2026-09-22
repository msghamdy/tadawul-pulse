# Tadawul Pulse · نبض تداول

Systematic research on the Saudi stock market (TASI), published as a free static site on GitHub Pages. A scheduled GitHub Actions job runs a Python pipeline that writes JSON files, and a React frontend reads them. There is no backend server.

> **For research and education only. Not investment advice.**

![Screenshot](docs/screenshot.png)
<!-- TODO: add a screenshot at docs/screenshot.png -->

## What's in it

| Page | Status | What it shows |
|---|---|---|
| Overview (`HOME`) | ✅ Phase 1 | TASI candlesticks and Brent, headline stats, movers, breadth, a monitor of every stock, data-cleaning summary |
| Oil beta (`BETA`) | ✅ Phase 1 | Rolling 60/120-day betas of ~60 stocks to Brent and TASI, sector averages, per-stock history |
| Price limits (`LIMT`) | ✅ Phase 2 | What happens after a stock closes at, touches, or nearly reaches its ±10% limit: returns, confidence ranges, breakdowns, a tradable backtest, today's events and each stock's history |
| Factors (`FACT`) | Phase 3 | Momentum, low-volatility and dividend-yield portfolios vs TASI |
| Seasonality (`SEAS`) | Phase 4 | Ramadan, Eid and Hijri-month effects, with significance tests |
| Pairs (`PAIR`) | Phase 5 | Within-sector cointegration pairs, out-of-sample backtest |

English and Arabic (full right-to-left layout).

## Interface

The site uses a classic trading-terminal look: pure black screen, orange-amber labels, white values, teal-green and red for changes, blue for selections, grey title strips, numbered page menus, yellow function keys and a green GO key. Type is IBM Plex Mono, with IBM Plex Sans Arabic for Arabic. It's inspired by financial terminals in general; no vendor names, logos or trademarks are used.

| Control | What it does |
|---|---|
| Command bar (top) | Type a ticker (`2222`), part of a name (`rajhi`, `الراجحي`), a page code (`LIMT`) or both (`2222 LIMT`), then press Enter or GO. Suggestions appear as you type; use ↑/↓ to choose. `/` focuses it from anywhere, and typing a letter or digit with nothing else focused starts a command. `Esc` clears it. A bare ticker opens its oil-beta page, or its price-limit history if it isn't in the oil-beta universe. |
| Page codes | `HOME` market overview, `BETA` oil beta monitor, `LIMT` price-limit monitor, `FACT` factors, `SEAS` seasonality, `PAIR` pairs |
| Function keys (bottom) | `F1` HOME, `F2` BETA, `F3` FACT, `F4` SEAS, `F5` PAIR, `F6` LIMT. Click them or press the real keys. |
| Ticker tape | TASI and every stock's last price and daily change. Hover to pause; click an item to open it. |
| Status bar | Riyadh clock, market status, data date, and the research disclaimer. Market status follows the Sun–Thu 10:00–15:00 schedule and doesn't know about public holidays. |

Colours: teal-green `#4AF6C3` up, red `#FF433D` down, white unchanged, everywhere including charts. Oil beta is amber and market beta is blue.

### Changing the palette

Every colour is defined once, as a CSS variable in [`web/src/styles/theme.css`](web/src/styles/theme.css). Tailwind ([`web/tailwind.config.js`](web/tailwind.config.js)) maps its colour names to those variables, and the chart code reads the same variables at runtime, so editing a value in `theme.css` restyles text, panels, tables and both chart libraries. Sector colours are the `--s-*` variables in the same file.

## Architecture

```mermaid
flowchart LR
    Y[(Yahoo Finance<br/>.SR stocks, ^TASI.SR, BZ=F)] --> F[fetch.py<br/>download, cache, clean]
    F --> O[oil_beta.py]
    F --> L[limits.py]
    F --> E[export.py]
    O --> E
    L --> E
    E --> J[/JSON files/]
    subgraph "update-data.yml (Sun–Thu 12:30 UTC)"
      F
      O
      L
      E
    end
    J -->|workflow artifact| D[deploy.yml<br/>Vite build]
    D --> P[GitHub Pages]
    P --> B[React app<br/>reads /data/*.json]
```

```
tadawul-pulse/
├── pipeline/            Python 3.11
│   ├── config.py        universe, sectors, Shariah flags, every parameter
│   ├── fetch.py         download + cleaning + caching + trading calendar
│   ├── oil_beta.py      rolling oil and market betas
│   ├── limits.py        price-limit event study and backtest
│   ├── data/main_market.csv  Main Market tickers for the limit study
│   └── export.py        entry point; writes JSON to web/public/data/
├── tests/               pytest
├── web/                 React + Vite + TypeScript + Tailwind
└── .github/workflows/
    ├── update-data.yml  scheduled pipeline run, uploads data artifact
    └── deploy.yml       builds the site with the latest data, deploys to Pages
```

The data files are **not committed**. `update-data.yml` uploads them as a workflow artifact (kept 30 days) and `deploy.yml` downloads the most recent successful one before building. This keeps the repository small; committing a fresh set of JSON files every trading day would add hundreds of MB of history a year.

## Run it locally

Requirements: Python 3.11+, Node 20+.

```bash
# 1. Pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q
python -m pipeline.export          # real data from Yahoo (a few minutes the first time)
# or: python -m pipeline.export --synthetic   # generated demo data, no network
# add -v to log every individual cleaning action

# 2. Website
cd web
npm install
npm run dev                        # http://localhost:5173/tadawul-pulse/
```

Downloads are cached in `.cache/prices/` for 12 hours (`CACHE_TTL_HOURS`). Use `--no-cache` to force a fresh download.

## Deploy to GitHub Pages

**One command:** `ship.sh` creates the repo, pushes it, sets Pages to GitHub Actions and starts the first data run.

```bash
read -s "GITHUB_TOKEN?Paste token: " && export GITHUB_TOKEN   # zsh; in bash use: read -s GITHUB_TOKEN && export GITHUB_TOKEN
bash ship.sh                 # or: bash ship.sh my-repo-name
```

The token needs the `repo` and `workflow` scopes (classic), or Contents, Workflows, Pages and Actions set to read and write (fine-grained).

**By hand:**

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Actions → Update data → Run workflow.** When it finishes, *Deploy site* starts automatically.
4. The site is live at `https://<user>.github.io/<repo>/`. The base path is set from the repository name, so renaming the repo just works.

After that, data refreshes every Sunday–Thursday at 12:30 UTC and the site redeploys on its own. Pushing changes under `web/` also redeploys, using the latest data artifact.

If no data run has succeeded in the last 30 days, the artifact expires and the site shows “No data yet” until the next run.

## Methodology

### Trading calendar
Tadawul trades Sunday to Thursday. The calendar is every date TASI has a close on Yahoo, plus any Sunday–Thursday date on which at least half the universe traded (covers missing index rows). No part of the pipeline assumes a Monday–Friday week. The data starts in 2015, after the June 2013 move from a Saturday–Wednesday week.

### Cleaning
For each stock, in order:
1. Drop non-positive or non-finite closes.
2. Drop rows that fall on Friday or Saturday.
3. Drop zero-volume days (Yahoo often repeats the previous close on days a stock didn't trade).
4. **Remove bad prints**: a move beyond ±10.5% that reverses by more than ±10.5% the next day. Tadawul's ±10% daily limit makes this pattern impossible from real trading.
5. **Flag** any remaining move beyond ±10.5%. These are usually corporate actions Yahoo didn't adjust for (rights issues, bonus shares) or first-day listings. The price is kept, but that day's return is excluded from all statistics.
6. Align to the calendar and forward-fill only gaps of **3 trading days or fewer**. Longer gaps are left empty rather than partly filled, and a gap at the end is never filled. A return is only used when both of its endpoints are real observations.

Every action is counted per ticker in `quality.json` and summarised on the Overview page.

### Oil beta and market beta
Both are OLS slopes on daily log returns over rolling 60- and 120-day windows, requiring at least 80% of the window to be usable returns.

- **Market beta**: the stock's return on the same-day TASI return.
- **Oil beta**: Brent (BZ=F) trades Monday to Friday, so each Saudi date is paired with the latest Brent close on or before it. A Sunday return is paired with Brent's Thursday→Friday move. Tadawul closes at 15:00 Riyadh time, hours before Brent settles in London, so part of each day's oil move only reaches Saudi prices the next day. By default the oil beta is a **Dimson beta**: the stock return is regressed on the same-day and prior-day Brent returns and the two slopes are summed. Set `OIL_BETA_METHOD = "same_day"` in `config.py` for the plain univariate version.

Current values older than 10 trading days are reported as empty.

### Price-limit study (LIMT)

**Universe.** Every operating company on the Main Market (253 stocks, codes 1xxx–8xxx, listed in [`pipeline/data/main_market.csv`](pipeline/data/main_market.csv), retrieved 22 Sep 2026). Nomu (9xxx) is excluded because its price limits differ, and REIT funds (4330–4349) because they aren't operating companies.

**Limit prices.** Tadawul sets each day's limits at ±10% of the previous close, on the tick grid. The pipeline rebuilds the exact limit prices from the previous *actual* close, using the tick schedule in force that day:

| From | Tick sizes (SAR) |
|---|---|
| 4 Jun 2017 | below 10: 0.01, 10–24.98: 0.02, 25–49.95: 0.05, 50–99.90: 0.10, 100+: 0.20 |
| 29 Jun 2025 | below 25: 0.01, 25–49.98: 0.02, 50–99.95: 0.05, 100–249.90: 0.10, 250–499.80: 0.20, 500+: 0.50 |

Sources: Argaam (23 May 2017) and the Saudi Exchange announcement reported by EnterpriseAM (30 Jun 2025). The schedule before June 2017 isn't clearly documented, so the study starts on 4 June 2017. A limit price must sit on the grid of its own price band. For example, from a close of 24.98 the upper limit is 27.45 on the 0.05 grid. Where Yahoo has rescaled old prices for a later bonus issue, prices are no longer on the grid, and those days fall back to "within one tick of ±10%". The page reports how many days used this fallback.

**Events.**
- **Locked:** closed at the limit.
- **Touched:** the day's high (or low) reached the limit, but the close didn't.
- **Near miss:** closed 8% or more beyond the previous close without reaching the limit. This is the comparison group.

A day is only studied if the stock also traded the day before, and not in its first 10 sessions after listing. Moves beyond the limit can't happen in normal trading, so they are treated as bad data or unadjusted corporate actions. They are excluded, and so is any event whose holding window contains one.

**Measures.** All returns use dividend-adjusted prices.
- **Close→close vs market:** the event close to the close h days later, minus the market's return over the same days. The market is TASI, or the equal-weighted proxy if TASI's history is missing.
- **Next open→close:** entry at the next day's open, to be compared with the same measure averaged over all stock-days. A stock locked at +10% usually has no sellers at the close, so this is the realistic entry.
- **Overnight gap:** the event close to the next open.

**Uncertainty.** Limit events cluster on the same days, for example in market-wide sell-offs, so 95% ranges come from resampling *dates*, 2,000 times. A filled yellow square marks a range that excludes zero (or the all-days average). Everything else could be chance.

**Backtest.** Buy at the next open after each lock-up (or lock-down), and sell at the close five sessions later. Trades are skipped when the stock opens at its upper limit, and 15 bps are charged per side (`LIMIT_COST_BPS`: set this to your broker's commission). The strategy is long only, because short selling is restricted on Tadawul. Open trades share the portfolio equally, and idle days earn zero.

**Liquidity tiers** use each stock's average traded value over the previous 60 sessions, ranked across stocks on that day, so they use no future information. Tests in `tests/test_limits.py` check tick sizes, limit prices, every event type, the returns maths, the trade rules, and that no signal uses prices after its own close.

## Known data limitations

- **Yahoo Finance is unofficial.** Saudi data can be late, have gaps, or change retroactively. Tickers occasionally stop returning data.
- **Corporate actions.** Yahoo's adjustment for Saudi bonus-share issues and rights issues is inconsistent. The cleaning step flags the resulting jumps but can't repair the price history.
- **Survivorship bias.** The universe is today's list of liquid stocks. Delisted and merged companies (e.g. the pre-2021 NCB and Samba) are missing.
- **Recent listings** such as ADES and Arabian Drilling have short histories, so their 120-day betas start later.
- **TASI includes the stocks being measured.** Aramco and Al Rajhi are large index weights, which pushes their market betas towards 1.
- **Price limits from daily data.** The intraday "magnet" effect (prices speeding up near the limit) needs intraday data and isn't measured. Yahoo's daily high and low for small Saudi stocks are occasionally inconsistent with the open and close. These are repaired by widening the range, and the page counts them.
- **The limit study's universe is today's Main Market.** Delisted companies are missing, which can flatter results for stocks that later failed after limit-down days.
- **Shariah flags and some sector labels need checking.** See the `TODO` comments in `pipeline/config.py`. Screening standards differ and lists are revised quarterly.

## Configuration

Everything tunable is in [`pipeline/config.py`](pipeline/config.py): the universe (ticker, English and Arabic names, sector, Shariah flag), start date, cleaning thresholds, beta windows and method, and export settings.

## License

MIT
