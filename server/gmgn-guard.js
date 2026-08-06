const fs = require('fs')
const path = require('path')

const STATE_FILE = path.join(__dirname, '.gmgn-cooldown.json')

let cooldownUntil = 0
try {
  if (fs.existsSync(STATE_FILE)) {
    cooldownUntil = Number(fs.readFileSync(STATE_FILE, 'utf-8')) || 0
  }
} catch { cooldownUntil = 0 }

function persist() {
  try { fs.writeFileSync(STATE_FILE, String(cooldownUntil)) } catch {}
}

function inCooldown(now = Date.now()) { return now < cooldownUntil }

function setCooldownUntil(ts) { cooldownUntil = Math.max(cooldownUntil, ts); persist() }

function noteError(err, stderr = '') {
  if (/429|RATE_LIMIT/i.test(`${err?.message || ''} ${stderr}`)) {
    const m = `${stderr}`.match(/resets at (.+?) \(/i)
    const ts = m && Number.isFinite(Date.parse(m[1])) ? Date.parse(m[1]) : Date.now() + 60000
    setCooldownUntil(ts)
    return true
  }
  return false
}

function cooldownState() {
  const now = Date.now()
  return { active: now < cooldownUntil, resetsInMs: Math.max(0, cooldownUntil - now), resetsAt: cooldownUntil || null }
}

module.exports = { inCooldown, setCooldownUntil, noteError, cooldownState }