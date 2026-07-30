const CONFIG = {
  profitPercent: 0.50,
  usdc: {
    sol: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    robinhood: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  sol: {
    rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  },
  robinhood: {
    rpc: process.env.ROBINHOOD_RPC || '',
  },
  maxTradesTracked: 200,
}

module.exports = { CONFIG }
