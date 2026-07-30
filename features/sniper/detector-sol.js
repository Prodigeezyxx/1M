const { Connection, PublicKey, LogLevel } = require('@solana/web3.js')
const { CONFIG } = require('./config')

const pumpProgramId = new PublicKey(CONFIG.sol.pumpFunProgram)

function startSolDetector(onDetect, onStatus) {
  const connection = new Connection(CONFIG.sol.rpc, {
    wsEndpoint: CONFIG.sol.wss,
    commitment: 'processed',
  })

  let running = true
  let subId = null
  let errorCount = 0

  async function subscribe() {
    if (!running) return

    try {
      subId = connection.onLogs(
        pumpProgramId,
        (logs, context) => {
          if (!running) return
          errorCount = 0

          if (logs.err) return

          const logStr = logs.logs.join(' ')
          const sig = logs.signature

          // Pump.fun create emits specific program data
          // Look for "Program return:" or "Instruction: create" patterns
          const isCreate = logStr.includes('Instruction: create')
            || logStr.includes('Program return: ')
            || (logStr.includes('initialize') && logStr.includes('mint'))

          if (!isCreate) return

          // Best-effort extraction — real production uses getTransaction to parse
          onDetect({
            chain: 'sol',
            signature: sig,
            slot: context.slot,
            address: extractMint(logs.logs, sig),
            name: '[parsing via tx]',
            symbol: '[parsing via tx]',
            rawLogs: logs.logs,
          })
        },
        'processed'
      )

      onStatus({ chain: 'sol', status: 'listening', subId })

    } catch (err) {
      errorCount++
      onStatus({ chain: 'sol', status: 'error', error: err.message, attempt: errorCount })
      if (running && errorCount < 10) {
        setTimeout(subscribe, Math.min(5000 * errorCount, 60000))
      }
    }
  }

  subscribe()

  return {
    stop: () => {
      running = false
      if (subId !== null) {
        connection.removeOnLogsListener(subId).catch(() => {})
      }
    },
  }
}

// Best-effort mint extraction from raw logs
function extractMint(logs, sig) {
  for (const line of logs) {
    // Pattern: Program log: mint: <address>  or  Program return: ... <address>
    const mintMatch = line.match(/mint:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/)
    if (mintMatch) return mintMatch[1]
  }
  return sig ? `sig:${sig.slice(0, 8)}` : 'unknown'
}

module.exports = { startSolDetector }
