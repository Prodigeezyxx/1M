const TABS = ['HUB', 'TRENCHES', 'TRADES', 'SIGNALS', 'TOKEN', 'PORTFOLIO', 'FACTORY', 'SNIPER', 'PROTECTOR']
let activeTab = 0
let cachedData = { trending: [], trenches: [], smartMoney: [], kol: [], signals: [] }
let portAddr = ''
let lastChain = 'sol'
let loading = false
let showUnder5k = true
let availableStrategies = null
let lastSniperStatus = null

const $ = id => document.getElementById(id)
const content = $('content')
const input = $('input')
const status = $('status')

function chain() { return $('chain-select').value }
function dataFor(type) { return cachedData[type] || [] }

function fiat(n) { n = Number(n); if (n > 1e6) return `<span class="gold">$${(n/1e6).toFixed(2)}M</span>`; if (n > 1e3) return `<span class="gold">$${(n/1e3).toFixed(1)}K</span>`; return `$${n.toFixed(2)}` }
function rugC(r) { r=Number(r); if (r>0.3) return `<span class="error">${r.toFixed(2)}</span>`; if (r>0.1) return `<span class="gold">${r.toFixed(2)}</span>`; return `${r.toFixed(2)}` }
function ago(ts) { const s=Math.floor(Date.now()/1e3-ts); if(s<60)return `${s}s`; const m=Math.floor(s/60); if(m<60)return `${m}m`; return `${Math.floor(m/60)}h` }
function sa(a) { return a?a.slice(0,4)+'..'+a.slice(-4):'' }
function tr(s,n) { return s&&s.length>n?s.slice(0,n-1)+'\u2026':(s||'') }
function sm(n) { return n>=5?`<span class="cyan">${n}</span>`:n>=3?`<span class="gold">${n}</span>`:n>0?String(n):'-' }
function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML }
function tRow(t) { const l='\u2550'.repeat(Math.max(2,54-t.length)); return `<span class="bold">\u2554\u2556 ${t} ${l}\u2557</span>` }
function bRow() { return `<span class="bold">\u255a${'\u2550'.repeat(56)}\u255d</span>` }

function mcBar(mc, ath) {
  const pct = ath > 0 ? Math.min(100, (mc / ath) * 100) : 0
  const filled = Math.round(pct / 4)
  const empty = 25 - filled
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(Math.max(0, empty))
  const color = pct > 80 ? 'cyan' : pct > 40 ? 'gold' : 'dim'
  return `<span class="${color}">${bar}</span> <span class="dim">${pct.toFixed(0)}%</span>`
}

function copyCA(addr, el) {
  if (!addr) return
  navigator.clipboard.writeText(addr).then(() => {
    const orig = el.textContent; el.textContent = '\u2713'; el.style.color = '#00e676'
    setTimeout(() => { el.textContent = orig; el.style.color = '' }, 600)
  }).catch(() => {})
}

function bindCA() { document.querySelectorAll('.ca').forEach(el => { el.onclick = (e) => { e.stopPropagation(); copyCA(el.dataset.addr, el) } }) }

async function fetchJSON(url) {
  try { const r = await fetch(url); return await r.json() } catch { return null }
}

async function refreshAll() {
  if (loading) return
  loading = true
  const c = chain()
  lastChain = c
  const [tren, trend, sm, kol, sigs] = await Promise.all([
    fetchJSON(`/api/trenches?chain=${c}`),
    fetchJSON(`/api/trending?chain=${c}`),
    fetchJSON(`/api/smartmoney?chain=${c}`),
    fetchJSON(`/api/kol?chain=${c}`),
    fetchJSON(`/api/signals?chain=${c}`),
  ])
  if (tren && Array.isArray(tren)) cachedData.trenches = tren
  if (trend && Array.isArray(trend)) cachedData.trending = trend
  if (sm && Array.isArray(sm)) cachedData.smartMoney = sm
  if (kol && Array.isArray(kol)) cachedData.kol = kol
  if (sigs && Array.isArray(sigs)) cachedData.signals = sigs
  loading = false
  $('freshness').textContent = `${Math.floor((Date.now()-pollStart)/1000)}s`
  if (activeTab !== 4 && activeTab !== 5) renderCurrentTab()
}

function renderCurrentTab() {
  switch (activeTab) {
    case 0: renderHub(); break; case 1: renderTrenches(); break; case 2: renderTrades(); break
    case 3: renderSignals(); break; case 4: if (lastTokenQuery) renderTokenSearch(lastTokenQuery); break
    case 5: if (portAddr) renderPortfolio(lastChain, portAddr); break
    case 6: renderFactory(); break; case 7: renderSniper(); break; case 8: renderProtector(); break
  }
}

function renderHub() {
  const l = ['']
  const trens = dataFor('trenches')
  const trend = dataFor('trending')
  const sm = dataFor('smartMoney')
  const sigs = dataFor('signals')

  const snipes = (sigs || []).filter(s => s.patterns?.includes('SNIPER_TARGET') && s.score >= 50).slice(0, 6)
  const preBond = (sigs || []).filter(s => s.patterns?.includes('PRE_BOND_RUN') && s.score >= 50).slice(0, 4)
  if (snipes.length > 0) {
    l.push(tRow(`\u2620 SNIPER TARGETS (${snipes.length})`))
    l.push(`<span class="bold">\u2551  SYMBOL    MC          LIQ         AGE  SM  SCORE  RISK       \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const s of snipes) {
      const sc = s.score >= 70 ? `<span class="cyan">${s.score}</span>` : `<span class="gold">${s.score}</span>`
      const ageStr = s.age > 0 ? ago(Date.now()/1e3 - s.age) : 'new'
      const risk = s.isHoneypot ? '<span class="error">HONEY</span>' : s.rugRatio > 0.1 ? `<span class="gold">${(s.rugRatio*100).toFixed(0)}%</span>` : '<span class="green">LOW</span>'
      l.push(`\u2551 <span class="ca gold" data-addr="${esc(s.address)}">${tr(s.symbol,8).padEnd(8)}</span> ${fiat(s.mc).padEnd(10)} ${fiat(s.liq).padEnd(11)} ${ageStr.padEnd(4)} ${sm(s.smartDegen).padEnd(3)} ${sc.toString().padEnd(5)} ${risk.padEnd(10)} \u2551`)
    }
    l.push(bRow())
  }

  if (preBond.length > 0) {
    l.push(tRow(`\u26A1 PRE-BOND RUN (${preBond.length})`))
    l.push(`<span class="bold">\u2551  SYMBOL    MC          LIQ         VOL        5M CHG            \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const s of preBond) {
      const chg = s.priceChange5m != null ? (s.priceChange5m >= 0 ? `<span class="cyan">+${(s.priceChange5m*100).toFixed(1)}%</span>` : `<span class="error">${(s.priceChange5m*100).toFixed(1)}%</span>`) : '<span class="dim">-</span>'
      l.push(`\u2551 <span class="ca gold" data-addr="${esc(s.address)}">${tr(s.symbol,8).padEnd(8)}</span> ${fiat(s.mc).padEnd(10)} ${fiat(s.liq).padEnd(11)} ${fiat(s.volume||s.vol).padEnd(10)} ${chg.padEnd(15)} \u2551`)
    }
    l.push(bRow())
  }

  let trensFiltered = trens
  if (showUnder5k) trensFiltered = trensFiltered.filter(t => parseFloat(t.mc || t.marketCap || 0) < 5000)
  l.push(tRow(`\U0001F4E1 NEW LAUNCHES (${trensFiltered.length}/${trens.length})`))
  if (trensFiltered.length > 0) {
    l.push(`<span class="bold">\u2551  SYM    MC-BAR               MC     AGE SM VOL    \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const t of trensFiltered.slice(0, 20)) {
      const mcNum = parseFloat(t.mc || t.marketCap || 0)
      const r = t.isHoneypot ? '<span class="error">\u2622</span>' : rugC(t.rugRatio||0)
      const a = t.age !== undefined ? ago(parseInt(t.createdAt)||t.age) : 'new'
      l.push(`\u2551 <span class="ca" data-addr="${esc(t.address)}">${tr(t.symbol,4).padEnd(4)}</span> ${mcBar(mcNum, mcNum*3).padEnd(20)} ${fiat(mcNum).padEnd(8)} ${a.padEnd(4)} ${sm(t.smartMoney||t.smartDegen).padEnd(2)} ${fiat(t.volume||t.vol).padEnd(8)}${r}\u2551`)
    }
    l.push(bRow())
  }

  l.push(tRow(`\U0001F4C8 TRENDING (${trend.length})`))
  if (trend.length > 0) {
    l.push(`<span class="bold">\u2551  SYMBOL    MC          VOL         5M CHG    H  SM            \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const t of trend.slice(0, 8)) {
      const chg = t.priceChange5m != null ? (t.priceChange5m >= 0 ? `<span class="cyan">+${(t.priceChange5m*100).toFixed(1)}%</span>` : `<span class="error">${(t.priceChange5m*100).toFixed(1)}%</span>`) : '<span class="dim">-</span>'
      l.push(`\u2551 <span class="ca" data-addr="${esc(t.address)}">${tr(t.symbol,8).padEnd(8)}</span> ${fiat(t.mc).padEnd(10)} ${fiat(t.volume||t.vol).padEnd(10)} ${chg.padEnd(10)} ${(''+(t.hourly||t.h||'')).padEnd(5)} ${(''+(t.smartMoney||t.smartDegen||'')).padEnd(10)} \u2551`)
    }
    l.push(bRow())
  }

  l.push(tRow('SMART MONEY'))
  if (sm.length > 0) {
    l.push(`<span class="bold">\u2551  ADDR       TOKEN         PROFIT      MC         \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const w of sm.slice(0, 6)) {
      const addr = sa(w.address||w.wallet||w.holder||'')
      const sym = tr(w.symbol||w.token||'', 8)
      const pf = parseFloat(w.profit||0) > 0 ? `<span class="cyan">+${w.profit}</span>` : `<span class="error">${w.profit}</span>`
      l.push(`\u2551 ${addr.padEnd(11)} ${sym.padEnd(14)} ${pf.padEnd(11)} ${fiat(w.mc||w.marketCap).padEnd(14)} \u2551`)
    }
    l.push(bRow())
  }

  l.push(tRow('\u03B1 ALPHA'))
  let alphas = sigs?.filter(s => s.score >= 70) || []
  if (showUnder5k) alphas = alphas.filter(s => s.mc < 5000)
  alphas = alphas.slice(0, 20)
  if (alphas.length > 0) {
    l.push(`<span class="bold">\u2551  SYM    SCR MC-BAR              ATH    AGE  CHG     LIQ      SM RUG \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const a of alphas) {
      const sc = a.score >= 80 ? `<span class="cyan">${a.score}</span>` : `<span class="gold">${a.score}</span>`
      const ageStr = a.age > 0 ? ago(Date.now()/1e3 - a.age) : 'new'
      const chg = a.priceChange != null ? (a.priceChange >= 0 ? `<span class="cyan">+${(a.priceChange*100).toFixed(0)}%</span>` : `<span class="error">${(a.priceChange*100).toFixed(0)}%</span>`) : '<span class="dim">-</span>'
      const ath = a.ath || a.mc || 0
      const warn = a.rugRatio > 0.3 ? '<span class="error">\u2622</span>' : a.rugRatio > 0.1 ? '<span class="gold">\u26A0</span>' : '<span class="dim">-</span>'
      l.push(`\u2551 <span class="ca" data-addr="${esc(a.address)}">${tr(a.symbol,4).padEnd(4)}</span> ${sc.toString().padEnd(3)} ${mcBar(a.mc, ath).padEnd(20)} ${fiat(ath).padEnd(6)} ${ageStr.padEnd(4)} ${chg.padEnd(7)} ${fiat(a.liq).padEnd(6)} ${sm(a.smartDegen).padEnd(2)} ${warn}\u2551`)
    }
    l.push(bRow())
  }

  content.innerHTML = l.join('\n')
  bindCA()
}

function renderTrenches() {
  const trens = dataFor('trenches')
  let l = ['']
  l.push(tRow(`\U0001F4E1 NEW CREATIONS (${trens.length})`))
  if (trens.length === 0) { l.push(`\u2551  <span class="dim">No data. Try a different chain.</span>                                \u2551`) }
  else {
    l.push(`<span class="bold">\u2551  SYMBOL    MC          LIQ         AGE  SM  RUG    VOL           \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const t of trens) {
      const r = t.isHoneypot ? '<span class="error">HONEY</span>' : rugC(t.rugRatio||0)
      const a = t.age !== undefined ? ago(parseInt(t.createdAt)||t.age) : 'new'
      l.push(`\u2551 <span class="ca" data-addr="${esc(t.address)}">${tr(t.symbol,8).padEnd(8)}</span> ${fiat(t.mc).padEnd(10)} ${fiat(t.liquidity||t.liq).padEnd(11)} ${a.padEnd(4)} ${sm(t.smartMoney||t.smartDegen).padEnd(3)} ${r.padEnd(6)} ${fiat(t.volume||t.vol).padEnd(12)} \u2551`)
    }
  }
  l.push(bRow()); content.innerHTML = l.join('\n'); bindCA()
}

function renderTrades() {
  const sm = dataFor('smartMoney'); const kol = dataFor('kol'); let l = ['']
  l.push(tRow('SMART MONEY TRADES'))
  if (sm.length === 0) { l.push(`\u2551  <span class="dim">No smart money data.</span>                                          \u2551`) }
  else {
    l.push(`<span class="bold">\u2551  ADDR       TOKEN         ACTION  PROFIT      MC         \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const w of sm.slice(0, 12)) {
      const addr = sa(w.address||w.wallet||w.holder||''), sym = tr(w.symbol||w.token||'', 8)
      const act = (w.action||'BUY').padEnd(6)
      const pf = parseFloat(w.profit||0) > 0 ? `<span class="cyan">+${w.profit}</span>` : parseFloat(w.profit||0) < 0 ? `<span class="error">${w.profit}</span>` : '<span class="dim">0</span>'
      l.push(`\u2551 ${addr.padEnd(11)} ${sym.padEnd(14)} ${act} ${pf.padEnd(11)} ${fiat(w.mc||w.marketCap).padEnd(14)} \u2551`)
    }
  }
  l.push(bRow()); l.push('')
  l.push(tRow(`KOL TRADES (${kol.length})`))
  if (kol.length > 0) {
    l.push(`<span class="bold">\u2551  KOL        TOKEN         PROFIT      MC         \u2551</span>`)
    for (const w of kol.slice(0, 12)) {
      const addr = sa(w.address||w.wallet||''), sym = tr(w.symbol||w.token||'', 8)
      const pf = parseFloat(w.profit||0) > 0 ? `<span class="cyan">+${w.profit}</span>` : `<span class="error">${w.profit}</span>`
      l.push(`\u2551 ${addr.padEnd(11)} ${sym.padEnd(14)} ${pf.padEnd(11)} ${fiat(w.mc||w.marketCap).padEnd(14)} \u2551`)
    }
  }
  l.push(bRow()); content.innerHTML = l.join('\n'); bindCA()
}

function renderSignals() {
  const sigs = dataFor('signals'); let l = ['']
  l.push(tRow(`DETECTED SIGNALS (${sigs.length})`))
  if (sigs.length === 0) { l.push(`\u2551  <span class="dim">No signals for this chain.</span>                                    \u2551`) }
  else {
    l.push(`<span class="bold">\u2551  SYMBOL    SCORE  SM  RUG  5M CHG    PATTERNS              \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const s of sigs.slice(0, 30)) {
      const sc = s.score >= 70 ? `<span class="cyan">${s.score}</span>` : s.score >= 40 ? `<span class="gold">${s.score}</span>` : String(s.score)
      const r = s.rugRatio > 0.3 ? `<span class="error">${(s.rugRatio*100).toFixed(0)}%</span>` : s.rugRatio > 0.1 ? `<span class="gold">${(s.rugRatio*100).toFixed(0)}%</span>` : '-'
      const chg = s.priceChange5m != null ? (s.priceChange5m >= 0 ? `<span class="cyan">+${(s.priceChange5m*100).toFixed(1)}%</span>` : `<span class="error">${(s.priceChange5m*100).toFixed(1)}%</span>`) : '<span class="dim">-</span>'
      const pats = Array.isArray(s.patterns) ? s.patterns.slice(0, 4).join(', ') : (s.patterns||'')
      const rugWarn = s.isDevSniperRug ? ' <span class="error">\u2622 RUG</span>' : ''
      l.push(`\u2551 <span class="ca gold" data-addr="${esc(s.address)}">${tr(s.symbol,8).padEnd(8)}</span> ${sc.toString().padEnd(6)} ${(''+sm(s.smartDegen)).padEnd(3)} ${r.padEnd(5)} ${chg.padEnd(9)} ${tr(pats+rugWarn,16).padEnd(20)} \u2551`)
    }
  }
  l.push(bRow()); l.push('<span class="dim">  Click symbol \u2192 copy CA    |    Score 70+ \u2192 alpha    |    \u2622 = rug risk</span>')
  content.innerHTML = l.join('\n'); bindCA()
}

let lastTokenQuery = ''
function renderTokenSearch(q) {
  if (q) lastTokenQuery = q
  if (!lastTokenQuery) { content.innerHTML = `\n\n  <span class="gold">Token Research</span>\n\n  Type <span class="cyan">sol:ADDR</span> or <span class="cyan">bsc:ADDR</span> in the bottom bar and press Enter\n  Or click any symbol from other tabs.`; return }
  const parts = lastTokenQuery.split(':'); const c = parts[0] || 'sol'; const addr = parts.slice(1).join(':')
  if (!addr) return
  content.innerHTML = `<span class="dim">Fetching ${c}:${sa(addr)}...</span>`
  Promise.all([fetchJSON(`/api/token/info?chain=${c}&address=${addr}`), fetchJSON(`/api/token/security?chain=${c}&address=${addr}`), fetchJSON(`/api/token/rugcheck?chain=${c}&address=${addr}`)])
    .then(([info, sec, rug]) => {
      let l = ['']
      const d = info?.data || info || {}
      const ath = d.ath || d.history_highest_market_cap || d.mc || 0
      const tokenAge = d.age || d.created_timestamp ? ago(d.created_timestamp || (Date.now()/1e3 - d.age)) : '?'
      l.push(tRow(`TOKEN ${sa(addr)}`)); l.push(`\u2551  Symbol        ${d.symbol||'?'}                                          \u2551`)
      l.push(`\u2551  Name          ${tr(d.name||'?', 40)}                              \u2551`)
      l.push(`\u2551  MC            ${fiat(d.mc||d.marketCap||0).padEnd(40)}                              \u2551`)
      l.push(`\u2551  MC Bar        ${mcBar(d.mc||d.marketCap||0, ath).padEnd(40)}                              \u2551`)
      l.push(`\u2551  ATH           ${fiat(ath).padEnd(40)}                              \u2551`)
      l.push(`\u2551  Age           ${tokenAge.padEnd(40)}                              \u2551`)
      l.push(`\u2551  Liq           ${fiat(d.liquidity||d.liq||0).padEnd(40)}                              \u2551`)
      l.push(`\u2551  Price         ${'$'+(d.price||'?')}                                       \u2551`)
      if (rug) {
        l.push(`\u2551  ${rug.isDevSniperRug ? '<span class="error">\u2622 DEV SNIPER RUG</span>' : '<span class="green">\u2713 No rug pattern</span>'} ${rug.confidence > 0 ? `(confidence: ${rug.confidence}%)` : ''}             \u2551`)
        if (rug.signals?.length) l.push(`\u2551  Signals: ${rug.signals.join(', ')}                              \u2551`)
        if (rug.topExtractors?.length) { for (const e of rug.topExtractors.slice(0, 3)) l.push(`\u2551  ${sa(e.address)} profit=${fiat(e.profit)} tags=${e.tags?.join(',')}               \u2551`) }
      }
      if (sec) {
        const s = sec.data || sec
        l.push(`\u2551  Honeypot      ${s.isHoneypot ? '<span class="error">YES</span>' : '<span class="green">NO</span>'}                                           \u2551`)
        l.push(`\u2551  Renounced     ${s.renounced ? '<span class="green">YES</span>' : '<span class="error">NO</span>'}                                           \u2551`)
        l.push(`\u2551  Top10         ${s.top10HolderPercent ? (s.top10HolderPercent+'%') : '-'}                                            \u2551`)
      }
      l.push(bRow()); l.push(`<span class="dim">  Click symbol \u2192 copy    |    Chain: ${c}    |    Buy/Sell via F8 Sniper tab</span>`); content.innerHTML = l.join('\n')
    })
}

function renderPortfolio(c, wallet) {
  if (!wallet) { content.innerHTML = `\n\n  <span class="gold">Portfolio Tracker</span>\n\n  Type <span class="cyan">portfolio ADDR</span> in the bottom bar\n  Or <span class="cyan">portfolio bsc:ADDR</span> for a specific chain.`; return }
  content.innerHTML = `<span class="dim">Fetching ${c}:${sa(wallet)}...</span>`
  Promise.all([fetchJSON(`/api/portfolio/holdings?chain=${c}&wallet=${wallet}`), fetchJSON(`/api/portfolio/stats?chain=${c}&wallet=${wallet}`)])
    .then(([holdings, stats]) => {
      let l = ['']; const s = stats?.data || stats || {}
      l.push(tRow(`PORTFOLIO ${sa(wallet)}`))
      l.push(`\u2551  P&L           ${parseFloat(s.pnl||s.profit||0) >= 0 ? '<span class="cyan">+'+fiat(s.pnl||s.profit||0)+'</span>' : '<span class="error">'+fiat(s.pnl||s.profit||0)+'</span>'}                               \u2551`)
      l.push(`\u2551  Win Rate      ${s.winRate || s.win_rate || '?'}%                                              \u2551`)
      l.push(`\u2551  Total Trades  ${s.totalTrades || s.trades || '?'}                                             \u2551`)
      l.push(bRow())
      if (holdings?.length > 0) {
        l.push(tRow(`HOLDINGS (${holdings.length})`)); l.push(`<span class="bold">\u2551  SYMBOL    BALANCE       VALUE       PROFIT      \u2551</span>`)
        for (const h of holdings.slice(0, 20)) {
          const sym = tr(h.symbol||h.token||'', 8), bal = h.balance || h.amount || '?'
          const val = fiat(h.valueUsd||h.value||0), pnl = parseFloat(h.pnl||h.profit||0) >= 0 ? `<span class="cyan">+${fiat(h.pnl||h.profit||0)}</span>` : `<span class="error">${fiat(h.pnl||h.profit||0)}</span>`
          l.push(`\u2551 ${sym.padEnd(8)}  ${String(bal).padEnd(12)} ${val.padEnd(11)} ${pnl.padEnd(14)} \u2551`)
        }
        l.push(bRow())
      }
      content.innerHTML = l.join('\n')
    })
}

function renderFactory() {
  let l = ['']
  l.push(tRow('PONS FACTORY'))
  l.push(`\u2551  <span class="dim">Pump-and-Dump on Robinhood ETH PONS tokens</span>               \u2551`)
  l.push(`\u2551  <span class="dim">Setup wallets, fund, then run cycles.</span>                     \u2551`)
  l.push(bRow()); l.push('')
  l.push(tRow('CONTROLS'))
  l.push(`\u2551  <span class="cyan">[1] Setup Wallets</span>  Creates puppet wallets                   \u2551`)
  l.push(`\u2551  <span class="cyan">[2] Fund</span>            Send ETH to all puppets                 \u2551`)
  l.push(`\u2551  <span class="cyan">[3] Run X</span>           Run X cycles (e.g. "run 3")             \u2551`)
  l.push(`\u2551  <span class="cyan">[4] Balances</span>        Check all balances                      \u2551`)
  l.push(`\u2551  <span class="cyan">[5] Sweep ADDR</span>      Sweep ETH to main address               \u2551`)
  l.push(bRow()); l.push('')
  l.push('<div id="factory-log" style="color:#2a5a2a">Log will appear here.</div>')
  content.innerHTML = l.join('\n')
}

let factoryEs = null
function factoryConnectSSE() {
  factoryEs = new EventSource('/api/factory/stream')
  factoryEs.onmessage = (e) => {
    const d = JSON.parse(e.data); const log = document.getElementById('factory-log')
    if (!log) return
    if (d.type === 'log') log.innerHTML = esc(d.msg) + '<br>' + log.innerHTML.substring(0, 2000)
    else if (d.type === 'status') log.innerHTML = `Status: ${JSON.stringify(d.status)}<br>` + log.innerHTML.substring(0, 2000)
    else if (d.type === 'done') log.innerHTML = `<span class="cyan">DONE</span><br>` + log.innerHTML.substring(0, 2000)
  }
  factoryEs.onerror = () => { factoryEs.close(); setTimeout(factoryConnectSSE, 2000) }
}

async function renderSniper() {
  const c = chain()
  let l = ['']
  l.push(tRow(`SNIPER [${c.toUpperCase()}]`))
  l.push(`\u2551  <span class="dim">Real-time token detector for ${c}</span>                            \u2551`)
  l.push(bRow()); l.push('')
  l.push(tRow('CONTROLS (keyboard)'))
  l.push(`\u2551  <span class="cyan">[1] Start ${c}</span>   <span class="cyan">[5] Stop</span>          <span class="cyan">[7] SellAll</span>              \u2551`)
  l.push(`\u2551  <span class="cyan">[2] Wallet</span>       <span class="cyan">[6] Autobuy</span>       <span class="cyan">[8] Autosell</span>             \u2551`)
  l.push(`\u2551  <span class="cyan">[3] Strategy</span>     <span class="cyan">[4] Strategy-</span>    <span class="cyan">[9] Set Amount</span>                \u2551`)
  l.push(bRow())
  // Load strategies
  if (!availableStrategies) {
    fetchJSON('/api/sniper/strategies').then(s => { availableStrategies = s; if (activeTab === 7) renderSniper() })
  }

  const [status, detected, buys, positions] = await Promise.all([
    fetchJSON('/api/sniper/status'),
    fetchJSON('/api/sniper/detected?limit=10'),
    fetchJSON('/api/sniper/buys?limit=5'),
    fetchJSON('/api/sniper/positions'),
  ])
  lastSniperStatus = status
  const wallet = status?.wallets?.[c]
  // Always fetch balance to auto-set wallet from API binding
  const balanceData = await fetchJSON(`/api/portfolio/balance?chain=${c}`)

  l.push('')
  if (status) {
    const s = status
    const strat = availableStrategies?.[s.strategy]
    const stratLabel = strat ? `${s.strategyLabel} (${strat.desc})` : s.strategyLabel || 'snipe'
    const ab = s.autoBuy?.[c] ? '<span class="cyan">ON</span>' : '<span class="dim">OFF</span>'
    const as = s.autoSell?.[c] ? '<span class="cyan">ON</span>' : '<span class="dim">OFF</span>'
    const w = s.wallets?.[c] || ''
    // Auto-set wallet from API binding if not set
    if (!w && balanceData?.wallet) {
      postJSON('/api/sniper/wallet', { chain: c, address: balanceData.wallet })
    }
    const isActive = s.active?.[c]
    const wSet = w.length > 0
    const buyAmt = s.buyAmounts?.[c] || '0.3'
    l.push(`\u2551 <span class="cyan">STRAT</span> ${stratLabel.padEnd(20)} <span class="cyan">BUY</span> ${ab} <span class="cyan">SELL</span> ${as} <span class="cyan">AMT</span> ${buyAmt} \u2551`)
    l.push(`\u2551 ${isActive ? '<span class="cyan">RUNNING</span>' : '<span class="error">STOPPED — press [1] to start</span>'} wallet=${sa(w)} \u2551`)
    l.push(`\u2551 buys=${s.autoBuyCounts?.[c]||0} pos=${s.positions||0} amt=${buyAmt} ${c==='sol'?'SOL':'ETH'} ${' '.repeat(18)} \u2551`)
    if (balanceData) {
      const bal = parseFloat(balanceData.balance || 0)
      const sym = balanceData.symbol || (c === 'sol' ? 'SOL' : 'ETH')
      const boundWallet = balanceData.wallet || ''
      l.push(`\u2551 <span class="${bal > 0 ? 'cyan' : 'dim'}">${bal.toFixed(4)} ${sym}</span> bound: ${sa(boundWallet)}${' '.repeat(10)}\u2551`)
    }
    l.push(`\u255c${'\u2550'.repeat(56)}\u255e`)
    l.push('')
  }

  l.push(tRow('BUY TOKEN'))
  l.push(`\u2551  Enter token address below or click detected token                      \u2551`)
  l.push(`\u2551  <input type="text" id="buy-addr" placeholder="Token address" style="width:50%"> \u2551`)
  const curSym = c === 'sol' ? 'SOL' : 'ETH'
  l.push(`\u2551  Amount: <span class="buy-btn" data-amt="0.1">[.1 ${curSym}]</span> <span class="buy-btn" data-amt="0.2">[.2 ${curSym}]</span> <span class="buy-btn" data-amt="0.3">[.3 ${curSym}]</span> <input type="text" id="buy-custom" placeholder="custom" style="width:60px"> \u2551`)
  l.push(`\u2551  <span class="buy-btn" data-amt="custom" id="buy-execute">[EXECUTE BUY]</span>                     \u2551`)
  l.push(bRow()); l.push('')

  if (positions && Object.keys(positions).length > 0) {
    l.push(tRow(`POSITIONS (${Object.keys(positions).length})`))
    l.push(`<span class="bold">\u2551  ADDR                   AMOUNT  CHAIN  AGE    SELL               \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const [addr, pos] of Object.entries(positions)) {
      const age = pos.ts ? Math.floor((Date.now() - pos.ts) / 1000) + 's' : '?'
      l.push(`\u2551 <span class="ca gold" data-addr="${esc(addr)}">${sa(addr).padEnd(22)}</span> ${(pos.amount||'?').padEnd(7)} ${(pos.chain||'').padEnd(6)} ${age.padStart(5)}  <span class="sell-btn" data-addr="${esc(addr)}" data-chain="${esc(pos.chain)}">[SELL]</span>     \u2551`)
    }
    l.push(bRow())
  }

  if (detected?.length > 0) {
    l.push(tRow(`DETECTED (${detected.length})`))
    l.push(`<span class="bold">\u2551  SYMBOL    ADDR                                      BUY                \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const d of detected) {
      l.push(`\u2551 <span class="ca gold" data-addr="${esc(d.address)}">${tr(d.symbol,8).padEnd(8)}</span> ${sa(d.address).padEnd(22)} <span class="buy-btn" data-addr="${esc(d.address)}" data-amt="0.1">[.1]</span> <span class="buy-btn" data-addr="${esc(d.address)}" data-amt="0.2">[.2]</span> <span class="buy-btn" data-addr="${esc(d.address)}" data-amt="0.3">[.3]</span> \u2551`)
    }
    l.push(bRow())
  }
  if (buys?.length > 0) {
    l.push(tRow('BUYS'))
    for (const b of buys) {
      const ok = b.success ? '<span class="cyan">OK</span>' : '<span class="error">FAIL</span>'
      const addr = sa(b.token||b.result?.tokenAddress||'')
      const amt = b.amount || b.result?.amount || ''
      l.push(`\u2551  ${ok} ${addr} ${amt}                                   \u2551`)
    }
    l.push(bRow())
  }
  l.push(''); l.push('<div id="sniper-log" style="color:#2a5a2a">Log from detector.</div>'); content.innerHTML = l.join('\n'); bindSniperButtons(); bindCA()
}

function bindSniperButtons() {
  // Buy preset buttons
  document.querySelectorAll('.buy-btn').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation()
      const addr = el.dataset.addr || document.getElementById('buy-addr')?.value?.trim()
      if (!addr) { logToSniper('No token address'); return }
      const amt = el.dataset.amt
      const customInput = document.getElementById('buy-custom')
      let finalAmt = amt
      if (amt === 'custom' || amt === undefined) {
        const cv = customInput?.value?.trim()
        if (!cv) { logToSniper('Enter amount'); return }
        finalAmt = parseFloat(cv)
        if (!finalAmt || finalAmt <= 0) { logToSniper('Invalid amount'); return }
      }
      const c = chain()
      postJSON('/api/sniper/buy', { chain: c, tokenAddress: addr, amount: String(finalAmt) }).then(r => {
        logToSniper(r?.ok ? `Buy ${finalAmt} ${c === 'sol' ? 'SOL' : 'ETH'} of ${sa(addr)}` : `Buy failed: ${r?.error || '?'}`)
      })
    }
  })
  // Sell buttons
  document.querySelectorAll('.sell-btn').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation()
      const addr = el.dataset.addr
      const ch = el.dataset.chain
      if (!addr) return
      postJSON('/api/sniper/sell', { chain: ch, tokenAddress: addr }).then(r => {
        logToSniper(r?.ok !== false ? `Sold ${sa(addr)}` : `Sell failed: ${r?.error || '?'}`)
        renderSniper()
      })
    }
  })
  // Buy execute button
  const execBtn = document.getElementById('buy-execute')
  if (execBtn) {
    execBtn.onclick = () => {
      const addr = document.getElementById('buy-addr')?.value?.trim()
      if (!addr) { logToSniper('Enter token address'); return }
      const customInput = document.getElementById('buy-custom')
      const cv = customInput?.value?.trim()
      if (!cv) { logToSniper('Enter amount in custom field'); return }
      const amt = parseFloat(cv)
      if (!amt || amt <= 0) { logToSniper('Invalid amount'); return }
      const c = chain()
      postJSON('/api/sniper/buy', { chain: c, tokenAddress: addr, amount: String(amt) }).then(r => {
        logToSniper(r?.ok ? `Buy ${amt} ${c === 'sol' ? 'SOL' : 'ETH'} of ${sa(addr)}` : `Buy failed: ${r?.error || '?'}`)
      })
    }
  }
}

let sniperEs = null
function sniperConnectSSE() {
  sniperEs = new EventSource('/api/sniper/stream')
  sniperEs.onmessage = (e) => {
    const d = JSON.parse(e.data); if (activeTab !== 7) return; const log = document.getElementById('sniper-log')
    if (!log) return
    if (d.type === 'log') log.innerHTML = esc(d.msg) + '<br>' + log.innerHTML.substring(0, 2000)
    else if (d.type === 'detected' && d.token) log.innerHTML = `<span class="gold">DETECTED ${d.token.symbol||''}</span><br>` + log.innerHTML.substring(0, 2000)
    else if (d.type === 'buy') log.innerHTML = `<span class="cyan">BUY ${d.result?.success ? 'OK' : 'FAIL'}</span><br>` + log.innerHTML.substring(0, 2000)
  }
  sniperEs.onerror = () => { sniperEs.close(); setTimeout(sniperConnectSSE, 2000) }
}

function switchTab(idx) {
  activeTab = idx; updateUI()
  switch (idx) {
    case 0: renderHub(); break; case 1: renderTrenches(); break; case 2: renderTrades(); break
    case 3: renderSignals(); break; case 4: renderTokenSearch(lastTokenQuery); break; case 5: renderPortfolio(chain(), portAddr); break
    case 6: renderFactory(); break; case 7: renderSniper(); break; case 8: renderProtector(); break
  }
}

function updateUI() {
  $('tabs').innerHTML = TABS.map((t,i)=>`<span class="tab${i===activeTab?' active':''}" data-tab="${i}">${i===activeTab?`[${t}]`:t}</span>`).join('')
  const s = document.getElementById('under5k-toggle')
  if (s) s.textContent = showUnder5k ? '[<5k]' : '[ALL]'
  $('time').textContent = new Date().toLocaleTimeString('en-US',{hour12:false})
}

async function checkConn() {
  try { const r=await fetch('/api/config/check').then(r=>r.json()); $('conn').className=r.connected?'conn-on':'conn-off' } catch { $('conn').className='conn-off' }
}

function handleSubmit() {
  const v=input.value.trim(); input.value=''
  if (!v) { input.focus(); return }
  if (/^(sol|bsc|base|eth|robinhood):/i.test(v)) { switchTab(4); renderTokenSearch(v) }
  else if (v.startsWith('portfolio ')) { const a=v.replace(/^portfolio\s+/,'').trim(); const c=a.includes(':')?a.split(':')[0]:chain(); const w=a.includes(':')?a.split(':')[1]:a; portAddr=w; renderPortfolio(c,w) }
  else if (v==='help'||v==='?') showHelp()
  else if (v.startsWith('token ')||v.startsWith('t:')) { switchTab(4); renderTokenSearch(chain()+':'+v.replace(/^(token |t:)/,'').trim()) }
  else { status.textContent=`? ${v}`; setTimeout(()=>{if(status.textContent.includes('?'))status.textContent=''},1500) }
  input.focus()
}

function showHelp() {
  content.innerHTML = `\n\n  <span class="bold">GMGN TERMINAL v2</span>\n\n  <span class="gold">F1-F8</span> Tabs  <span class="gold">Tab</span> Focus  <span class="gold">q</span> Close\n  Click any symbol \u2192 copy CA to clipboard\n\n  <span class="cyan">sol:ADDR</span>  Token lookup\n  <span class="cyan">portfolio ADDR</span>  Wallet (uses active chain)\n  <span class="cyan">help</span>  This\n\n  <span class="gold">F1 HUB</span>: Sniper targets + Pre-bond + New launches + Trending + SM + Alpha\n  <span class="gold">F2 TRENCHES</span>: All new creations\n  <span class="gold">F3 TRADES</span>: Whale + KOL trade feed\n  <span class="gold">F4 SIGNALS</span>: 22 pattern detectors + risk scoring\n  <span class="gold">F5 TOKEN</span>: Deep research\n  <span class="gold">F6 PORTFOLIO</span>: Wallet P&L\n  <span class="gold">F7 FACTORY</span>: PONS Token Factory (P&D on Robinhood ETH)\n  <span class="gold">F8 SNIPER</span>: Real-time detector + buy/sell (uses chain selector)\n  <span class="gold">F9 PROTECTOR</span>: Auto-send 50% of profits to vault wallet\n\n  <span class="dim">Chain selector changes all tabs. SNIPER uses selected chain.</span>`
}

async function postJSON(url, body) {
  try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return await r.json() } catch { return null }
}

function logToSniper(msg) {
  const log = document.getElementById('sniper-log')
  if (log) log.innerHTML = esc(msg) + '<br>' + log.innerHTML.substring(0, 2000)
}

// ── Profit Protector ────────────────────────────────────────────────

let protectorLogs = []
let protectorStatus = {}
let protectorEs = null

function protectorConnectSSE() {
  if (protectorEs) protectorEs.close()
  protectorEs = new EventSource('/api/protector/stream')
  protectorEs.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data)
      if (d.type === 'log') {
        protectorLogs.push(d.msg)
        if (activeTab === 8) renderProtector()
      } else if (d.type === 'status') {
        protectorStatus = d
        if (activeTab === 8) renderProtector()
      } else if (d.type === 'buy-tracked' || d.type === 'sell-processed') {
        if (activeTab === 8) renderProtector()
      }
    } catch {}
  }
  protectorEs.onerror = () => { protectorEs.close(); setTimeout(protectorConnectSSE, 2000) }
}

async function protectorPost(endpoint, body) {
  return fetch('/api/protector/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json()).catch(() => null)
}

async function toggleProtector(chain, enabled) {
  const r = await protectorPost('enable', { chain, enabled })
  if (!r?.ok) { status.textContent = 'protector error'; setTimeout(() => status.textContent = '', 1500) }
  renderProtector()
}

function renderProtector() {
  const s = protectorStatus.stats || {}
  const lines = ['']
  const title = '\u2554\u2556 PROFIT PROTECTOR \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557'

  lines.push(title)
  lines.push('\u2551  Auto-swap <span class="gold">50%</span> of every profitable trade to <span class="cyan">USDC</span> (stays in wallet)          \u2551')

  // SOL panel
  const solEn = protectorStatus.enabled?.sol ? '<span class="error">\u25a0 ON</span>' : '<span class="cyan">\u25b6 OFF</span>'
  lines.push('\u255c\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255e')
  lines.push('\u2551  <span class="gold">SOLANA</span>  ' + solEn + '  → USDC via gmgn-cli swap                          \u2551')
  lines.push('\u2551  <span class="cyan" onclick="toggleProtector(\'sol\',true)">[ENABLE]</span>  <span class="error" onclick="toggleProtector(\'sol\',false)">[DISABLE]</span>                                              \u2551')

  // ROBIN panel
  const rhEn = protectorStatus.enabled?.robinhood ? '<span class="error">\u25a0 ON</span>' : '<span class="cyan">\u25b6 OFF</span>'
  lines.push('\u2551                                                                                    \u2551')
  lines.push('\u2551  <span class="gold">ROBINHOOD</span>  ' + rhEn + '  → USDC via gmgn-cli swap                       \u2551')
  lines.push('\u2551  <span class="cyan" onclick="toggleProtector(\'robinhood\',true)">[ENABLE]</span>  <span class="error" onclick="toggleProtector(\'robinhood\',false)">[DISABLE]</span>                                              \u2551')

  // Stats
  const totalProfit = '$' + Number(s.totalProfitUsd || 0).toFixed(2)
  const totalProtected = '$' + Number(s.totalProtectedUsd || 0).toFixed(2)
  lines.push('\u2551                                                                                    \u2551')
  lines.push('\u2551  Trades: <span class="gold">' + (s.totalTrades || 0) + '</span>  |  Protected: <span class="cyan">' + (s.protectedTrades || 0) + '</span>  \u2551')
  lines.push('\u2551  Pending: ' + (s.pendingTrades || 0) + '  |  Profit: <span class="gold">' + totalProfit + '</span>  |  Saved: <span class="cyan">' + totalProtected + '</span>  \u2551')

  // Log
  lines.push('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d')
  lines.push('')
  lines.push(tRow('PROTECTOR LOG'))
  const vis = protectorLogs.slice(-12)
  if (vis.length === 0) {
    lines.push('  <span class="dim">Enable the protector and make trades to see activity.</span>')
  } else {
    for (const msg of vis) {
      const colored = esc(msg)
        .replace(/USDC saved|OK|profit|protected|→ USDC/gi, m => '<span class="cyan">' + m + '</span>')
        .replace(/error|FAIL|skip|not profitable|swap failed/gi, m => '<span class="error">' + m + '</span>')
      lines.push('  ' + colored)
    }
  }
  lines.push(bRow())

  content.innerHTML = lines.join('\n')
}

let currentStrategy = 1 // default to snipe

document.addEventListener('keydown', e => {
  const m={F1:0,F2:1,F3:2,F4:3,F5:4,F6:5,F7:6,F8:7,F9:8}; if(e.key in m){e.preventDefault();switchTab(m[e.key])}
  if(e.key==='Tab'){e.preventDefault();input.focus()}; if(e.key==='q'&&!e.ctrlKey)window.close(); if(e.key==='Escape')input.focus()

  // Factory tab shortcuts
  if (activeTab === 6) {
    if (e.key === '1') { e.preventDefault(); postJSON('/api/factory/setup').then(r => logToFactory(r?.ok ? 'Wallets created' : 'Error: ' + (r?.error || '?'))) }
    if (e.key === '2') { e.preventDefault(); const pk = prompt('Wallet private key to fund from:'); if (pk) postJSON('/api/factory/fund', { fromPk: pk }).then(r => logToFactory(r?.ok ? 'Funding started' : 'Error: ' + (r?.error || '?'))) }
    if (e.key === '3') { e.preventDefault(); const input = prompt('Cycles (e.g. 3):'); if (input) postJSON('/api/factory/run', { cycles: parseInt(input) || 3, mainAddress: '' }).then(r => logToFactory(r?.ok ? 'Running ' + input + ' cycles' : 'Error: ' + (r?.error || '?'))) }
    if (e.key === '4') { e.preventDefault(); fetch('/api/factory/balances').then(r=>r.json()).then(r => logToFactory(JSON.stringify(r))) }
    if (e.key === '5') { e.preventDefault(); const addr = prompt('Sweep to address:'); if (addr) postJSON('/api/factory/sweep', { toAddress: addr }).then(r => logToFactory(r?.ok ? 'Swept ' + r.total : 'Error: ' + (r?.error || '?'))) }
  }

  // Sniper tab shortcuts (chain-aware)
  if (activeTab === 7) {
    const c = chain()
    if (e.key === '1') { e.preventDefault(); postJSON('/api/sniper/start', { chain: c }).then(r => logToSniper(r?.ok ? `${c} detector started` : 'Error: ' + (r?.error || '?'))) }
    if (e.key === '2') { e.preventDefault(); const addr = prompt(`${c} wallet address:`); if (addr) postJSON('/api/sniper/wallet', { chain: c, address: addr }).then(r => logToSniper(r?.ok ? 'Wallet set: ' + addr.slice(0,8)+'...' : 'Error: ' + (r?.error || '?'))) }
    if (e.key === '3') { e.preventDefault(); currentStrategy = (currentStrategy + 1) % 6; const stratNames = ['speed','snipe','scalp','hold','razor','manual']; const s = stratNames[currentStrategy]; postJSON('/api/sniper/strategy', { chain: c, strategy: s }).then(r => { logToSniper(r?.ok ? 'Strategy: ' + s : 'Error'); renderSniper() }) }
    if (e.key === '4') { e.preventDefault(); currentStrategy = (currentStrategy - 1 + 6) % 6; const stratNames = ['speed','snipe','scalp','hold','razor','manual']; const s = stratNames[currentStrategy]; postJSON('/api/sniper/strategy', { chain: c, strategy: s }).then(r => { logToSniper(r?.ok ? 'Strategy: ' + s : 'Error'); renderSniper() }) }
    if (e.key === '5') { e.preventDefault(); postJSON('/api/sniper/stop').then(r => logToSniper('Detectors stopped')) }
    if (e.key === '6') { e.preventDefault(); const cur = lastSniperStatus?.autoBuy?.[c] || false; postJSON('/api/sniper/autobuy', { chain: c, enabled: !cur }).then(r => { logToSniper(r?.ok ? `Auto-buy ${!cur ? 'enabled' : 'disabled'}` : 'Error'); renderSniper() }) }
    if (e.key === '7') { e.preventDefault(); postJSON('/api/sniper/sell-all', { chain: c }).then(r => logToSniper(r?.ok ? 'Sold ' + (r.sold || 0) + ' positions' : 'Error')) }
    if (e.key === '8') { e.preventDefault(); const cur = lastSniperStatus?.autoSell?.[c] || false; postJSON('/api/sniper/autosell', { chain: c, enabled: !cur }).then(r => { logToSniper(r?.ok ? `Auto-sell ${!cur ? 'enabled' : 'disabled'}` : 'Error'); renderSniper() }) }
    if (e.key === '9') { e.preventDefault(); const amt = prompt('Enter buy amount in ' + (c === 'sol' ? 'SOL' : 'ETH') + ':'); if (amt && parseFloat(amt) > 0) postJSON('/api/sniper/buy-amount', { chain: c, amount: amt }).then(r => { logToSniper(r?.ok ? `Buy amount set to ${amt} ${c === 'sol' ? 'SOL' : 'ETH'}` : 'Error'); renderSniper() }) }
  }
})

function logToFactory(msg) {
  const log = document.getElementById('factory-log')
  if (log) log.innerHTML = esc(msg) + '<br>' + log.innerHTML.substring(0, 2000)
}

$('tabs').addEventListener('click', e=>{const t=e.target.closest('.tab');if(t)switchTab(parseInt(t.dataset.tab))})
$('chain-select').addEventListener('change', ()=>{updateUI();switchTab(activeTab)})
document.addEventListener('click', e => {
  if (e.target.id === 'under5k-toggle') { showUnder5k = !showUnder5k; updateUI(); switchTab(activeTab) }
})
input.addEventListener('keydown', e=>{if(e.key==='Enter')handleSubmit()})

let pollStart = Date.now()

fetchJSON('/api/sniper/strategies').then(s => { availableStrategies = s })
checkConn(); updateUI(); switchTab(0); factoryConnectSSE(); sniperConnectSSE(); protectorConnectSSE(); setInterval(updateUI,1000); input.focus()
setInterval(refreshAll, 8000)
refreshAll()
