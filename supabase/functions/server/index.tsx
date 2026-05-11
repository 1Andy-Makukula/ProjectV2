import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Supabase client with service role for admin operations
const getSupabaseAdmin = () => createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
);

const requireAdmin = async (authorizationHeader?: string | null) => {
  const accessToken = authorizationHeader?.split(" ")[1];

  if (!accessToken) {
    return { error: "Unauthorized", status: 401 as const };
  }

  const supabase = getSupabaseAdmin();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  if (authError || !user) {
    return { error: "Unauthorized", status: 401 as const };
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return { error: "Unauthorized", status: 401 as const };
  }

  return { supabase, user, profile };
};

// Health check endpoint
app.get("/make-server-468852b1/health", (c) => {
  return c.json({ status: "ok" });
});

// Initialize Flutterwave payment
app.post("/make-server-468852b1/payment/initialize", async (c) => {
  try {
    const body = await c.req.json();
    const { orderId, amount, currency, email, name, phone, txRef } = body;

    const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
    const flutterwavePublicKey = Deno.env.get("FLUTTERWAVE_PUBLIC_KEY");

    if (!flutterwaveSecretKey || !flutterwavePublicKey) {
      return c.json({ error: "Flutterwave keys not configured" }, 500);
    }

    // Call Flutterwave API to initialize payment
    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${flutterwaveSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: amount / 100, // Convert from lowest unit to actual amount
        currency: currency || "ZMW",
        redirect_url: `${Deno.env.get("APP_URL") || ""}/confirmation/${orderId}?tx_ref=${txRef}`,
        payment_options: "card,mobilemoneyzambia,banktransfer",
        customer: {
          email,
          name,
          phonenumber: phone,
        },
        customizations: {
          title: "KithLy Gift Payment",
          description: "Payment for gift order",
          logo: "",
        },
      }),
    });

    const data = await response.json();

    if (data.status === "success") {
      return c.json({
        success: true,
        paymentLink: data.data.link,
      });
    } else {
      console.error("Flutterwave initialization error:", data);
      return c.json({ error: data.message || "Payment initialization failed" }, 400);
    }
  } catch (error: any) {
    console.error("Error initializing payment:", error);
    return c.json({ error: error.message || "Failed to initialize payment" }, 500);
  }
});

// Flutterwave webhook handler
app.post("/make-server-468852b1/webhooks/flutterwave", async (c) => {
  try {
    const body = await c.req.json();
    const signature = c.req.header("verif-hash");
    const webhookSecret = Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET");

    // Verify webhook signature
    if (!signature || signature !== webhookSecret) {
      console.error("Invalid webhook signature");
      return c.json({ error: "Invalid signature" }, 401);
    }

    // Handle successful payment
    if (body.event === "charge.completed" && body.data.status === "successful") {
      const txRef = body.data.tx_ref;
      const transactionId = body.data.id;

      const supabase = getSupabaseAdmin();

      // Find order by tx_ref and update status
      const { data: order, error: findError } = await supabase
        .from("orders")
        .select("id")
        .eq("flutterwave_tx_ref", txRef)
        .single();

      if (findError || !order) {
        console.error("Order not found for tx_ref:", txRef, findError);
        return c.json({ error: "Order not found" }, 404);
      }

      // Update order status to paid
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "paid",
          flutterwave_transaction_id: transactionId,
          paid_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      if (updateError) {
        console.error("Error updating order:", updateError);
        return c.json({ error: "Failed to update order" }, 500);
      }

      console.log("Order marked as paid:", order.id);
      return c.json({ success: true });
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Manual payment confirmation (for Airtel direct payments)
app.post("/make-server-468852b1/orders/:orderId/confirm-payment", async (c) => {
  try {
    const orderId = c.req.param("orderId");
    const adminCheck = await requireAdmin(c.req.header("Authorization"));

    if ("error" in adminCheck) {
      return c.json({ error: adminCheck.error }, adminCheck.status);
    }

    const { supabase } = adminCheck;

    // Update order status
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateError) {
      console.error("Error confirming payment:", updateError);
      return c.json({ error: "Failed to confirm payment" }, 500);
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Error confirming payment:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Create merchant account (admin only)
app.post("/make-server-468852b1/merchants", async (c) => {
  try {
    const adminCheck = await requireAdmin(c.req.header("Authorization"));

    if ("error" in adminCheck) {
      return c.json({ error: adminCheck.error }, adminCheck.status);
    }

    const { supabase } = adminCheck;
    const body = await c.req.json();
    const { name, email, password, shopId } = body;

    if (!name || !email || !password || !shopId) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const { data: authData, error: createUserError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
      },
    });

    if (createUserError || !authData.user) {
      console.error("Error creating merchant auth user:", createUserError);
      return c.json({ error: createUserError?.message || "Failed to create merchant account" }, 400);
    }

    const merchantUserId = authData.user.id;

    const { error: roleUpdateError } = await supabase
      .from("users")
      .update({
        name,
        email,
        role: "merchant",
      })
      .eq("id", merchantUserId);

    if (roleUpdateError) {
      console.error("Error updating merchant profile:", roleUpdateError);
      await supabase.auth.admin.deleteUser(merchantUserId);
      return c.json({ error: "Failed to assign merchant role" }, 500);
    }

    const { error: assignmentError } = await supabase
      .from("merchant_shops")
      .insert({
        user_id: merchantUserId,
        shop_id: shopId,
      });

    if (assignmentError) {
      console.error("Error assigning merchant to shop:", assignmentError);
      await supabase.auth.admin.deleteUser(merchantUserId);
      return c.json({ error: "Failed to assign merchant to shop" }, 500);
    }

    return c.json({
      success: true,
      merchant: {
        id: merchantUserId,
        email,
        name,
        shopId,
      },
    });
  } catch (error: any) {
    console.error("Error creating merchant:", error);
    return c.json({ error: error.message || "Failed to create merchant" }, 500);
  }
});

Deno.serve(app.fetch);
