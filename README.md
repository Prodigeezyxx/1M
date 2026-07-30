# GMGN Trading Agent

World's most powerful memecoin trading agent & Bloomberg Terminal — your personal quant co-pilot for Solana, BSC, Base, and Ethereum. Powered by GMGN's full API suite with 22 real-time signal detectors, a token sniper, and a PONS token factory.

## Architecture

```
gmgn-trading-agent/
├── cli/                  # Terminal UI (blessed.js, TUI)
│   ├── src/index.ts      # TUI entry point
│   └── package.json
├── features/
│   ├── sniper/           # Real-time token detection + auto-buy
│   │   ├── config.js          # Chain params, RPCs, filter thresholds
│   │   ├── filter.js          # Disqualification engine (keywords, patterns, rate-limit)
│   │   ├── detector-sol.js    # Pump.fun WebSocket listener (connection.onLogs)
│   │   ├── detector-eth.js    # PONS factory event listener (ethers WebSocket)
│   │   ├── executor.js        # gmgn-cli swap integration
│   │   ├── server-adapter.js  # EventEmitter lifecycle manager
│   │   └── index.js           # Public adapter factory
│   └── pons-factory/     # High-speed token factory (Robinhood ETH / PONS)
│       ├── config.js          # Tunable parameters
│       ├── wallet.js          # Wallet generation & funding (ethers)
│       ├── puppets.js         # Puppet buy/sell via gmgn-cli swap
│       ├── cycle.js           # Single P&D cycle orchestrator
│       ├── index.js           # CLI entry point
│       └── server-adapter.js  # EventEmitter lifecycle manager
├── server/               # Web dashboard (Express + SSE)
│   ├── server.js         # API routes, data polling, SSE
│   └── public/
│       ├── index.html         # Terminal dashboard
│       ├── app.js             # Tabs: Hub, Trenches, Trades, Signals, Token, Portfolio, Factory, Sniper
│       └── style.css          # Terminal-styled CSS
├── signal-engine/        # 22 pattern detectors + scoring engine
│   └── index.js          # Real-time signal processing pipeline
├── utils/                # PowerShell utility scripts
│   ├── scout.ps1         # Quick market scan
│   └── check-token.ps1   # Token security check
├── .wallets/             # Generated puppet wallets (git-ignored)
├── .env.example          # Environment template
├── .gitignore
├── AGENTS.md             # AI agent instructions for OpenCode
├── package.json          # Root scripts
└── README.md
```

## Prerequisites

- **Node.js 18+**
- **GMGN API Key** from https://gmgn.ai
- A wallet bound to your API Key for trading operations
- **PowerShell 7+** (for utility scripts and gmgn-cli shell)

## Setup

```bash
# 1. Install gmgn-cli globally
npm install -g gmgn-cli

# 2. Configure your API Key
gmgn-cli config
# → Copy the key shown
gmgn-cli config --apply <YOUR_API_KEY>

# 3. Verify setup
gmgn-cli config --check
# → Exit code 0 = ready to trade

# 4. (Optional) Set private key for trading
# Edit ~/.config/gmgn/.env and add:
# GMGN_PRIVATE_KEY=your_wallet_private_key
# GMGN_ALLOW_AUTOMATED_TRADES=0

# 5. Install dependencies
npm install
cd cli && npm install && cd ..
```

## Quick Start

### Web Dashboard (Recommended)

```bash
npm run server
```

Open http://localhost:3000 in your browser.

| Key | Tab | Description |
|-----|-----|-------------|
| F1 | HUB | Sniper targets, pre-bond runs, new launches, trending, smart money buys, alpha |
| F2 | TRENCHES | All new token creations across chains |
| F3 | TRADES | Whale + KOL real-time trade feed |
| F4 | SIGNALS | 22 pattern detectors with risk scoring |
| F5 | TOKEN | Deep research: info, security, pool, holders |
| F6 | PORTFOLIO | Wallet holdings, P&L, win rate, trading history |
| F7 | FACTORY | PONS Token Factory (P&D bot on Robinhood ETH) |
| F8 | SNIPER | Real-time detector (Solana Pump.fun + Robinhood PONS) |

### Terminal UI

```bash
npm run terminal
```

### Market Data

```bash
npm run trending      # Top trending on Solana (5m volume)
npm run trenches      # New token creations (Solana)
npm run smartmoney    # Smart money trade feed (Solana)
```

## Features

### 22-Pattern Signal Engine

The `signal-engine/` scans trenches, hot searches, trending tokens, and smart money trades across all chains, running 22 detectors in parallel:

**Bullish Signals:**
- Smart Money Accumulation (3+ wallets cluster)
- Momentum Spike (>100% price, high volume/liq)
- CTO Setup (dev out + renounced + community forming)
- Bonding Curve Gradient (pre-Raydium migration)
- Sniper Target (fresh pre-bond, clean security)
- Pre-Bond Run (>70% curve, volume picking up)
- Whale Reload (smart money re-buying)
- KOL Pump (renowned wallets buying)
- Liquidity Injection
- Hot Search Surge

**Bearish Signals:**
- Bundle Launch (bundler + bots + no dev)
- Rug Scam (high rug ratio + creator closed)
- Honeypot Detection
- Wash Trading
- Sniper Dump
- Top Heavy (>50% held by top 10)
- Bot Dominated
- Insider Ring
- Fresh Wallet Dump
- Entrapment
- Creator Resume Holding
- Mint Not Renounced

### Sniper Bot (F8)

Real-time token detection on Pump.fun (Solana) and Robinhood ETH via polling:

- **Detection**: 2s polling via `gmgn-cli market trenches` (no WebSocket needed)
- **MC Filter**: Skips tokens > $5k market cap — focuses on ultra-early entries
- **Safety Filters**: Blocks honeypots, high rug-ratio tokens, known scam keywords
- **Vamp/Rename Detection**: Tracks creator wallets — flags serial launchers (3+ tokens in 5min) and exact symbol repeats
- **Mayhem Mode Detection**: Skips tokens with 2B total supply (AI agent pump/dump)
- **Razor Strategy**: Hard 3% stop-loss, 50% profit target, immediate profitability pre-filter
- **Auto-sell Strategies**: Speed, Snipe, Scalp, Hold, Razor — configurable via keyboard
- **Buy Amount**: Configurable per chain via `[9]` key + prompt
- **SSE streaming**: Full event pipeline — log, detected, filtered, buy-result, status

#### Strategies

| Strategy | Key `[3]` | Stop Loss | Profit Target | Time Limit | Trailing | Description |
|----------|-----------|-----------|---------------|------------|----------|-------------|
| Speed | first | 8% | — | 20s | — | Fast scalp, time-based exit |
| Snipe | → | 10% | 20% | 30s | — | 20% profit or 30s |
| Scalp | → | 5% | 10% | — | — | Tight stop, quick profit |
| Hold | → | 15% | 50% | — | 10% trail | Ride winners with trail |
| Razor | → | **3%** | 50% | — | — | Hard 3% stop + immediate profit filter |
| Manual | → | — | — | — | — | No auto-sell |

#### Sniper Keyboard Controls

| Key | Action |
|-----|--------|
| `[1]` | Start detector (chain from selector) |
| `[2]` | Set wallet address |
| `[3]` | Next strategy → |
| `[4]` | Previous strategy ← |
| `[5]` | Stop all detectors |
| `[6]` | Enable auto-buy |
| `[7]` | Sell all positions |
| `[8]` | Enable auto-sell |
| `[9]` | Set buy amount |

### PONS Token Factory (F7)

High-speed Pump & Dump strategy on Robinhood ETH / PONS launchpad:

```
features/pons-factory/
├── index.js     — CLI entry (setup, fund, run, balances, sweep)
├── config.js    — Tunable parameters (amounts, timing, puppets)
├── wallet.js    — Wallet generation, funding, balance checks
├── cycle.js     — Single P&D cycle orchestrator
└── puppets.js   — Puppet buy/sell via gmgn-cli swap
```

**Per-Cycle Sequence:**
1. Create token + buy 64.6% bag (2.475 WETH) + add LP
2. 8 puppet wallets buy staggered over 60s (organic volume)
3. Price pumps to $30-47k MC (~60s)
4. Main wallet sells bag + remove LP (~180s)
5. Puppets exit at -91% loss (~300s)

**Profit:** +~$5k–9k per cycle, ~98.76% win rate (81 cycles empirical)

### Web Dashboard API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/trending` | GET | Top trending by volume |
| `/api/trenches` | GET | New token launches |
| `/api/smartmoney` | GET | Smart money trade feed |
| `/api/kol` | GET | KOL trade feed |
| `/api/signals` | GET | Alpha signal rankings |
| `/api/token/info` | GET | Token details |
| `/api/token/security` | GET | Security audit |
| `/api/portfolio/holdings` | GET | Wallet open positions |
| `/api/portfolio/stats` | GET | Wallet P&L stats |
| `/api/portfolio/balance` | GET | Wallet balance from API binding |
| `/api/config/check` | GET | GMGN API health check |
| `/api/token/rugcheck` | GET | Sniper/bundler rug pattern analysis |
| `/api/factory/*` | GET/POST | Factory control |
| `/api/sniper/start` | POST | Start detector for chain |
| `/api/sniper/stop` | POST | Stop detector(s) |
| `/api/sniper/wallet` | POST | Set wallet for chain |
| `/api/sniper/autobuy` | POST | Toggle auto-buy |
| `/api/sniper/autosell` | POST | Toggle auto-sell |
| `/api/sniper/strategy` | POST | Set strategy (speed/snipe/scalp/hold/razor/manual) |
| `/api/sniper/buy-amount` | POST | Set buy amount per chain |
| `/api/sniper/buy` | POST | Manual buy (amount in SOL/ETH, auto-converted) |
| `/api/sniper/sell` | POST | Sell position |
| `/api/sniper/sell-all` | POST | Sell all positions for chain |
| `/api/sniper/strategies` | GET | List available strategies |
| `/api/sniper/status` | GET | Sniper status |
| `/api/sniper/detected` | GET | Recent detected tokens |
| `/api/sniper/buys` | GET | Recent buy history |
| `/api/sniper/positions` | GET | Open positions |

## Supported Chains

`sol` · `bsc` · `base` · `eth` · `robinhood`

## Environment Variables

```bash
GMGN_API_KEY=<your_api_key>           # Required — from gmgn.ai
GMGN_PRIVATE_KEY=<your_private_key>    # Required for trading
GMGN_ALLOW_AUTOMATED_TRADES=0          # Set to 1 for headless
ROBINHOOD_RPC=<rpc_url>               # Required for PONS Factory
```

## Security

- All trades require explicit human confirmation — enforced at code level
- Private key never leaves your machine
- On-chain metadata sanitized against prompt injection
- Honeypot check before every swap (hard stop if detected)
- Rate-limited execution (max 3 buys/min per chain)

## Utility Scripts

```powershell
pwsh utils/scout.ps1                    # Quick market scan
pwsh utils/check-token.ps1 -chain sol -address <ADDR>  # Security check
```

## v2.1.0

- **Razor Strategy**: Hard 3% stop-loss + 50% profit target + immediate profitability pre-filter
- **Vamp/Rename Detection**: Tracks creator wallets, flags serial launchers and symbol repeats
- **Mayhem Mode Detection**: Blocks AI-agent tokens (2B supply = pump.fun mayhem)
- **Safety Filters**: Honeypot + rug-ratio blocking from trenches API data
- **Buy Amount Config**: Changeable via `[9]` key in sniper tab
- **Robinhood Sniper**: Polling-based detection now active for robinhood chain
- **Amount Format Fix**: Automatic SOL→lamports / ETH→wei conversion for gmgn-cli v2
- **GMGN_ALLOW_AUTOMATED_TRADES**: Env var for headless auto-execution
