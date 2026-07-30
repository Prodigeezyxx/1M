const { ethers } = require('ethers')
const { CONFIG } = require('./config')

function getWsProvider(chain) {
  const cfg = CONFIG[chain]
  if (!cfg.wss) return null
  try {
    return new ethers.WebSocketProvider(cfg.wss)
  } catch {
    return null
  }
}

function getHttpProvider(chain) {
  const cfg = CONFIG[chain]
  if (!cfg.rpc) return null
  return new ethers.JsonRpcProvider(cfg.rpc)
}

const PONS_FACTORY_ABI = [
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol)',
  'event PairCreated(address indexed token, address indexed pair, uint256)',
]

function startEthDetector(onDetect, onStatus) {
  const cfg = CONFIG.robinhood
  const provider = getWsProvider('robinhood') || getHttpProvider('robinhood')

  if (!provider) {
    onStatus({ chain: 'robinhood', status: 'error', error: 'No RPC configured. Set ROBINHOOD_RPC / ROBINHOOD_WSS.' })
    return { stop: () => {} }
  }

  const factoryAddr = cfg.ponsFactory
  const isPlaceholder = factoryAddr === '0x0000000000000000000000000000000000000000'
  const factoryContract = new ethers.Contract(factoryAddr, PONS_FACTORY_ABI, provider)

  let running = true

  function pollBlock() {
    if (!running) return
    // Poll-based fallback when WebSocket isn't available
  }

  if (provider instanceof ethers.WebSocketProvider) {
    onStatus({ chain: 'robinhood', status: 'connecting' })

    factoryContract.on('TokenCreated', (token, creator, name, symbol, event) => {
      if (!running) return
      onDetect({
        chain: 'robinhood',
        address: token,
        creator: creator,
        name: name,
        symbol: symbol,
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      })
    })

    factoryContract.on('PairCreated', (token, pair, event) => {
      if (!running) return
      onDetect({
        chain: 'robinhood',
        address: token,
        pair: pair,
        name: null,
        symbol: null,
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      })
    })

    provider._websocket.on('close', () => {
      onStatus({ chain: 'robinhood', status: 'disconnected' })
      if (running) setTimeout(startEthDetector.bind(null, onDetect, onStatus), 5000)
    })

    provider._websocket.on('error', (err) => {
      onStatus({ chain: 'robinhood', status: 'error', error: err.message })
    })

    onStatus({ chain: 'robinhood', status: 'listening', contract: factoryAddr })
  } else {
    // HTTP provider — not ideal for real-time detection
    onStatus({ chain: 'robinhood', status: 'http-poll', warning: 'HTTP fallback, no real-time' })
  }

  return {
    stop: () => {
      running = false
      if (provider instanceof ethers.WebSocketProvider) {
        factoryContract.removeAllListeners()
        provider.destroy()
      }
    },
    isPlaceholder,
  }
}

module.exports = { startEthDetector }
