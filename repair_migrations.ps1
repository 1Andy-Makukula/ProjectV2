
# ── Supabase Migration Repair + Push ─────────────────────────────────────────
# Run this once from your project root to sync the migration history and push
# the 3 local migrations (20260725*) to the remote database.
#
# Usage:  .\repair_migrations.ps1
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

Write-Host "`n[1/3] Marking dashboard-only migrations as reverted..." -ForegroundColor Cyan

$toRevert = @(
  "20260525120000",
  "20260525130000",
  "20260525140000",
  "20260526140000",
  "20260530190000",
  "20260601000000",
  "20260605000000",
  "20260606000000",
  "20260610000000",
  "20260611000000",
  "20260612000000",
  "20260613000000",
  "20260613010000",
  "20260614000000",
  "20260614100000",
  "20260614200000",
  "20260615000000",
  "20260615010000",
  "20260616000000",
  "20260616010000",
  "20260620000000",
  "20260628000000"
)

foreach ($version in $toRevert) {
  Write-Host "  Reverting $version ..."
  npx supabase migration repair --status reverted $version
}

Write-Host "`n[2/3] Pushing the 3 local migrations to remote..." -ForegroundColor Cyan
npx supabase db push

Write-Host "`n[3/3] Done! Check output above for any errors." -ForegroundColor Green
