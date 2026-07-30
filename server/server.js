const express = require('express')
const { execSync } = require('child_process')
const path = require('path')
const { getSignals } = require('../signal-engine/index.js')
const app = express()
const PORT = 3000

app.use(express.static(path.join(__dirname, 'public')))

function run(args) {
  try {
    const cmd = `gmgn-cli ${args.join(' ')} --raw 2>NUL`
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000, shell: 'pwsh.exe' }).trim()
  } catch { return '' }
}

function parse(out) { try { return JSON.parse(out) } catch { return null } }

const CHAINS = ['sol', 'bsc', 'base', 'eth', 'robinhood']

// ── Shared data cache ──
const cache = {
  trending: {},    // chain -> data
  trenches: {},    // chain -> data
  smartMoney: {},  // chain -> data
  kol: {},         // chain -> data
  signals: {},     // chain -> data
}

// SSE clients
let sseClients = []

function broadcast(type, chain, data) {
  const msg = JSON.stringify({ type, chain, data, ts: Date.now() })
  for (const c of sseClients) {
    try { c.write(`event: ${type}\ndata: ${msg}\n\n`) } catch {}
  }
}

function broadcastAll(changedType, changedChain) {
  const snapshot = {}
  for (const type of Object.keys(cache)) {
    snapshot[type] = {}
    for (const chain of Object.keys(cache[type])) {
      snapshot[type][chain] = cache[type][chain]
    }
  }
  const msg = JSON.stringify({ type: changedType, chain: changedChain, data: snapshot, ts: Date.now(), full: true })
  for (const c of sseClients) {
    try { c.write(`event: update\ndata: ${msg}\n\n`) } catch {}
  }
}

// ── Workers ──

function pollTrending(chain) {
  const out = run(['market', 'trending', '--chain', chain, '--interval', '5m', '--order-by', 'volume', '--limit', '30'])
  const d = parse(out)
  if (d?.data?.rank) { cache.trending[chain] = d.data.rank; broadcastAll('trending', chain) }
}

function pollTrenches(chain) {
  const out = run(['market', 'trenches', '--chain', chain, '--type', 'new_creation', '--filter-preset', 'safe', '--limit', '40'])
  const d = parse(out)
  const tokens = d?.data?.new_creation || d?.data?.pump || []
  if (tokens.length) { cache.trenches[chain] = tokens; broadcastAll('trenches', chain) }
}

function pollSmartMoney(chain) {
  const out = run(['track', 'smartmoney', '--chain', chain, '--limit', '30'])
  const d = parse(out)
  if (d?.list) { cache.smartMoney[chain] = d.list; broadcastAll('smartMoney', chain) }
}

function pollKol(chain) {
  const out = run(['track', 'kol', '--chain', chain, '--limit', '30'])
  const d = parse(out)
  if (d?.list) { cache.kol[chain] = d.list; broadcastAll('kol', chain) }
}

function pollSignals(chain) {
  try {
    const sigs = getSignals(chain === 'all' ? '' : chain)
    if (sigs.length) { cache.signals[chain] = sigs; broadcastAll('signals', chain) }
  } catch {}
}

function startWorker(fn, label, chain) {
  const loop = () => {
    try { fn(chain) } catch {}
    setTimeout(loop, 200) // 200ms stagger, each finishes at its own pace
  }
  loop()
}

function startPollers() {
  for (const chain of ['sol']) {
    startWorker(pollTrending, 'trending', chain)
    startWorker(pollTrenches, 'trenches', chain)
    startWorker(pollSmartMoney, 'smartMoney', chain)
    startWorker(pollKol, 'kol', chain)
    startWorker(pollSignals, 'signals', chain)
  }
  // Background scan other chains less frequently
  for (const chain of ['bsc', 'base', 'eth', 'robinhood', 'all']) {
    setTimeout(() => startWorker(pollSignals, 'signals-bg', chain), 5000)
  }
}

startPollers()

// ── REST endpoints (fallback) ──

function q(s) { return s || 'sol' }

app.get('/api/trending', (req, res) => {
  const c = q(req.query.chain)
  if (cache.trending[c]) return res.json(cache.trending[c])
  const out = run(['market', 'trending', '--chain', c, '--interval', '5m', '--order-by', 'volume', '--limit', '30'])
  res.json(parse(out)?.data?.rank || [])
})

app.get('/api/trenches', (req, res) => {
  const c = q(req.query.chain)
  if (cache.trenches[c]) return res.json(cache.trenches[c])
  const out = run(['market', 'trenches', '--chain', c, '--type', 'new_creation', '--filter-preset', 'safe', '--limit', '40'])
  const d = parse(out)
  res.json(d?.data?.new_creation || d?.data?.pump || [])
})

app.get('/api/smartmoney', (req, res) => {
  const c = q(req.query.chain)
  if (cache.smartMoney[c]) return res.json(cache.smartMoney[c])
  const out = run(['track', 'smartmoney', '--chain', c, '--limit', '30'])
  res.json(parse(out)?.list || [])
})

app.get('/api/kol', (req, res) => {
  const c = q(req.query.chain)
  if (cache.kol[c]) return res.json(cache.kol[c])
  const out = run(['track', 'kol', '--chain', c, '--limit', '30'])
  res.json(parse(out)?.list || [])
})

app.get('/api/signals', (req, res) => {
  const c = req.query.chain || 'sol'
  if (cache.signals[c]) return res.json(cache.signals[c])
  res.json(getSignals(c === 'all' ? '' : c))
})

app.get('/api/token/info', (req, res) => {
  const addr = req.query.address
  if (!addr) return res.status(400).json({ error: 'missing address' })
  const out = run(['token', 'info', '--chain', q(req.query.chain), '--address', addr])
  res.json(parse(out))
})

app.get('/api/token/security', (req, res) => {
  const addr = req.query.address
  if (!addr) return res.status(400).json({ error: 'missing address' })
  const out = run(['token', 'security', '--chain', q(req.query.chain), '--address', addr])
  res.json(parse(out))
})

app.get('/api/portfolio/holdings', (req, res) => {
  const wallet = req.query.wallet
  if (!wallet) return res.status(400).json({ error: 'missing wallet' })
  const out = run(['portfolio', 'holdings', '--chain', q(req.query.chain), '--wallet', wallet, '--limit', '50', '--hide-closed', 'false'])
  res.json(parse(out)?.list || [])
})

app.get('/api/portfolio/stats', (req, res) => {
  const wallet = req.query.wallet
  if (!wallet) return res.status(400).json({ error: 'missing wallet' })
  const out = run(['portfolio', 'stats', '--chain', q(req.query.chain), '--wallet', wallet])
  res.json(parse(out))
})

app.get('/api/config/check', (req, res) => {
  try {
    execSync('gmgn-cli config --check', { encoding: 'utf-8', shell: 'pwsh.exe' })
    res.json({ connected: true })
  } catch { res.json({ connected: false }) }
})

// ── SSE endpoint ──

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // Send full initial state
  const init = {}
  for (const type of Object.keys(cache)) {
    init[type] = {}
    for (const chain of Object.keys(cache[type])) {
      init[type][chain] = cache[type][chain]
    }
  }
  res.write(`event: init\ndata: ${JSON.stringify({ data: init, ts: Date.now() })}\n\n`)

  sseClients.push(res)
  res.on('close', () => { sseClients = sseClients.filter(c => c !== res) })
})

// ── Factory API ──────────────────────────────────────────────────────

const factory = require('../features/pons-factory/index.js')
app.get('/api/factory/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' })
  const onLog = (msg) => { try { res.write(`data: ${JSON.stringify({ type: 'log', msg })}\n\n`) } catch {} }
  const onCycle = (d) => { try { res.write(`data: ${JSON.stringify({ type: 'cycle', ...d })}\n\n`) } catch {} }
  const onDone = (r) => { try { res.write(`data: ${JSON.stringify({ type: 'done', result: r })}\n\n`) } catch {} }
  const onStatus = (s) => { try { res.write(`data: ${JSON.stringify({ type: 'status', status: s })}\n\n`) } catch {} }
  factory.on('log', onLog); factory.on('cycle', onCycle); factory.on('done', onDone); factory.on('status', onStatus)
  res.write(`data: ${JSON.stringify({ type: 'status', status: factory.getStatus() })}\n\n`)
  const keepalive = setInterval(() => res.write(':keepalive\n\n'), 15000)
  req.on('close', () => { factory.removeListener('log', onLog); factory.removeListener('cycle', onCycle); factory.removeListener('done', onDone); factory.removeListener('status', onStatus); clearInterval(keepalive) })
})

app.post('/api/factory/setup', (req, res) => { try { const r = factory.setup(); res.json(r) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.post('/api/factory/fund', express.json(), (req, res) => { try { const r = factory.fund(req.body.fromPk); res.json(r) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.post('/api/factory/run', express.json(), (req, res) => { try { factory.run(req.body.cycles, req.body.mainAddress); res.json({ ok: true }) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.get('/api/factory/balances', (req, res) => { try { const b = factory.getBalances(); res.json({ ok: true, balances: b }) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.post('/api/factory/sweep', express.json(), (req, res) => { try { const r = factory.sweep(req.body.toAddress); res.json(r) } catch (e) { res.json({ ok: false, error: e.message }) } })
app.get('/api/factory/status', (req, res) => { res.json(factory.getStatus()) })

// ── Sniper API ──────────────────────────────────────────────────────

const sniper = require('../features/sniper/index.js').getSniperAdapter()

app.get('/api/sniper/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' })
  const onLog = (msg) => { try { res.write(`data: ${JSON.stringify({ type: 'log', msg })}\n\n`) } catch {} }
  const onDetected = (token) => { try { res.write(`data: ${JSON.stringify({ type: 'detected', token })}\n\n`) } catch {} }
  const onFiltered = (data) => { try { res.write(`data: ${JSON.stringify({ type: 'filtered', ...data })}\n\n`) } catch {} }
  const onBuyResult = (result) => { try { res.write(`data: ${JSON.stringify({ type: 'buy', result })}\n\n`) } catch {} }
  const onStatus = (status) => { try { res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`) } catch {} }
  sniper.on('log', onLog); sniper.on('detected', onDetected); sniper.on('filtered', onFiltered); sniper.on('buy-result', onBuyResult); sniper.on('status', onStatus)
  res.write(`data: ${JSON.stringify({ type: 'status', status: sniper.getStatus() })}\n\n`)
  const keepalive = setInterval(() => res.write(':keepalive\n\n'), 15000)
  req.on('close', () => { sniper.removeListener('log', onLog); sniper.removeListener('detected', onDetected); sniper.removeListener('filtered', onFiltered); sniper.removeListener('buy-result', onBuyResult); sniper.removeListener('status', onStatus); clearInterval(keepalive) })
})

app.post('/api/sniper/start', express.json(), (req, res) => {
  const { chain } = req.body
  if (!chain || !['sol', 'robinhood'].includes(chain)) return res.status(400).json({ error: 'chain must be sol or robinhood' })
  sniper.start(chain); res.json({ ok: true })
})

app.post('/api/sniper/stop', express.json(), (req, res) => {
  const { chain } = req.body
  if (chain) sniper.stop(chain); else sniper.stopAll()
  res.json({ ok: true })
})

app.post('/api/sniper/wallet', express.json(), (req, res) => {
  const { chain, address } = req.body
  if (!chain || !address) return res.status(400).json({ error: 'missing chain or address' })
  sniper.setWallet(chain, address); res.json({ ok: true })
})

app.post('/api/sniper/autobuy', express.json(), (req, res) => {
  const { chain, enabled } = req.body
  if (!chain) return res.status(400).json({ error: 'missing chain' })
  sniper.setAutoBuy(chain, enabled); res.json({ ok: true })
})

app.get('/api/sniper/status', (req, res) => { res.json(sniper.getStatus()) })
app.get('/api/sniper/detected', (req, res) => { res.json(sniper.getRecentDetected(parseInt(req.query.limit) || 30)) })
app.get('/api/sniper/buys', (req, res) => { res.json(sniper.getRecentBuys(parseInt(req.query.limit) || 20)) })

app.listen(PORT, () => {
  console.log(`GMGN Terminal Web → http://localhost:${PORT}`)
})
