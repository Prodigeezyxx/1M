const EventEmitter = require('events')
const path = require('path')
const fs = require('fs')
const { ethers } = require('ethers')
const { CONFIG } = require('./config')
const { generatePuppetWallets, saveWallets, loadWallets, bulkFund, getEthBalance, getProvider } = require('./wallet')
const { runCycle } = require('./cycle')

const WALLET_DIR = path.join(__dirname, '..', '..', '.wallets')
const PUPPET_FILE = path.join(WALLET_DIR, 'puppets.csv')

class FactoryServerAdapter extends EventEmitter {
  constructor() {
    super()
    this.running = false
    this.stats = { cycles: 0, wins: 0, losses: 0 }
  }

  log(msg) {
    this.emit('log', String(msg))
  }

  async setup() {
    if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR, { recursive: true })
    const count = CONFIG.puppets.count
    this.log(`Generating ${count} puppet wallets...`)
    this.log(`WARNING: Keys stored in plaintext at ${PUPPET_FILE}`)
    const wallets = generatePuppetWallets(count)
    saveWallets(wallets, PUPPET_FILE)
    wallets.forEach(w => this.log(`  [${w.index}] ${w.address}`))
    this.log('Setup complete.')
    return wallets
  }

  async fund(fromPk) {
    const puppets = loadWallets(PUPPET_FILE)
    if (!puppets.length) { this.log('No puppets found. Run setup first.'); return [] }
    this.log(`Funding ${puppets.length} puppets with ${CONFIG.puppets.fundAmtEth} ETH each...`)
    const results = await bulkFund(fromPk, puppets, CONFIG.puppets.fundAmtEth)
    results.forEach(r => this.log(`  ${r.address} → ${r.tx}`))
    this.log('Funding complete.')
    return results
  }

  async getBalances() {
    const provider = getProvider()
    try { await provider.getBlockNumber() } catch { this.log('RPC not reachable.'); return [] }
    const puppets = loadWallets(PUPPET_FILE)
    const results = []
    for (const p of puppets) {
      const bal = await getEthBalance(p.address, provider)
      results.push({ index: p.index, address: p.address, balance: bal })
      this.log(`  [${p.index}] ${p.address}  ${bal} ETH`)
    }
    return results
  }

  async run(cycles, mainAddress) {
    if (this.running) { this.log('Factory is already running.'); return }
    this.running = true
    const puppets = loadWallets(PUPPET_FILE)
    if (!puppets.length) { this.log('No puppets. Run setup first.'); this.running = false; return }

    try {
      for (let i = 0; i < cycles; i++) {
        this.log(`\n=== CYCLE ${i + 1}/${cycles} ===`)
        const mainWallet = { address: mainAddress }
        const result = await runCycle(mainWallet, puppets, i + 1, (msg) => this.log(msg))
        this.stats.cycles++
        this.stats.wins++
        this.emit('cycle-complete', result)
        if (i < cycles - 1) await new Promise(r => setTimeout(r, 3000))
      }
      this.log('\nAll cycles complete.')
    } catch (err) {
      this.log(`\nFatal error: ${err.message}`)
    }
    this.running = false
    this.emit('done')
  }

  async sweep(toAddress) {
    const puppets = loadWallets(PUPPET_FILE)
    const provider = getProvider()
    let total = 0n
    for (const p of puppets) {
      const signer = new ethers.Wallet(p.privateKey, provider)
      const bal = await provider.getBalance(signer.address)
      const gasEst = (await provider.getFeeData()).gasPrice * 25000n
      const send = bal - gasEst
      if (send <= 0n) { this.log(`  [${p.index}] ${p.address} — ${ethers.formatEther(bal)} ETH (skip)`); continue }
      const tx = await signer.sendTransaction({ to: toAddress, value: send })
      await tx.wait()
      total += send
      this.log(`  [${p.index}] ${p.address} → ${ethers.formatEther(send)} ETH  tx:${tx.hash}`)
    }
    this.log(`\nSwept ${ethers.formatEther(total)} ETH total.`)
    return total
  }

  getStatus() {
    const walletsExist = fs.existsSync(PUPPET_FILE)
    const puppetCount = walletsExist ? loadWallets(PUPPET_FILE).length : 0
    return {
      running: this.running,
      puppets: puppetCount,
      walletsExist,
      stats: this.stats,
      config: {
        chain: CONFIG.chain,
        dex: CONFIG.dex,
        buyAmt: CONFIG.launch.buyAmt,
        puppetCount: CONFIG.puppets.count,
        fundAmt: CONFIG.puppets.fundAmtEth,
        holdSec: CONFIG.timing.lpHoldSec,
      },
    }
  }
}

let instance = null
function getAdapter() {
  if (!instance) instance = new FactoryServerAdapter()
  return instance
}

module.exports = { FactoryServerAdapter, getAdapter }
