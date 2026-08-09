/**
 * fx-quote — what a diaspora buyer will pay, before they commit.
 *
 * Two answers, and which one you get is not a preference:
 *
 *   NATIVE   the currency is enabled for collection, so KithLy charges in it
 *            against a locked, single-use, expiring quote. KithLy performs the
 *            conversion and earns the spread.
 *
 *   FALLBACK the currency is not enabled, so the card is charged in ZMW and the
 *            buyer's own bank converts. KithLy takes no FX risk and earns
 *            nothing from the conversion, so what comes back is an ESTIMATE
 *            with no quote id, no expiry and nothing bindable.
 *
 * The caller must render the kwacha total in both cases. In the fallback it is
 * the only certain figure -- a buyer shown "A$88" who then finds "ZMW 1,080" on
 * their statement does not reason about exchange rates, they call their bank,
 * and a chargeback costs the goods, the fee and the dispute.
 *
 * WHY THE CART, NOT A TOTAL
 * -------------------------
 * The client sends what is in the basket and never what it is worth. The
 * database prices it -- through the same quantity-break rule that will charge
 * it -- and quotes against that. Taking a total from the client would mean
 * quoting against a number the checkout might not agree with, and fx_quotes is
 * deliberately anti-swap: the mismatch would surface at payment as a confusing
 * rejection rather than never happening.
 */
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import { authenticateCaller, createAdminClient } from "../_shared/auth.ts";

const FN = "fx-quote";

interface CartItem {
  item_id: string;
  shop_id: string;
  quantity: number;
}

interface VendorGroup {
  shop_id: string;
  item_ids: string[];
}

/**
 * Group a cart into the vendor shape the pricing and checkout functions expect.
 *
 * Quantity is expanded into repeated ids rather than carried as a count,
 * because that is the shape checkout_init_atomic consumes -- one entry per unit.
 * Keeping the two identical is what lets a quote and its checkout agree.
 */
function toVendorGroups(cart: CartItem[]): VendorGroup[] | { error: string } {
  const byShop = new Map<string, string[]>();

  for (const line of cart) {
    if (!line?.item_id || !line?.shop_id) {
      return { error: "Every cart item needs an item_id and a shop_id." };
    }
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 500) {
      return { error: `Invalid quantity for item ${line.item_id}.` };
    }
    const ids = byShop.get(line.shop_id) ?? [];
    for (let i = 0; i < qty; i++) ids.push(line.item_id);
    byShop.set(line.shop_id, ids);
  }

  return [...byShop.entries()].map(([shop_id, item_ids]) => ({ shop_id, item_ids }));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonWithCors(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient(FN);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    return jsonWithCors(req, { error: "Server configuration error." }, 500);
  }

  // A real signed-in buyer. The quote is issued to them and consume_fx_quote
  // checks ownership at checkout, so an anonymous quote could never be spent.
  const caller = await authenticateCaller(req, admin, FN);
  if (caller instanceof Response) return caller;

  let body: { cart_items?: CartItem[]; currency?: string };
  try {
    body = await req.json();
  } catch {
    return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
  }

  const currency = (body.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return jsonWithCors(req, { error: "currency must be a 3-letter ISO code." }, 400);
  }

  if (!Array.isArray(body.cart_items) || body.cart_items.length === 0) {
    return jsonWithCors(req, { error: "cart_items is required." }, 400);
  }

  const grouped = toVendorGroups(body.cart_items);
  if ("error" in grouped) {
    return jsonWithCors(req, { error: grouped.error }, 400);
  }

  // Which path applies is the database's decision, from the same list the
  // fx_quotes constraint enforces. Deciding it here would be a third copy of a
  // list that has already drifted once.
  const { data: supported, error: supportedError } = await admin.rpc("fx_supported_currencies");
  if (supportedError) {
    console.error(`[${FN}] Could not read supported currencies: ${supportedError.message}`);
    return jsonWithCors(req, { error: "Could not determine supported currencies." }, 500);
  }

  const isNative = Array.isArray(supported) && supported.includes(currency);

  if (isNative) {
    const { data, error } = await admin.rpc("issue_fx_quote_for_basket", {
      p_buyer_id: caller.id,
      p_target_currency: currency,
      p_vendors: grouped,
    });

    if (error) {
      // A stale rate is the expected reason, and it is not the buyer's fault.
      // Surfaced rather than swallowed so the client can offer the kwacha path
      // instead of showing a dead end.
      console.error(`[${FN}] Quote failed for ${currency}: ${error.message}`);
      return jsonWithCors(
        req,
        { error: "Could not price this order in that currency right now.", detail: error.message },
        503,
      );
    }

    return jsonWithCors(req, { mode: "native", ...data });
  }

  const { data, error } = await admin.rpc("fx_estimate_for_basket", {
    p_target_currency: currency,
    p_vendors: grouped,
  });

  if (error) {
    console.error(`[${FN}] Estimate failed for ${currency}: ${error.message}`);
    return jsonWithCors(req, { error: "Could not price this order." }, 500);
  }

  // `charge_currency: ZMW` is stated rather than implied. The one thing the
  // caller must not get wrong here is which figure the buyer is actually
  // charged, and leaving that to be inferred from the absence of a quote id is
  // how a UI ends up displaying the estimate as the price.
  return jsonWithCors(req, { mode: "fallback", charge_currency: "ZMW", ...data });
});
