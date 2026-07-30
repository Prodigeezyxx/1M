const { CONFIG } = require('./config')

const recentTokens = new Set()

function nameFilter(tokenName, chain) {
  const cfg = CONFIG[chain]
  if (!tokenName) return { pass: false, reason: 'no name' }
  const lower = tokenName.toLowerCase()
  for (const kw of cfg.filter.blockedKeywords) {
    if (lower.includes(kw)) return { pass: false, reason: `blocked keyword: ${kw}` }
  }
  return { pass: true }
}

function symbolFilter(symbol, chain) {
  const cfg = CONFIG[chain]
  if (!symbol) return { pass: false, reason: 'no symbol' }
  if (!cfg.filter.allowedSymbolPattern) return { pass: true }
  if (!cfg.filter.allowedSymbolPattern.test(symbol)) {
    return { pass: false, reason: `symbol "${symbol}" fails pattern` }
  }
  return { pass: true }
}

function dedupFilter(tokenAddress) {
  if (recentTokens.has(tokenAddress)) return { pass: false, reason: 'duplicate' }
  if (recentTokens.size > CONFIG.crossChain.maxRecentTokens) recentTokens.clear()
  recentTokens.add(tokenAddress)
  return { pass: true }
}

function rateLimitFilter(chain, chainTimestamps) {
  const now = Date.now()
  const chainTxs = chainTimestamps[chain] || []
  const recent = chainTxs.filter(ts => now - ts < 60000)
  if (recent.length >= CONFIG.crossChain.maxBuyPerMinute) {
    return { pass: false, reason: `rate limit: ${recent.length}/min` }
  }
  return { pass: true, timestamps: recent }
}

async function filterToken(token, chain) {
  const checks = [
    { name: 'dedup',  result: dedupFilter(token.address) },
    { name: 'name',   result: nameFilter(token.name, chain) },
    { name: 'symbol', result: symbolFilter(token.symbol, chain) },
  ]
  const failures = checks.filter(c => !c.result.pass)
  if (failures.length > 0) {
    return { pass: false, failed: failures }
  }
  return { pass: true }
}

function simulateCheck(token) {
  return { pass: true }
}

module.exports = { filterToken, nameFilter, symbolFilter, dedupFilter, rateLimitFilter }
