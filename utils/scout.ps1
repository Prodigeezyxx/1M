# GMGN Trading Agent — Market Scout
# Run: pwsh utils/scout.ps1
# Scans trending, new trenches, and smart money buys for a quick market overview

param(
  [string]$chain = "sol",
  [int]$trendingLimit = 20,
  [int]$trenchLimit = 20,
  [int]$smartMoneyLimit = 10
)

Write-Host "`n=== GMGN Market Scout ===`n" -ForegroundColor Cyan

Write-Host "[1/3] Trending ($chain, 5m)..." -ForegroundColor Yellow
gmgn-cli market trending --chain $chain --interval 5m --order-by volume --limit $trendingLimit --raw 2>$null | ConvertFrom-Json | ForEach-Object { $_.data.rank } | Select-Object -First 5 | ForEach-Object {
  Write-Host "  $($_.symbol)  Vol: `$$([math]::Round([double]$_.volume))  MC: `$$([math]::Round([double]$_.market_cap))  SM: $($_.smart_degen_count)" -ForegroundColor Green
}

Write-Host "`n[2/3] New Trenches ($chain)..." -ForegroundColor Yellow
gmgn-cli market trenches --chain $chain --type new_creation --filter-preset safe --limit $trenchLimit --raw 2>$null | ConvertFrom-Json | ForEach-Object { $_.data.new_creation } | Select-Object -First 5 | ForEach-Object {
  Write-Host "  $($_.symbol)  MC: `$$([math]::Round([double]$_.usd_market_cap))  SM: $($_.smart_degen_count)  Rug: $($_.rug_ratio)" -ForegroundColor Green
}

Write-Host "`n[3/3] Smart Money Buys ($chain)..." -ForegroundColor Yellow
gmgn-cli track smartmoney --chain $chain --side buy --limit $smartMoneyLimit --raw 2>$null | ConvertFrom-Json | ForEach-Object { $_.list } | Select-Object -First 5 | ForEach-Object {
  Write-Host "  $($_.base_token.symbol)  `$$([math]::Round([double]$_.amount_usd))  by $($_.maker_info.twitter_username)" -ForegroundColor Green
}

Write-Host "`n=== Scout Complete ===`n" -ForegroundColor Cyan
