const CONFIG = {
  sol: {
    rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    wss: process.env.SOLANA_WSS || 'wss://api.mainnet-beta.solana.com',
    pumpFunProgram: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    currency: 'So11111111111111111111111111111111111111112', // SOL (WSOL)
    currencyDecimals: 9,
    buyAmount: '0.05',
    maxBuyAmount: '0.1',
    maxSlippage: 25,
    jitoTip: '0.005',
    filter: {
      maxNameLength: 30,
      allowedSymbolPattern: /^[A-Za-z0-9]{2,10}$/,
      blockedKeywords: ['claim','airdrop','free','mint','presale','scam'],
    },
  },

  robinhood: {
    rpc: process.env.ROBINHOOD_RPC || '',
    wss: process.env.ROBINHOOD_WSS || '',
    ponsFactory: process.env.PONS_FACTORY || '0x5c6fdf3883c80555c5c2a1a99897d01b2e311a13',
    currency: '0x0000000000000000000000000000000000000000', // native ETH
    currencyDecimals: 18,
    buyAmount: '0.005',
    maxBuyAmount: '0.01',
    maxSlippage: 20,
    filter: {
      blockedKeywords: ['claim','airdrop','test','honeypot'],
    },
  },

  crossChain: {
    maxBuyPerMinute: 3,
    cooldownMs: 2000,
    buyStaggerMs: 500,
    maxRecentTokens: 100,
  },
}

module.exports = { CONFIG }
