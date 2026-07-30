const { execSync } = require('child_process')
const { ethers } = require('ethers')
const { CONFIG } = require('./config')
const { getProvider } = require('./wallet')

function swapFromWallet(wallet, tokenAddress, amount, side, log) {
  const isBuy = side === 'buy'
  const input = isBuy ? CONFIG.weth : tokenAddress
  const output = isBuy ? tokenAddress : CONFIG.weth
  const cmd = `gmgn-cli swap`
    + ` --chain ${CONFIG.chain}`
    + ` --from ${wallet.address}`
    + ` --input-token ${input}`
    + ` --output-token ${output}`
    + ` --amount ${amount}`
    + ` --auto-slippage`
    + ` --yes`
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
}

function swapPercent(wallet, tokenAddress, pct, log) {
  const cmd = `gmgn-cli swap`
    + ` --chain ${CONFIG.chain}`
    + ` --from ${wallet.address}`
    + ` --input-token ${tokenAddress}`
    + ` --output-token ${CONFIG.weth}`
    + ` --percent ${pct}`
    + ` --auto-slippage`
    + ` --yes`
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
}

async function puppetsBuy(puppets, tokenAddress, log) {
  log = log || console.log
  for (let i = 0; i < puppets.length; i++) {
    const amount = Math.floor(
      CONFIG.puppets.buyRange.min
      + Math.random() * (CONFIG.puppets.buyRange.max - CONFIG.puppets.buyRange.min)
    )
    const minUnit = ethers.parseUnits(amount.toString(), CONFIG.launch.decimals).toString()
    log(`  [puppet ${i}] buying ${amount} tokens...`)
    swapFromWallet(puppets[i], tokenAddress, minUnit, 'buy')
    if (i < puppets.length - 1) {
      await new Promise(r => setTimeout(r, CONFIG.puppets.buyStaggerMs))
    }
  }
}

async function puppetsSell(puppets, tokenAddress, log) {
  log = log || console.log
  for (let i = 0; i < puppets.length; i++) {
    log(`  [puppet ${i}] selling 100%...`)
    swapPercent(puppets[i], tokenAddress, 100)
    if (i < puppets.length - 1) {
      await new Promise(r => setTimeout(r, CONFIG.timing.gasBetweenTxsMs))
    }
  }
}

module.exports = {
  puppetsBuy,
  puppetsSell,
  swapFromWallet,
}
