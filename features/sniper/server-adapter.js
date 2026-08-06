const EventEmitter = require('events')
const path = require('path')
const GMGN_CLI = path.join(process.env.APPDATA, 'npm', 'node_modules', 'gmgn-cli', 'dist', 'index.js')
const { execAsync, errorText } = require('./exec-util')
const { filterToken } = require('./filter')
const { startSolDetector } = require('./detector-sol')
const { startEthDetector } = require('./detector-eth')
const { executeBuy, executeSell } = require('./executor')
const { checkSolMint } = require('./solana-safety')
const { CONFIG } = require('./config')

const STRATEGIES = {
  speed:  { label: 'Speed',  sellTime: 20,  sellProfit: null, stopLoss: 8,   trailPct: null, desc: 'Auto-sell after 20s' },
  snipe:  { label: 'Snipe',  sellTime: 30,  sellProfit: 20,  stopLoss: 10,  trailPct: null, desc: '20% profit or 30s' },
  scalp:  { label: 'Scalp',  sellTime: null, sellProfit: 10, stopLoss: 5,   trailPct: null, desc: '10% profit, -5% stop' },
  hold:   { label: 'Hold',   sellTime: null, sellProfit: 50, stopLoss: 15,  trailPct: 10,  desc: '50% profit, 10% trail' },
  razor:  { label: 'Razor',  sellTime: null, sellProfit: 50, stopLoss: 3, trailPct: null, desc: 'Hard 3% stop, profit target 50%' },
  manual: { label: 'Manual', sellTime: null, sellProfit: null, stopLoss: null, trailPct: null, desc: 'No automatic execution' },
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
    this.executionBlocked = { sol: null, robinhood: null }
  }

  log(msg) { this.emit('log', String(msg)) }

  setWallet(chain, address) {
    this.wallets[chain] = address
    this.log(`Wallet set for ${chain}: ${address}`)
    this.emit('status', this.getStatus())
  }

  setAutoBuy(chain, enabled) {
    if (enabled && this.executionBlocked[chain]) {
      this.log(`Auto-buy ${chain} blocked: ${this.executionBlocked[chain]}`)
      return false
    }
    this.autoBuy[chain] = enabled
    this.log(`Auto-buy ${chain}: ${enabled ? 'ON' : 'OFF'}`)
    this.emit('status', this.getStatus())
    return true
  }

  setBuyAmount(chain, amount) {
    const num = parseFloat(amount)
    if (!num || num <= 0) { this.log(`Invalid buy amount: ${amount}`); return }
    if (num > parseFloat(CONFIG[chain].maxBuyAmount)) {
      this.log(`Buy amount exceeds ${chain} safety cap: ${CONFIG[chain].maxBuyAmount}`)
      return false
    }
    this.buyAmounts[chain] = String(num)
    this.log(`Buy amount for ${chain}: ${num}`)
    this.emit('status', this.getStatus())
    return true
  }

  setAutoSell(chain, enabled, targetPct) {
    this.autoSell[chain] = enabled
    if (targetPct) this.sellTargets[chain] = targetPct
    this.log(`Auto-sell ${chain}: ${enabled ? 'ON at ' + (targetPct || this.sellTargets[chain]) + '%' : 'OFF'}`)
    if (enabled) {
      for (const [address, position] of Object.entries(this.positions)) {
        if (position.chain === chain) this.watchPosition(chain, address)
      }
    }
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
      // WebSocket events are the earliest possible signal, but they do not yet
      // contain enough holder/liquidity/risk data for safe automatic execution.
      if (token.source === 'ws') {
        this.emit('log', `[SOL] Raw launch: ${token.address.slice(0, 10)}.. — awaiting enriched trench data`)
        this.emit('raw-detected', token)
        return false
      }

      const key = token.address || token.signature
      if (this.seenTokens.has(key)) return
      const mcLabel = token.mc ? ` MC:$${token.mc}` : ''
      this.emit('log', `[${chain.toUpperCase()}] Screening: ${token.address.slice(0, 10)}..  ${token.name || token.symbol || ''}${mcLabel}`)

      const filterResult = await filterToken(token, chain)
      if (!filterResult.pass) {
        const reasons = filterResult.failed.map(f => f.result.reason).join(', ')
        this.emit('log', `  filtered: ${reasons}`)
        this.emit('filtered', { token, reason: reasons })
        return
      }

      await this.resolveDev(token, chain)
      const vc = this.isVampOrRename(token)
      if (vc) {
        this.emit('log', `  [VAMP/${vc.reason}] ${token.symbol} → ${vc.match} (${vc.matchTs}s ago) — blocked`)
        this.emit('filtered', { token, reason: vc.reason })
        return false
      }

      const nowS = Math.floor(Date.now() / 1e3)
      this.nameHistory.set((token.symbol || '').toLowerCase(), nowS)
      if (this.nameHistory.size > 500) this.nameHistory.clear()

      if (chain !== 'sol' && !(await this.checkEvmSecurity(token))) {
        return false
      }
      if (chain === 'sol') {
        const mintSafety = await checkSolMint(token.address)
        if (!mintSafety.pass) {
          this.log(`  [SOL SECURITY] ${token.symbol} — blocked: ${mintSafety.reason}`)
          this.emit('filtered', { token, reason: mintSafety.reason })
          return false
        }
      }

      this.seenTokens.add(key)
      if (this.seenTokens.size > 500) this.seenTokens.clear()
      token.vettedAt = Date.now()
      this.detected.unshift(token)
      this.detected = this.detected.slice(0, 200)
      this.emit('detected', token)
      this.emit('log', `  vetted candidate — passed execution gates`)
      this.runRugCheck(token.address, chain).catch(() => {})

      if (this.autoBuy[chain] && this.wallets[chain]) {
        // Immediate profitability check for Razor: skip if price dropping
        if (this.strategy === 'razor') {
          try {
            const out = (await execAsync(`node "${GMGN_CLI}" token info --chain ${chain} --address ${token.address} --raw`, { timeout: 6000 })).trim()
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
        this.executeBuyWithStrategy(chain, token).catch(err => this.log(`  buy pipeline error: ${err.message}`))
      }
      return true
    }

    const onStatus = (status) => {
      this.emit('status', { ...this.getStatus(), chainStatus: status })
    }

    if (chain === 'sol') {
      this.detectors.sol = startSolDetector(onDetect, onStatus)
      this.startPoller(chain, onDetect)
      this.log(`Solana detector started (WebSocket visibility + vetted polling execution)`)
    } else if (chain === 'robinhood') {
      const det = startEthDetector(onDetect, onStatus)
      this.detectors.robinhood = det
      if (det.isPlaceholder) this.emit('log', '  [robinhood] WebSocket detector placeholder (polling active)')
      this.startPoller(chain, onDetect)
    }
  }

  async executeBuyWithStrategy(chain, token) {
    const buyAmt = this.buyAmounts[chain] || CONFIG[chain].buyAmount
    const result = await executeBuy(chain, this.wallets[chain], token.address, (msg) => this.emit('log', msg), buyAmt)
    if (result) {
      this.buys.unshift(result)
      this.buys = this.buys.slice(0, 100)
      if (result.authError) {
        this.executionBlocked[chain] = 'AUTH_SIGNATURE_INVALID — private key does not authorize the bound wallet'
        this.autoBuy[chain] = false
        this.log(`  [CIRCUIT BREAKER] ${chain} auto-buy disabled: ${this.executionBlocked[chain]}`)
        this.emit('status', this.getStatus())
        return result
      }
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
    return result
  }

  watchPosition(chain, address) {
    const strat = this.getStrategyConfig()
    const wallet = this.wallets[chain]
    if (!wallet || !this.positions[address]) return
    if (this._sellTimers[address]) clearTimeout(this._sellTimers[address])

    const check = async () => {
      if (!this.positions[address] || !this.autoSell[chain]) return
      const pos = this.positions[address]
      const elapsed = (Date.now() - pos.ts) / 1000

      // Get current price
      try {
        const out = (await execAsync(`node "${GMGN_CLI}" token info --chain ${chain} --address ${address} --raw`, { timeout: 8000 })).trim()
        const data = JSON.parse(out)
        const price = parseFloat(data?.data?.price?.price || data?.price?.price || data?.data?.price || data?.price || 0)
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
          const r = await executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
          if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('sell-result', { ...r, reason: 'stop-loss', profitPct: gain }); return }
        }

        // 2. Trailing stop
        if (strat.trailPct !== null && pos.highWaterMark !== null && pos.highWaterMark > 0) {
          const drawdown = pos.highWaterMark - gain
          if (drawdown >= strat.trailPct) {
            this.log(`  [TRAIL ${strat.label}] ${address.slice(0, 10)}.. high=${pos.highWaterMark.toFixed(1)}% drop=${drawdown.toFixed(1)}% ≥ ${strat.trailPct}%`)
            const r = await executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
            if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('sell-result', { ...r, reason: 'trailing-stop', profitPct: gain }); return }
          }
        }

        // 3. Time-based sell
        if (strat.sellTime !== null && elapsed >= strat.sellTime) {
          const msg = gain >= 0 ? `+${gain.toFixed(1)}%` : `${gain.toFixed(1)}%`
          this.log(`  [TIME ${strat.label}] ${address.slice(0, 10)}.. ${elapsed.toFixed(0)}s elapsed → selling (${msg})`)
          const r = await executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
          if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('sell-result', { ...r, reason: 'time', profitPct: gain }); return }
        }

        // 4. Single profit target
        if (strat.sellProfit !== null && gain >= strat.sellProfit) {
          this.log(`  [PROFIT ${strat.label}] ${address.slice(0, 10)}.. +${gain.toFixed(1)}% ≥ ${strat.sellProfit}%`)
          const r = await executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
          if (r?.success) { delete this.positions[address]; clearTimeout(this._sellTimers[address]); this.emit('sell-result', { ...r, reason: 'profit-target', profitPct: gain }); return }
        }

      } catch {}
      this._sellTimers[address] = setTimeout(check, 3000)
    }
    check()
  }

  startPoller(chain, onDetect) {
    const checkedAt = new Map()
    const poll = async () => {
      if (!this.active[chain]) return
      let nextDelay = 10000
      try {
        const filters = chain === 'sol'
          ? '--type new_creation --type near_completion --filter-preset strict --max-rug-ratio 0.2 --max-bundler-rate 0.2 --max-insider-ratio 0.2 --min-holder-count 10 --min-progress 0.1 --min-volume-24h 1000 --min-smart-degen-count 1'
          : '--type new_creation --filter-preset strict --min-holder-count 10 --min-volume-24h 1000'
        const out = (await execAsync(`node "${GMGN_CLI}" market trenches --chain ${chain} ${filters} --limit 40 --raw`, { timeout: 15000 })).trim()
        const data = JSON.parse(out)
        const tokens = [...(data?.new_creation || []), ...(data?.pump || [])]
        for (const t of tokens) {
          const addr = t.address || t.mint || ''
          if (!addr) continue
          const lastCheck = checkedAt.get(addr) || 0
          if (Date.now() - lastCheck < 30000) continue
          checkedAt.set(addr, Date.now())
          const accepted = await onDetect({
            ...t,
            chain,
            address: addr,
            name: t.name || t.symbol || '',
            symbol: t.symbol || '',
            mc: parseFloat(t.market_cap || t.usd_market_cap || 0),
            liq: parseFloat(t.liquidity || 0),
            age: parseInt(t.created_timestamp || 0),
            creator: t.creator || '',
            source: 'poll',
          })
          if (accepted) checkedAt.set(addr, Number.MAX_SAFE_INTEGER)
        }
        if (checkedAt.size > 2000) checkedAt.clear()
      } catch (err) {
        const message = errorText(err)
        nextDelay = /429|RATE_LIMIT/i.test(message) ? 60000 : 15000
        this.log(`  ${chain} poll error — retrying in ${nextDelay / 1000}s: ${message.slice(0, 100)}`)
      }
      if (this.active[chain]) setTimeout(poll, nextDelay)
    }
    setTimeout(poll, 1000)
  }

  async resolveDev(token, chain) {
    let dev = token.creator || ''
    if (!dev && !this.devCache.has(token.address)) {
      try {
        const out = (await execAsync(`node "${GMGN_CLI}" token info --chain ${chain} --address ${token.address} --raw`, { timeout: 6000 })).trim()
        const parsed = JSON.parse(out)
        const info = parsed?.data || parsed || {}
        dev = info.creator || info.creator_address || info.dev?.creator_address || info.deployer || info.authority || ''
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

  async checkEvmSecurity(token) {
    try {
      const out = await execAsync(`node "${GMGN_CLI}" token security --chain ${token.chain} --address ${token.address} --raw`, { timeout: 8000 })
      const sec = JSON.parse(out.trim())
      const reasons = []
      if (sec.is_honeypot === true || sec.is_honeypot === 'true' || sec.honeypot === 1) reasons.push('honeypot')
      if (sec.can_sell === 0 || sec.can_not_sell === 1) reasons.push('cannot_sell')
      if (sec.is_open_source === false || sec.open_source === 0 || sec.open_source === 'no') reasons.push('source_not_verified')
      if (sec.is_renounced === false || sec.renounced === -1 || sec.owner_renounced === 'no') reasons.push('not_renounced')
      if (sec.lock_summary?.is_locked === false) reasons.push('liquidity_unlocked')
      if (sec.is_show_alert === true) reasons.push('gmgn_alert')
      if (reasons.length) {
        this.log(`  [SECURITY] ${token.symbol} — blocked: ${reasons.join(', ')}`)
        this.emit('filtered', { token, reason: reasons.join(',') })
        return false
      }
      return true
    } catch (err) {
      this.log(`  [SECURITY] ${token.symbol} — blocked: security unavailable`)
      this.emit('filtered', { token, reason: 'security_unavailable' })
      return false
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
    this.active[chain] = false
    this.emit('status', this.getStatus())
  }

  stopAll() { this.stop('sol'); this.stop('robinhood'); this.log('All stopped.') }

  async runRugCheck(address, chain) {
    try {
      const out = await execAsync(`node "${GMGN_CLI}" token traders --chain ${chain} --address ${address} --limit 15 --order-by profit --direction desc --raw`, { timeout: 10000 })
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
      executionBlocked: { ...this.executionBlocked },
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
