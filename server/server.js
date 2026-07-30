const express = require('express')
const { execSync, exec } = require('child_process')
const path = require('path')
const { getSignals } = require('../signal-engine/index.js')
const { executeSell } = require('../features/sniper/executor.js')
const app = express()
const PORT = 3001
const GMGN_CLI = path.join(process.env.APPDATA, 'npm', 'node_modules', 'gmgn-cli', 'dist', 'index.js')

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }))

function parse(out) { try { return JSON.parse(out) } catch { return null } }
function q(s) { return s || 'sol' }

const cache = {}
function getCached(key, ttlMs) {
  const entry = cache[key]
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data
  return undefined
}
function setCache(key, data) { cache[key] = { data, ts: Date.now() } }

function refreshAsync(args, cacheKey) {
  const cmd = `node "${GMGN_CLI}" ${args.join(' ')} --raw`
  exec(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 2*1024*1024 }, (err, stdout) => {
    if (!err && stdout) setCache(cacheKey, stdout.trim())
  })
}

function fetchOrRefresh(args, cacheKey, ttlMs, parser) {
  const cached = getCached(cacheKey, ttlMs)
  if (cached !== undefined) return parser(cached)
  refreshAsync(args, cacheKey)
  return null
}

const TTL = { trending: 20000, trenches: 20000, smartmoney: 30000, kol: 30000, signals: 120000 }

app.get('/api/trending', (req, res) => {
  const c = q(req.query.chain)
  const key = `trending:${c}`
  const data = fetchOrRefresh(['market', 'trending', '--chain', c, '--interval', '5m', '--order-by', 'volume', '--limit', '30'], key, TTL.trending, out => parse(out)?.data?.rank || [])
  if (data) return res.json(data)
  const out = execSync(`node "${GMGN_CLI}" market trending --chain ${c} --interval 5m --order-by volume --limit 30 --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  if (out) setCache(key, out)
  res.json(parse(out)?.data?.rank || [])
})

app.get('/api/trenches', (req, res) => {
  const c = q(req.query.chain)
  const key = `trenches:${c}`
  const data = fetchOrRefresh(['market', 'trenches', '--chain', c, '--type', 'new_creation', '--filter-preset', 'safe', '--limit', '40'], key, TTL.trenches, out => { const d = parse(out); return d?.data?.new_creation || d?.data?.pump || [] })
  if (data) return res.json(data)
  const out = execSync(`node "${GMGN_CLI}" market trenches --chain ${c} --type new_creation --filter-preset safe --limit 40 --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  if (out) setCache(key, out)
  const d = parse(out); res.json(d?.data?.new_creation || d?.data?.pump || [])
})

app.get('/api/smartmoney', (req, res) => {
  const c = q(req.query.chain)
  const key = `smartmoney:${c}`
  const data = fetchOrRefresh(['track', 'smartmoney', '--chain', c, '--limit', '30'], key, TTL.smartmoney, out => parse(out)?.list || [])
  if (data) return res.json(data)
  const out = execSync(`node "${GMGN_CLI}" track smartmoney --chain ${c} --limit 30 --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  if (out) setCache(key, out)
  res.json(parse(out)?.list || [])
})

app.get('/api/kol', (req, res) => {
  const c = q(req.query.chain)
  const key = `kol:${c}`
  const data = fetchOrRefresh(['track', 'kol', '--chain', c, '--limit', '30'], key, TTL.kol, out => parse(out)?.list || [])
  if (data) return res.json(data)
  const out = execSync(`node "${GMGN_CLI}" track kol --chain ${c} --limit 30 --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  if (out) setCache(key, out)
  res.json(parse(out)?.list || [])
})

app.get('/api/signals', async (req, res) => {
  const c = req.query.chain === 'all' ? '' : (req.query.chain || 'sol')
  const key = `signals:${c || 'all'}`
  const cached = getCached(key, TTL.signals)
  if (cached) return res.json(cached)
  try {
    const sigs = await getSignals(c)
    if (sigs) setCache(key, sigs)
    res.json(sigs || [])
  } catch {
    res.json([])
  }
})

app.get('/api/token/info', (req, res) => {
  if (!req.query.address) return res.status(400).json({ error: 'missing address' })
  const out = execSync(`node "${GMGN_CLI}" token info --chain ${q(req.query.chain)} --address ${req.query.address} --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  res.json(parse(out))
})

app.get('/api/token/security', (req, res) => {
  if (!req.query.address) return res.status(400).json({ error: 'missing address' })
  const out = execSync(`node "${GMGN_CLI}" token security --chain ${q(req.query.chain)} --address ${req.query.address} --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  res.json(parse(out))
})

app.get('/api/token/rugcheck', (req, res) => {
  const chain = req.query.chain || 'sol'; const addr = req.query.address
  if (!addr) return res.status(400).json({ error: 'missing address' })
  const out = execSync(`node "${GMGN_CLI}" token traders --chain ${chain} --address ${addr} --limit 30 --order-by profit --direction desc --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  const traders = parse(out)?.list || []
  const result = { address: addr, isDevSniperRug: false, confidence: 0, signals: [], devProfit: 0, bundlerProfit: 0, totalTopProfit: 0, topExtractors: [] }
  const top = traders.filter(t => parseFloat(t.profit || 0) > 0).slice(0, 10)
  for (const t of top) {
    const profit = parseFloat(t.profit || 0); const tags = t.maker_token_tags || []; result.totalTopProfit += profit
    if (tags.some(tg => ['dev_team', 'bundler', 'sniper'].includes(tg))) {
      result.topExtractors.push({ address: t.address, profit, tags, avgCost: t.avg_cost })
      if (tags.includes('dev_team')) result.devProfit += profit
      if (tags.includes('bundler')) result.bundlerProfit += profit
    }
  }
  const c = result.topExtractors.length
  if (c >= 3 && result.devProfit > 1000) { result.isDevSniperRug = true; result.signals.push('dev_sniper_bundler_cluster'); result.confidence = Math.min(100, 60 + c * 5) }
  if (result.devProfit > result.totalTopProfit * 0.5 && result.totalTopProfit > 0) { result.isDevSniperRug = true; result.signals.push('dev_team_dominated_profits'); result.confidence = Math.min(100, result.confidence + 25) }
  if (c >= 5) { result.signals.push('large_sniper_ring'); result.confidence = Math.min(100, result.confidence + 15) }
  res.json(result)
})

app.get('/api/portfolio/holdings', (req, res) => {
  if (!req.query.wallet) return res.status(400).json({ error: 'missing wallet' })
  const out = execSync(`node "${GMGN_CLI}" portfolio holdings --chain ${q(req.query.chain)} --wallet ${req.query.wallet} --limit 50 --hide-closed false --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  res.json(parse(out)?.list || [])
})

app.get('/api/portfolio/stats', (req, res) => {
  if (!req.query.wallet) return res.status(400).json({ error: 'missing wallet' })
  const out = execSync(`node "${GMGN_CLI}" portfolio stats --chain ${q(req.query.chain)} --wallet ${req.query.wallet} --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
  res.json(parse(out))
})

app.get('/api/portfolio/balance', (req, res) => {
  if (!req.query.wallet) return res.status(400).json({ error: 'missing wallet' })
  const c = q(req.query.chain)
  try {
    const out = execSync(`node "${GMGN_CLI}" portfolio tokens --chain ${c} --wallet ${req.query.wallet} --raw`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 2*1024*1024 }).trim()
    const data = parse(out)
    const holdings = data?.list || []
    // Native token is the chain currency (SOL for solana, WETH/ETH for robinhood)
    const native = c === 'sol'
      ? holdings.find(h => (h.symbol||'').toUpperCase() === 'SOL' || (h.token_address||'') === 'So11111111111111111111111111111111111111112')
      : holdings.find(h => (h.symbol||'').toUpperCase() === 'ETH' || (h.token_address||'') === '0x0bd7d308f8e1639fab988df18a8011f41eacad73' || (h.token_address||'') === '0x0000000000000000000000000000000000000000')
    res.json({ balance: parseFloat(native?.balance || native?.amount || 0), symbol: c === 'sol' ? 'SOL' : 'ETH', raw: holdings })
  } catch { res.json({ balance: 0, symbol: c === 'sol' ? 'SOL' : 'ETH', raw: [] }) }
})

app.get('/api/config/check', (req, res) => {
  try { execSync(`node "${GMGN_CLI}" config --check`, { encoding: 'utf-8', timeout: 5000 }); res.json({ connected: true }) }
  catch { res.json({ connected: false }) }
})

// Factory SSE
const factory = require('../features/pons-factory/server-adapter.js').getAdapter()
app.get('/api/factory/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const onLog = (m) => { try { res.write(`data: ${JSON.stringify({ type: 'log', msg: m })}\n\n`) } catch {} }
  const onCycle = (d) => { try { res.write(`data: ${JSON.stringify({ type: 'cycle', ...d })}\n\n`) } catch {} }
  const onDone = (r) => { try { res.write(`data: ${JSON.stringify({ type: 'done', result: r })}\n\n`) } catch {} }
  const onStatus = (s) => { try { res.write(`data: ${JSON.stringify({ type: 'status', status: s })}\n\n`) } catch {} }
  factory.on('log', onLog); factory.on('cycle', onCycle); factory.on('done', onDone); factory.on('status', onStatus)
  res.write(`data: ${JSON.stringify({ type: 'status', status: factory.getStatus() })}\n\n`)
  const keepalive = setInterval(() => res.write(':keepalive\n\n'), 15000)
  req.on('close', () => { factory.removeListener('log', onLog); factory.removeListener('cycle', onCycle); factory.removeListener('done', onDone); factory.removeListener('status', onStatus); clearInterval(keepalive) })
})

app.post('/api/factory/setup', async (req, res) => { try { const r = await factory.setup(); res.json({ ok: true, wallets: r }) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.post('/api/factory/fund', express.json(), async (req, res) => { try { await factory.fund(req.body.fromPk); res.json({ ok: true }) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.post('/api/factory/run', express.json(), async (req, res) => { try { factory.run(req.body.cycles, req.body.mainAddress); res.json({ ok: true }) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.get('/api/factory/balances', async (req, res) => { try { const b = await factory.getBalances(); res.json({ ok: true, balances: b }) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.post('/api/factory/sweep', express.json(), async (req, res) => { try { const r = await factory.sweep(req.body.toAddress); res.json({ ok: true, total: String(r) }) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.get('/api/factory/status', (req, res) => { res.json(factory.getStatus()) })

// Sniper SSE
const sniper = require('../features/sniper/index.js').getSniperAdapter()
app.get('/api/sniper/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const onLog = (m) => { try { res.write(`data: ${JSON.stringify({ type: 'log', msg: m })}\n\n`) } catch {} }
  const onDetected = (t) => { try { res.write(`data: ${JSON.stringify({ type: 'detected', token: t })}\n\n`) } catch {} }
  const onFiltered = (d) => { try { res.write(`data: ${JSON.stringify({ type: 'filtered', ...d })}\n\n`) } catch {} }
  const onBuy = (r) => { try { res.write(`data: ${JSON.stringify({ type: 'buy', result: r })}\n\n`) } catch {} }
  const onStatus = (s) => { try { res.write(`data: ${JSON.stringify({ type: 'status', status: s })}\n\n`) } catch {} }
  sniper.on('log', onLog); sniper.on('detected', onDetected); sniper.on('filtered', onFiltered); sniper.on('buy-result', onBuy); sniper.on('status', onStatus)
  res.write(`data: ${JSON.stringify({ type: 'status', status: sniper.getStatus() })}\n\n`)
  const keepalive = setInterval(() => res.write(':keepalive\n\n'), 15000)
  req.on('close', () => { sniper.removeListener('log', onLog); sniper.removeListener('detected', onDetected); sniper.removeListener('filtered', onFiltered); sniper.removeListener('buy-result', onBuy); sniper.removeListener('status', onStatus); clearInterval(keepalive) })
})

app.post('/api/sniper/start', express.json(), (req, res) => {
  if (!req.body.chain || !['sol', 'robinhood'].includes(req.body.chain)) return res.status(400).json({ error: 'chain must be sol or robinhood' })
  sniper.start(req.body.chain); res.json({ ok: true })
})

app.post('/api/sniper/stop', express.json(), (req, res) => {
  if (req.body.chain) sniper.stop(req.body.chain); else sniper.stopAll()
  res.json({ ok: true })
})

app.post('/api/sniper/wallet', express.json(), (req, res) => {
  if (!req.body.chain || !req.body.address) return res.status(400).json({ error: 'missing chain or address' })
  sniper.setWallet(req.body.chain, req.body.address); res.json({ ok: true })
})

app.post('/api/sniper/autobuy', express.json(), (req, res) => {
  if (!req.body.chain) return res.status(400).json({ error: 'missing chain' })
  sniper.setAutoBuy(req.body.chain, req.body.enabled); res.json({ ok: true })
})

app.post('/api/sniper/autosell', express.json(), (req, res) => {
  if (!req.body.chain) return res.status(400).json({ error: 'missing chain' })
  sniper.setAutoSell(req.body.chain, req.body.enabled, req.body.targetPct)
  res.json({ ok: true })
})

app.post('/api/sniper/strategy', express.json(), (req, res) => {
  const strat = req.body.strategy || 'snipe'
  const chain = req.body.chain || 'sol'
  sniper.setStrategy(strat)
  // Enable auto-buy + auto-sell for HF strategies
  if (strat !== 'manual') {
    sniper.setAutoBuy(chain, true)
    sniper.setAutoSell(chain, true)
  } else {
    sniper.setAutoBuy(chain, false)
    sniper.setAutoSell(chain, false)
  }
  res.json({ ok: true, strategy: strat })
})

app.get('/api/sniper/strategies', (req, res) => {
  const { STRATEGIES } = require('../features/sniper/server-adapter.js')
  res.json(STRATEGIES)
})

app.get('/api/sniper/status', (req, res) => { res.json(sniper.getStatus()) })
app.get('/api/sniper/detected', (req, res) => { res.json(sniper.getRecentDetected(parseInt(req.query.limit) || 30)) })
app.get('/api/sniper/buys', (req, res) => { res.json(sniper.getRecentBuys(parseInt(req.query.limit) || 20)) })
app.get('/api/sniper/positions', (req, res) => { res.json(sniper.getPositions()) })

app.post('/api/sniper/buy', express.json(), (req, res) => {
  const { chain, tokenAddress, amount } = req.body
  if (!chain || !tokenAddress) return res.status(400).json({ error: 'missing chain or tokenAddress' })
  if (!amount) return res.status(400).json({ error: 'missing amount' })
  const wallet = sniper.wallets?.[chain]
  if (!wallet) return res.status(400).json({ error: `no wallet set for ${chain}` })
  // Use gmgn-cli directly for custom amount buys
  try {
    const quoteToken = chain === 'sol' ? 'So11111111111111111111111111111111111111112' : '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
    const out = execSync(`node "${GMGN_CLI}" swap --chain ${chain} --from ${wallet} --input-token ${quoteToken} --output-token ${tokenAddress} --amount ${amount} --auto-slippage --yes`, { encoding: 'utf-8', timeout: 20000, maxBuffer: 2*1024*1024 }).trim()
    sniper.emit('log', `[BUY] ${tokenAddress.slice(0, 10)}.. ${amount} ${chain === 'sol' ? 'SOL' : 'ETH'}`)
    sniper.buys.unshift({ success: true, token: tokenAddress, amount, chain, result: parse(out) || out })
    sniper.buys = sniper.buys.slice(0, 100)
    sniper.positions[tokenAddress] = { chain, amount, ts: Date.now() }
    res.json({ ok: true, result: parse(out) || out })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

app.post('/api/sniper/sell', express.json(), (req, res) => {
  const { chain, tokenAddress, percent } = req.body
  if (!chain || !tokenAddress) return res.status(400).json({ error: 'missing chain or tokenAddress' })
  const wallet = sniper.wallets?.[chain]
  if (!wallet) return res.status(400).json({ error: `no wallet set for ${chain}` })
  const result = executeSell(chain, wallet, tokenAddress, (msg) => sniper.emit('log', msg))
  res.json(result || { ok: false, error: 'sell failed' })
})

app.post('/api/sniper/sell-all', express.json(), (req, res) => {
  const chain = req.body.chain || 'sol'
  const wallet = sniper.wallets?.[chain]
  if (!wallet) return res.status(400).json({ error: `no wallet set for ${chain}` })
  const positions = sniper.getPositions()
  const tokens = Object.keys(positions).filter(addr => positions[addr].chain === chain)
  if (tokens.length === 0) return res.json({ ok: true, sold: 0, message: 'no positions' })
  let sold = 0
  for (const addr of tokens) {
    const r = executeSell(chain, wallet, addr, (msg) => sniper.emit('log', msg))
    if (r?.success) { sold++; delete sniper.positions[addr] }
  }
  res.json({ ok: true, sold })
})

app.listen(PORT, () => {
  console.log(`GMGN Terminal Web → http://localhost:${PORT}`)
  // Pre-warm signals cache asynchronously
  setTimeout(() => {
    const key = 'signals:sol'
    if (!getCached(key, 60000)) {
      getSignals('sol').then(sigs => { if (sigs) setCache(key, sigs) }).catch(() => {})
    }
  }, 5000)
})
