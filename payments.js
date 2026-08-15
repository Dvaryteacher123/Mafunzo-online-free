const express = require("express");
const { query } = require("../db");
const { auth, adminOnly } = require("../middleware/auth");

const router = express.Router();

function apiUrl(path) {
  return `${process.env.HARAKAPAY_BASE_URL || "https://harakapay.net"}${path}`;
}

async function hpRequest(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": process.env.HARAKAPAY_API_KEY,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    const e = new Error(data.error || `HarakaPay HTTP ${response.status}`);
    e.data = data;
    throw e;
  }
  return data;
}

router.get("/plans", async (req, res) => {
  const r = await query("SELECT * FROM plans WHERE active=true ORDER BY price");
  res.json({ plans: r.rows });
});

router.post("/create", auth, async (req, res) => {
  try {
    const planId = Number(req.body.planId);
    const phone = String(req.body.phone || "").trim();
    const planR = await query("SELECT * FROM plans WHERE id=$1 AND active=true", [planId]);
    const plan = planR.rows[0];
    if (!plan) return res.status(400).json({ error: "Plan haipo" });
    if (!/^(\+?255|0)[67]\d{8}$/.test(phone.replace(/\s+/g, ""))) {
      return res.status(400).json({ error: "Weka namba sahihi ya Tanzania" });
    }

    const internal = `SC-${req.user.id}-${Date.now()}-${Math.floor(Math.random()*10000)}`;
    const webhook = `${process.env.APP_URL}${process.env.HARAKAPAY_WEBHOOK_PATH || "/api/payments/harakapay/webhook"}`;

    const hp = await hpRequest(process.env.HARAKAPAY_COLLECT_PATH || "/api/v1/collect", {
      method: "POST",
      body: JSON.stringify({
        phone: phone.replace(/\s+/g, ""),
        amount: plan.price,
        description: `SOLO CHAT ${plan.name} - ${internal}`,
        webhook_url: webhook
      })
    });

    const providerOrderId = hp.order_id || hp.orderId || hp.data?.order_id;
    if (!providerOrderId) return res.status(502).json({ error: "HarakaPay haikutoa order_id", provider: hp });

    const saved = await query(
      `INSERT INTO payments(user_id,plan_id,phone,amount,provider_order_id,status,raw_response)
       VALUES($1,$2,$3,$4,$5,'pending',$6) RETURNING id,provider_order_id,status,amount`,
      [req.user.id, plan.id, phone, plan.price, providerOrderId, JSON.stringify(hp)]
    );

    res.json({
      payment: saved.rows[0],
      provider: hp,
      message: "Payment imeanzishwa. Thibitisha kwenye simu yako."
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Imeshindikana kuanzisha HarakaPay payment", details: e.message });
  }
});

async function completePayment(providerOrderId, providerData = {}) {
  const pR = await query("SELECT * FROM payments WHERE provider_order_id=$1 FOR UPDATE", [providerOrderId]);
  const payment = pR.rows[0];
  if (!payment) return false;
  if (payment.status === "completed") return true;

  const client = await require("../db").pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [payment.id]);
    const p = locked.rows[0];
    if (p.status === "completed") { await client.query("COMMIT"); return true; }

    const planR = await client.query("SELECT * FROM plans WHERE id=$1", [p.plan_id]);
    const plan = planR.rows[0];
    const userR = await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [p.user_id]);
    const user = userR.rows[0];

    const current = user.premium_expires_at && new Date(user.premium_expires_at) > new Date()
      ? new Date(user.premium_expires_at) : new Date();
    current.setUTCDate(current.getUTCDate() + plan.duration_days);

    await client.query(
      "UPDATE payments SET status='completed',completed_at=NOW(),raw_response=$1 WHERE id=$2",
      [JSON.stringify(providerData), p.id]
    );
    await client.query(
      "UPDATE users SET plan='premium',premium_expires_at=$1 WHERE id=$2",
      [current, user.id]
    );
    await client.query(
      "INSERT INTO notifications(user_id,type,title,body) VALUES($1,'payment','Premium activated', $2)",
      [user.id, `Malipo ya TZS ${p.amount.toLocaleString()} yamekamilika. Premium hadi ${current.toISOString().slice(0,10)}.`]
    );
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

router.post("/harakapay/webhook", async (req, res) => {
  try {
    const data = req.body || {};
    const orderId = data.order_id || data.orderId || data.payment?.order_id;
    const status = data.status || data.payment?.status;
    if (!orderId) return res.status(400).json({ error: "order_id missing" });

    if (status === "completed") {
      await completePayment(orderId, data);
    } else if (["failed", "cancelled"].includes(status)) {
      await query("UPDATE payments SET status=$1,raw_response=$2 WHERE provider_order_id=$3 AND status='pending'",
        [status, JSON.stringify(data), orderId]);
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook:", e);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

router.get("/status/:orderId", auth, async (req, res) => {
  const pR = await query("SELECT * FROM payments WHERE provider_order_id=$1 AND user_id=$2", [req.params.orderId, req.user.id]);
  if (!pR.rows[0]) return res.status(404).json({ error: "Payment not found" });

  try {
    const hp = await hpRequest(`${process.env.HARAKAPAY_STATUS_PATH || "/api/v1/status"}/${encodeURIComponent(req.params.orderId)}`);
    const status = hp.status || hp.payment?.status;
    if (status === "completed") await completePayment(req.params.orderId, hp);
    if (["failed","cancelled"].includes(status)) await query("UPDATE payments SET status=$1,raw_response=$2 WHERE provider_order_id=$3", [status, JSON.stringify(hp), req.params.orderId]);
    const fresh = await query("SELECT id,provider_order_id,amount,status,created_at,completed_at FROM payments WHERE provider_order_id=$1", [req.params.orderId]);
    res.json({ provider: hp, payment: fresh.rows[0] });
  } catch (e) {
    res.status(502).json({ error: "Imeshindikana ku-check HarakaPay", details: e.message });
  }
});

router.get("/mine", auth, async (req, res) => {
  const r = await query(
    `SELECT p.id,p.amount,p.status,p.provider_order_id,p.created_at,p.completed_at,pl.name,pl.duration_days
     FROM payments p JOIN plans pl ON pl.id=p.plan_id
     WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 50`, [req.user.id]
  );
  res.json({ payments: r.rows });
});

router.get("/admin/balance", auth, adminOnly, async (req, res) => {
  try {
    const hp = await hpRequest("/api/v1/balance");
    res.json(hp);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
