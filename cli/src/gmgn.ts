import { execSync } from 'child_process'

const CLI = 'gmgn-cli'

function run(args: string[]): string {
  try {
    const cmd = `${CLI} ${args.join(' ')} --raw 2>NUL`
    return execSync(cmd, { encoding: 'utf-8', timeout: 25000, shell: 'pwsh.exe' }).trim()
  } catch (e: any) {
    const msg = e.stderr?.trim() || e.message || 'Command failed'
    if (msg.includes('RATE_LIMIT')) return JSON.stringify({ error: 'rate_limited', message: msg })
    return JSON.stringify({ error: true, message: msg.substring(0, 200) })
  }
}

function parse<T>(out: string): T | null {
  try { return JSON.parse(out) as T } catch { return null }
}

export interface TrendingItem {
  address: string; symbol: string; name: string; price: string
  market_cap: string; volume: string; liquidity: string
  smart_degen_count: number; renowned_count: number
  rug_ratio: number; holder_count: number; swaps: number
  price_change_percent: number; hot_level: number
  creator_token_status: string; is_wash_trading: boolean
  launchpad_platform: string; twitter_username?: string
}

export function trending(chain = 'sol', interval = '5m', limit = 30): TrendingItem[] {
  const out = run(['market', 'trending', '--chain', chain, '--interval', interval, '--order-by', 'volume', '--limit', String(limit)])
  const d = parse<{ data: { rank: TrendingItem[] } }>(out)
  return d?.data?.rank || []
}

export interface TrenchItem {
  address: string; symbol: string; name: string
  usd_market_cap: string; liquidity: string
  smart_degen_count: number; renowned_count: number
  rug_ratio: number; holder_count: number
  volume_1h: string; swaps_1h: number
  created_timestamp: number; launchpad_platform: string
  creator_token_status: string
}

export function trenches(chain = 'sol', type = 'new_creation', filter = 'safe', limit = 40): TrenchItem[] {
  const out = run(['market', 'trenches', '--chain', chain, '--type', type, '--filter-preset', filter, '--limit', String(limit)])
  const d = parse<any>(out)
  const key = type === 'near_completion' ? 'pump' : type
  return d?.data?.[key] || []
}

export interface SMTrade {
  transaction_hash: string; maker: string; side: string
  base_address: string; amount_usd: string; price_usd: string
  timestamp: number; is_open_or_close: number
  base_token: { symbol: string; launchpad?: string }
  maker_info: { twitter_username?: string; tags?: string[] }
}

export function smartMoney(chain = 'sol', limit = 30): SMTrade[] {
  const out = run(['track', 'smartmoney', '--chain', chain, '--limit', String(limit)])
  const d = parse<{ list: SMTrade[] }>(out)
  return d?.list || []
}

export function kolTrades(chain = 'sol', limit = 30): SMTrade[] {
  const out = run(['track', 'kol', '--chain', chain, '--limit', String(limit)])
  const d = parse<{ list: SMTrade[] }>(out)
  return d?.list || []
}

export interface TokenInfo {
  address: string; symbol: string; name: string
  price: { price: string; volume_1h: string; hot_level: number }
  liquidity: string; holder_count: number
  launchpad_platform?: string
  total_supply: string; circulating_supply: string
}

export function tokenInfo(chain: string, address: string): TokenInfo | null {
  const out = run(['token', 'info', '--chain', chain, '--address', address])
  return parse<TokenInfo>(out)
}

export interface TokenSecurity {
  is_honeypot: string; rug_ratio: number; top_10_holder_rate: number
  creator_token_status: string; buy_tax: number; sell_tax: number
  owner_renounced: string; open_source: string
  sniper_count: number; is_wash_trading: boolean
}

export function tokenSecurity(chain: string, address: string): TokenSecurity | null {
  const out = run(['token', 'security', '--chain', chain, '--address', address])
  return parse<TokenSecurity>(out)
}

export interface PortfolioHolding {
  balance: string; usd_value: string
  accu_cost: string; realized_profit: string; unrealized_profit: string; total_profit: string
  realized_profit_pnl: string; unrealized_profit_pnl: string; total_profit_pnl: string
  history_total_buys: number; history_total_sells: number
  last_active_timestamp: number; start_holding_at: number
  token: {
    token_address: string; symbol: string; name: string
    price: string; liquidity: string; launchpad: string
  }
}

export interface PortfolioStats {
  wallet_address: string; native_balance: string
  realized_profit: string; realized_profit_pnl: string
  total_cost: string; last_timestamp: number
  pnl_stat: {
    token_num: number; winrate: number
    pnl_lt_nd5_num: number; pnl_nd5_0x_num: number
    pnl_0x_2x_num: number; pnl_2x_5x_num: number; pnl_gt_5x_num: number
    avg_holding_period: number
  }
  common?: { nick_name?: string; twitter_username?: string; fund_from?: string; followers_count?: number }
}

export function portfolioHoldings(chain: string, wallet: string, limit = 50): PortfolioHolding[] {
  const out = run(['portfolio', 'holdings', '--chain', chain, '--wallet', wallet, '--limit', String(limit), '--hide-closed', 'false'])
  const d = parse<{ list: PortfolioHolding[] }>(out)
  return d?.list || []
}

export function portfolioStats(chain: string, wallet: string): PortfolioStats | null {
  const out = run(['portfolio', 'stats', '--chain', chain, '--wallet', wallet])
  return parse<PortfolioStats>(out)
}

export function isConfigured(): boolean {
  try {
    execSync(`${CLI} config --check`, { encoding: 'utf-8', shell: 'pwsh.exe' })
    return true
  } catch { return false }
}
