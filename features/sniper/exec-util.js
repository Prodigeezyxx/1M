const { exec } = require('child_process')

function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
      ...opts,
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
        return
      }
      resolve(stdout)
    })
  })
}

function errorText(err) {
  return [err?.message, err?.stderr, err?.stdout].filter(Boolean).join(' ')
}

function isAuthError(err) {
  return /AUTH_SIGNATURE_INVALID|signature invalid/i.test(errorText(err))
}

module.exports = { execAsync, errorText, isAuthError }
