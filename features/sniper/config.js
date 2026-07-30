const CONFIG = {
  sol: {
    rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    wss: process.env.SOLANA_WSS || 'wss://api.mainnet-beta.solana.com',
    pumpFunProgram: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    currency: 'So11111111111111111111111111111111111111112', // SOL (WSOL)
    currencyDecimals: 9,
    buyAmount: '0.3',
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
    ponsFactory: process.env.PONS_FACTORY || '0x0000000000000000000000000000000000000000',
    currency: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', // WETH
    currencyDecimals: 18,
    buyAmount: '0.02',
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
