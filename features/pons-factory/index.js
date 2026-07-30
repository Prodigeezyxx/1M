#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const { CONFIG } = require('./config')
const { generatePuppetWallets, saveWallets, loadWallets, bulkFund, getEthBalance, getProvider } = require('./wallet')
const { runCycle, pickName } = require('./cycle')
const { ethers } = require('ethers')

const WALLET_DIR = path.join(__dirname, '..', '..', '.wallets')
const PUPPET_FILE = path.join(WALLET_DIR, 'puppets.csv')

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }) }

async function cmdSetup() {
  ensureDir(WALLET_DIR)
  const count = CONFIG.puppets.count
  console.log(`Generating ${count} puppet wallets...`)
  console.log(`WARNING: These keys are stored in plaintext at ${PUPPET_FILE}`)
  console.log(`Only use these for small amounts (0.002 ETH each) you're willing to lose\n`)
  const wallets = generatePuppetWallets(count)
  saveWallets(wallets, PUPPET_FILE)
  wallets.forEach(w => console.log(`  [${w.index}] ${w.address}`))
  console.log(`\nNext: npm run factory:fund -- --from-pk <MASTER_PRIVATE_KEY>`)
}

async function cmdFund(fromPk) {
  const puppets = loadWallets(PUPPET_FILE)
  if (puppets.length === 0) { console.log('No puppets found. Run setup first.'); return }
  console.log(`Funding ${puppets.length} puppets with ${CONFIG.puppets.fundAmtEth} ETH each...`)
  const results = await bulkFund(fromPk, puppets, CONFIG.puppets.fundAmtEth)
  results.forEach(r => console.log(`  ${r.address} → ${r.tx}`))
  console.log('Funding complete.')
}

async function cmdBalances() {
  const provider = getProvider()
  try { await provider.getBlockNumber() } catch { console.log('RPC not reachable. Check ROBINHOOD_RPC env.'); return }
  const puppets = loadWallets(PUPPET_FILE)
  if (puppets.length === 0) { console.log('No puppets.'); return }
  for (const p of puppets) {
    const bal = await getEthBalance(p.address, provider)
    console.log(`  [${p.index}] ${p.address}  ${bal} ETH`)
  }
}

async function cmdRun(cycles, mainAddress, mainPk) {
  const puppets = loadWallets(PUPPET_FILE)
  if (puppets.length === 0) { console.log('No puppets. Run setup first.'); process.exit(1) }
  if (!mainAddress) { console.log('Provide --main <ADDRESS>'); process.exit(1) }

  const mainWallet = { address: mainAddress }

    for (let i = 0; i < cycles; i++) {
      try {
        await runCycle(mainWallet, puppets, i + 1, console.log)
      } catch (err) {
      console.error(`Cycle ${i + 1} failed: ${err.message}`)
    }
    if (i < cycles - 1) await new Promise(r => setTimeout(r, 3000))
  }
}

async function cmdSweep(toAddress) {
  if (!toAddress || !ethers.isAddress(toAddress)) { console.log('Provide valid --to <ADDRESS>'); return }
  const puppets = loadWallets(PUPPET_FILE)
  const provider = getProvider()
  let total = 0n
  for (const p of puppets) {
    const signer = new ethers.Wallet(p.privateKey, provider)
    const bal = await provider.getBalance(signer.address)
    const gasEst = (await provider.getFeeData()).gasPrice * 25000n
    const send = bal - gasEst
    if (send <= 0n) { console.log(`  [${p.index}] ${p.address} — ${ethers.formatEther(bal)} ETH (skip)`); continue }
    const tx = await signer.sendTransaction({ to: toAddress, value: send })
    await tx.wait()
    total += send
    console.log(`  [${p.index}] ${p.address} → ${ethers.formatEther(send)} ETH  tx:${tx.hash}`)
  }
  console.log(`\nSwept ${ethers.formatEther(total)} ETH total.`)
}

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]

  switch (cmd) {
    case 'setup':     await cmdSetup(); break
    case 'fund':      await cmdFund(extractVal(args, '--from-pk')); break
    case 'balances':  await cmdBalances(); break
    case 'run':       await cmdRun(extractNum(args, '--cycles') || 1, extractVal(args, '--main'), extractVal(args, '--main-pk')); break
    case 'sweep':     await cmdSweep(extractVal(args, '--to')); break
    default:
      console.log(`
PONS Token Factory — Orchestrator

COMMANDS:
  setup     Generate puppet wallets (saved to .wallets/puppets.csv)
  fund      Fund puppets from master wallet
              --from-pk <PRIVATE_KEY>
  run       Execute N P/D cycles
              --cycles N  --main <ADDRESS>
  balances  Check puppet ETH balances
  sweep     Sweep puppet ETH to harvest address
              --to <ADDRESS>

EXAMPLES:
  node features/pons-factory/index.js setup
  node features/pons-factory/index.js fund --from-pk 0x...
  node features/pons-factory/index.js run --cycles 10 --main 0x...
  node features/pons-factory/index.js sweep --to 0x...

ENV:
  ROBINHOOD_RPC       — Robinhood ETH RPC URL
  GMGN_ALLOW_AUTOMATED_TRADES=1  — Required for headless gmgn-cli
`)
  }
}

function extractVal(args, flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}
function extractNum(args, flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? parseInt(args[i + 1]) : null
}

main().catch(console.error)
