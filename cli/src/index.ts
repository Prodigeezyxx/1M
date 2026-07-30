#!/usr/bin/env tsx

import blessed from 'blessed'
import { isConfigured, trending, trenches, smartMoney, kolTrades, tokenInfo, tokenSecurity, portfolioHoldings, portfolioStats, type TrendingItem, type TrenchItem, type SMTrade, type PortfolioHolding, type PortfolioStats } from './gmgn.js'

const C = {
  bg: '#0a0a0a',
  fg: '#00ff41',
  fgDim: '#1a5c1a',
  border: '#1a3a1a',
  accent: '#ffd700',
  red: '#ff4444',
  cyan: '#44ddff',
  tabActive: '#00ff41',
}
const X = '{/}'

const screen = blessed.screen({
  smartCSR: true,
  title: 'GMGN Terminal',
  cursor: { artificial: true, shape: 'line', blink: true, color: C.fg },
  dockBorders: true,
  fullUnicode: true,
})

// ── Top Bar ───────────────────────────────────────────────────────
const topBar = blessed.box({
  parent: screen,
  top: 0, left: 0, width: '100%', height: 1,
  style: { fg: C.fg, bg: '#000000' },
  tags: true,
})

// ── Main Content ──────────────────────────────────────────────────
const mainBox = blessed.box({
  parent: screen,
  top: 1, left: 0, width: '100%', height: '100%-2',
  style: { fg: C.fg, bg: C.bg },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  tags: true,
  scrollbar: { ch: '│', style: { fg: C.fgDim } },
})

// ── Bottom Bar ────────────────────────────────────────────────────
const cmdBar = blessed.box({
  parent: screen,
  bottom: 0, left: 0, width: '100%', height: 1,
  style: { fg: C.fgDim, bg: '#000000' },
  tags: true,
})

const input = blessed.textbox({
  parent: cmdBar,
  inputOnFocus: true,
  style: { fg: C.cyan, bg: '#000000' },
  height: 1, left: 0, right: 0,
  keys: true, mouse: true,
})

// ── State ─────────────────────────────────────────────────────────
const tabs = ['DASHBOARD', 'TRENCHES', 'SMART MONEY', 'TOKEN', 'PORTFOLIO'] as const
let activeTab = 0
let refreshTimer: ReturnType<typeof setInterval> | null = null
let cachedTrending: TrendingItem[] = []
let cachedTrenches: TrenchItem[] = []
let cachedSmartMoney: SMTrade[] = []
let cachedKol: SMTrade[] = []
let cachedPortfolioHoldings: PortfolioHolding[] = []
let cachedPortfolioStats: PortfolioStats | null = null
let cachedPortfolioAddr = ''
let isLoading = false

// ── Helpers ───────────────────────────────────────────────────────
function colDollar(v: string | number): string {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (n > 1_000_000) return `{${C.accent}-fg}$${(n / 1_000_000).toFixed(2)}M{/}`
  if (n > 1_000) return `{${C.accent}-fg}$${(n / 1_000).toFixed(1)}K{/}`
  return `$${n.toFixed(2)}`
}
function colRug(r: number): string {
  if (r > 0.3) return `{${C.red}-fg}${r.toFixed(2)}{/}`
  if (r > 0.1) return `{${C.accent}-fg}${r.toFixed(2)}{/}`
  return `{${C.fg}-fg}${r.toFixed(2)}{/}`
}
function ago(ts: number): string {
  const s = Math.floor((Date.now() / 1000 - ts))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}
function shortAddr(a: string): string { return `${a.slice(0, 4)}..${a.slice(-4)}` }
function trunc(s: string, n: number): string { return s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '') }
function formatTime(): string { return new Date().toLocaleTimeString('en-US', { hour12: false }) }
function smStr(n: number): string { return n >= 3 ? `{${C.cyan}-fg}${n}{/}` : n > 0 ? `${n}` : '-' }

// ── Title box helper ──────────────────────────────────────────────
function titleRow(title: string): string {
  const line = '═'.repeat(Math.max(2, 56 - title.length))
  return `{bold}╔══ ${title} ${line}╗{/}`
}
function bottomRow(): string {
  return `{bold}╚${'═'.repeat(58)}╝{/}`
}

// ── Views ─────────────────────────────────────────────────────────

function renderDashboard() {
  const lines: string[] = []
  lines.push('')
  lines.push(titleRow('MARKET OVERVIEW'))
  lines.push(`{bold}║  TRENDING (5m)                    VOLUME       MC          SM  RUG ║{/}`)
  lines.push(`{bold}╠${'═'.repeat(58)}╣{/}`)
  for (const t of cachedTrending.slice(0, 12)) {
    const s = smStr(t.smart_degen_count || 0)
    lines.push(`║ ${trunc(t.symbol, 8).padEnd(8)} ${trunc(t.name, 12).padEnd(12)} ${colDollar(t.volume).padEnd(12)} ${colDollar(t.market_cap).padEnd(10)} ${String(s).padEnd(3)} ${colRug(t.rug_ratio)} ║`)
  }
  lines.push(bottomRow())
  lines.push('')

  const buys = cachedSmartMoney.filter(t => t.side === 'buy').slice(0, 8)
  if (buys.length) {
    lines.push(titleRow('SMART MONEY BUYS'))
    lines.push(`{bold}║  TOKEN      USD VALUE     WHO                TIME               ║{/}`)
    lines.push(`{bold}╠${'═'.repeat(58)}╣{/}`)
    for (const t of buys) {
      const who = t.maker_info?.twitter_username || shortAddr(t.maker)
      lines.push(`║ ${trunc(t.base_token.symbol, 10).padEnd(10)} ${colDollar(t.amount_usd).padEnd(13)} ${trunc(who, 16).padEnd(16)} ${ago(t.timestamp)}m ago           ║`)
    }
    lines.push(bottomRow())
  }

  mainBox.setContent(lines.join('\n'))
  screen.render()
}

function renderTrenches() {
  const lines: string[] = []
  lines.push('')
  lines.push(titleRow('NEW LAUNCHES'))
  lines.push(`{bold}║  SYMBOL    MC          LIQ          VOL 1H     SM  RUG   PLATFORM  ║{/}`)
  lines.push(`{bold}╠${'═'.repeat(58)}╣{/}`)
  for (const t of cachedTrenches.slice(0, 14)) {
    const s = smStr(t.smart_degen_count || 0)
    lines.push(`║ ${trunc(t.symbol, 8).padEnd(8)} ${colDollar(t.usd_market_cap).padEnd(11)} ${colDollar(t.liquidity).padEnd(11)} ${colDollar(t.volume_1h).padEnd(10)} ${String(s).padEnd(3)} ${colRug(t.rug_ratio)} ${trunc(t.launchpad_platform || '', 10).padEnd(10)} ║`)
  }
  lines.push(bottomRow())
  mainBox.setContent(lines.join('\n'))
  screen.render()
}

function renderSmartMoney() {
  const all = [...cachedSmartMoney, ...cachedKol]
  all.sort((a, b) => b.timestamp - a.timestamp)

  const lines: string[] = []
  lines.push('')
  lines.push(titleRow('TRADE FEED'))
  lines.push(`{bold}║  TIME  SIDE  TOKEN      USD VALUE   WHO                TYPE TAG  ║{/}`)
  lines.push(`{bold}╠${'═'.repeat(58)}╣{/}`)

  for (const t of all.slice(0, 22)) {
    const side = t.side === 'buy' ? `{${C.cyan}-fg}BUY {/}` : `{${C.red}-fg}SELL{/}`
    const who = t.maker_info?.twitter_username || shortAddr(t.maker)
    const tag = t.maker_info?.tags?.find(tg => tg === 'smart_degen' || tg === 'kol') || '-'
    const tagLbl = tag === 'smart_degen' ? 'SMART' : tag === 'kol' ? 'KOL' : tag.substring(0, 4)
    const pos = t.is_open_or_close === 0 ? 'OPEN' : 'CLOSE'
    lines.push(`║ ${ago(t.timestamp).padEnd(5)} ${side} ${trunc(t.base_token.symbol, 8).padEnd(8)} ${colDollar(t.amount_usd).padEnd(11)} ${trunc(who, 16).padEnd(16)} ${pos} ${tagLbl} ║`)
  }
  lines.push(bottomRow())
  mainBox.setContent(lines.join('\n'))
  screen.render()
}

function renderTokenSearch(tokenAddr?: string) {
  if (!tokenAddr) {
    mainBox.setContent(`

  {${C.fgDim}-fg}Enter a token address in the command bar and press Enter.{/}

  {bold}FORMAT:{/}  ${C.accent}sol:ADDRESS${C.fg}  ${C.accent}bsc:ADDRESS${C.fg}  ${C.accent}base:ADDRESS${C.fg}

  {bold}EXAMPLE:{/}  ${C.cyan}sol:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v${X}

  {bold}F1{/} Dashboard    {bold}F2{/} Trenches    {bold}F3{/} Smart Money
  {bold}F4{/} Token        {bold}F5{/} Portfolio   {bold}q{/} Quit  {bold}r{/} Refresh`)
    screen.render()
    return
  }

  const [chain, addr] = tokenAddr.includes(':') ? tokenAddr.split(':') : ['sol', tokenAddr]
  const info = tokenInfo(chain, addr)
  const sec = tokenSecurity(chain, addr)

  const lines: string[] = []
  lines.push('')
  lines.push(titleRow('TOKEN RESEARCH'))
  if (info) {
    lines.push(`║  {${C.accent}-fg}${info.symbol}{/} (${info.name})`)
    lines.push(`║  Address: ${shortAddr(info.address)}   Chain: {${C.cyan}-fg}${chain.toUpperCase()}{/}`)
    lines.push(`║  Price: {${C.cyan}-fg}$${parseFloat(info.price.price).toFixed(10)}{/}`)
    lines.push(`║  Liquidity: ${colDollar(info.liquidity)}   Holders: ${info.holder_count}`)
    lines.push(`║  Supply: ${parseFloat(info.total_supply || '0').toLocaleString()}   Launchpad: ${info.launchpad_platform || 'N/A'}`)
  } else {
    lines.push(`║  Address: ${shortAddr(addr)}   Chain: {${C.cyan}-fg}${chain.toUpperCase()}{/}`)
    lines.push(`║  {${C.red}-fg}TOKEN INFO UNAVAILABLE{/}`)
  }
  lines.push(`{bold}╠${'═'.repeat(58)}╣{/}`)
  if (sec) {
    const hp = sec.is_honeypot === 'yes' ? `{${C.red}-fg}YES — HONEYPOT{/}` : `{${C.fg}-fg}NO{/}`
    const rug = sec.rug_ratio > 0.3 ? `{${C.red}-fg}${sec.rug_ratio} HIGH{/}` : sec.rug_ratio > 0.1 ? `{${C.accent}-fg}${sec.rug_ratio} MED{/}` : `${sec.rug_ratio} LOW`
    const t10 = sec.top_10_holder_rate > 0.5 ? `{${C.red}-fg}${(sec.top_10_holder_rate * 100).toFixed(1)}%{/}` : `${(sec.top_10_holder_rate * 100).toFixed(1)}%`
    const dev = sec.creator_token_status === 'creator_hold' ? `{${C.accent}-fg}HOLDING{/}` : `{${C.fg}-fg}CLOSED{/}`
    lines.push(`{bold}║  SECURITY{/}`)
    lines.push(`║  Honeypot: ${hp}   Rug: ${rug}`)
    lines.push(`║  Top10: ${t10}   Dev: ${dev}`)
    lines.push(`║  Tax: ${(sec.buy_tax * 100).toFixed(1)}% / ${(sec.sell_tax * 100).toFixed(1)}%   Snipers: ${sec.sniper_count || 0}`)
    lines.push(`║  Wash Trade: ${sec.is_wash_trading ? `{${C.red}-fg}DETECTED{/}` : `{${C.fg}-fg}NO{/}`}`)
  } else {
    lines.push(`║  {${C.red}-fg}SECURITY DATA UNAVAILABLE{/}`)
  }
  lines.push(bottomRow())
  mainBox.setContent(lines.join('\n'))
  screen.render()
}

function renderPortfolio() {
  if (!cachedPortfolioAddr) {
    mainBox.setContent(`

  {bold}PORTFOLIO VIEW{/}

  Use the command bar to check a wallet:

    {${C.cyan}-fg}portfolio sol:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM${X}

  Shows holdings, P&L, and trading stats for any wallet address.

  {bold}F1{/} Dashboard    {bold}F2{/} Trenches    {bold}F3{/} Smart Money
  {bold}F4{/} Token        {bold}F5{/} Portfolio   {bold}q{/} Quit  {bold}r{/} Refresh`)
    screen.render()
    return
  }

  const lines: string[] = []
  lines.push('')
  lines.push(titleRow('WALLET PORTFOLIO'))
  lines.push(`║  Wallet: {${C.cyan}-fg}${shortAddr(cachedPortfolioAddr)}{/}`)
  if (cachedPortfolioStats) {
    const s = cachedPortfolioStats
    const winrate = (s.pnl_stat.winrate * 100).toFixed(1)
    const nativeBal = parseFloat(s.native_balance).toFixed(2)
    const totalCost = parseFloat(s.total_cost).toFixed(2)
    const rp = parseFloat(s.realized_profit)
    const rpStr = rp >= 0 ? `{${C.fg}-fg}+${rp.toFixed(2)}{/}` : `{${C.red}-fg}${rp.toFixed(2)}{/}`
    lines.push(`║  SOL: {${C.accent}-fg}${nativeBal}{/}  |  Total Cost: \$${totalCost}  |  Realized P&L: ${rpStr}`)
    lines.push(`║  Tokens Traded: {${C.cyan}-fg}${s.pnl_stat.token_num}{/}  |  Winrate: {${C.accent}-fg}${winrate}%{/}  |  Avg Hold: {${C.fgDim}-fg}${Math.floor(s.pnl_stat.avg_holding_period / 86400)}d{/}`)
    lines.push(`║  PnL Dist: < -50%: {${C.red}-fg}${s.pnl_stat.pnl_lt_nd5_num}{/}  |  -50-0%: ${s.pnl_stat.pnl_nd5_0x_num}  |  0-200%: ${s.pnl_stat.pnl_0x_2x_num}  |  2-5x: ${s.pnl_stat.pnl_2x_5x_num}  |  >5x: {${C.cyan}-fg}${s.pnl_stat.pnl_gt_5x_num}{/}`)
    if (s.common?.nick_name) lines.push(`║  Label: {${C.fgDim}-fg}${s.common.nick_name}{/}${s.common.fund_from ? `  |  Funded By: {${C.fgDim}-fg}${s.common.fund_from}{/}` : ''}`)
  }
  lines.push(`{bold}╠${'═'.repeat(58)}╣{/}`)

  if (cachedPortfolioHoldings.length === 0) {
    lines.push(`║  {${C.fgDim}-fg}No open positions for this wallet.{/}`)
  } else {
    lines.push(`{bold}║  TOKEN      BALANCE       USD VALUE     P&L          SINCE        ║{/}`)
    lines.push(`{bold}╠${'═'.repeat(58)}╣{/}`)
    for (const h of cachedPortfolioHoldings.slice(0, 15)) {
      const val = parseFloat(h.usd_value)
      const tp = parseFloat(h.total_profit)
      const tpp = parseFloat(h.total_profit_pnl) * 100
      const pnlStr = tp >= 0 ? `{${C.fg}-fg}+${tp.toFixed(2)}{/}` : `{${C.red}-fg}${tp.toFixed(2)}{/}`
      const pnlPct = tp >= 0 ? `{${C.fg}-fg}(${tpp.toFixed(1)}%){/}` : `{${C.red}-fg}(${tpp.toFixed(1)}%){/}`
      lines.push(`║ ${trunc(h.token.symbol, 8).padEnd(8)} ${trunc(h.balance, 12).padEnd(12)} ${colDollar(val).padEnd(13)} ${(pnlStr + ' ' + pnlPct).padEnd(12)} ${ago(h.start_holding_at)}d               ║`)
    }
  }
  lines.push(bottomRow())
  mainBox.setContent(lines.join('\n'))
  screen.render()
}

// ── Tab Control ────────────────────────────────────────────────────

function updateTopBar() {
  const conn = isConfigured()
  const connStr = conn ? `{green-fg}● CONNECTED{/}` : `{${C.red}-fg}● DISCONNECTED{/}`
  const tabStr = tabs.map((t, i) => i === activeTab
    ? `{${C.tabActive}-fg}{bold}[${t}]{/}`
    : `{${C.fgDim}-fg} ${t} {/}`
  ).join(' ')
  topBar.setContent(` ${formatTime()}  ${connStr}    ${tabStr}   {${C.fgDim}-fg}| AUTO 30s{/}`)
  screen.render()
}

function switchTab(idx: number) {
  activeTab = idx
  updateTopBar()
  switch (idx) {
    case 0: renderDashboard(); break
    case 1: renderTrenches(); break
    case 2: renderSmartMoney(); break
    case 3: renderTokenSearch(); break
    case 4: renderPortfolio(); break
  }
}

// ── Refresh ───────────────────────────────────────────────────────

async function refreshData() {
  if (isLoading) return
  isLoading = true
  try {
    const [tr, tc, sm, kl] = await Promise.all([
      Promise.resolve().then(() => trending('sol', '5m', 30)),
      Promise.resolve().then(() => trenches('sol', 'new_creation', 'safe')),
      Promise.resolve().then(() => smartMoney('sol')),
      Promise.resolve().then(() => kolTrades('sol')),
    ])
    if (tr.length) cachedTrending = tr
    if (tc.length) cachedTrenches = tc
    if (sm.length) cachedSmartMoney = sm
    if (kl.length) cachedKol = kl
  } catch { /* keep stale data */ }
  isLoading = false
  switchTab(activeTab)
}

// ── Command Input ─────────────────────────────────────────────────

function focusInput() { input.focus() }

function showHelp() {
  mainBox.setContent(`

  {bold}GMGN TERMINAL HELP{/}

  {bold}NAVIGATION{/}
    {${C.accent}-fg}F1-F5{/}  Switch tabs
    {${C.accent}-fg}1-5{/}    Same (shorthand)
    {${C.accent}-fg}Tab{/}    Focus command bar
    {${C.accent}-fg}Esc{/}    Back to command bar
    {${C.accent}-fg}q{/}     Quit
    {${C.accent}-fg}r{/}     Force refresh

  {bold}COMMANDS{/}
    {${C.cyan}-fg}sol:ADDR${X}        Token lookup (sol/bsc/base/eth/robinhood)
    {${C.cyan}-fg}portfolio CHAIN:ADDR${X}  Wallet holdings (e.g. portfolio sol:ADDR)

  {bold}TABS{/}
    {${C.accent}-fg}F1 DASHBOARD{/}   Trending + smart money buys
    {${C.accent}-fg}F2 TRENCHES{/}    New token launches
    {${C.accent}-fg}F3 SMART MONEY{/} Whale + KOL trade feed
    {${C.accent}-fg}F4 TOKEN{/}       Deep research on any token
    {${C.accent}-fg}F5 PORTFOLIO{/}   Wallet P&L

  {${C.fgDim}-fg}Auto-refreshes every 30s. Powered by GMGN API.{/}`)
  screen.render()
}

input.on('submit', async (value: string) => {
  const v = value.trim()
  input.clearValue()
  input.setContent('')
  cmdBar.setContent('')

  if (!v) { focusInput(); return }

  if (v.startsWith('sol:') || v.startsWith('bsc:') || v.startsWith('base:') || v.startsWith('eth:') || v.startsWith('robinhood:')) {
    switchTab(3)
    renderTokenSearch(v)
  } else if (v.startsWith('portfolio ')) {
    const addr = v.replace(/^portfolio\s+/, '').trim()
    const chain = addr.includes(':') ? addr.split(':')[0] : 'sol'
    const wallet = addr.includes(':') ? addr.split(':')[1] : addr
    cachedPortfolioAddr = wallet
    const [holdings, stats] = await Promise.all([
      portfolioHoldings(chain, wallet),
      portfolioStats(chain, wallet),
    ])
    cachedPortfolioHoldings = holdings
    cachedPortfolioStats = stats
    switchTab(4)
  } else if (v === 'help' || v === '?') {
    showHelp()
  } else if (v === 'refresh' || v === 'r') {
    refreshData()
  } else if (v.startsWith('token ') || v.startsWith('t:')) {
    switchTab(3)
    renderTokenSearch(`sol:${v.replace(/^(token |t:)/, '').trim()}`)
  } else {
    cmdBar.setContent(`  {${C.red}-fg}Unknown:{/} ${v}  {${C.fgDim}-fg}(try sol:ADDR, portfolio ADDR, help, or any chain: sol/bsc/base/eth/robinhood){/}`)
    screen.render()
  }
  focusInput()
})

// ── Keyboard ──────────────────────────────────────────────────────

screen.key(['escape'], () => focusInput())
screen.key(['C-c', 'q'], () => { if (refreshTimer) clearInterval(refreshTimer); process.exit(0) })
screen.key(['r', 'R'], () => refreshData())

screen.key(['f1'], () => { switchTab(0); focusInput() })
screen.key(['f2'], () => { switchTab(1); focusInput() })
screen.key(['f3'], () => { switchTab(2); focusInput() })
screen.key(['f4'], () => { switchTab(3); focusInput() })
screen.key(['f5'], () => { switchTab(4); focusInput() })

screen.key(['1'], () => switchTab(0))
screen.key(['2'], () => switchTab(1))
screen.key(['3'], () => switchTab(2))
screen.key(['4'], () => switchTab(3))
screen.key(['5'], () => switchTab(4))

// ── Init ──────────────────────────────────────────────────────────

cmdBar.setContent(`  {${C.fgDim}-fg}Type sol:ADDR, bsc:ADDR, portfolio ADDR, or help{/}`)
focusInput()

refreshData().then(() => {
  updateTopBar()
  refreshTimer = setInterval(refreshData, 30000)
})
