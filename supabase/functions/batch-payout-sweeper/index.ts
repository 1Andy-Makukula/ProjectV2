import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sweeper-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface OrderWithShop {
  shop_order_id: string;
  transaction_id: string;
  shop_id: string;
  subtotal: number;
  claim_code: string;
  recipient_name: string;
  recipient_phone: string;
  shop: {
    id: string;
    name: string;
    payout_method: string | null;
    payout_details: string | null;
  } | null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[batch-payout-sweeper] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method === "GET") {
    return json({ status: "ok", service: "batch-payout-sweeper-v2" });
  }

  if (req.method !== "POST") {
    return json({ error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  // 1. Authorization Check
  const authHeader = req.headers.get("Authorization");
  const incomingSecret = req.headers.get("x-sweeper-secret") || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const expectedSecret = Deno.env.get("BATCH_PAYOUT_SWEEPER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (expectedSecret && incomingSecret !== expectedSecret) {
    console.error("[batch-payout-sweeper] Unauthorized payout sweep request.");
    return json({ error: "Unauthorized." }, 401);
  }

  let supabase;
  try {
    supabase = getAdminClient();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    return json({ error: "Server configuration error." }, 500);
  }

  const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!flutterwaveSecretKey) {
    console.error("[batch-payout-sweeper] FLUTTERWAVE_SECRET_KEY is not configured.");
    return json({ error: "Flutterwave keys not configured." }, 500);
  }

  try {
    // 2. Query due shop orders (FULFILLED and PENDING_BATCH)
    const { data: pendingOrders, error: fetchError } = await supabase
      .from("shop_orders")
      .select(`
        shop_order_id,
        transaction_id,
        shop_id,
        subtotal,
        claim_code,
        recipient_name,
        recipient_phone,
        shop:shop_id (
          id,
          name,
          payout_method,
          payout_details
        )
      `)
      .eq("claim_status", "FULFILLED")
      .eq("payout_status", "PENDING_BATCH");

    if (fetchError) {
      console.error("[batch-payout-sweeper] Failed to fetch shop orders:", fetchError.message);
      return json({ error: "Failed to fetch pending payouts." }, 500);
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      console.log("[batch-payout-sweeper] No shop orders found in FULFILLED + PENDING_BATCH state.");
      return json({
        success: true,
        processed_shops: 0,
        settled_orders_count: 0,
        results: []
      });
    }

    // 3. Group by Shop ID
    const batches = new Map<string, {
      shop: NonNullable<OrderWithShop["shop"]>;
      orders: OrderWithShop[];
      grossAmountNgwee: number;
    }>();

    for (const order of (pendingOrders as unknown as OrderWithShop[])) {
      if (!order.shop) {
        console.warn(`[batch-payout-sweeper] Order ${order.shop_order_id} has no associated shop details.`);
        continue;
      }
      const shopId = order.shop_id;
      let batch = batches.get(shopId);
      if (!batch) {
        batch = {
          shop: order.shop,
          orders: [],
          grossAmountNgwee: 0
        };
        batches.set(shopId, batch);
      }
      batch.orders.push(order);
      batch.grossAmountNgwee += order.subtotal;
    }

    const results = [];
    let settledOrdersCount = 0;

    // 4. Process each batch
    for (const batch of batches.values()) {
      const { shop, orders, grossAmountNgwee } = batch;

      if (!shop.payout_method || !shop.payout_details?.trim()) {
        console.error(`[batch-payout-sweeper] Shop '${shop.name}' (${shop.id}) is missing payout method or details.`);
        results.push({
          shop_id: shop.id,
          shop_name: shop.name,
          status: "FAILED",
          message: "Shop missing payout_method or payout_details."
        });
        continue;
      }

      // Calculate platform fee and merchant share (5% / 95%) in Ngwee
      const platformFeeNgwee = Math.round(grossAmountNgwee * 0.05);
      const merchantAmountNgwee = grossAmountNgwee - platformFeeNgwee;
      const transferAmountZMW = merchantAmountNgwee / 100;

      if (transferAmountZMW <= 0) {
        console.warn(`[batch-payout-sweeper] Shop '${shop.name}' has non-positive payout amount: ${transferAmountZMW} ZMW.`);
        results.push({
          shop_id: shop.id,
          shop_name: shop.name,
          status: "SKIPPED",
          message: "Payout amount is zero or negative."
        });
        continue;
      }

      // Map payout method to Flutterwave bank codes
      let accountBank = "";
      const method = shop.payout_method.toLowerCase().trim();
      if (method.includes("airtel")) {
        accountBank = "ATL";
      } else if (method.includes("mtn")) {
        accountBank = "MTN";
      } else if (method.includes("zamtel")) {
        accountBank = "ZMT";
      } else {
        accountBank = shop.payout_method;
      }

      // Sanitize mobile/bank account numbers
      let accountNumber = shop.payout_details.trim();
      if (["ATL", "MTN", "ZMT"].includes(accountBank)) {
        const digitsOnly = accountNumber.replace(/\D/g, "");
        if (digitsOnly.length >= 9) {
          accountNumber = `260${digitsOnly.slice(-9)}`;
        }
      }

      const reference = `kithly-batch-payout-${shop.id}-${Date.now()}`;

      try {
        console.log(`[batch-payout-sweeper] Initiating Flutterwave transfer: shop='${shop.name}', amount=${transferAmountZMW} ZMW, bank='${accountBank}', ref='${reference}'`);

        // Execute live fetch to Flutterwave Transfers API
        const flwResponse = await fetch("https://api.flutterwave.com/v3/transfers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${flutterwaveSecretKey}`
          },
          body: JSON.stringify({
            account_bank: accountBank,
            account_number: accountNumber,
            amount: transferAmountZMW,
            currency: "ZMW",
            narration: `KithLy Payout Batch - ${shop.name}`,
            reference: reference
          })
        });

        const flwResult = await flwResponse.json();

        if (!flwResponse.ok || flwResult.status !== "success") {
          const errMsg = flwResult.message ?? JSON.stringify(flwResult);
          throw new Error(`Flutterwave API error: ${errMsg}`);
        }

        const transferId = String(flwResult.data?.id ?? "");
        const shopOrderIds = orders.map(o => o.shop_order_id);

        // 5. Update shop orders to SETTLED
        const { error: updateErr } = await supabase
          .from("shop_orders")
          .update({
            payout_status: "SETTLED",
            settled: true
          })
          .in("shop_order_id", shopOrderIds);

        if (updateErr) {
          throw new Error(`Failed to update shop_orders in database: ${updateErr.message}`);
        }

        // 6. Record PAYOUT_BATCHED events in transaction_events
        const events = orders.map(order => ({
          transaction_id: order.transaction_id,
          shop_order_id: order.shop_order_id,
          event_type: "PAYOUT_BATCHED",
          payload: {
            action: "bulk_merchant_payout",
            provider: "flutterwave",
            transfer_id: transferId,
            transfer_reference: reference,
            transfer_status: "SUCCESSFUL",
            shop_id: shop.id,
            payout_method: shop.payout_method,
            gross_amount_ngwee: order.subtotal,
            platform_fee_ngwee: Math.round(order.subtotal * 0.05),
            merchant_amount_ngwee: order.subtotal - Math.round(order.subtotal * 0.05),
            settled_at: new Date().toISOString()
          }
        }));

        const { error: eventErr } = await supabase
          .from("transaction_events")
          .insert(events);

        if (eventErr) {
          console.error(`[batch-payout-sweeper] Warning: Failed to write audit transaction_events: ${eventErr.message}`);
        }

        settledOrdersCount += orders.length;
        results.push({
          shop_id: shop.id,
          shop_name: shop.name,
          status: "SUCCESS",
          amount: transferAmountZMW,
          transfer_id: transferId,
          orders_count: orders.length
        });

      } catch (shopErr: unknown) {
        const msg = shopErr instanceof Error ? shopErr.message : String(shopErr);
        console.error(`[batch-payout-sweeper] Payout failed for shop '${shop.name}':`, msg);
        results.push({
          shop_id: shop.id,
          shop_name: shop.name,
          status: "FAILED",
          message: msg
        });
      }
    }

    const processedShopsCount = results.filter(r => r.status === "SUCCESS").length;

    return json({
      success: results.every(r => r.status !== "FAILED"),
      processed_shops: processedShopsCount,
      settled_orders_count: settledOrdersCount,
      results
    });

  } catch (unhandled: unknown) {
    const msg = unhandled instanceof Error ? unhandled.message : String(unhandled);
    console.error("[batch-payout-sweeper] Unhandled exception:", msg);
    return json({ error: "Internal server error." }, 500);
  }
});
