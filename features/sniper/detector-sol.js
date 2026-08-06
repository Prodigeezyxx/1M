const { Connection, PublicKey } = require('@solana/web3.js')
const { CONFIG } = require('./config')

const pumpProgramId = new PublicKey(CONFIG.sol.pumpFunProgram)
const pumpProgram = CONFIG.sol.pumpFunProgram

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function extractMintFromTx(connection, signature) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      if (tx && !tx.meta?.err) {
        const instructions = [
          ...(tx.transaction.message.instructions || []),
          ...((tx.meta?.innerInstructions || []).flatMap(group => group.instructions)),
        ]
        for (const instruction of instructions) {
          if (instruction.programId?.toBase58?.() !== pumpProgram) continue
          if (!Array.isArray(instruction.accounts) || instruction.accounts.length === 0) continue
          return instruction.accounts[0].toBase58()
        }
      }
    } catch {}
    if (attempt < 5) await sleep(150)
  }
  return null
}

function startSolDetector(onDetect, onStatus) {
  const connection = new Connection(CONFIG.sol.rpc, {
    wsEndpoint: CONFIG.sol.wss,
    commitment: 'processed',
  })

  let running = true
  let subId = null
  let errorCount = 0
  const inFlight = new Set()

  async function resolveAndEmit(signature, slot) {
    if (inFlight.has(signature)) return
    inFlight.add(signature)
    try {
      const address = await extractMintFromTx(connection, signature)
      if (!address) {
        onStatus({ chain: 'sol', status: 'extract-miss', signature })
        return
      }
      onDetect({ chain: 'sol', signature, slot, address, source: 'ws' })
    } finally {
      inFlight.delete(signature)
    }
  }

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
          const isCreate = logStr.includes('Instruction: Create') || logStr.includes('Instruction: create')

          if (!isCreate) return
          resolveAndEmit(logs.signature, context.slot).catch(() => {})
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

module.exports = { startSolDetector }
