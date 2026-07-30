# GMGN Trading Agent — Quick Token Check
# Run: pwsh utils/check-token.ps1 -chain sol -address <TOKEN_ADDRESS>
# Runs info + security + pool in one shot

param(
  [Parameter(Mandatory=$true)]
  [string]$chain,
  [Parameter(Mandatory=$true)]
  [string]$address
)

Write-Host "`n=== Token Security Check ===`n" -ForegroundColor Cyan

Write-Host "[1/3] Token Info..." -ForegroundColor Yellow
$info = gmgn-cli token info --chain $chain --address $address --raw 2>$null | ConvertFrom-Json
Write-Host "  $($info.symbol) ($($info.name))" -ForegroundColor White
Write-Host "  Price: `$$($info.price.price)  Liq: `$$([math]::Round([double]$info.liquidity))  Holders: $($info.holder_count)"

Write-Host "`n[2/3] Security Audit..." -ForegroundColor Yellow
$sec = gmgn-cli token security --chain $chain --address $address --raw 2>$null | ConvertFrom-Json
Write-Host "  Honeypot: $($sec.is_honeypot)" -ForegroundColor $(if ($sec.is_honeypot -eq "yes") { "Red" } else { "Green" })
Write-Host "  Rug Ratio: $($sec.rug_ratio)" -ForegroundColor $(if ([double]$sec.rug_ratio -gt 0.3) { "Red" } elseif ([double]$sec.rug_ratio -gt 0.1) { "Yellow" } else { "Green" })
Write-Host "  Top10 Holder Rate: $([math]::Round([double]$sec.top_10_holder_rate * 100, 1))%"
Write-Host "  Dev Status: $($sec.creator_token_status)"
Write-Host "  Smart Money: $($sec.smart_degen_count)  KOL: $($sec.renowned_count)"

Write-Host "`n[3/3] Pool Info..." -ForegroundColor Yellow
$pool = gmgn-cli token pool --chain $chain --address $address --raw 2>$null | ConvertFrom-Json
Write-Host "  DEX: $($pool.exchange)  Liq: `$$([math]::Round([double]$pool.liquidity))"

Write-Host "`n=== Check Complete ===`n" -ForegroundColor Cyan
