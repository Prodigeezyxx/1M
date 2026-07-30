const EventEmitter = require('events')
const { recordBuy, processSell, getHistory, getStats } = require('./protector')

class ProfitProtectorAdapter extends EventEmitter {
  constructor() {
    super()
    this.enabled = { sol: false, robinhood: false }
  }

  log(msg) { this.emit('log', String(msg)) }

  setEnabled(chain, val) {
    this.enabled[chain] = val
    this.log(`Protector ${chain}: ${val ? 'ON' : 'OFF'}`)
    this.emit('status', this.getStatus())
  }

  onBuy(chain, tokenAddress, costNative) {
    if (!this.enabled[chain]) return
    recordBuy(chain, tokenAddress, costNative)
    this.emit('buy-tracked', { chain, token: tokenAddress, cost: costNative })
  }

  async onSell(chain, tokenAddress, sellProceedsNative, walletAddress) {
    if (!this.enabled[chain]) return
    if (!walletAddress) {
      this.log(`  protector: no ${chain} wallet set — skipping`)
      return
    }
    const result = await processSell(chain, tokenAddress, sellProceedsNative, walletAddress, (msg) => this.emit('log', msg))
    this.emit('sell-processed', { chain, token: tokenAddress, ...result })
    this.emit('status', this.getStatus())
    return result
  }

  getStatus() {
    return {
      enabled: { ...this.enabled },
      profitPercent: 0.50,
      stats: getStats(),
      history: getHistory(20),
    }
  }
}

let instance = null
function getAdapter() {
  if (!instance) instance = new ProfitProtectorAdapter()
  return instance
}

module.exports = { ProfitProtectorAdapter, getAdapter }
