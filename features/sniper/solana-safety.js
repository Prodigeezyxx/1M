const { Connection, PublicKey } = require('@solana/web3.js')
const {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  getMint,
} = require('@solana/spl-token')
const { CONFIG } = require('./config')

const connection = new Connection(CONFIG.sol.rpc, 'confirmed')
const allowedToken2022Extensions = new Set([
  ExtensionType.Uninitialized,
  ExtensionType.ImmutableOwner,
  ExtensionType.MetadataPointer,
  ExtensionType.TokenMetadata,
  ExtensionType.GroupPointer,
  ExtensionType.TokenGroup,
  ExtensionType.GroupMemberPointer,
  ExtensionType.TokenGroupMember,
])

async function checkSolMint(address) {
  try {
    const mintAddress = new PublicKey(address)
    const account = await connection.getAccountInfo(mintAddress, 'confirmed')
    if (!account) return { pass: false, reason: 'mint_account_unavailable' }

    const isLegacy = account.owner.equals(TOKEN_PROGRAM_ID)
    const isToken2022 = account.owner.equals(TOKEN_2022_PROGRAM_ID)
    if (!isLegacy && !isToken2022) return { pass: false, reason: 'unknown_token_program' }

    const mint = await getMint(
      connection,
      mintAddress,
      'confirmed',
      isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    )
    if (mint.mintAuthority !== null) return { pass: false, reason: 'mint_authority_active' }
    if (mint.freezeAuthority !== null) return { pass: false, reason: 'freeze_authority_active' }

    if (isToken2022) {
      const extensions = getExtensionTypes(mint.tlvData)
      const risky = extensions.filter(extension => !allowedToken2022Extensions.has(extension))
      if (risky.length > 0) {
        const names = risky.map(extension => ExtensionType[extension] || String(extension))
        return { pass: false, reason: `risky_token2022:${names.join('|')}` }
      }
    }

    return { pass: true, standard: isToken2022 ? '2022' : 'spl' }
  } catch {
    return { pass: false, reason: 'mint_security_unavailable' }
  }
}

module.exports = { checkSolMint }
