const { execSync } = require('child_process')
const { CONFIG } = require('./config')

const openTrades = { sol: new Map(), robinhood: new Map() }
const tradeHistory = []

function recordBuy(chain, tokenAddress, costNative) {
  const map = openTrades[chain]
  const existing = map.get(tokenAddress)
  const cost = Number(costNative)
  if (existing) {
    existing.cost = existing.cost + cost
  } else {
    map.set(tokenAddress, { token: tokenAddress, chain, cost, enteredAt: Date.now() })
  }
}

function closeTrade(chain, tokenAddress) {
  const trade = openTrades[chain].get(tokenAddress)
  if (trade) openTrades[chain].delete(tokenAddress)
  return trade || null
}

function getHistory(limit = 30) {
  return tradeHistory.slice(-limit).reverse()
}

function getStats() {
  const totalProtected = tradeHistory.reduce((s, t) => s + (t.protectedUsd || 0), 0)
  const totalProfit = tradeHistory.reduce((s, t) => s + (t.profitUsd || 0), 0)
  return {
    totalTrades: tradeHistory.length,
    protectedTrades: tradeHistory.filter(t => t.protectedUsd > 0).length,
    totalProfitUsd: totalProfit,
    totalProtectedUsd: totalProtected,
    pendingTrades: openTrades.sol.size + openTrades.robinhood.size,
  }
}

function gmgnSwap(chain, fromAddress, inputToken, outputToken, amount, log) {
  const cmd = `gmgn-cli swap --chain ${chain} --from ${fromAddress} --input-token ${inputToken} --output-token ${outputToken} --amount ${amount} --auto-slippage --yes`
  log(`  swap: ${amount} → USDC`)
  try {
    const raw = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    return { success: true, raw }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

async function processSell(chain, tokenAddress, sellProceedsNative, walletAddress, log) {
  const trade = closeTrade(chain, tokenAddress)
  if (!trade) {
    log(`  protector: no open trade for ${tokenAddress.slice(0,10)}..`)
    return null
  }

  const profit = Number(sellProceedsNative) - trade.cost
  const protectedAmt = Math.floor(profit * CONFIG.profitPercent)

  const profitStr = profit > 0 ? `<span class="cyan">+${profit}</span>` : `<span class="error">${profit}</span>`
  log(`  profit: ${profitStr}  → protecting ${CONFIG.profitPercent*100}% = ${protectedAmt}`)

  if (protectedAmt <= 0) {
    log(`  not profitable — no USDC swap`)
    tradeHistory.push({ token: tokenAddress, chain, profit, protectedUsd: 0, reason: 'not profitable' })
    return { profit, protected: 0 }
  }

  const usdcAddr = CONFIG.usdc[chain]
  const nativeToken = chain === 'sol' ? 'So11111111111111111111111111111111111111112' : '0x0000000000000000000000000000000000000000'

  log(`  swapping ${protectedAmt} to USDC...`)
  const result = gmgnSwap(chain, walletAddress, nativeToken, usdcAddr, String(protectedAmt), log)

  if (result.success) {
    log(`  <span class="cyan">${protectedAmt} → USDC saved</span>`)
  } else {
    log(`  <span class="error">swap failed: ${result.error?.slice(0,60)}</span>`)
  }

  tradeHistory.push({
    token: tokenAddress,
    chain,
    profit,
    profitUsd: profit,
    protectedUsd: protectedAmt,
    swapped: result.success,
  })

  return { profit, protected: protectedAmt, swapped: result.success }
}

module.exports = {
  recordBuy,
  processSell,
  getHistory,
  getStats,
}
