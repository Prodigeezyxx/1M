const express = require('express')
const { execSync } = require('child_process')
const path = require('path')
const { getSignals } = require('../signal-engine/index.js')
const app = express()
const PORT = 3001
const GMGN_CLI = path.join(process.env.APPDATA, 'npm', 'node_modules', 'gmgn-cli', 'dist', 'index.js')

app.use(express.static(path.join(__dirname, 'public')))

function run(args) {
  try {
    const cmd = `node "${GMGN_CLI}" ${args.join(' ')} --raw`
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 2*1024*1024 }).trim()
  } catch { return '' }
}

function parse(out) { try { return JSON.parse(out) } catch { return null } }

function q(s) { return s || 'sol' }

app.get('/api/trending', (req, res) => {
  const out = run(['market', 'trending', '--chain', q(req.query.chain), '--interval', '5m', '--order-by', 'volume', '--limit', '30'])
  res.json(parse(out)?.data?.rank || [])
})

app.get('/api/trenches', (req, res) => {
  const out = run(['market', 'trenches', '--chain', q(req.query.chain), '--type', 'new_creation', '--filter-preset', 'safe', '--limit', '40'])
  const d = parse(out)
  res.json(d?.data?.new_creation || d?.data?.pump || [])
})

app.get('/api/smartmoney', (req, res) => {
  const out = run(['track', 'smartmoney', '--chain', q(req.query.chain), '--limit', '30'])
  res.json(parse(out)?.list || [])
})

app.get('/api/kol', (req, res) => {
  const out = run(['track', 'kol', '--chain', q(req.query.chain), '--limit', '30'])
  res.json(parse(out)?.list || [])
})

app.get('/api/signals', (req, res) => {
  res.json(getSignals(req.query.chain === 'all' ? '' : (req.query.chain || 'sol')))
})

app.get('/api/token/info', (req, res) => {
  if (!req.query.address) return res.status(400).json({ error: 'missing address' })
  const out = run(['token', 'info', '--chain', q(req.query.chain), '--address', req.query.address])
  res.json(parse(out))
})

app.get('/api/token/security', (req, res) => {
  if (!req.query.address) return res.status(400).json({ error: 'missing address' })
  const out = run(['token', 'security', '--chain', q(req.query.chain), '--address', req.query.address])
  res.json(parse(out))
})

app.get('/api/token/rugcheck', (req, res) => {
  const chain = req.query.chain || 'sol'; const addr = req.query.address
  if (!addr) return res.status(400).json({ error: 'missing address' })
  const out = run(['token', 'traders', '--chain', chain, '--address', addr, '--limit', '30', '--order-by', 'profit', '--direction', 'desc'])
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
  const out = run(['portfolio', 'holdings', '--chain', q(req.query.chain), '--wallet', req.query.wallet, '--limit', '50', '--hide-closed', 'false'])
  res.json(parse(out)?.list || [])
})

app.get('/api/portfolio/stats', (req, res) => {
  if (!req.query.wallet) return res.status(400).json({ error: 'missing wallet' })
  const out = run(['portfolio', 'stats', '--chain', q(req.query.chain), '--wallet', req.query.wallet])
  res.json(parse(out))
})

app.get('/api/config/check', (req, res) => {
  try { execSync(`node "${GMGN_CLI}" config --check`, { encoding: 'utf-8', timeout: 5000 }); res.json({ connected: true }) }
  catch { res.json({ connected: false }) }
})

// Factory SSE (user-initiated only)
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

// Sniper SSE (user-initiated only)
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

app.get('/api/sniper/status', (req, res) => { res.json(sniper.getStatus()) })
app.get('/api/sniper/detected', (req, res) => { res.json(sniper.getRecentDetected(parseInt(req.query.limit) || 30)) })
app.get('/api/sniper/buys', (req, res) => { res.json(sniper.getRecentBuys(parseInt(req.query.limit) || 20)) })

app.listen(PORT, () => {
  console.log(`GMGN Terminal Web → http://localhost:${PORT}`)
})
