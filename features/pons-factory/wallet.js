const { ethers } = require('ethers')
const { CONFIG } = require('./config')

function getProvider() {
  const rpc = process.env.ROBINHOOD_RPC || CONFIG.rpc.robinhood
  return new ethers.JsonRpcProvider(rpc)
}

function generateWallet() {
  return ethers.Wallet.createRandom()
}

async function getEthBalance(address, provider) {
  const bal = await provider.getBalance(address)
  return ethers.formatEther(bal)
}

async function fundWallet(fromSigner, toAddress, amountEth) {
  const tx = await fromSigner.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(amountEth),
  })
  return tx.wait()
}

async function bulkFund(fromPk, wallets, amountEth) {
  const provider = getProvider()
  const fromSigner = new ethers.Wallet(fromPk, provider)
  const results = []
  for (const w of wallets) {
    const receipt = await fundWallet(fromSigner, w.address, amountEth)
    results.push({ address: w.address, tx: receipt.hash })
    await new Promise(r => setTimeout(r, CONFIG.timing.gasBetweenTxsMs))
  }
  return results
}

function generatePuppetWallets(count) {
  const wallets = []
  for (let i = 0; i < count; i++) {
    const w = generateWallet()
    wallets.push({
      index: i,
      address: w.address,
      privateKey: w.privateKey,
    })
  }
  return wallets
}

function saveWallets(wallets, filePath) {
  const fs = require('fs')
  const data = wallets.map(w => `${w.index},${w.address},${w.privateKey}`).join('\n')
  fs.writeFileSync(filePath, data, 'utf-8')
}

function loadWallets(filePath) {
  const fs = require('fs')
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, 'utf-8').trim().split('\n').map(line => {
    const [index, address, privateKey] = line.split(',')
    return { index: parseInt(index), address, privateKey }
  })
}

module.exports = {
  getProvider,
  generateWallet,
  getEthBalance,
  fundWallet,
  bulkFund,
  generatePuppetWallets,
  saveWallets,
  loadWallets,
}
