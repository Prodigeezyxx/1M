const CONFIG = {
  chain: 'robinhood',
  dex: 'pons',
  weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',

  launch: {
    buyAmt: '2.475',
    dexFee: '0.025',
    supply: '1000000000',
    decimals: 18,
  },

  bagBuy: {
    percentOfSupply: 0.646,
    quoteToken: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  },

  puppets: {
    count: 8,
    fundAmtEth: '0.002',
    buyRange: { min: 5000, max: 12000 },
    buyStaggerMs: 8000,
    exitLossPct: 91,
  },

  pump: {
    expectedAthMc: { min: 30000, max: 47000 },
    floorMc: 2500,
    lpReturn: { min: 10000, max: 14000 },
  },

  timing: {
    puppetBuyWindowSec: 60,
    lpHoldSec: 180,
    puppetSellDelaySec: 300,
    gasBetweenTxsMs: 500,
  },

  rpc: {
    robinhood: 'https://robinhood.rpc.url', // override via env
  },

  namePool: [
    'NAVEN','CRAMER','QUANT','CashDog','CCARDS',
    'BUY','FLAY','TA','Guy','PIPEDOG','RODINO',
    'SBS','RWI','ELO','MM','MarketCat',
  ],
}

module.exports = { CONFIG }
