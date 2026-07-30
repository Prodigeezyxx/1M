const EventEmitter = require('events')
const { execSync, exec } = require('child_process')
const path = require('path')
const GMGN_CLI = path.join(process.env.APPDATA, 'npm', 'node_modules', 'gmgn-cli', 'dist', 'index.js')
const { filterToken, quickRugCheck } = require('./filter')
const { startSolDetector } = require('./detector-sol')
const { startEthDetector } = require('./detector-eth')
const { executeBuy, executeSell } = require('./executor')
const { CONFIG } = require('./config')

class SniperServerAdapter extends EventEmitter {
  constructor() {
    super()
    this.detectors = { sol: null, robinhood: null }
    this.pollers = { sol: null }
    this.active = { sol: false, robinhood: false }
    this.wallets = { sol: null, robinhood: null }
    this.autoBuy = { sol: false, robinhood: false }
    this.autoSell = { sol: false, robinhood: false }
    this.sellTargets = { sol: 25, robinhood: 25 }
    this.detected = []
    this.buys = []
    this.positions = {}  // address -> { buyPrice, chain, amount, ts }
    this.autoBuyCounts = { sol: 0, robinhood: 0 }
    this.seenTokens = new Set()
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

  start(chain) {
    if (this.active[chain]) { this.log(`${chain} already running`); return }

    this.log(`Starting ${chain} detector...`)
    this.active[chain] = true

    const onDetect = async (token) => {
      // Dedup
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

      // Non-blocking rug check
      this.runRugCheck(token.address, chain)

      // Auto-buy
      if (this.autoBuy[chain] && this.wallets[chain]) {
        this.emit('log', `  auto-buy...`)
        const result = executeBuy(chain, this.wallets[chain], token.address, (msg) => this.emit('log', msg))
        if (result) {
          this.buys.unshift(result)
          this.buys = this.buys.slice(0, 100)
          if (result.success) {
            this.autoBuyCounts[chain]++
            this.positions[token.address] = { chain, amount: CONFIG[chain].buyAmount, ts: Date.now() }
            // Start monitoring for auto-sell
            if (this.autoSell[chain]) this.monitorSell(chain, token.address)
          }
          this.emit('buy-result', result)
        }
      }
    }

    const onStatus = (status) => {
      this.emit('status', { ...this.getStatus(), chainStatus: status })
    }

    if (chain === 'sol') {
      // WebSocket detector (may fail silently on public RPC)
      this.detectors.sol = startSolDetector(onDetect, onStatus)
      // Polling fallback detector — watches new trenches for tokens
      this.startPoller(chain, onDetect)
    } else if (chain === 'robinhood') {
      const det = startEthDetector(onDetect, onStatus)
      this.detectors.robinhood = det
      if (det.isPlaceholder) {
        this.emit('log', '  [robinhood] PONS_FACTORY not set')
      }
    }
  }

  startPoller(chain, onDetect) {
    const seen = new Set()
    const poll = () => {
      if (!this.active[chain]) return
      try {
        const out = execSync(`node "${GMGN_CLI}" market trenches --chain ${chain} --type new_creation --filter-preset safe --limit 10 --raw`, { encoding: 'utf-8', timeout: 10000 }).trim()
        const data = JSON.parse(out)
        const tokens = data?.data?.new_creation || data?.data?.pump || []
        for (const t of tokens) {
          const addr = t.address || t.mint || ''
          if (!addr || seen.has(addr)) continue
          seen.add(addr)
          if (seen.size > 1000) seen.clear()
          onDetect({
            chain,
            address: addr,
            name: t.name || t.symbol || '',
            symbol: t.symbol || '',
            mc: t.mc || t.marketCap || 0,
            liq: t.liquidity || t.liq || 0,
            age: t.age || 0,
            source: 'poll',
          })
        }
      } catch {}
      setTimeout(poll, 3000)
    }
    setTimeout(poll, 2000)
  }

  monitorSell(chain, address) {
    const target = this.sellTargets[chain]
    const wallet = this.wallets[chain]
    if (!wallet) return

    const check = () => {
      if (!this.active[chain]) return
      if (!this.positions[address]) return
      if (!this.autoSell[chain]) return

      try {
        const out = execSync(`node "${GMGN_CLI}" token info --chain ${chain} --address ${address} --raw`, { encoding: 'utf-8', timeout: 8000 }).trim()
        const data = JSON.parse(out)
        const currentPrice = parseFloat(data?.data?.price || data?.price || 0)
        const buyPrice = parseFloat(this.positions[address].buyPrice || 0)

        if (buyPrice > 0 && currentPrice > 0) {
          const gain = ((currentPrice - buyPrice) / buyPrice) * 100
          if (gain >= target) {
            this.log(`  [TARGET] ${address.slice(0, 10)}.. +${gain.toFixed(1)}% >= ${target}% → selling`)
            const result = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
            if (result?.success) {
              delete this.positions[address]
              this.emit('buy-result', { ...result, type: 'sell', profitPct: gain })
            }
            return
          }
          // Stop-loss -50% (optional rug protection)
          if (gain <= -50) {
            this.log(`  [STOP-LOSS] ${address.slice(0, 10)}.. ${gain.toFixed(1)}% → selling`)
            const result = executeSell(chain, wallet, address, (msg) => this.emit('log', msg))
            if (result?.success) delete this.positions[address]
            return
          }
        }
      } catch {}
      setTimeout(check, 10000)
    }
    setTimeout(check, 15000)
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

module.exports = { SniperServerAdapter, getAdapter }
