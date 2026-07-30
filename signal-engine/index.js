const { exec } = require('child_process')
const path = require('path')

const CHAINS = ['sol', 'bsc', 'base', 'eth', 'robinhood']
const GMGN_CLI = path.join(process.env.APPDATA, 'npm', 'node_modules', 'gmgn-cli', 'dist', 'index.js')

function runAsync(args) {
  return new Promise((resolve) => {
    const cmd = `node "${GMGN_CLI}" ${args.join(' ')} --raw`
    exec(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }, (err, stdout) => {
      if (err) return resolve('')
      try { resolve(JSON.parse(stdout.trim())) }
      catch { resolve('') }
    })
  })
}

function parse(out) { try { return JSON.parse(out) } catch { return null } }

const P = parseFloat

const PATTERNS = [
  { id: 'SMART_MONEY_ACCUM',    label: 'SM Accum',     weight: 30, cat: 'bullish' },
  { id: 'MOMENTUM_SPIKE',       label: 'Momentum',     weight: 20, cat: 'bullish' },
  { id: 'CTO_CANDIDATE',        label: 'CTO Setup',    weight: 25, cat: 'bullish' },
  { id: 'BONDING_GRAD',         label: 'BondCurve',    weight: 10, cat: 'bullish' },
  { id: 'HOT_SEARCH_SURGE',     label: 'Hot Search',   weight: 15, cat: 'bullish' },
  { id: 'WHALE_RELOAD',         label: 'Whale Reload', weight: 25, cat: 'bullish' },
  { id: 'KOL_PUMP',             label: 'KOL Pump',     weight: 20, cat: 'bullish' },
  { id: 'LIQUIDITY_INJECT',     label: 'Liq Add',      weight: 15, cat: 'bullish' },
  { id: 'PRE_BOND_RUN',         label: 'Pre-Bond Run', weight: 22, cat: 'bullish' },
  { id: 'SNIPER_TARGET',        label: 'Sniper',       weight: 35, cat: 'bullish' },
  { id: 'BUNDLE_LAUNCH',        label: 'Bundle',       weight: -50, cat: 'bearish' },
  { id: 'RUG_SCAM',             label: 'Rug',          weight: -100, cat: 'bearish' },
  { id: 'DEV_DUMP',             label: 'DevDump',      weight: -60, cat: 'bearish' },
  { id: 'HONEYPOT',             label: 'Honeypot',     weight: -100, cat: 'bearish' },
  { id: 'WASH_TRADING',         label: 'WashTrade',    weight: -40, cat: 'bearish' },
  { id: 'SNIPER_DUMP',          label: 'SniperDump',   weight: -35, cat: 'bearish' },
  { id: 'TOP_HEAVY',            label: 'TopHeavy',     weight: -25, cat: 'bearish' },
  { id: 'BOT_DOMINATED',        label: 'BotDom',       weight: -30, cat: 'bearish' },
  { id: 'INSIDER_RING',         label: 'InsiderRing',  weight: -45, cat: 'bearish' },
  { id: 'FRESH_WALLET_DUMP',    label: 'FreshDump',    weight: -40, cat: 'bearish' },
  { id: 'ENTRAPMENT',           label: 'Entrap',       weight: -55, cat: 'bearish' },
  { id: 'CREATOR_RESUME',       label: 'DevResume',    weight: -70, cat: 'bearish' },
  { id: 'MINT_NOT_RENOUNCED',   label: 'Mintable',     weight: -50, cat: 'bearish' },
  { id: 'DEV_SNIPER_RUG',       label: 'DevSniperRug', weight: -100, cat: 'bearish' },
  { id: 'ZERO_SMART_MONEY',     label: 'NoSmartMoney', weight: -20, cat: 'bearish' },
]
const PAT_MAP = Object.fromEntries(PATTERNS.map(p => [p.id, p]))

function features(t) {
  return {
    mc: P(t.usd_market_cap ?? t.market_cap ?? 0),
    liq: P(t.liquidity ?? 0),
    volume: P(t.volume ?? t.volume_1h ?? 0),
    vol6h: P(t.volume_6h ?? 0),
    vol24h: P(t.volume_24h ?? 0),
    swaps: P(t.swaps ?? t.swaps_1h ?? 0),
    buys: P(t.buys ?? t.buys_1h ?? 0),
    sells: P(t.sells ?? t.sells_1h ?? 0),
    priceChange: P(t.price_change_percent ?? 0),
    priceChange1m: P(t.price_change_percent1m ?? 0),
    priceChange5m: P(t.price_change_percent5m ?? 0),
    priceChange1h: P(t.price_change_percent1h ?? 0),
    rug: P(t.rug_ratio ?? 0),
    bundler: P(t.bundler_trader_amount_rate ?? t.bundler_rate ?? 0),
    entrap: P(t.entrapment_ratio ?? 0),
    bot: P(t.bot_degen_rate ?? 0),
    botCount: P(t.bot_degen_count ?? 0),
    smart: P(t.smart_degen_count ?? 0),
    renCount: P(t.renowned_count ?? 0),
    top10: P(t.top_10_holder_rate ?? 0),
    top70Sniper: P(t.top70_sniper_hold_rate ?? 0),
    devHold: P(t.dev_team_hold_rate ?? 0),
    holders: P(t.holder_count ?? 0),
    sniperCount: P(t.sniper_count ?? 0),
    freshWallet: P(t.fresh_wallet_rate ?? 0),
    ratTrader: P(t.rat_trader_amount_rate ?? 0),
    creatorClose: t.creator_close === true || t.creator_token_status === 'creator_close',
    renounced: t.renounced_mint === 1 || t.renounced_mint === true,
    freezeRenounced: t.renounced_freeze_account === 1,
    isHoneypot: t.is_honeypot === 'yes' || t.is_honeypot === 1 || t.is_honeypot === true,
    isWash: t.is_wash_trading === true,
    burnStatus: t.burn_status || '',
    creatorBalance: P(t.creator_balance_rate ?? 0),
    launchpad: t.launchpad_platform || t.launchpad || '',
    twitter: t.twitter_username || '',
    website: t.website || '',
    telegram: t.telegram || '',
    hasSocial: !!(t.twitter_username || t.website || t.telegram),
    imageDup: P(t.image_dup ?? 0),
    webDup: P(t.website_dup ?? 0),
    twitterDup: P(t.twitter_dup ?? 0),
    twitterFollowers: P(t.x_user_follower ?? 0),
    age: (Date.now() / 1000) - (t.creation_timestamp ?? t.created_timestamp ?? Date.now() / 1000),
    ath: P(t.ath ?? t.history_highest_market_cap ?? 0),
    dexscr: t.dexscr_ad === 1 || t.dexscr_ad === true,
    cto: t.cto_flag === 1 || t.cto_flag === true,
    migratable: t.progress ? P(t.progress) : null,
    buyingPressure: null,
    volToLiq: null,
  }
}

function computeDerived(f) {
  if (f.liq > 0) f.volToLiq = f.volume / f.liq
  const totalTrades = f.buys + f.sells
  if (totalTrades > 0) f.buyingPressure = (f.buys - f.sells) / totalTrades
  return f
}

function detectPatterns(f) {
  const active = []
  if (f.bundler > 0.3 && f.bot > 0.3 && f.devHold < 0.05 && f.creatorClose)
    active.push(PAT_MAP.BUNDLE_LAUNCH)
  if (f.rug > 0.3 && (f.creatorClose || f.bot > 0.5))
    active.push(PAT_MAP.RUG_SCAM)
  if (f.isHoneypot)
    active.push(PAT_MAP.HONEYPOT)
  if (f.isWash || (f.volToLiq !== null && f.volToLiq > 10 && f.holders < 50 && f.botCount > f.holders))
    active.push(PAT_MAP.WASH_TRADING)
  if (f.sniperCount >= 5 && f.priceChange < -20)
    active.push(PAT_MAP.SNIPER_DUMP)
  if (f.top10 > 0.5)
    active.push(PAT_MAP.TOP_HEAVY)
  if (f.bot > 0.5 && f.smart < 1)
    active.push(PAT_MAP.BOT_DOMINATED)
  if (f.bundler > 0.2 && f.top10 > 0.4 && f.devHold > 0.1 && !f.creatorClose)
    active.push(PAT_MAP.INSIDER_RING)
  if (f.freshWallet > 0.2 && f.priceChange < -30)
    active.push(PAT_MAP.FRESH_WALLET_DUMP)
  if (f.entrap > 0.1)
    active.push(PAT_MAP.ENTRAPMENT)
  if (f.devHold > 0.05 && !f.creatorClose)
    active.push(PAT_MAP.CREATOR_RESUME)
  if (!f.renounced)
    active.push(PAT_MAP.MINT_NOT_RENOUNCED)
  if (f.imageDup > 5 || f.webDup > 5 || f.twitterDup > 5)
    active.push({ ...PAT_MAP.RUG_SCAM, weight: -40, id: 'COPYCAT', label: 'Copycat' })
  if (f.bundler > 0 && f.smart === 0 && f.creatorClose && f.renounced && f.sniperCount >= 3 && f.priceChange <= 0)
    active.push(PAT_MAP.DEV_SNIPER_RUG)
  if (f.smart === 0 && f.holders > 10 && !active.some(p => p.id === 'DEV_SNIPER_RUG'))
    active.push(PAT_MAP.ZERO_SMART_MONEY)
  if (f.smart >= 3 && f.renCount >= 1 && f.rug < 0.15 && f.bundler < 0.2 && f.bot < 0.3 && f.mc > 5000 && f.mc < 200000)
    active.push(PAT_MAP.SMART_MONEY_ACCUM)
  if (f.priceChange > 100 && f.volToLiq !== null && f.volToLiq > 0.5 && f.rug < 0.2 && f.bot < 0.4 && f.swaps > 100)
    active.push(PAT_MAP.MOMENTUM_SPIKE)
  if (f.creatorClose && f.renounced && f.freezeRenounced && f.top10 < 0.3 && f.smart > 0 && f.mc < 100000 && f.rug < 0.1 && f.entrap < 0.05)
    active.push(PAT_MAP.CTO_CANDIDATE)
  if (f.mc < 60000 && f.age < 600 && f.creatorClose && f.renounced && f.rug < 0.1 && f.devHold < 0.01)
    active.push(PAT_MAP.BONDING_GRAD)
  if (f.age < 600 && f.mc < 30000 && f.rug < 0.05 && !f.isHoneypot && f.renounced && f.bundler < 0.2 && f.bot < 0.3 && f.migratable !== null && f.migratable < 0.8 && f.smart > 0 && f.creatorClose)
    active.push(PAT_MAP.SNIPER_TARGET)
  if (f.migratable !== null && f.migratable > 0.7 && f.volume > 5000 && f.rug < 0.1 && f.creatorClose)
    active.push(PAT_MAP.PRE_BOND_RUN)
  if (f.priceChange > 50 && f.volume > 10000 && f.liq > 5000 && f.smart + f.renCount > 0 && f.rug < 0.2 && f.swaps > 50)
    active.push(PAT_MAP.HOT_SEARCH_SURGE)
  if (f.smart >= 2 && f.rug < 0.1 && f.priceChange > -30 && f.priceChange < 50 && f.age < 1800)
    active.push(PAT_MAP.WHALE_RELOAD)
  if (f.renCount >= 2 && f.smart >= 1 && f.priceChange > 0 && f.rug < 0.1)
    active.push(PAT_MAP.KOL_PUMP)
  if (f.migratable !== null && f.migratable > 0.3 && f.priceChange > -10 && f.priceChange < 100 && f.volume > 2000)
    active.push(PAT_MAP.LIQUIDITY_INJECT)
  return active
}

function computeScore(t, patterns) {
  let score = 50
  if (t.rug > 0.3) score -= 30; else if (t.rug > 0.1) score -= 10
  if (t.entrap > 0.1) score -= 25
  if (t.bundler > 0.3) score -= 15; else if (t.bundler > 0.15) score -= 5
  if (t.bot > 0.5) score -= 20; else if (t.bot > 0.2) score -= 5
  if (t.botCount > 100) score -= 10
  if (t.top10 > 0.5) score -= 15; else if (t.top10 > 0.3) score -= 5
  if (t.freshWallet > 0.2) score -= 10
  if (t.ratTrader > 0.05) score -= 10
  if (t.top70Sniper > 0.1) score -= 10
  if (t.sniperCount > 10) score -= 10; else if (t.sniperCount > 3) score -= 3
  if (!t.renounced) score -= 15
  if (t.isHoneypot) score -= 50
  if (t.isWash) score -= 30
  if (t.imageDup > 5 || t.webDup > 5) score -= 10
  if (t.creatorClose) score += 10
  if (t.renounced && t.freezeRenounced) score += 5
  if (t.smart >= 5) score += 20; else if (t.smart >= 3) score += 15; else if (t.smart >= 1) score += 5
  if (t.renCount >= 2) score += 10; else if (t.renCount >= 1) score += 3
  if (t.holders > 200) score += 8; else if (t.holders > 50) score += 4; else if (t.holders > 10) score += 2
  if (t.hasSocial) score += 3
  if (t.twitterFollowers > 1000) score += 5
  if (t.volToLiq !== null && t.volToLiq > 2) score += 10
  if (t.buyingPressure !== null && t.buyingPressure > 0.3) score += 8
  if (t.age > 0 && t.age < 180) score += 12
  else if (t.age > 0 && t.age < 600) score += 8
  if (t.priceChange > 100) score += 5; else if (t.priceChange > 30) score += 2
  if (t.priceChange1m > 20) score += 3
  for (const p of patterns) score += p.weight
  if (t.liq > 50000) score += 5; else if (t.liq > 10000) score += 2
  else if (t.liq < 1000 && t.mc > 0) score -= 5
  if (t.launchpad.includes('mayhem')) score -= 15
  return Math.max(0, Math.min(100, Math.round(score)))
}

function scanTrenches(chain, tokens) {
  const signals = []
  for (const t of (tokens || [])) {
    const f = computeDerived(features(t))
    const pats = detectPatterns(f)
    if (pats.length) signals.push({ token: t, feat: f, patterns: pats, source: 'trenches', chain })
  }
  return signals
}

function scanHotSearch(chain, tokens) {
  const signals = []
  for (const t of (tokens || [])) {
    const f = computeDerived(features(t))
    const pats = detectPatterns(f)
    if (pats.length) signals.push({ token: t, feat: f, patterns: pats, source: 'hot-search', chain })
  }
  return signals
}

function scanTrending(chain, tokens) {
  const signals = []
  for (const t of (tokens || [])) {
    const f = computeDerived(features(t))
    if (f.priceChange > 80 && f.volume > 20000 && f.rug < 0.15 && f.mc > 10000 && f.mc < 500000)
      signals.push({ token: t, feat: f, patterns: [PAT_MAP.MOMENTUM_SPIKE], source: 'trending', chain })
    if (f.smart >= 3 && f.rug < 0.1 && f.priceChange > 20 && f.priceChange < 200)
      signals.push({ token: t, feat: f, patterns: [PAT_MAP.SMART_MONEY_ACCUM], source: 'trending', chain })
  }
  return signals
}

function scanSmartMoney(chain, trades) {
  const buys = new Map()
  for (const t of (trades || [])) {
    if (t.side !== 'buy') continue
    const addr = t.base_address || t.base_token?.token_address || ''
    if (!addr) continue
    if (!buys.has(addr)) buys.set(addr, { buys: [], token: t.base_token })
    buys.get(addr).buys.push(t)
  }
  const signals = []
  for (const [addr, data] of buys) {
    const count = data.buys.length
    const total = data.buys.reduce((s, b) => s + parseFloat(b.amount_usd || 0), 0)
    if (count >= 2 && total > 100) {
      signals.push({
        token: { address: addr, symbol: data.token?.symbol || '?', name: data.token?.name || '' },
        feat: null,
        patterns: count >= 3 ? [PAT_MAP.SMART_MONEY_ACCUM] : [{ ...PAT_MAP.WHALE_RELOAD, weight: 15 }],
        source: 'smart-money', chain,
        meta: { buyCount: count, totalUsd: total }
      })
    }
  }
  return signals
}

async function scanChain(chain) {
  const [tData, hData, rData, sData] = await Promise.all([
    runAsync(['market', 'trenches', '--chain', chain, '--type', 'new_creation', '--filter-preset', 'safe', '--limit', '50']),
    runAsync(['market', 'hot-searches', '--chain', chain, '--interval', '5m', '--limit', '30']),
    runAsync(['market', 'trending', '--chain', chain, '--interval', '5m', '--order-by', 'volume', '--limit', '30']),
    runAsync(['track', 'smartmoney', '--chain', chain, '--limit', '30']),
  ])

  const all = []
  if (tData) all.push(...scanTrenches(chain, tData.data?.new_creation || tData.data?.pump || []))
  if (hData && Array.isArray(hData)) all.push(...scanHotSearch(chain, hData[0]?.tokens || []))
  if (rData) all.push(...scanTrending(chain, rData.data?.rank || []))
  if (sData) all.push(...scanSmartMoney(chain, sData.list || []))
  return all
}

async function getSignals(chain = '') {
  const chains = chain ? [chain] : CHAINS
  const results = await Promise.all(chains.map(c => scanChain(c)))
  let allSignals = results.flat()

  const merged = new Map()
  for (const s of allSignals) {
    const addr = s.token.address || s.token.token_address || s.token.pool_address || ''
    if (!addr) continue
    const key = `${s.chain}:${addr}`
    if (merged.has(key)) {
      const ex = merged.get(key)
      for (const p of s.patterns) {
        if (!ex.patterns.find(ep => ep.id === p.id)) ex.patterns.push(p)
      }
      if (s.token.usd_market_cap || s.token.market_cap) Object.assign(ex.token, s.token)
      if (s.feat) Object.assign(ex.feat, s.feat)
      ex.sources.push(s.source)
    } else {
      merged.set(key, { ...s, sources: [s.source] })
    }
  }

  const output = []
  for (const [key, signal] of merged) {
    const tok = signal.token
    const f = signal.feat || computeDerived(features(tok))
    const score = computeScore(f, signal.patterns)
    if (score > 30) {
      const hasPos = signal.patterns.some(p => p.cat === 'bullish')
      if (!hasPos && score < 50) continue
      output.push({
        chain: signal.chain,
        address: tok.address || tok.token_address || tok.pool_address || '',
        symbol: tok.symbol || '',
        name: tok.name || tok.trans_name || '',
        score,
        patterns: signal.patterns.map(p => p.id),
        patternLabels: signal.patterns.map(p => p.label),
        patternCats: signal.patterns.map(p => p.cat),
        source: [...new Set(signal.sources)],
        mc: f.mc, liq: f.liq, volume: f.volume,
        smartDegen: f.smart, rugRatio: f.rug,
        bundlerRate: f.bundler, holders: f.holders,
        priceChange: f.priceChange, age: f.age,
        creatorClose: f.creatorClose, renounced: f.renounced,
        isHoneypot: f.isHoneypot, isWash: f.isWash,
        botRate: f.bot, entrapRate: f.entrap,
        top10Rate: f.top10, sniperCount: f.sniperCount,
        launchpad: f.launchpad, hasSocial: f.hasSocial,
        volToLiq: f.volToLiq,
      })
    }
  }

  output.sort((a, b) => b.score - a.score)
  return output
}

module.exports = { getSignals, PATTERNS, CHAINS }
