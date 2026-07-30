const { execSync } = require('child_process')
const { CONFIG } = require('./config')

const chainTimestamps = { sol: [], robinhood: [] }

function gmgnSwap(chain, fromAddress, inputToken, outputToken, amount, percent) {
  const chainName = chain === 'sol' ? 'sol' : 'robinhood'
  let cmd = `gmgn-cli swap --chain ${chainName} --from ${fromAddress}`
  if (percent) {
    cmd += ` --input-token ${inputToken} --percent ${percent}`
  } else {
    cmd += ` --input-token ${inputToken} --output-token ${outputToken} --amount ${amount}`
  }
  cmd += ` --auto-slippage --yes`

  const raw = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  try { return JSON.parse(raw) } catch { return { raw } }
}

function recordTimestamp(chain) {
  const now = Date.now()
  chainTimestamps[chain] = (chainTimestamps[chain] || []).concat(now)
  const cutoff = now - 60000
  chainTimestamps[chain] = chainTimestamps[chain].filter(ts => ts > cutoff)
}

function getRateCount(chain) {
  const now = Date.now()
  const recent = (chainTimestamps[chain] || []).filter(ts => now - ts < 60000)
  return recent.length
}

function executeBuy(chain, walletAddress, tokenAddress, log) {
  const cfg = CONFIG[chain]
  const isSol = chain === 'sol'

  // Rate check
  if (getRateCount(chain) >= CONFIG.crossChain.maxBuyPerMinute) {
    log(`  skip ${chain} ${tokenAddress.slice(0, 8)} — rate limit (${getRateCount(chain)}/min)`)
    return null
  }

  const amount = cfg.buyAmount
  const inputToken = cfg.currency
  const outputToken = tokenAddress
  const currencyLabel = isSol ? 'SOL' : 'WETH'

  log(`  [BUY] ${tokenAddress.slice(0, 10)}..  ${amount} ${currencyLabel}  via ${walletAddress.slice(0, 6)}...`)

  try {
    const result = gmgnSwap(chain, walletAddress, inputToken, outputToken, amount)
    recordTimestamp(chain)
    log(`  [BOUGHT] ${tokenAddress.slice(0, 10)}..  ${amount} ${currencyLabel}`)
    return { success: true, token: tokenAddress, amount, result }
  } catch (err) {
    log(`  [FAIL] ${tokenAddress.slice(0, 10)}.. — ${err.message.slice(0, 80)}`)
    return { success: false, token: tokenAddress, error: err.message }
  }
}

function executeSell(chain, walletAddress, tokenAddress, log) {
  const cfg = CONFIG[chain]
  const currencyLabel = chain === 'sol' ? 'SOL' : 'WETH'

  log(`  [SELL] ${tokenAddress.slice(0, 10)}..  100% → ${currencyLabel}`)
  try {
    const result = gmgnSwap(chain, walletAddress, tokenAddress, cfg.currency, null, 100)
    log(`  [SOLD] ${tokenAddress.slice(0, 10)}..`)
    return { success: true, token: tokenAddress, result }
  } catch (err) {
    log(`  [SELL FAIL] ${tokenAddress.slice(0, 10)}.. — ${err.message.slice(0, 80)}`)
    return { success: false, token: tokenAddress, error: err.message }
  }
}

module.exports = { executeBuy, executeSell }
