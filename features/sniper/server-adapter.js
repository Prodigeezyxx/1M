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
  razor:  { label: 'Razor',  sellTime: null, sellProfit: 50, stopLoss: 3, trailPct: null, desc: 'Hard 3% stop, profit target 50%' },
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
    this.buyAmounts = { sol: CONFIG.sol.buyAmount, robinhood: CONFIG.robinhood.buyAmount }
    this.seenTokens = new Set()
    this.priceCache = {}
    this._sellTimers = {}
    this.recentDevs = new Map()  // devWallet -> [{ symbol, name, address, ts }]
    this.devCache = new Map()    // tokenAddress -> devWallet
    this.nameHistory = new Map() // name.lower -> ts (last 5 min)
    this._devResolveQueue = []
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

  setBuyAmount(chain, amount) {
    const num = parseFloat(amount)
    if (!num || num <= 0) { this.log(`Invalid buy amount: ${amount}`); return }
    this.buyAmounts[chain] = String(num)
    this.log(`Buy amount for ${chain}: ${num}`)
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
      const mcLabel = token.mc ? ` MC:$${token.mc}` : ''
      this.emit('log', `[${chain.toUpperCase()}] New: ${token.address.slice(0, 10)}..  ${token.name || token.symbol || ''}${mcLabel}`)

      const filterResult = await filterToken(token, chain)
      if (!filterResult.pass) {
        const reasons = filterResult.failed.map(f => f.result.reason).join(', ')
        this.emit('log', `  filtered: ${reasons}`)
        this.emit('filtered', { token, reason: reasons })
        return
      }
      this.emit('log', `  passed filters`)

      // Safety checks from trenches data (no extra API calls)
      if (token.is_honeypot === true || token.is_honeypot === 'true') {
        this.emit('log', `  [HONEYPOT] ${token.symbol} — blocked`)
        this.emit('filtered', { token, reason: 'honeypot' })
        return
      }
      const rug = parseFloat(token.rug_ratio || 0)
      if (rug > 0.5) {
        this.emit('log', `  [RUG RISK] ${token.symbol} — rug_ratio ${rug}`)
        this.emit('filtered', { token, reason: `rug_${rug}` })
        return
      }

      this.resolveDev(token, chain)

      const vc = this.isVampOrRename(token)
      if (vc) {
        this.emit('log', `  [VAMP/${vc.reason}] ${token.symbol} → ${vc.match} (${vc.matchTs}s ago)`)
        return
      }
      if (this.isMayhem(token)) {
        this.emit('log', `  [MAYHEM] ${token.symbol} — AI agent has 1B extra supply, random walk trading`)
        this.emit('filtered', { token, reason: 'mayhem_mode' })
        return
      }
      const nowS = Math.floor(Date.now() / 1e3)
      this.nameHistory.set((token.symbol || '').toLowerCase(), nowS)
      if (this.nameHistory.size > 500) this.nameHistory.clear()

      this.runRugCheck(token.address, chain)

      if (this.autoBuy[chain] && this.wallets[chain]) {
        // Immediate profitability check for Razor: skip if price dropping
        if (this.strategy === 'razor') {
          try {
            const out = execSync(`node "${GMGN_CLI}" token info --chain ${chain} --address ${token.address} --raw`, { encoding: 'utf-8', timeout: 6000 }).trim()
            const info = JSON.parse(out)
            const p1m = parseFloat(info?.price?.price_1m || 0)
            if (p1m <= 0) {
              this.emit('log', `  [RAZOR] ${token.symbol} — price 1m change ${p1m}, skipping (not immediately profitable)`)
              this.emit('filtered', { token, reason: `razor_no_immediate_profit_${p1m}` })
              return
            }
            this.emit('log', `  [RAZOR] ${token.symbol} — price 1m +${p1m}, proceeding`)
          } catch (e) {
            this.emit('log', `  [RAZOR] could not verify price, proceeding anyway`)
          }
        }
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
      if (det.isPlaceholder) this.emit('log', '  [robinhood] WebSocket detector placeholder (polling active)')
      this.startPoller(chain, onDetect)
    }
  }

  executeBuyWithStrategy(chain, token) {
    const buyAmt = this.buyAmounts[chain] || CONFIG[chain].buyAmount
    const result = executeBuy(chain, this.wallets[chain], token.address, (msg) => this.emit('log', msg), buyAmt)
    if (result) {
      this.buys.unshift(result)
      this.buys = this.buys.slice(0, 100)
      if (result.success) {
        this.autoBuyCounts[chain]++
        const addr = token.address
        const buyAmt = this.buyAmounts[chain] || CONFIG[chain].buyAmount
        this.positions[addr] = { chain, amount: buyAmt, ts: Date.now(), highWaterMark: null }
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

        this.priceCache[address] = price

        const buyPrice = pos.entryPrice || price
        if (!pos.entryPrice) pos.entryPrice = price

        const gain = ((price - buyPrice) / buyPrice) * 100
        if (pos.highWaterMark === null || gain > pos.highWaterMark) pos.highWaterMark = gain

        // === SELL SIGNALS ===

        // 1. Stop-loss
        if (strat.stopLoss !== null && gain <= -strat.stopLoss) {
          this.log(`  [STOP-LOSS ${strat.label}] ${address.slice(0, 10)}.. ${gain.toFixed(1)}% ≤ -${strat.stopLoss}%`)
          const r = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
          if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('buy-result', { ...r, type: 'sell', reason: 'stop-loss', profitPct: gain }); return }
        }

        // 2. Trailing stop
        if (strat.trailPct !== null && pos.highWaterMark !== null && pos.highWaterMark > 0) {
          const drawdown = pos.highWaterMark - gain
          if (drawdown >= strat.trailPct) {
            this.log(`  [TRAIL ${strat.label}] ${address.slice(0, 10)}.. high=${pos.highWaterMark.toFixed(1)}% drop=${drawdown.toFixed(1)}% ≥ ${strat.trailPct}%`)
            const r = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
            if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('buy-result', { ...r, type: 'sell', reason: 'trailing-stop', profitPct: gain }); return }
          }
        }

        // 3. Time-based sell
        if (strat.sellTime !== null && elapsed >= strat.sellTime) {
          const msg = gain >= 0 ? `+${gain.toFixed(1)}%` : `${gain.toFixed(1)}%`
          this.log(`  [TIME ${strat.label}] ${address.slice(0, 10)}.. ${elapsed.toFixed(0)}s elapsed → selling (${msg})`)
          const r = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
          if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('buy-result', { ...r, type: 'sell', reason: 'time', profitPct: gain }); return }
        }

        // 4. Single profit target
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
        const out = execSync(`node "${GMGN_CLI}" market trenches --chain ${chain} --type new_creation --filter-preset safe --limit 20 --raw`, { encoding: 'utf-8', timeout: 10000 }).trim()
        const data = JSON.parse(out)
        const tokens = data?.new_creation || data?.pump || []
        for (const t of tokens) {
          const addr = t.address || t.mint || ''
          const mc = parseFloat(t.market_cap || t.marketCap || t.mc || 0)
          if (!addr || seen.has(addr)) continue
          if (mc > 5000) continue
          seen.add(addr)
          if (seen.size > 1000) seen.clear()
          onDetect({ chain, address: addr, name: t.name || t.symbol || '', symbol: t.symbol || '', mc, liq: parseFloat(t.liquidity || t.liq || 0), age: parseInt(t.created_timestamp) || t.age || 0, creator: t.creator || '', total_supply: t.total_supply, is_honeypot: t.is_honeypot, rug_ratio: t.rug_ratio, owner_renounced: t.owner_renounced, renounced_mint: t.renounced_mint, source: 'poll' })
        }
      } catch {}
      setTimeout(poll, 2000)
    }
    setTimeout(poll, 1000)
  }

  resolveDev(token, chain) {
    let dev = token.creator || ''
    if (!dev && !this.devCache.has(token.address)) {
      try {
        const out = execSync(`node "${GMGN_CLI}" token info --chain ${chain} --address ${token.address} --raw`, { encoding: 'utf-8', timeout: 6000 }).trim()
        const info = JSON.parse(out)?.data || JSON.parse(out) || {}
        dev = info.creator || info.creator_address || info.deployer || info.authority || ''
      } catch {}
    }
    if (dev) {
      this.devCache.set(token.address, dev)
      const now = Date.now()
      if (!this.recentDevs.has(dev)) this.recentDevs.set(dev, [])
      const hist = this.recentDevs.get(dev)
      hist.push({ symbol: token.symbol, name: token.name, address: token.address, ts: now })
      if (hist.length > 20) hist.shift()
      if (token.creator) this.emit('log', `  dev: ${dev.slice(0, 8)}..`)
    }
  }

  isMayhem(token) {
    return parseInt(token.totalSupply || token.total_supply || 0) >= 2000000000
  }

  isVampOrRename(token) {
    const sym = (token.symbol || '').toLowerCase()
    const name = (token.name || '').toLowerCase()
    const now = Date.now()
    const dev = this.devCache.get(token.address) || token.creator || ''

    // Check if same dev launched 3+ tokens in last 5 min (serial launcher)
    if (dev && this.recentDevs.has(dev)) {
      const hist = this.recentDevs.get(dev)
      const recent = hist.filter(t => now - t.ts < 300000).length
      if (recent >= 3) {
        const last = hist[hist.length - 1]
        return { reason: `serial_launcher_${recent}`, match: last?.symbol || dev.slice(0, 8), matchTs: Math.floor((now - hist[hist.length - 1]?.ts) / 1000) }
      }
    }

    // Exact symbol/name match in last 5 min across known devs
    if (dev) {
      const history = this.recentDevs.get(dev) || []
      for (const t of history) {
        if (t.address === token.address) continue
        const age = (now - t.ts) / 1000
        if (age > 300) continue
        const tSym = (t.symbol || '').toLowerCase()
        const tName = (t.name || '').toLowerCase()
        if ((sym && tSym === sym) || (name && tName === name)) {
          return { reason: 'exact_rename', match: t.symbol || t.name, matchTs: Math.floor(age) }
        }
      }
    }

    // Global exact symbol match in last 2 min (even if dev unknown yet)
    const seen = this.nameHistory.get(sym)
    if (seen && sym.length >= 2 && seen !== Math.floor(Date.now() / 1e3)) {
      const age = Math.floor(Date.now() / 1e3) - seen
      if (age < 120) return { reason: 'symbol_repeat', match: token.symbol, matchTs: age }
    }

    return null
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
      buyAmounts: { ...this.buyAmounts },
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
