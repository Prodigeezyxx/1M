const { CONFIG } = require('./config')
const { execAsync, errorText, isAuthError } = require('./exec-util')

const chainTimestamps = { sol: [], robinhood: [] }

async function gmgnSwap(chain, fromAddress, inputToken, outputToken, amount, percent) {
  const chainName = chain === 'sol' ? 'sol' : 'robinhood'
  let cmd = `gmgn-cli swap --chain ${chainName} --from ${fromAddress}`
  if (percent) {
    cmd += ` --input-token ${inputToken} --output-token ${outputToken} --percent ${percent}`
  } else {
    cmd += ` --input-token ${inputToken} --output-token ${outputToken} --amount ${amount}`
  }
  cmd += ` --auto-slippage --yes`

  const raw = await execAsync(cmd, { timeout: 20000 })
  try { return JSON.parse(raw) } catch { return { raw } }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function confirmOrder(chain, result) {
  if (!result) return { success: false, error: 'empty swap response' }
  if (result.status === 'confirmed' || result.status === 'successful' || result.state === 30) {
    return { success: true, order: result }
  }
  if (result.status === 'failed' || result.status === 'expired') {
    return { success: false, error: result.error_status || result.error_code || result.status, order: result }
  }
  if (!result.order_id) return { success: false, error: 'swap returned no order id', order: result }

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(3000)
    try {
      const raw = await execAsync(`gmgn-cli order get --chain ${chain} --order-id ${result.order_id} --raw`, { timeout: 10000 })
      const order = JSON.parse(raw.trim())
      if (order.status === 'confirmed' || order.status === 'successful' || order.state === 30) {
        return { success: true, order }
      }
      if (order.status === 'failed' || order.status === 'expired') {
        return { success: false, error: order.error_status || order.error_code || order.status, order }
      }
    } catch (err) {
      if (isAuthError(err)) throw err
    }
  }
  return { success: false, error: 'order not confirmed in time', order: result }
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

function toRawAmount(chain, amountStr) {
  const num = parseFloat(amountStr)
  if (isNaN(num) || num <= 0) return '0'
  const decimals = chain === 'sol' ? 1e9 : 1e18
  return String(Math.floor(num * decimals))
}

async function executeBuy(chain, walletAddress, tokenAddress, log, amountOverride) {
  const cfg = CONFIG[chain]
  const isSol = chain === 'sol'

  // Rate check
  if (getRateCount(chain) >= CONFIG.crossChain.maxBuyPerMinute) {
    log(`  skip ${chain} ${tokenAddress.slice(0, 8)} — rate limit (${getRateCount(chain)}/min)`)
    return null
  }

  const userAmount = amountOverride || cfg.buyAmount
  if (parseFloat(userAmount) > parseFloat(cfg.maxBuyAmount)) {
    const error = `amount exceeds ${chain} safety cap of ${cfg.maxBuyAmount}`
    log(`  skip ${tokenAddress.slice(0, 8)} — ${error}`)
    return { success: false, token: tokenAddress, chain, error }
  }
  const rawAmount = toRawAmount(chain, userAmount)
  const inputToken = cfg.currency
  const outputToken = tokenAddress
  const currencyLabel = isSol ? 'SOL' : 'ETH'

  log(`  [BUY] ${tokenAddress.slice(0, 10)}..  ${userAmount} ${currencyLabel}  via ${walletAddress.slice(0, 6)}...`)

  try {
    const submitted = await gmgnSwap(chain, walletAddress, inputToken, outputToken, rawAmount)
    const confirmation = await confirmOrder(chain, submitted)
    if (!confirmation.success) throw new Error(confirmation.error)
    recordTimestamp(chain)
    log(`  [BOUGHT] ${tokenAddress.slice(0, 10)}..  ${userAmount} ${currencyLabel}`)
    return {
      success: true,
      token: tokenAddress,
      chain,
      amount: userAmount,
      costNative: rawAmount,
      result: confirmation.order,
    }
  } catch (err) {
    const message = errorText(err).slice(0, 180)
    log(`  [FAIL] ${tokenAddress.slice(0, 10)}.. — ${message}`)
    return { success: false, token: tokenAddress, chain, authError: isAuthError(err), error: message }
  }
}

async function executeSell(chain, walletAddress, tokenAddress, log) {
  const cfg = CONFIG[chain]
  const currencyLabel = chain === 'sol' ? 'SOL' : 'WETH'

  log(`  [SELL] ${tokenAddress.slice(0, 10)}..  100% → ${currencyLabel}`)
  try {
    const submitted = await gmgnSwap(chain, walletAddress, tokenAddress, cfg.currency, null, 100)
    const confirmation = await confirmOrder(chain, submitted)
    if (!confirmation.success) throw new Error(confirmation.error)
    const proceeds = confirmation.order?.report?.output_amount || null
    log(`  [SOLD] ${tokenAddress.slice(0, 10)}..`)
    return { success: true, token: tokenAddress, chain, proceeds, result: confirmation.order }
  } catch (err) {
    const message = errorText(err).slice(0, 180)
    log(`  [SELL FAIL] ${tokenAddress.slice(0, 10)}.. — ${message}`)
    return { success: false, token: tokenAddress, chain, authError: isAuthError(err), error: message }
  }
}

module.exports = { executeBuy, executeSell }
