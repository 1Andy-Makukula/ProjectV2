#!/usr/bin/env bash
#
# Run the SQL migration tests against a throwaway PostgreSQL cluster.
#
# `pnpm typecheck` excludes supabase/ and Deno is not installed here, so
# migrations are otherwise covered by nothing. This is what covers them.
#
#   pnpm sql:test          # apply twice, then assert
#   pnpm sql:test --keep   # leave the cluster running afterwards
#
# Nothing here touches Supabase or any deployed database. The cluster lives in
# a temp directory and is destroyed on exit unless --keep is passed.
set -euo pipefail

PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/18/bin}"
PORT="${PGPORT_TEST:-54399}"
SCRATCH="${SCRATCH_DIR:-/c/Users/Owner/AppData/Local/Temp/kithlypg}"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

if [[ ! -x "$PGBIN/psql" ]]; then
  echo "No PostgreSQL at $PGBIN. Set PGBIN to your installation's bin directory." >&2
  exit 2
fi
export PATH="$PGBIN:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The migrations under test, in order. Add new ones here as stages land.
MIGRATIONS=(
  20260912060000_countries_and_holidays
  20260912070000_contact_groups
  20260912080000_shop_collections
  20260912090000_reco_signals
  20260913000000_notification_actions
  20260913010000_price_events_and_watches
  20260913020000_occasion_lead_times
  20260913030000_contact_tiers_and_preferences
  20260913040000_wallet_provenance_and_budgets
  20260913050000_checkout_respects_reservations
  20260914000000_item_governance_fields
  20260914010000_shop_vitality
  20260914020000_pulse
  20260914030000_composer
  20260914040000_record_signals
  20260914050000_restock_sweep
  20260914060000_reco_api
  20260914070000_slate_weights_and_kappa
  20260914080000_slate
  20260915000000_ledger_entries
  20260915010000_payout_destinations
  20260915020000_payout_instructions
  20260915030000_settlement_tiers
  20260915040000_escrow_funding_and_redemption
  20260915045000_fulfill_voucher_dual_write
  20260915050000_expiry_refunds_and_compensation
  20260915060000_fee_sweep_and_reconciliation
  20260915070000_retire_stored_value
)
SUITES=(
  assert_countries_and_holidays
  assert_contact_groups
  assert_shop_collections
  assert_reco_signals
  assert_price_watches
  assert_lead_times_and_preferences
  assert_budget_goals
  assert_shop_vitality
  assert_pulse
  assert_composer
  assert_restock_sweep
  assert_slate
  assert_escrow_ledger
  assert_escrow_lifecycle
  assert_escrow_cutover
)

cleanup() {
  if [[ $KEEP -eq 0 ]]; then
    pg_ctl -D "$SCRATCH/data" stop -m immediate >/dev/null 2>&1 || true
    rm -rf "$SCRATCH" 2>/dev/null || true
  else
    echo "Cluster left running on port $PORT."
  fi
}
trap cleanup EXIT

if ! pg_isready -h localhost -p "$PORT" >/dev/null 2>&1; then
  echo "Starting a throwaway cluster on port $PORT..."
  rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
  initdb -D "$SCRATCH/data" -U postgres -A trust -E UTF8 >/dev/null
  # unix_socket_directories is emptied deliberately: the scratch path exceeds
  # the 107-byte socket limit and the cluster will not start otherwise.
  pg_ctl -D "$SCRATCH/data" \
    -o "-p $PORT -c listen_addresses=localhost -c unix_socket_directories=" \
    -l "$SCRATCH/log" start >/dev/null
fi

P=(psql -h localhost -p "$PORT" -U postgres -d kithly -v ON_ERROR_STOP=1 -q)

psql -h localhost -p "$PORT" -U postgres -q \
  -c "DROP DATABASE IF EXISTS kithly;" -c "CREATE DATABASE kithly;"

"${P[@]}" -f tests/sql/scaffold.sql

# The shared date engine, taken from the migration that defines it rather than
# copied, so the tests exercise the shipped function.
sed -n '57,129p' supabase/migrations/20260904010000_occasion_reminders.sql | "${P[@]}"

# The voucher expiry clock, likewise taken from the migration that defines it.
# The escrow expiry sweep (20260915050000) reads it, and that migration is
# under test while the one defining this is not.
sed -n '118,138p' supabase/migrations/20260727030000_pricing_and_expiry_protocol.sql | "${P[@]}"

# Applied twice. Migrations get replayed, and a migration that only works once
# is a migration that fails in production.
for pass in 1 2; do
  for m in "${MIGRATIONS[@]}"; do
    "${P[@]}" -f "supabase/migrations/$m.sql" >/dev/null
  done
  echo "migrations applied (pass $pass)"
done

failed=0
passed=0
for s in "${SUITES[@]}"; do
  out="$(psql -h localhost -p "$PORT" -U postgres -d kithly -f "tests/sql/$s.sql" 2>&1 || true)"
  n=$(grep -c "PASS:" <<<"$out" || true)
  e=$(grep -cE "FAIL:|^psql.*ERROR" <<<"$out" || true)
  passed=$((passed + n)); failed=$((failed + e))
  printf '  %-34s %2d passed  %d failed\n' "$s" "$n" "$e"
  [[ $e -gt 0 ]] && grep -E "FAIL:|ERROR" <<<"$out" | sed 's/^/      /'
done

echo
echo "  TOTAL: $passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
