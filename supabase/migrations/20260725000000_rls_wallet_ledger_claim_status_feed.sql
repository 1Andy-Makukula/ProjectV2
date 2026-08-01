-- Enable RLS on wallet_ledger and claim_status_feed.
-- Both tables were added in the 2026-07 schema alignment but were left
-- without RLS, so any authenticated client could read every user's
-- wallet_ledger rows (financial transaction history).

ALTER TABLE "public"."wallet_ledger" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_ledger_select_own" ON "public"."wallet_ledger"
  FOR SELECT TO "authenticated"
  USING (
    (EXISTS (
      SELECT 1 FROM "public"."kithly_wallets" "kw"
      WHERE "kw"."id" = "wallet_ledger"."wallet_id"
        AND "kw"."user_id" = "auth"."uid"()
    ))
    OR ("public"."current_user_role"() = 'admin'::"text")
  );

ALTER TABLE "public"."claim_status_feed" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claim_status_feed_public_read" ON "public"."claim_status_feed"
  FOR SELECT TO "authenticated", "anon"
  USING (true);
