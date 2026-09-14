-- =============================================================================
-- gen_claim_code: draw from a CSPRNG, not random()
--
-- WHY THIS IS SEPARATE FROM THE ESCROW WORK
-- -----------------------------------------
-- This exact fix was first written inside
-- 20260915040000_escrow_funding_and_redemption.sql, which is staged behind
-- `escrow_mode` and is not cut over. That coupled the single most urgent
-- security fix in the schema to a workstream that is deliberately not
-- shipping yet -- so the fix could not land without the rebuild landing with
-- it.
--
-- It is lifted here verbatim so it ships on its own. 20260915040000 declares
-- the same body with the same signature; when the escrow work does land it
-- replaces this definition with an identical one, which is a no-op. Applying
-- either order, or both, yields the same function.
--
-- THE DEFECT
-- ----------
-- The definition in 20260525130000_v2_atomic_money_rpcs.sql builds the code
-- one character at a time from `random()`:
--
--     result := result || substr(alphabet, (floor(random() * 36)::INTEGER + 1), 1);
--
-- `random()` is a seeded, non-cryptographic PRNG. Its sequence is fully
-- determined by the session seed, so observing a handful of codes issued by a
-- busy shop is enough to reconstruct that state and predict the rest.
--
-- A claim code is a bearer instrument. Whoever presents it collects goods
-- someone else paid for. It has to be unguessable, and this one was not.
--
-- THE SOURCE
-- ----------
-- `gen_random_uuid()` is backed by `pg_strong_random`, the same CSPRNG that
-- `gen_random_bytes` uses, and unlike `gen_random_bytes` it lives in core
-- rather than pgcrypto -- so this needs no extension and behaves identically
-- on a bare cluster and on Supabase.
--
-- Rejection sampling, not modulo. 256 is not a multiple of 36, so a plain
-- `% 36` would make the first four letters of the alphabet ~14% more likely
-- than the rest. Small, but a bias in a bearer token is still a bias, so
-- bytes at or above 252 (the largest multiple of 36) are discarded.
--
-- BLAST RADIUS
-- ------------
-- Signature unchanged: gen_claim_code(integer) -> text. CREATE OR REPLACE,
-- not DROP + CREATE, so the existing ACL survives -- a DROP here is how this
-- project once re-granted a money function to `authenticated` unnoticed.
--
-- Callers, all unaffected because the contract is identical (8 or 6 uppercase
-- alphanumerics): checkout_init_atomic (every migration that has redefined
-- it), create_list_with_slug, and ensure_transaction_code via
-- 20260807060000. Output still matches the existing CHECK constraints,
-- including transactions_public_code_check's '^MULT-[A-Z0-9]{6}$'.
--
-- Already-issued codes are not rotated. They were drawn from a weak source
-- and remain weak; they age out with their vouchers. Rotating live claim
-- codes would invalidate gifts already delivered to recipients.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gen_claim_code(p_len INTEGER DEFAULT 8)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  -- 36 * 7 = 252. Bytes at 252..255 would skew the first four symbols.
  cutoff   CONSTANT INTEGER := 252;
  result   TEXT := '';
  buf      BYTEA;
  b        INTEGER;
  i        INTEGER;
BEGIN
  IF p_len IS NULL OR p_len < 1 THEN
    RAISE EXCEPTION 'gen_claim_code: length must be at least 1';
  END IF;

  WHILE length(result) < p_len LOOP
    -- 16 bytes of strong randomness per round. A round yields ~15.75 usable
    -- symbols on average, so an 8-character code almost always takes one.
    buf := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');

    FOR i IN 0..(octet_length(buf) - 1) LOOP
      EXIT WHEN length(result) >= p_len;
      b := get_byte(buf, i);
      IF b < cutoff THEN
        result := result || substr(alphabet, (b % 36) + 1, 1);
      END IF;
    END LOOP;
  END LOOP;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.gen_claim_code(integer) IS
  'Claim codes from pg_strong_random via gen_random_uuid, with rejection '
  'sampling to remove modulo bias. Never random() -- a claim code is a bearer '
  'instrument.';

-- ---------------------------------------------------------------------------
-- Proof, at apply time, that the body above is the one that is live.
--
-- Part 2 of the 2026-09-14 audit called out that this schema cannot tell you
-- which definition of a repeatedly-replaced function is running. That applies
-- to gen_claim_code as much as to confirm_payment_atomic, so this migration
-- asserts its own result rather than trusting apply order.
--
-- Two checks, both cheap and both deterministic despite testing a random
-- source: shape (length and alphabet) over a sample, and that the source is
-- not the old one. The second works because `random()` is seeded per session:
-- setseed() makes the OLD implementation emit the same code twice in a row,
-- while a CSPRNG ignores the seed entirely. A collision across 100 draws of
-- 8 symbols from a real CSPRNG has probability ~36^-8, which is not a flake
-- anyone will ever see.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_code TEXT;
  v_first TEXT;
  v_second TEXT;
  i INTEGER;
BEGIN
  FOR i IN 1..100 LOOP
    v_code := public.gen_claim_code(8);
    IF v_code !~ '^[A-Z0-9]{8}$' THEN
      RAISE EXCEPTION 'gen_claim_code returned %, which is not 8 uppercase alphanumerics', v_code;
    END IF;
  END LOOP;

  IF public.gen_claim_code(6) !~ '^[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'gen_claim_code(6) does not honour its length argument';
  END IF;

  PERFORM setseed(0.5);
  v_first := public.gen_claim_code(8);
  PERFORM setseed(0.5);
  v_second := public.gen_claim_code(8);

  IF v_first = v_second THEN
    RAISE EXCEPTION
      'gen_claim_code is seed-reproducible (% twice from setseed(0.5)) -- it is still drawing from random(), not a CSPRNG',
      v_first;
  END IF;

  RAISE NOTICE 'gen_claim_code: CSPRNG source confirmed, shape confirmed over 100 draws.';
END;
$$;
