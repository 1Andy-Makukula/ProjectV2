-- Drop the V1 atomic_fulfill_voucher(character varying, uuid) overload.
-- It references public.claim_vouchers, a table that no longer exists in
-- the V2 schema, and its (varchar, uuid) signature is ambiguous against
-- the live atomic_fulfill_voucher(text, uuid) overload for JSON-string
-- callers (e.g. ussd-gateway), risking a runtime failure if Postgres ever
-- resolves an RPC call to this dead overload instead.

DROP FUNCTION IF EXISTS "public"."atomic_fulfill_voucher"("p_claim_code" character varying, "p_shop_id" "uuid");
