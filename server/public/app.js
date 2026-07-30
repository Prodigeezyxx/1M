const TABS = ['HUB', 'TRENCHES', 'TRADES', 'SIGNALS', 'TOKEN', 'PORTFOLIO', 'FACTORY', 'SNIPER']
let activeTab = 0
let cachedData = { trending: {}, trenches: {}, smartMoney: {}, kol: {}, signals: {} }
let portAddr = ''

const $ = id => document.getElementById(id)
const content = $('content')
const input = $('input')
const status = $('status')

function chain() { return $('chain-select').value }
function dataFor(type) { const c = chain() === 'all' ? 'sol' : chain(); return cachedData[type]?.[c] || cachedData[type]?.['sol'] || [] }

function fiat(n) { n = Number(n); if (n > 1e6) return `<span class="gold">$${(n/1e6).toFixed(2)}M</span>`; if (n > 1e3) return `<span class="gold">$${(n/1e3).toFixed(1)}K</span>`; return `$${n.toFixed(2)}` }
function rugC(r) { r=Number(r); if (r>0.3) return `<span class="error">${r.toFixed(2)}</span>`; if (r>0.1) return `<span class="gold">${r.toFixed(2)}</span>`; return `${r.toFixed(2)}` }
function ago(ts) { const s=Math.floor(Date.now()/1e3-ts); if(s<60)return `${s}s`; const m=Math.floor(s/60); if(m<60)return `${m}m`; return `${Math.floor(m/60)}h` }
function sa(a) { return a?a.slice(0,4)+'..'+a.slice(-4):'' }
function tr(s,n) { return s&&s.length>n?s.slice(0,n-1)+'\u2026':(s||'') }
function sm(n) { return n>=5?`<span class="cyan">${n}</span>`:n>=3?`<span class="gold">${n}</span>`:n>0?String(n):'-' }
function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML }
function tRow(t) { const l='\u2550'.repeat(Math.max(2,54-t.length)); return `<span class="bold">\u2554\u2556 ${t} ${l}\u2557</span>` }
function bRow() { return `<span class="bold">\u255a${'\u2550'.repeat(56)}\u255d</span>` }
function divider() { return `<span class="dim">\u2500${'\u2500'.repeat(55)}</span>` }

function copyCA(addr, el) {
  if (!addr) return
  navigator.clipboard.writeText(addr).then(() => {
    const orig = el.textContent
    el.textContent = '\u2713'
    el.style.color = '#00e676'
    setTimeout(() => { el.textContent = orig; el.style.color = '' }, 600)
  }).catch(() => {})
}

function bindCA() {
  document.querySelectorAll('.ca').forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); copyCA(el.dataset.addr, el) }
  })
}

// ── UNIFIED HUB DASHBOARD ──
function renderHub() {
  const l = ['']
  const trens = dataFor('trenches')
  const trend = dataFor('trending')
  const sm = dataFor('smartMoney')
  const sigs = dataFor('signals')

  // ── SNIPER TARGETS ──
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
    l.push(bRow()); l.push('')
  }

  if (preBond.length > 0) {
    l.push(tRow(`\u26A1 PRE-BOND RUN (${preBond.length})`))
    l.push(`<span class="bold">\u2551  SYMBOL    MC          VOL 1H     SM  SCORE  PROGRESS  \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const s of preBond) {
      const sc = s.score >= 70 ? `<span class="cyan">${s.score}</span>` : `<span class="gold">${s.score}</span>`
      l.push(`\u2551 <span class="ca gold" data-addr="${esc(s.address)}">${tr(s.symbol,8).padEnd(8)}</span> ${fiat(s.mc).padEnd(10)} ${fiat(s.volume).padEnd(11)} ${sm(s.smartDegen).padEnd(3)} ${sc.toString().padEnd(5)} ${s.migratable !== null && s.migratable !== undefined ? (s.migratable*100).toFixed(0)+'%' : '-'}               \u2551`)
    }
    l.push(bRow()); l.push('')
  }

  // ── NEW LAUNCHES ──
  if (trens.length > 0) {
    l.push(tRow(`\uD83D\uDE80 NEW LAUNCHES (${trens.length})`))
    l.push(`<span class="bold">\u2551  SYMBOL    MC          LIQ          VOL 1H     SM  RUG   PLATFORM  \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const t of trens.slice(0, 8)) {
      const s = sm(t.smart_degen_count || 0)
      l.push(`\u2551 <span class="ca" data-addr="${esc(t.address||'')}">${tr(t.symbol,8).padEnd(8)}</span> ${fiat(t.usd_market_cap).padEnd(11)} ${fiat(t.liquidity).padEnd(11)} ${fiat(t.volume_1h||0).padEnd(10)} ${s.padEnd(3)} ${rugC(t.rug_ratio)} ${tr(t.launchpad_platform||'',10).padEnd(10)} \u2551`)
    }
    l.push(bRow()); l.push('')
  }

  // ── TRENDING ──
  if (trend.length > 0) {
    l.push(tRow(`\uD83D\uDD25 TRENDING (${trend.length})`))
    l.push(`<span class="bold">\u2551  TRENDING (5m)                    VOLUME       MC          SM  RUG \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const t of trend.slice(0, 8)) {
      const s = sm(t.smart_degen_count || 0)
      l.push(`\u2551 <span class="ca" data-addr="${esc(t.address||'')}">${tr(t.symbol,8).padEnd(8)}</span> ${tr(t.name,12).padEnd(12)} ${fiat(t.volume).padEnd(12)} ${fiat(t.market_cap).padEnd(10)} ${s.padEnd(3)} ${rugC(t.rug_ratio)} \u2551`)
    }
    l.push(bRow()); l.push('')
  }

  // ── SMART MONEY BUYS ──
  const buys = sm.filter(t => t.side === 'buy').slice(0, 6)
  if (buys.length > 0) {
    l.push(tRow(`\uD83D\uDC0B SMART MONEY BUYS (${buys.length})`))
    l.push(`<span class="bold">\u2551  TOKEN      USD VALUE     WHO                TIME               \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const t of buys) {
      const who = t.maker_info?.twitter_username || sa(t.maker)
      const sym = t.base_token?.symbol || '?'
      l.push(`\u2551 <span class="ca" data-addr="${esc(t.base_address||t.base_token?.token_address||'')}">${tr(sym,10).padEnd(10)}</span> ${fiat(t.amount_usd).padEnd(13)} ${tr(who,16).padEnd(16)} ${ago(t.timestamp)}m ago           \u2551`)
    }
    l.push(bRow()); l.push('')
  }

  // ── RUG WARNINGS ──
  const rugs = (sigs || []).filter(s => (s.patterns||[]).includes('DEV_SNIPER_RUG')).slice(0, 6)
  if (rugs.length > 0) {
    l.push(tRow(`\u2622 RUG WARNINGS (${rugs.length})`))
    l.push(`<span class="bold">\u2551  SYMBOL     MC          SCORE  PATTERNS                          \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const s of rugs) {
      const sc = `<span class="error">${s.score}</span>`
      const pats = (s.patternLabels||[]).filter(p => ['DevSniperRug','Bundle','Rug','NoSmartMoney'].includes(p)).join(' ').padEnd(30)
      l.push(`\u2551 <span class="ca" data-addr="${esc(s.address)}">${tr(s.symbol,8).padEnd(9)}</span> ${fiat(s.mc).padEnd(10)} ${sc.toString().padEnd(5)} <span class="error">${tr(pats,30).padEnd(30)}</span> \u2551`)
    }
    l.push(bRow()); l.push('')
  }

  // ── ZERO SMART MONEY WARNINGS ──
  const noSm = (sigs || []).filter(s => (s.patterns||[]).includes('ZERO_SMART_MONEY') && !(s.patterns||[]).includes('DEV_SNIPER_RUG')).slice(0, 4)
  if (noSm.length > 0) {
    l.push(tRow(`\u26A0 NO SMART MONEY (${noSm.length})`))
    l.push(`<span class="bold">\u2551  SYMBOL     MC          SCORE  PATTERNS                          \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const s of noSm) {
      const sc = s.score >= 50 ? `<span class="gold">${s.score}</span>` : `<span class="error">${s.score}</span>`
      const pats = (s.patternLabels||[]).filter(p => !['DevSniperRug'].includes(p)).slice(0,2).join(' ').padEnd(30)
      l.push(`\u2551 <span class="ca" data-addr="${esc(s.address)}">${tr(s.symbol,8).padEnd(9)}</span> ${fiat(s.mc).padEnd(10)} ${sc.toString().padEnd(5)} ${tr(pats,30).padEnd(30)} \u2551`)
    }
    l.push(bRow()); l.push('')
  }

  // ── TOP ALPHA SIGNALS ──
  const top = (sigs || []).filter(s => s.score >= 55 && !(s.patterns||[]).includes('DEV_SNIPER_RUG')).slice(0, 6)
  if (top.length > 0) {
    l.push(tRow(`\uD83E\uDDEA ALPHA SIGNALS (${top.length})`))
    l.push(`<span class="bold">\u2551  SYMBOL     SCORE  MC          PATTERNS                   \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const s of top) {
      const sc = s.score >= 70 ? `<span class="cyan">${s.score}</span>` : `<span class="gold">${s.score}</span>`
      const pats = (s.patternLabels||[]).slice(0,3).join(' ').padEnd(25)
      l.push(`\u2551 <span class="ca" data-addr="${esc(s.address)}">${tr(s.symbol,8).padEnd(9)}</span> ${sc.toString().padEnd(5)} ${fiat(s.mc).padEnd(10)} ${tr(pats,25).padEnd(25)} \u2551`)
    }
    l.push(bRow())
  }

  content.innerHTML = l.join('\n')
  bindCA()
}

// ── Other tab renderers (unchanged, just redirected) ──
function renderTrenches() {
  const l = ['']
  l.push(tRow('NEW LAUNCHES'))
  l.push(`<span class="bold">\u2551  SYMBOL    MC          LIQ          VOL 1H     SM  RUG   PLATFORM  \u2551</span>`)
  l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
  for (const t of dataFor('trenches').slice(0, 14)) {
    const s = sm(t.smart_degen_count || 0)
    l.push(`\u2551 <span class="ca" data-addr="${esc(t.address||'')}">${tr(t.symbol,8).padEnd(8)}</span> ${fiat(t.usd_market_cap).padEnd(11)} ${fiat(t.liquidity).padEnd(11)} ${fiat(t.volume_1h||0).padEnd(10)} ${s.padEnd(3)} ${rugC(t.rug_ratio)} ${tr(t.launchpad_platform||'',10).padEnd(10)} \u2551`)
  }
  l.push(bRow())
  content.innerHTML = l.join('\n'); bindCA()
}

function renderTrades() {
  const all = [...dataFor('smartMoney'), ...dataFor('kol')]
  all.sort((a, b) => b.timestamp - a.timestamp)
  const l = ['']
  l.push(tRow('TRADE FEED'))
  l.push(`<span class="bold">\u2551  TIME  SIDE  TOKEN      USD VALUE   WHO                TYPE TAG  \u2551</span>`)
  l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
  for (const t of all.slice(0, 22)) {
    const side = t.side === 'buy' ? '<span class="cyan">BUY </span>' : '<span class="error">SELL</span>'
    const who = t.maker_info?.twitter_username || sa(t.maker)
    const tag = (t.maker_info?.tags || []).find(tg => tg === 'smart_degen' || tg === 'kol') || '-'
    const tagL = tag === 'smart_degen' ? 'SMART' : tag === 'kol' ? 'KOL' : tag.slice(0,4)
    const pos = t.is_open_or_close === 0 ? 'OPEN' : 'CLOSE'
    const sym = t.base_token?.symbol || '?'
    const addr = t.base_address || t.base_token?.token_address || ''
    l.push(`\u2551 ${ago(t.timestamp).padEnd(5)} ${side} <span class="ca" data-addr="${esc(addr)}">${tr(sym,8).padEnd(8)}</span> ${fiat(t.amount_usd).padEnd(11)} ${tr(who,16).padEnd(16)} ${pos} ${tagL} \u2551`)
  }
  l.push(bRow())
  content.innerHTML = l.join('\n'); bindCA()
}

function renderSignals() {
  const l = ['']
  l.push(tRow('ALPHA SIGNALS'))
  l.push(`<span class="bold">\u2551  CH SCORE SYMBOL     MC          PATTERNS              RISK  AGE \u2551</span>`)
  l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
  const sigs = dataFor('signals')
  if (!sigs || sigs.length === 0) {
    l.push(`\u2551  <span class="dim">No signals. Try another chain.</span>`)
  } else {
    for (const s of sigs.slice(0, 18)) {
      const sc = s.score >= 70 ? `<span class="cyan">${s.score}</span>` : s.score >= 50 ? `<span class="gold">${s.score}</span>` : s.score >= 40 ? `<span class="orange">${s.score}</span>` : `<span class="error">${s.score}</span>`
      const ct = s.chain ? s.chain.toUpperCase().slice(0,2).padEnd(2) : 'SO'
      const pats = (s.patternLabels||[]).slice(0,3).join(' ').padEnd(20)
      const isDevRug = (s.patterns||[]).includes('DEV_SNIPER_RUG')
      const isNoSm = (s.patterns||[]).includes('ZERO_SMART_MONEY') && !isDevRug
      const risk = s.isHoneypot ? '<span class="error">HONEY</span>' : isDevRug ? '<span class="error">\u2622 RUG</span>' : s.isWash ? '<span class="error">WASH</span>' : !s.renounced ? '<span class="orange">CONC</span>' : isNoSm ? '<span class="gold">NO SM</span>' : s.botRate > 0.5 ? '<span class="gold">BOT</span>' : s.rugRatio > 0.1 ? `<span class="gold">${(s.rugRatio*100).toFixed(0)}%</span>` : '<span class="green">LOW</span>'
      const ageStr = s.age > 0 ? ago(Date.now()/1e3 - s.age) : 'new'
      l.push(`\u2551 ${ct} ${sc.toString().padEnd(5)} <span class="ca" data-addr="${esc(s.address)}">${tr(s.symbol,8).padEnd(9)}</span> ${fiat(s.mc).padEnd(10)} ${tr(pats,20).padEnd(20)} ${risk.padEnd(5)} ${ageStr.padEnd(4)} \u2551`)
    }
  }
  l.push(bRow())
  const high = sigs.filter(s => s.score >= 70).length; const med = sigs.filter(s => s.score >= 50 && s.score < 70).length
  const low = sigs.filter(s => s.score < 50).length; const rug = sigs.filter(s => s.isHoneypot || s.entrapRate > 0.1).length
  const devRug = sigs.filter(s => (s.patterns||[]).includes('DEV_SNIPER_RUG')).length
  const noSm = sigs.filter(s => (s.patterns||[]).includes('ZERO_SMART_MONEY') && !(s.patterns||[]).includes('DEV_SNIPER_RUG')).length
  l.push(`<span class="dim">  \u25b2${high}  \u25b6${med}  \u25bc${low}  \u2622${rug}  \u2622DevRug:${devRug}  \u26A0NoSM:${noSm}  |  ${sigs.length} signals</span>`)
  content.innerHTML = l.join('\n'); bindCA()
}

async function renderTokenSearch(tokenAddr) {
  if (!tokenAddr) {
    content.innerHTML = `\n\n  <span class="dim">Enter: <span class="gold">sol:ADDRESS</span></span>\n\n  <span class="bold">EG:</span>  <span class="cyan">sol:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</span>`
    return
  }
  const [chain, addr] = tokenAddr.includes(':') ? tokenAddr.split(':') : ['sol', tokenAddr]
  status.textContent = 'loading…'
  const [info, sec, rug] = await Promise.all([
    fetch(`/api/token/info?chain=${chain}&address=${addr}`).then(r => r.json()),
    fetch(`/api/token/security?chain=${chain}&address=${addr}`).then(r => r.json()),
    fetch(`/api/token/rugcheck?chain=${chain}&address=${addr}`).then(r => r.json()).catch(() => null)
  ])
  status.textContent = ''
  const l = ['']
  l.push(tRow('TOKEN RESEARCH'))
  if (info && !info.error) {
    l.push(`\u2551  <span class="gold">${esc(info.symbol)}</span> (${esc(info.name)})`)
    l.push(`\u2551  <span class="ca" data-addr="${esc(addr)}">${sa(addr)}</span>  <span class="cyan">${chain.toUpperCase()}</span>`)
    const p = info.price?.price || '0'
    l.push(`\u2551  Price: <span class="cyan">$${parseFloat(p).toFixed(10)}</span>`)
    l.push(`\u2551  Liq: ${fiat(info.liquidity)}   Holders: ${info.holder_count}`)
    l.push(`\u2551  Supply: ${info.total_supply?parseFloat(info.total_supply).toLocaleString():'N/A'}   ${info.launchpad_platform||''}`)
    l.push(`\u2551  SM: ${info.wallet_tags_stat?.smart_wallets||0}  KOL: ${info.wallet_tags_stat?.renowned_wallets||0}  Bundler: ${info.wallet_tags_stat?.bundler_wallets||0}  Sniper: ${info.wallet_tags_stat?.sniper_wallets||0}`)
  } else {
    l.push(`\u2551  <span class="ca" data-addr="${esc(addr)}">${sa(addr)}</span>  <span class="cyan">${chain.toUpperCase()}</span>`)
    l.push(`\u2551  <span class="error">UNAVAILABLE</span>`)
  }
  l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
  if (sec && !sec.error) {
    const hp = sec.is_honeypot === 'yes' ? '<span class="error">YES</span>' : '<span class="green">NO</span>'
    const rg = sec.rug_ratio > 0.3 ? `<span class="error">${sec.rug_ratio}</span>` : sec.rug_ratio > 0.1 ? `<span class="gold">${sec.rug_ratio}</span>` : `${sec.rug_ratio}`
    const t10 = sec.top_10_holder_rate > 0.5 ? `<span class="error">${(sec.top_10_holder_rate*100).toFixed(1)}%</span>` : `${(sec.top_10_holder_rate*100).toFixed(1)}%`
    const dv = sec.creator_token_status === 'creator_hold' ? '<span class="gold">HOLD</span>' : '<span class="green">CLOSED</span>'
    l.push(`<span class="bold">\u2551  SECURITY</span>`)
    l.push(`\u2551  Honeypot: ${hp}  Rug: ${rg}  Top10: ${t10}  Dev: ${dv}`)
    l.push(`\u2551  Tax: ${(sec.buy_tax*100).toFixed(1)}%/${(sec.sell_tax*100).toFixed(1)}%  Snip: ${sec.sniper_count||0}  Wash: ${sec.is_wash_trading?'<span class="error">YES</span>':'<span class="green">NO</span>'}`)
  } else {
    l.push(`\u2551  <span class="error">SECURITY UNAVAILABLE</span>`)
  }
  // ── Deep Rug Check ──
  if (rug && !rug.error) {
    if (rug.isDevSniperRug) {
      l.push(`<span class="bold">\u2551  \u2622 DEV-SNIPER RUG DETECTED (${rug.confidence}% confidence) \u2622</span>`)
      l.push(`\u2551  <span class="error">Top profitable wallets are dev_team + bundler + sniper</span>`)
      l.push(`\u2551  Dev extraction profit: <span class="error">\$${rug.devProfit.toLocaleString()}</span>  |  Bundler profit: <span class="error">\$${rug.bundlerProfit.toLocaleString()}</span>`)
      if (rug.topExtractors.length > 0) {
        l.push(`\u2551  Extraction wallets:`)
        rug.topExtractors.slice(0,4).forEach(e => {
          const tagStr = e.tags.filter(t => ['dev_team','bundler','sniper'].includes(t)).join(',')
          l.push(`\u2551    <span class="ca" data-addr="${esc(e.address)}">${sa(e.address)}</span> +\$${e.profit.toLocaleString()} [${tagStr}]`)
        })
      }
    } else if (rug.topExtractors.length > 0) {
      l.push(`<span class="bold">\u2551  TRADER PATTERN</span>`)
      l.push(`\u2551  ${rug.topExtractors.length} dev/bundler/sniper wallets with positive profit`)
      l.push(`\u2551  Total extractor profit: <span class="gold">\$${rug.devProfit.toLocaleString()}</span>`)
    }
  }
  l.push(bRow())
  content.innerHTML = l.join('\n'); bindCA()
}

async function renderPortfolio(c, wallet) {
  if (!wallet) {
    content.innerHTML = `\n\n  <span class="bold">PORTFOLIO</span>\n\n  <span class="cyan">portfolio sol:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM</span>`
    return
  }
  status.textContent = 'loading…'
  const [holdings, stats] = await Promise.all([
    fetch(`/api/portfolio/holdings?chain=${c}&wallet=${wallet}`).then(r => r.json()),
    fetch(`/api/portfolio/stats?chain=${c}&wallet=${wallet}`).then(r => r.json())
  ])
  status.textContent = ''
  const l = ['']
  l.push(tRow('WALLET'))
  l.push(`\u2551  ${sa(wallet)}  <span class="cyan">${c.toUpperCase()}</span>`)
  if (stats && !stats.error) {
    const wr = (stats.pnl_stat.winrate*100).toFixed(1); const nb = parseFloat(stats.native_balance).toFixed(2)
    const rp = parseFloat(stats.realized_profit); const rpS = rp>=0 ? `+${rp.toFixed(2)}` : `<span class="error">${rp.toFixed(2)}</span>`
    l.push(`\u2551  SOL: <span class="gold">${nb}</span>  Cost: $${parseFloat(stats.total_cost).toFixed(2)}  P&L: ${rpS}`)
    l.push(`\u2551  Tokens: <span class="cyan">${stats.pnl_stat.token_num}</span>  WR: <span class="gold">${wr}%</span>  Hold: <span class="dim">${Math.floor(stats.pnl_stat.avg_holding_period/86400)}d</span>`)
    const ld = stats.pnl_stat
    l.push(`\u2551  <-50%: <span class="error">${ld.pnl_lt_nd5_num}</span>  -50-0%: ${ld.pnl_nd5_0x_num}  0-200%: ${ld.pnl_0x_2x_num}  2-5x: ${ld.pnl_2x_5x_num}  >5x: <span class="cyan">${ld.pnl_gt_5x_num}</span>`)
    if (stats.common?.nick_name) l.push(`\u2551  ${esc(stats.common.nick_name)}${stats.common.fund_from?`  |  ${esc(stats.common.fund_from)}`:''}`)
  }
  l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
  if (!holdings || holdings.length === 0) {
    l.push(`\u2551  <span class="dim">No open positions.</span>`)
  } else {
    l.push(`<span class="bold">\u2551  TOKEN      BALANCE       USD VALUE     P&L          SINCE        \u2551</span>`)
    l.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const h of holdings.slice(0, 15)) {
      const val = parseFloat(h.usd_value); const tp = parseFloat(h.total_profit); const tpp = parseFloat(h.total_profit_pnl)*100
      const pnl = tp>=0?`+${tp.toFixed(2)}`:`<span class="error">${tp.toFixed(2)}</span>`
      const pct = tp>=0?`(${tpp.toFixed(1)}%)`:`<span class="error">(${tpp.toFixed(1)}%)</span>`
      l.push(`\u2551 <span class="ca" data-addr="${esc(h.token?.token_address||'')}">${tr(h.token.symbol,8).padEnd(8)}</span> ${tr(h.balance,12).padEnd(12)} ${fiat(val).padEnd(13)} ${(pnl+' '+pct).padEnd(12)} ${ago(h.start_holding_at)}d               \u2551`)
    }
  }
  l.push(bRow())
  content.innerHTML = l.join('\n'); bindCA()
}

// ── Factory State ──

let factoryLogs = []
let factoryRunning = false
let factoryEventSource = null

function factoryConnectSSE() {
  if (factoryEventSource) factoryEventSource.close()
  factoryEventSource = new EventSource('/api/factory/stream')
  factoryEventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type === 'log') { factoryLogs.push(data.msg); if (activeTab === 6) renderFactory() }
      else if (data.type === 'done') { factoryRunning = false; factoryConnectSSE(); if (activeTab === 6) renderFactory() }
      else if (data.type === 'status') { factoryRunning = data.status.running }
      else if (data.type === 'cycle') { if (activeTab === 6) renderFactory() }
    } catch {}
  }
  factoryEventSource.onerror = () => setTimeout(factoryConnectSSE, 3000)
}

function factoryApi(method, endpoint, body) {
  status.textContent = 'factory...'
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  return fetch(`/api/factory/${endpoint}`, opts).then(r => r.json()).finally(() => { status.textContent = '' })
}

function renderFactory() {
  const lines = ['']
  lines.push(tRow('PONS TOKEN FACTORY'))
  lines.push(`<span class="bold">\u2551  Strategy: Pump & Dump on Robinhood ETH (PONS Launchpad)        \u2551</span>`)
  lines.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
  lines.push(`\u2551  ${factoryRunning ? '<span class="error">\u25a0 RUNNING</span>' : '<span class="cyan">\u25b6 IDLE</span>'}                                  \u2551`)
  lines.push(bRow())
  lines.push(tRow('CONFIG'))
  lines.push(`\u2551  Chain: <span class="cyan">robinhood</span>  |  DEX: <span class="gold">pons</span>  |  Buy Amt: <span class="gold">2.475 WETH</span>  \u2551`)
  lines.push(`\u2551  Puppets: <span class="gold">8</span>  |  Fund: <span class="gold">0.002 ETH</span>  |  Hold: <span class="gold">180s</span>           \u2551`)
  lines.push(bRow())
  lines.push(tRow('ACTIONS'))
  lines.push(`\u2551  <span class="cyan" onclick="factorySetup()">[SETUP]</span> Generate wallets    <span class="cyan" onclick="factoryFund()">[FUND]</span> Fund puppets     \u2551`)
  lines.push(`\u2551  <span class="cyan" onclick="factoryRun()">[RUN]</span> Start cycles         <span class="cyan" onclick="factoryBalances()">[BAL]</span> Check balances  \u2551`)
  lines.push(`\u2551  <span class="cyan" onclick="factorySweep()">[SWEEP]</span> Harvest profits                                      \u2551`)
  lines.push(`\u2551                                                                                  \u2551`)
  lines.push(`\u2551  Cycles: <input id="f-cycles" type="number" value="1" min="1" max="100" style="width:50px">  |  Main: <input id="f-main" type="text" placeholder="0x..." style="width:200px">  \u2551`)
  lines.push(`\u2551  Harvest: <input id="f-harvest" type="text" placeholder="0x..." style="width:200px">  \u2551`)
  lines.push(bRow())
  lines.push(tRow('LIVE LOG'))
  const vis = factoryLogs.slice(-20)
  if (vis.length === 0) {
    lines.push(`\u2551  <span class="dim">No activity yet. Run setup, then fund, then start cycles.</span>      \u2551`)
  } else {
    for (const log of vis) {
      const e = esc(log).replace(/ERROR|FAIL|error|fail/g, m => `<span class="error">${m}</span>`).replace(/COMPLETE|OK|ok/g, m => `<span class="cyan">${m}</span>`).replace(/[\d.]+ ETH|\$[\d,]+/g, m => `<span class="gold">${m}</span>`)
      lines.push(`\u2551  ${e.padEnd(54).slice(0,54)} \u2551`)
    }
  }
  lines.push(bRow())
  lines.push(tRow('SESSION STATS'))
  lines.push(`\u2551  Cycles: <span class="gold">?</span>  |  Wins: <span class="cyan">?</span>  |  Profit: <span class="gold">TBD</span>    \u2551`)
  lines.push(`\u2551  Win Rate: <span class="cyan">~98.76%</span> (empirical)                      \u2551`)
  lines.push(bRow())
  content.innerHTML = lines.join('\n')
}

async function factorySetup() {
  const r = await factoryApi('POST', 'setup')
  if (r.ok) factoryLogs.push(`Setup complete: ${r.wallets.length} wallets generated`)
  else factoryLogs.push(`Setup failed: ${r.error}`)
  renderFactory()
}

async function factoryFund() {
  const fromPk = prompt('Enter master wallet private key (not stored):')
  if (!fromPk) return
  factoryLogs.push('Funding puppets...')
  const r = await factoryApi('POST', 'fund', { fromPk })
  if (r.ok) factoryLogs.push('Funding initiated.')
  else factoryLogs.push(`Fund failed: ${r.error}`)
  renderFactory()
}

async function factoryRun() {
  const cycles = parseInt($('f-cycles').value) || 1
  const mainAddress = $('f-main').value.trim()
  if (!mainAddress) { alert('Enter main wallet address'); return }
  factoryLogs.push(`Starting ${cycles} cycle(s) with ${sa(mainAddress)}...`)
  factoryRunning = true; renderFactory()
  await factoryApi('POST', 'run', { cycles, mainAddress })
}

async function factoryBalances() {
  const r = await factoryApi('GET', 'balances')
  if (r.ok && r.balances) {
    factoryLogs.push('--- Balances ---')
    r.balances.forEach(b => factoryLogs.push(`  [${b.index}] ${b.address}  ${b.balance} ETH`))
  } else factoryLogs.push(`Balances failed: ${r.error || 'no data'}`)
  renderFactory()
}

async function factorySweep() {
  const toAddress = $('f-harvest').value.trim()
  if (!toAddress) { alert('Enter harvest address'); return }
  factoryLogs.push(`Sweeping to ${sa(toAddress)}...`)
  const r = await factoryApi('POST', 'sweep', { toAddress })
  if (r.ok) factoryLogs.push(`Sweep complete: ${r.total} wei harvested.`)
  else factoryLogs.push(`Sweep failed: ${r.error}`)
  renderFactory()
}

// ── Sniper State ──

let sniperLogs = []
let sniperDetected = []
let sniperBuys = []
let sniperStatus = { active: { sol: false, robinhood: false }, autoBuy: { sol: false, robinhood: false }, wallets: {}, config: {}, autoBuyCounts: { sol: 0, robinhood: 0 } }
let sniperEventSource = null

function sniperConnectSSE() {
  if (sniperEventSource) sniperEventSource.close()
  sniperEventSource = new EventSource('/api/sniper/stream')
  sniperEventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type === 'log') { sniperLogs.push(data.msg); if (activeTab === 7) renderSniper() }
      else if (data.type === 'detected') { sniperDetected.unshift(data.token); sniperDetected = sniperDetected.slice(0, 200); if (activeTab === 7) renderSniper() }
      else if (data.type === 'filtered') { if (activeTab === 7) renderSniper() }
      else if (data.type === 'buy') { sniperBuys.unshift(data.result); sniperBuys = sniperBuys.slice(0, 100); if (activeTab === 7) renderSniper() }
      else if (data.type === 'status') { sniperStatus = data.status; if (activeTab === 7) renderSniper() }
      else if (data.type === 'rug-flagged') { sniperLogs.push(`\u2622 RUG FLAGGED: ${data.address.slice(0,10)}.. (${data.confidence}%)`); if (activeTab === 7) renderSniper() }
    } catch {}
  }
  sniperEventSource.onerror = () => setTimeout(sniperConnectSSE, 3000)
}

async function sniperApi(method, endpoint, body) {
  status.textContent = 'sniper...'
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  return fetch(`/api/sniper/${endpoint}`, opts).then(r => r.json()).finally(() => { status.textContent = '' })
}

function sniperStart(chain) {
  sniperApi('POST', 'start', { chain })
  sniperLogs.push(`Starting ${chain} detector...`); renderSniper()
}
function sniperStop(chain) {
  sniperApi('POST', 'stop', { chain })
  sniperLogs.push(`Stopping ${chain} detector.`); renderSniper()
}
function sniperSetWallet(chain) {
  const addr = prompt(`Enter ${chain} wallet:`)
  if (!addr) return
  sniperApi('POST', 'wallet', { chain, address: addr })
  sniperLogs.push(`${chain} wallet set: ${sa(addr)}`); renderSniper()
}
function sniperToggleAutoBuy(chain) {
  const newVal = !sniperStatus.autoBuy[chain]
  sniperApi('POST', 'autobuy', { chain, enabled: newVal })
  renderSniper()
}

function renderSniper() {
  const lines = ['']
  lines.push(tRow('SNIPER BOT'))
  lines.push(`<span class="bold">\u2551  Real-time token detection + auto-buy on Solana (Pump.fun) & Robinhood (PONS) \u2551</span>`)
  lines.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
  lines.push(bRow())

  // Solana
  lines.push(tRow('SOLANA (Pump.fun)'))
  const solOn = sniperStatus.active?.sol; const solWallet = sniperStatus.wallets?.sol
  const solAuto = sniperStatus.autoBuy?.sol; const solCount = sniperStatus.autoBuyCounts?.sol || 0
  lines.push(`\u2551  ${solOn ? '<span class="error">\u25a0 ACTIVE</span>' : '<span class="cyan">\u25b6 STOPPED</span>'}  Wallet: ${solWallet ? sa(solWallet) : '<span class="dim">not set</span>'}        \u2551`)
  lines.push(`\u2551  Auto-buy: ${solAuto ? '<span class="cyan">ON</span>' : '<span class="dim">OFF</span>'}  (${solCount} buys)  Buy: <span class="gold">${sniperStatus.config?.solBuyAmt || '0.3'} SOL</span>  \u2551`)
  lines.push(`\u2551  <span class="cyan" onclick="sniperStart('sol')">[START]</span>  <span class="error" onclick="sniperStop('sol')">[STOP]</span>  <span class="cyan" onclick="sniperSetWallet('sol')">[SET WALLET]</span>  <span class="cyan" onclick="sniperToggleAutoBuy('sol')">[TOGGLE AUTO]</span>  \u2551`)
  lines.push(bRow())

  // Robinhood
  lines.push(tRow('ROBINHOOD (PONS)'))
  const rhOn = sniperStatus.active?.robinhood; const rhWallet = sniperStatus.wallets?.robinhood
  const rhAuto = sniperStatus.autoBuy?.robinhood; const rhCount = sniperStatus.autoBuyCounts?.robinhood || 0
  lines.push(`\u2551  ${rhOn ? '<span class="error">\u25a0 ACTIVE</span>' : '<span class="cyan">\u25b6 STOPPED</span>'}  Wallet: ${rhWallet ? sa(rhWallet) : '<span class="dim">not set</span>'}        \u2551`)
  lines.push(`\u2551  Auto-buy: ${rhAuto ? '<span class="cyan">ON</span>' : '<span class="dim">OFF</span>'}  (${rhCount} buys)  Buy: <span class="gold">${sniperStatus.config?.robinBuyAmt || '0.02'} ETH</span>  \u2551`)
  lines.push(`\u2551  <span class="cyan" onclick="sniperStart('robinhood')">[START]</span>  <span class="error" onclick="sniperStop('robinhood')">[STOP]</span>  <span class="cyan" onclick="sniperSetWallet('robinhood')">[SET WALLET]</span>  <span class="cyan" onclick="sniperToggleAutoBuy('robinhood')">[TOGGLE AUTO]</span>  \u2551`)
  lines.push(bRow())

  // Detected
  lines.push(tRow('RECENT DETECTED'))
  if (sniperDetected.length === 0) {
    lines.push(`\u2551  <span class="dim">Start a detector to see new tokens arrive in real-time.</span>          \u2551`)
  } else {
    lines.push(`<span class="bold">\u2551  CHAIN    ADDRESS             NAME          TIME                \u2551</span>`)
    lines.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const t of sniperDetected.slice(0, 8)) {
      const cl = t.chain === 'sol' ? 'SOL ' : 'ROB '; const addr = sa(t.address || t.txHash || '')
      const name = tr(t.name || t.symbol || '-', 14); const ts = t.slot ? `slot ${t.slot}` : t.blockNumber ? `#${t.blockNumber}` : ''
      lines.push(`\u2551 ${cl} ${addr.padEnd(18)} ${name.padEnd(14)} ${ts.padEnd(20)} \u2551`)
    }
  }
  lines.push(bRow())

  // Buys
  lines.push(tRow('RECENT BUYS'))
  if (sniperBuys.length === 0) {
    lines.push(`\u2551  <span class="dim">No buys yet. Enable auto-buy with a wallet set.</span>                 \u2551`)
  } else {
    lines.push(`<span class="bold">\u2551  STATUS  TOKEN             AMOUNT                            \u2551</span>`)
    lines.push(`<span class="bold">\u255c${'\u2550'.repeat(56)}\u255e</span>`)
    for (const b of sniperBuys.slice(0, 6)) {
      const ok = b.success ? '<span class="cyan">OK </span>' : '<span class="error">FAIL</span>'
      const addr = sa(b.token || ''); const amt = b.result?.amount || b.amount || '-'
      lines.push(`\u2551 ${ok} ${addr.padEnd(18)} ${String(amt).padEnd(34)} \u2551`)
    }
  }
  lines.push(bRow())

  // Log
  lines.push(tRow('LIVE LOG'))
  const vis = sniperLogs.slice(-10)
  if (vis.length === 0) {
    lines.push(`\u2551  <span class="dim">Log will appear here when detectors are running.</span>               \u2551`)
  } else {
    for (const log of vis) {
      const e = esc(log).replace(/ERROR|FAIL|error|fail/g, m => `<span class="error">${m}</span>`).replace(/listening|OK|ok|BOUGHT|SOLD/g, m => `<span class="cyan">${m}</span>`).replace(/\[(SOL|ROB)\]/g, m => `<span class="gold">${m}</span>`)
      lines.push(`\u2551  ${e.padEnd(54).slice(0,54)} \u2551`)
    }
  }
  lines.push(bRow())

  content.innerHTML = lines.join('\n')
}

// ── SSE ──
function connectSSE() {
  const es = new EventSource('/api/stream')
  es.addEventListener('init', e => { assign(JSON.parse(e.data).data); updateUI(); switchTab(activeTab) })
  es.addEventListener('update', e => {
    const m = JSON.parse(e.data)
    if (m.full && m.data) assign(m.data)
    else if (m.type && m.chain && m.data !== undefined) {
      const d = m.data
      if (m.type==='trending'&&Array.isArray(d)) cachedData.trending[m.chain]=d
      else if (m.type==='trenches'&&Array.isArray(d)) cachedData.trenches[m.chain]=d
      else if (m.type==='smartMoney'&&Array.isArray(d)) cachedData.smartMoney[m.chain]=d
      else if (m.type==='kol'&&Array.isArray(d)) cachedData.kol[m.chain]=d
      else if (m.type==='signals'&&Array.isArray(d)) cachedData.signals[m.chain]=d
    }
    if (activeTab !== 4 && activeTab !== 5) switchTab(activeTab)
  })
  es.onerror = () => { es.close(); setTimeout(connectSSE, 1000) }
}
function assign(data) { if(!data)return; for(const t of Object.keys(data)){ if(!cachedData[t])cachedData[t]={}; for(const c of Object.keys(data[t]))cachedData[t][c]=data[t][c] } }

function switchTab(idx) {
  activeTab = idx; updateUI()
  switch (idx) {
    case 0: renderHub(); break; case 1: renderTrenches(); break; case 2: renderTrades(); break
    case 3: renderSignals(); break; case 4: renderTokenSearch(); break; case 5: renderPortfolio(chain(), portAddr); break
    case 6: renderFactory(); break; case 7: renderSniper(); break
  }
}
function updateUI() {
  $('tabs').innerHTML = TABS.map((t,i)=>`<span class="tab${i===activeTab?' active':''}" data-tab="${i}">${i===activeTab?`[${t}]`:t}</span>`).join('')
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
  content.innerHTML = `\n\n  <span class="bold">GMGN TERMINAL v2</span>\n\n  <span class="gold">F1-F8</span> Tabs  <span class="gold">Tab</span> Focus  <span class="gold">q</span> Close\n  Click any symbol \u2192 copy CA to clipboard\n\n  <span class="cyan">sol:ADDR</span>  Token lookup\n  <span class="cyan">portfolio ADDR</span>  Wallet (uses active chain)\n  <span class="cyan">help</span>  This\n\n  <span class="gold">F1 HUB</span>: Sniper targets + Pre-bond + New launches + Trending + SM + Alpha\n  <span class="gold">F2 TRENCHES</span>: All new creations\n  <span class="gold">F3 TRADES</span>: Whale + KOL trade feed\n  <span class="gold">F4 SIGNALS</span>: 22 pattern detectors + risk scoring\n  <span class="gold">F5 TOKEN</span>: Deep research\n  <span class="gold">F6 PORTFOLIO</span>: Wallet P&L\n  <span class="gold">F7 FACTORY</span>: PONS Token Factory (P&D on Robinhood ETH)\n  <span class="gold">F8 SNIPER</span>: Real-time detector (Solana Pump.fun + Robinhood PONS)\n\n  <span class="dim">Real-time SSE push  |  22 detectors  |  v2</span>`
}

document.addEventListener('keydown', e => {
  const m={F1:0,F2:1,F3:2,F4:3,F5:4,F6:5,F7:6,F8:7}; if(e.key in m){e.preventDefault();switchTab(m[e.key])}
  if(e.key==='Tab'){e.preventDefault();input.focus()}; if(e.key==='q'&&!e.ctrlKey)window.close(); if(e.key==='Escape')input.focus()
})
$('tabs').addEventListener('click', e=>{const t=e.target.closest('.tab');if(t)switchTab(parseInt(t.dataset.tab))})
$('chain-select').addEventListener('change', ()=>{updateUI();switchTab(activeTab)})
input.addEventListener('keydown', e=>{if(e.key==='Enter')handleSubmit()})

checkConn(); updateUI(); connectSSE(); factoryConnectSSE(); sniperConnectSSE(); setInterval(updateUI,1000); input.focus()
