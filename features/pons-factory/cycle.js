const { execSync } = require('child_process')
const { ethers } = require('ethers')
const { CONFIG } = require('./config')
const { puppetsBuy, puppetsSell } = require('./puppets')

function gmgnRaw(args) {
  const cmd = `gmgn-cli ${args} --raw`
  const out = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  return JSON.parse(out)
}

function gmgn(args) {
  const cmd = `gmgn-cli ${args}`
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
}

function pickName(usedNames) {
  const available = CONFIG.namePool.filter(n => !usedNames.includes(n))
  if (available.length === 0) return CONFIG.namePool[0]
  return available[Math.floor(Math.random() * available.length)]
}

function pickSymbol(name) {
  return name.toUpperCase().slice(0, 6)
}

async function stepCreateToken(mainWallet, name, symbol, log) {
  const args = `cooking create --chain ${CONFIG.chain} --dex ${CONFIG.dex} --from ${mainWallet.address} --name "${name}" --symbol ${symbol} --buy-amt ${CONFIG.launch.buyAmt} --auto-slippage --yes`
  log(`  creating token ${name} (${symbol})...`)
  const raw = execSync(`gmgn-cli ${args}`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  const resp = JSON.parse(raw)
  if (resp.error_code) throw new Error(`create failed: ${resp.error_status}`)

  const orderId = resp.order_id
  let tokenAddress = null
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 2000))
    const status = gmgnRaw(`order get --chain ${CONFIG.chain} --order-id ${orderId}`)
    if (status.status === 'confirmed' || status.state === 30) {
      tokenAddress = status.report?.output_token
      break
    }
    if (status.status === 'failed' || status.status === 'expired') {
      throw new Error(`create failed: ${status.error_status || status.status}`)
    }
  }
  if (!tokenAddress) throw new Error('token not created within 60s')
  log(`  token: ${tokenAddress} | bag: 646M tokens (64.6%) bought at launch`)

  const poolInfo = gmgnRaw(`token pool --chain ${CONFIG.chain} --address ${tokenAddress}`)
  log(`  pool: ${poolInfo.pool_address || poolInfo.address} | liq: $${parseFloat(poolInfo.liquidity || 0).toFixed(0)}`)

  return { tokenAddress, poolAddress: poolInfo.pool_address || poolInfo.address }
}

async function stepPuppetsBuy(puppets, tokenAddress, log) {
  log(`  puppets buying (${CONFIG.timing.puppetBuyWindowSec}s window)...`)
  await puppetsBuy(puppets, tokenAddress, log)
}

async function stepWait(sec, label, log) {
  log(`  waiting ${sec}s (${label})...`)
  await new Promise(r => setTimeout(r, sec * 1000))
}

async function stepDustCheck(mainWallet, tokenAddress, log) {
  log(`  dust-check (sell 1 wei)...`)
  try {
    gmgn(`swap --chain ${CONFIG.chain} --from ${mainWallet.address} --input-token ${tokenAddress} --output-token ${CONFIG.weth} --amount 1 --auto-slippage --yes`)
  } catch (e) {
    log(`  dust-check failed (expected): ${e.message.slice(0, 80)}`)
  }
}

async function stepSellBag(mainWallet, tokenAddress, log) {
  log(`  main wallet selling bag...`)
  const cmd = `swap --chain ${CONFIG.chain} --from ${mainWallet.address} --input-token ${tokenAddress} --output-token ${CONFIG.weth} --percent 100 --auto-slippage --yes`
  try {
    gmgn(cmd)
  } catch (e) {
    log(`  bag sell failed: ${e.message.slice(0, 80)}`)
    log(`  trying partial sell...`)
    gmgn(`swap --chain ${CONFIG.chain} --from ${mainWallet.address} --input-token ${tokenAddress} --output-token ${CONFIG.weth} --percent 50 --auto-slippage --yes`)
  }
}

async function stepPuppetsSell(puppets, tokenAddress, log) {
  log(`  puppets dumping at -${CONFIG.puppets.exitLossPct}%...`)
  await puppetsSell(puppets, tokenAddress, log)
}

async function runCycle(mainWallet, puppets, cycleNum, log) {
  log = log || console.log
  const name = pickName([])
  const symbol = pickSymbol(name)
  log(`\n=== CYCLE ${cycleNum}: ${name} (${symbol}) ===`)

  const { tokenAddress, poolAddress } = await stepCreateToken(mainWallet, name, symbol, log)

  await stepDustCheck(mainWallet, tokenAddress, log)
  await stepPuppetsBuy(puppets, tokenAddress, log)
  await stepWait(CONFIG.timing.lpHoldSec, 'pump window', log)

  log(`  ----- LP REMOVAL -----`)
  log(`  pool: ${poolAddress}`)
  log(`  LP must be removed via direct RPC call to PONS pool contract`)
  log(`  ----------------------`)

  await stepSellBag(mainWallet, tokenAddress, log)
  await stepPuppetsSell(puppets, tokenAddress, log)

  log(`=== CYCLE ${cycleNum} COMPLETE: ${name} ===`)
  return { name, symbol, tokenAddress, poolAddress }
}

module.exports = { runCycle, pickName, pickSymbol }
