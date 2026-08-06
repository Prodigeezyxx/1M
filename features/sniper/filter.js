const { CONFIG } = require('./config')

const recentTokens = new Set()

function nameFilter(tokenName, chain) {
  const cfg = CONFIG[chain]
  if (!tokenName) return { pass: false, reason: 'no name' }
  if (cfg.filter.maxNameLength && tokenName.length > cfg.filter.maxNameLength) {
    return { pass: false, reason: 'name_too_long' }
  }
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

function numberValue(...values) {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function safetyFilter(token, chain) {
  const issues = []
  const platform = String(token.launchpad_platform || token.launchpad || '').toLowerCase()
  const rug = numberValue(token.rug_ratio)
  const bundler = Math.max(numberValue(token.bundler_rate), numberValue(token.bundler_trader_amount_rate), numberValue(token.bundler_mhr))
  const insider = Math.max(numberValue(token.suspected_insider_hold_rate), numberValue(token.rat_trader_amount_rate))
  const entrapment = numberValue(token.entrapment_ratio)
  const top10 = Math.max(numberValue(token.top_10_holder_rate), numberValue(token.top_holder_rate))
  const creator = Math.max(numberValue(token.creator_balance_rate), numberValue(token.dev_team_hold_rate))
  const sniperHold = numberValue(token.top70_sniper_hold_rate)

  if (token.is_honeypot === true || token.is_honeypot === 'true' || token.honeypot === 1) issues.push('honeypot')
  if (rug > 0.2) issues.push(`rug_${rug}`)
  if (token.is_wash_trading === true || token.is_wash_trading === 'true') issues.push('wash_trading')
  if (bundler > 0.2) issues.push(`bundler_${bundler}`)
  if (insider > 0.2) issues.push(`insider_${insider}`)
  if (entrapment > 0.1) issues.push(`entrapment_${entrapment}`)
  if (top10 > 0.3) issues.push(`top10_${top10}`)
  if (creator > 0.05) issues.push(`creator_${creator}`)
  if (sniperHold > 0.2 || numberValue(token.sniper_count) > 10) issues.push('sniper_concentration')
  if (numberValue(token.creator_created_count) > 500) issues.push('token_factory_creator')
  if (platform.includes('mayhem') || numberValue(token.total_supply) >= 2000000000) issues.push('mayhem')
  if (Math.max(numberValue(token.image_dup), numberValue(token.twitter_dup), numberValue(token.website_dup)) > 0) issues.push('duplicated_metadata')

  if (chain === 'sol') {
    if (token.renounced_mint === false || token.renounced_mint === 0) issues.push('mint_authority')
    if (token.renounced_freeze_account === false || token.renounced_freeze_account === 0) issues.push('freeze_authority')
  }

  return issues.length ? { pass: false, reason: issues.join(',') } : { pass: true }
}

function liquidityFilter(token) {
  if (token.source !== 'poll') return { pass: false, reason: 'not_enriched' }
  const liq = numberValue(token.liquidity, token.liq)
  if (liq < 1000) return { pass: false, reason: 'low_liquidity' }
  const holders = numberValue(token.holder_count)
  if (holders < 10) return { pass: false, reason: 'low_holders' }
  if (numberValue(token.progress) < 0.1) return { pass: false, reason: 'low_progress' }
  if (numberValue(token.volume_24h) < 1000) return { pass: false, reason: 'low_volume' }
  if (numberValue(token.smart_degen_count) < 1) return { pass: false, reason: 'no_smart_money' }
  if (token.has_at_least_one_social === false) return { pass: false, reason: 'no_social' }
  return { pass: true }
}

async function filterToken(token, chain) {
  const checks = [
    { name: 'name',   result: nameFilter(token.name, chain) },
    { name: 'symbol', result: symbolFilter(token.symbol, chain) },
    { name: 'safety', result: safetyFilter(token, chain) },
    { name: 'quality', result: liquidityFilter(token) },
  ]
  const failures = checks.filter(c => !c.result.pass)
  if (failures.length > 0) {
    return { pass: false, failed: failures }
  }
  return { pass: true }
}

// Quick rug pattern check from available data at detection time
function quickRugCheck(token) {
  const flags = []
  // Known bundler/sniper cluster patterns in token metadata
  if (!token.name || token.name.length < 2) flags.push('no_name')
  if (!token.symbol || token.symbol.length < 1) flags.push('no_symbol')
  // If we have creator info from the detection event
  if (token.creatorWallet) {
    // creator being the same as sniper address pattern
    if (token.sniperWallets && token.sniperWallets.includes(token.creatorWallet))
      flags.push('creator_is_sniper')
  }
  return flags
}

module.exports = {
  filterToken,
  nameFilter,
  symbolFilter,
  dedupFilter,
  rateLimitFilter,
  safetyFilter,
  liquidityFilter,
  quickRugCheck,
}
