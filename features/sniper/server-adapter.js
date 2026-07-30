const EventEmitter = require('events')
const { execSync } = require('child_process')
const { filterToken, quickRugCheck } = require('./filter')
const { startSolDetector } = require('./detector-sol')
const { startEthDetector } = require('./detector-eth')
const { executeBuy } = require('./executor')
const { CONFIG } = require('./config')

class SniperServerAdapter extends EventEmitter {
  constructor() {
    super()
    this.detectors = { sol: null, robinhood: null }
    this.active = { sol: false, robinhood: false }
    this.wallets = { sol: null, robinhood: null }
    this.autoBuy = { sol: false, robinhood: false }
    this.detected = []
    this.buys = []
    this.autoBuyCounts = { sol: 0, robinhood: 0 }
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

  start(chain) {
    if (this.active[chain]) { this.log(`${chain} already running`); return }

    this.log(`Starting ${chain} detector...`)
    this.active[chain] = true

    const onDetect = async (token) => {
      this.detected.unshift(token)
      this.detected = this.detected.slice(0, 200)
      this.emit('detected', token)
      this.emit('log', `[${chain.toUpperCase()}] New token: ${token.address.slice(0, 10)}..  ${token.name || token.symbol || ''}`)

      // Run filters
      const filterResult = await filterToken(token, chain)
      if (!filterResult.pass) {
        const reasons = filterResult.failed.map(f => f.result.reason).join(', ')
        this.emit('log', `  filtered: ${reasons}`)
        this.emit('filtered', { token, reason: reasons })
        return
      }

      this.emit('log', `  passed filters ✓`)

      // Fire-and-forget deep rug check (non-blocking)
      this.runRugCheck(token.address, chain)

      // Auto-buy if enabled and wallet is set
      if (this.autoBuy[chain] && this.wallets[chain]) {
        this.emit('log', `  auto-buy triggered...`)
        const result = executeBuy(chain, this.wallets[chain], token.address, (msg) => this.emit('log', msg))
        if (result) {
          this.buys.unshift(result)
          this.buys = this.buys.slice(0, 100)
          if (result.success) this.autoBuyCounts[chain]++
          this.emit('buy-result', result)
        }
      }
    }

    const onStatus = (status) => {
      this.emit('status', { ...this.getStatus(), chainStatus: status })
      const label = status.status === 'listening' ? 'listening' : status.status === 'error' ? `error: ${status.error}` : status.status
      this.emit('log', `  [${status.chain}] ${label}`)
    }

    if (chain === 'sol') {
      this.detectors.sol = startSolDetector(onDetect, onStatus)
    } else if (chain === 'robinhood') {
      const det = startEthDetector(onDetect, onStatus)
      this.detectors.robinhood = det
      if (det.isPlaceholder) {
        this.emit('log', '  [robinhood] PONS_FACTORY not set — update .env with real address')
      }
    }
  }

  stop(chain) {
    if (!this.active[chain]) return
    this.log(`Stopping ${chain} detector...`)
    if (this.detectors[chain]) {
      this.detectors[chain].stop()
      this.detectors[chain] = null
    }
    this.active[chain] = false
    this.emit('status', this.getStatus())
  }

  stopAll() {
    this.stop('sol')
    this.stop('robinhood')
    this.log('All detectors stopped.')
  }

  async runRugCheck(address, chain) {
    try {
      const out = execSync(`gmgn-cli token traders --chain ${chain} --address ${address} --limit 15 --order-by profit --direction desc --raw 2>NUL`, { encoding: 'utf-8', timeout: 10000, shell: 'pwsh.exe', windowsHide: true })
      const data = JSON.parse(out.trim())
      const traders = data?.list || []
      const topProfitable = traders.filter(t => parseFloat(t.profit || 0) > 0).slice(0, 8)
      let devProfit = 0, extractors = 0
      for (const t of topProfitable) {
        const tags = t.maker_token_tags || []
        if (tags.some(tg => ['dev_team', 'bundler', 'sniper'].includes(tg))) {
          devProfit += parseFloat(t.profit || 0)
          extractors++
        }
      }
      if (extractors >= 3 && devProfit > 500) {
        this.log(`  \u2622 RUG FLAG: ${extractors} dev/bundler/sniper wallets extracted $${devProfit.toLocaleString()}`)
        this.emit('rug-flagged', { address, chain, extractors, devProfit, confidence: Math.min(100, 60 + extractors * 5) })
      } else if (extractors > 0) {
        this.log(`  \u26A0 ${extractors} dev/bundler wallets profitable: $${devProfit.toLocaleString()}`)
      }
    } catch { /* rugcheck non-critical, silent fail */ }
  }

  getStatus() {
    return {
      active: { ...this.active },
      wallets: { ...this.wallets },
      autoBuy: { ...this.autoBuy },
      autoBuyCounts: { ...this.autoBuyCounts },
      detectedCount: this.detected.length,
      buysCount: this.buys.length,
      config: {
        solBuyAmt: CONFIG.sol.buyAmount,
        robinBuyAmt: CONFIG.robinhood.buyAmount,
        maxPerMin: CONFIG.crossChain.maxBuyPerMinute,
      },
    }
  }

  getRecentDetected(limit = 30) {
    return this.detected.slice(0, limit)
  }

  getRecentBuys(limit = 20) {
    return this.buys.slice(0, limit)
  }
}

let instance = null
function getAdapter() {
  if (!instance) instance = new SniperServerAdapter()
  return instance
}

module.exports = { SniperServerAdapter, getAdapter }
