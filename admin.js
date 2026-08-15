const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db");
const { auth, adminOnly } = require("../middleware/auth");

const router = express.Router();

router.get("/stats", auth, adminOnly, async (req,res) => {
  const [users, online, payments, revenue, reports] = await Promise.all([
    query("SELECT COUNT(*)::int count FROM users"),
    query("SELECT COUNT(*)::int count FROM users WHERE online=true"),
    query("SELECT COUNT(*)::int count FROM payments"),
    query("SELECT COALESCE(SUM(amount),0)::int total FROM payments WHERE status='completed'"),
    query("SELECT COUNT(*)::int count FROM reports WHERE status='open'")
  ]);
  res.json({
    users: users.rows[0].count,
    online: online.rows[0].count,
    payments: payments.rows[0].count,
    revenue: revenue.rows[0].total,
    openReports: reports.rows[0].count
  });
});

router.get("/users", auth, adminOnly, async (req,res) => {
  const q = String(req.query.q || "");
  const r = await query(
    `SELECT id,username,display_name,email,role,plan,premium_expires_at,online,last_seen,created_at
     FROM users WHERE username ILIKE $1 OR email ILIKE $1 ORDER BY created_at DESC LIMIT 100`, [`%${q}%`]
  );
  res.json({ users: r.rows });
});

router.put("/users/:id/plan", auth, adminOnly, async (req,res) => {
  const plan = req.body.plan === "premium" ? "premium" : "free";
  const days = Number(req.body.days || 30);
  const expires = plan === "premium" ? new Date(Date.now()+days*86400000) : null;
  await query("UPDATE users SET plan=$1,premium_expires_at=$2 WHERE id=$3", [plan, expires, req.params.id]);
  res.json({ message: "Plan updated" });
});

router.put("/users/:id/role", auth, adminOnly, async (req,res) => {
  const role = ["user","moderator","admin","superadmin"].includes(req.body.role) ? req.body.role : "user";
  await query("UPDATE users SET role=$1 WHERE id=$2", [role, req.params.id]);
  res.json({ message: "Role updated" });
});

router.get("/payments", auth, adminOnly, async (req,res) => {
  const r = await query(
    `SELECT p.*,u.username,u.email,pl.name plan_name
     FROM payments p JOIN users u ON u.id=p.user_id JOIN plans pl ON pl.id=p.plan_id
     ORDER BY p.created_at DESC LIMIT 200`
  );
  res.json({ payments: r.rows });
});

router.get("/reports", auth, adminOnly, async (req,res) => {
  const r = await query(
    `SELECT r.*,a.username reporter,b.username reported
     FROM reports r JOIN users a ON a.id=r.reporter_id JOIN users b ON b.id=r.reported_id
     ORDER BY r.created_at DESC LIMIT 200`
  );
  res.json({ reports: r.rows });
});

router.put("/reports/:id", auth, adminOnly, async (req,res) => {
  await query("UPDATE reports SET status=$1 WHERE id=$2", [req.body.status || "closed", req.params.id]);
  res.json({ message: "Report updated" });
});

router.post("/plans", auth, adminOnly, async (req,res) => {
  const { name, price, durationDays, features="" } = req.body;
  const r = await query(
    "INSERT INTO plans(name,price,duration_days,features) VALUES($1,$2,$3,$4) RETURNING *",
    [name, Number(price), Number(durationDays), features]
  );
  res.json({ plan: r.rows[0] });
});

module.exports = router;
