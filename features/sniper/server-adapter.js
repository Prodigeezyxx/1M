const EventEmitter = require('events')
const { execSync, exec } = require('child_process')
const path = require('path')
const GMGN_CLI = path.join(process.env.APPDATA, 'npm', 'node_modules', 'gmgn-cli', 'dist', 'index.js')
const { filterToken, quickRugCheck } = require('./filter')
const { startSolDetector } = require('./detector-sol')
const { startEthDetector } = require('./detector-eth')
const { executeBuy, executeSell } = require('./executor')
const { CONFIG } = require('./config')

const STRATEGIES = {
  speed:  { label: 'Speed',  sellTime: 20,  sellProfit: null, stopLoss: 8,   trailPct: null, desc: 'Auto-sell after 20s' },
  snipe:  { label: 'Snipe',  sellTime: 30,  sellProfit: 20,  stopLoss: 10,  trailPct: null, desc: '20% profit or 30s' },
  scalp:  { label: 'Scalp',  sellTime: null, sellProfit: 10, stopLoss: 5,   trailPct: null, desc: '10% profit, -5% stop' },
  hold:   { label: 'Hold',   sellTime: null, sellProfit: 50, stopLoss: 15,  trailPct: 10,  desc: '50% profit, 10% trail' },
}

class SniperServerAdapter extends EventEmitter {
  constructor() {
    super()
    this.detectors = { sol: null, robinhood: null }
    this.active = { sol: false, robinhood: false }
    this.wallets = { sol: null, robinhood: null }
    this.autoBuy = { sol: false, robinhood: false }
    this.autoSell = { sol: false, robinhood: false }
    this.sellTargets = { sol: 25, robinhood: 25 }
    this.strategy = 'snipe'
    this.detected = []
    this.buys = []
    this.positions = {}
    this.autoBuyCounts = { sol: 0, robinhood: 0 }
    this.seenTokens = new Set()
    this.priceCache = {}
    this._sellTimers = {}
  }

  log(msg) { this.emit('log', String(msg)) }

  setWallet(chain, address) {
    this.wallets[chain] = address
    this.log(`Wallet set for ${chain}: ${address}`)
    this.emit('status', this.getStatus())
  }

  setAutoBuy(chain, enabled) {
    this.autoBuy[chain] = enabled
    this.log(`Auto-buy ${chain}: ${enabled ? 'ON' : 'OFF'}`)
    this.emit('status', this.getStatus())
  }

  setAutoSell(chain, enabled, targetPct) {
    this.autoSell[chain] = enabled
    if (targetPct) this.sellTargets[chain] = targetPct
    this.log(`Auto-sell ${chain}: ${enabled ? 'ON at ' + (targetPct || this.sellTargets[chain]) + '%' : 'OFF'}`)
    this.emit('status', this.getStatus())
  }

  setStrategy(name) {
    if (!STRATEGIES[name]) { this.log(`Unknown strategy: ${name}`); return }
    this.strategy = name
    const s = STRATEGIES[name]
    this.log(`Strategy: ${s.label} — ${s.desc}`)
    this.emit('status', this.getStatus())
  }

  getStrategyConfig() {
    return STRATEGIES[this.strategy] || STRATEGIES.snipe
  }

  start(chain) {
    if (this.active[chain]) { this.log(`${chain} already running`); return }
    this.log(`Starting ${chain} detector...`)
    this.active[chain] = true

    const onDetect = async (token) => {
      const key = token.address || token.signature
      if (this.seenTokens.has(key)) return
      this.seenTokens.add(key)
      if (this.seenTokens.size > 500) this.seenTokens.clear()

      this.detected.unshift(token)
      this.detected = this.detected.slice(0, 200)
      this.emit('detected', token)
      this.emit('log', `[${chain.toUpperCase()}] New: ${token.address.slice(0, 10)}..  ${token.name || token.symbol || ''}`)

      const filterResult = await filterToken(token, chain)
      if (!filterResult.pass) {
        const reasons = filterResult.failed.map(f => f.result.reason).join(', ')
        this.emit('log', `  filtered: ${reasons}`)
        this.emit('filtered', { token, reason: reasons })
        return
      }
      this.emit('log', `  passed filters`)

      this.runRugCheck(token.address, chain)

      if (this.autoBuy[chain] && this.wallets[chain]) {
        this.emit('log', `  auto-buy...`)
        this.executeBuyWithStrategy(chain, token)
      }
    }

    const onStatus = (status) => {
      this.emit('status', { ...this.getStatus(), chainStatus: status })
    }

    if (chain === 'sol') {
      this.detectors.sol = startSolDetector(onDetect, onStatus)
      this.startPoller(chain, onDetect)
    } else if (chain === 'robinhood') {
      const det = startEthDetector(onDetect, onStatus)
      this.detectors.robinhood = det
      if (det.isPlaceholder) this.emit('log', '  [robinhood] PONS_FACTORY not set')
    }
  }

  executeBuyWithStrategy(chain, token) {
    const result = executeBuy(chain, this.wallets[chain], token.address, (msg) => this.emit('log', msg))
    if (result) {
      this.buys.unshift(result)
      this.buys = this.buys.slice(0, 100)
      if (result.success) {
        this.autoBuyCounts[chain]++
        const addr = token.address
        this.positions[addr] = { chain, amount: CONFIG[chain].buyAmount, ts: Date.now(), highWaterMark: null }
        this.emit('buy-result', result)
        this.log(`  [BOUGHT] ${addr.slice(0, 10)}.. — strategy: ${STRATEGIES[this.strategy].label}`)
        if (this.autoSell[chain]) this.watchPosition(chain, addr)
      }
    }
  }

  watchPosition(chain, address) {
    const strat = this.getStrategyConfig()
    const wallet = this.wallets[chain]
    if (!wallet || !this.positions[address]) return

    const check = () => {
      if (!this.active[chain] || !this.positions[address] || !this.autoSell[chain]) return
      const pos = this.positions[address]
      const elapsed = (Date.now() - pos.ts) / 1000

      // Get current price
      try {
        const out = execSync(`node "${GMGN_CLI}" token info --chain ${chain} --address ${address} --raw`, { encoding: 'utf-8', timeout: 8000 }).trim()
        const data = JSON.parse(out)
        const price = parseFloat(data?.data?.price || data?.price || 0)
        if (price <= 0) { this._sellTimers[address] = setTimeout(check, 5000); return }

        // Store price for manual reference
        this.priceCache[address] = price

        // Estimate buy price from first check or use price as reference
        const buyPrice = pos.entryPrice || price
        if (!pos.entryPrice) pos.entryPrice = price

        const gain = ((price - buyPrice) / buyPrice) * 100
        if (pos.highWaterMark === null || gain > pos.highWaterMark) pos.highWaterMark = gain

        // === SELL SIGNALS ===

        // 1. Stop-loss: price drops below threshold
        if (strat.stopLoss !== null && gain <= -strat.stopLoss) {
          this.log(`  [STOP-LOSS ${strat.label}] ${address.slice(0, 10)}.. ${gain.toFixed(1)}% ≤ -${strat.stopLoss}%`)
          const r = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
          if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('buy-result', { ...r, type: 'sell', reason: 'stop-loss', profitPct: gain }); return }
        }

        // 2. Trailing stop: if enabled, sell when price drops X% from high
        if (strat.trailPct !== null && pos.highWaterMark !== null && pos.highWaterMark > 0) {
          const drawdown = pos.highWaterMark - gain
          if (drawdown >= strat.trailPct) {
            this.log(`  [TRAIL ${strat.label}] ${address.slice(0, 10)}.. high=${pos.highWaterMark.toFixed(1)}% drop=${drawdown.toFixed(1)}% ≥ ${strat.trailPct}%`)
            const r = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
            if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('buy-result', { ...r, type: 'sell', reason: 'trailing-stop', profitPct: gain }); return }
          }
        }

        // 3. Time-based sell: if sellTime is set and elapsed time exceeds it
        if (strat.sellTime !== null && elapsed >= strat.sellTime) {
          // Sell regardless of profit (take what we have)
          const msg = gain >= 0 ? `+${gain.toFixed(1)}%` : `${gain.toFixed(1)}%`
          this.log(`  [TIME ${strat.label}] ${address.slice(0, 10)}.. ${elapsed.toFixed(0)}s elapsed → selling (${msg})`)
          const r = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
          if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('buy-result', { ...r, type: 'sell', reason: 'time', profitPct: gain }); return }
        }

        // 4. Profit target: if sellProfit is set and gain meets/exceeds it
        if (strat.sellProfit !== null && gain >= strat.sellProfit) {
          this.log(`  [PROFIT ${strat.label}] ${address.slice(0, 10)}.. +${gain.toFixed(1)}% ≥ ${strat.sellProfit}%`)
          const r = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
          if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('buy-result', { ...r, type: 'sell', reason: 'profit-target', profitPct: gain }); return }
        }

      } catch {}
      this._sellTimers[address] = setTimeout(check, 3000)
    }
    check()
  }

  startPoller(chain, onDetect) {
    const seen = new Set()
    const poll = () => {
      if (!this.active[chain]) return
      try {
        const out = execSync(`node "${GMGN_CLI}" market trenches --chain ${chain} --type new_creation --filter-preset safe --limit 15 --raw`, { encoding: 'utf-8', timeout: 10000 }).trim()
        const data = JSON.parse(out)
        const tokens = data?.data?.new_creation || data?.data?.pump || []
        for (const t of tokens) {
          const addr = t.address || t.mint || ''
          const mc = parseFloat(t.mc || t.marketCap || 0)
          if (!addr || seen.has(addr)) continue
          // Skip tokens above 5k MC — focus on super early
          if (mc > 5000) continue
          seen.add(addr)
          if (seen.size > 1000) seen.clear()
          onDetect({ chain, address: addr, name: t.name || t.symbol || '', symbol: t.symbol || '', mc, liq: parseFloat(t.liquidity || t.liq || 0), age: t.age || 0, source: 'poll' })
        }
      } catch {}
      setTimeout(poll, 2000)
    }
    setTimeout(poll, 1000)
  }

  stop(chain) {
    if (!this.active[chain]) return
    this.log(`Stopping ${chain} detector...`)
    if (this.detectors[chain]) { this.detectors[chain].stop(); this.detectors[chain] = null }
    // Clear sell timers
    for (const [addr, timer] of Object.entries(this._sellTimers)) {
      clearTimeout(timer); delete this._sellTimers[addr]
    }
    this.active[chain] = false
    this.emit('status', this.getStatus())
  }

  stopAll() { this.stop('sol'); this.stop('robinhood'); this.log('All stopped.') }

  async runRugCheck(address, chain) {
    try {
      const out = execSync(`node "${GMGN_CLI}" token traders --chain ${chain} --address ${address} --limit 15 --order-by profit --direction desc --raw`, { encoding: 'utf-8', timeout: 10000 })
      const data = JSON.parse(out.trim())
      const traders = data?.list || []
      const top = traders.filter(t => parseFloat(t.profit || 0) > 0).slice(0, 8)
      let devProfit = 0, extractors = 0
      for (const t of top) {
        const tags = t.maker_token_tags || []
        if (tags.some(tg => ['dev_team', 'bundler', 'sniper'].includes(tg))) {
          devProfit += parseFloat(t.profit || 0); extractors++
        }
      }
      if (extractors >= 3 && devProfit > 500) {
        this.log(`  \u2622 RUG: ${extractors} dev/bundler wallets extracted $${devProfit.toLocaleString()}`)
        this.emit('rug-flagged', { address, chain, extractors, devProfit, confidence: Math.min(100, 60 + extractors * 5) })
      } else if (extractors > 0) {
        this.log(`  \u26A0 ${extractors} dev/bundler profitable: $${devProfit.toLocaleString()}`)
      }
    } catch {}
  }

  getStatus() {
    const s = STRATEGIES[this.strategy]
    return {
      active: { ...this.active },
      wallets: { ...this.wallets },
      autoBuy: { ...this.autoBuy },
      autoSell: { ...this.autoSell },
      sellTargets: { ...this.sellTargets },
      autoBuyCounts: { ...this.autoBuyCounts },
      positions: Object.keys(this.positions).length,
      detectedCount: this.detected.length,
      buysCount: this.buys.length,
      strategy: this.strategy,
      strategyLabel: s?.label || 'Snipe',
      strategyDesc: s?.desc || '',
      config: {
        solBuyAmt: CONFIG.sol.buyAmount,
        robinBuyAmt: CONFIG.robinhood.buyAmount,
        maxPerMin: CONFIG.crossChain.maxBuyPerMinute,
      },
    }
  }

  getRecentDetected(limit = 30) { return this.detected.slice(0, limit) }
  getRecentBuys(limit = 20) { return this.buys.slice(0, limit) }
  getPositions() { return this.positions }
}

let instance = null
function getAdapter() {
  if (!instance) instance = new SniperServerAdapter()
  return instance
}

module.exports = { SniperServerAdapter, getAdapter, STRATEGIES }
