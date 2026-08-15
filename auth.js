const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../db");
const { auth } = require("../middleware/auth");

const router = express.Router();

function tokenFor(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, display_name: u.display_name,
    email: u.email, avatar_url: u.avatar_url, bio: u.bio,
    country: u.country, interests: u.interests, role: u.role,
    plan: u.plan, premium_expires_at: u.premium_expires_at,
    online: u.online, last_seen: u.last_seen
  };
}

router.post("/register", async (req, res) => {
  try {
    const { username, displayName, email, password, country = "" } = req.body;
    if (!username || !displayName || !email || !password) return res.status(400).json({ error: "Jaza taarifa zote muhimu" });
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: "Username iwe 3-30 letters/numbers/underscore" });
    if (password.length < 8) return res.status(400).json({ error: "Password iwe angalau characters 8" });

    const exists = await query("SELECT id FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($2)", [username, email]);
    if (exists.rows[0]) return res.status(409).json({ error: "Username au email tayari imetumika" });

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (username, display_name, email, password_hash, country)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [username, displayName, email.toLowerCase(), hash, country]
    );
    const user = result.rows[0];
    res.json({ token: tokenFor(user), user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const result = await query(
      "SELECT * FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($1)",
      [identifier || ""]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.status(401).json({ error: "Login details si sahihi" });
    }
    await query("UPDATE users SET online=true,last_seen=NOW() WHERE id=$1", [user.id]);
    res.json({ token: tokenFor(user), user: publicUser({ ...user, online: true }) });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", auth, async (req, res) => {
  await query("UPDATE users SET online=true,last_seen=NOW() WHERE id=$1", [req.user.id]);
  const r = await query("SELECT * FROM users WHERE id=$1", [req.user.id]);
  res.json({ user: publicUser(r.rows[0]) });
});

router.put("/profile", auth, async (req, res) => {
  const { displayName, bio, country, interests, avatarUrl, username } = req.body;
  if (username && !/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: "Username si sahihi" });
  try {
    const r = await query(
      `UPDATE users SET
       display_name=COALESCE($1,display_name),
       bio=COALESCE($2,bio),
       country=COALESCE($3,country),
       interests=COALESCE($4,interests),
       avatar_url=COALESCE($5,avatar_url),
       username=COALESCE($6,username)
       WHERE id=$7 RETURNING *`,
      [displayName, bio, country, interests, avatarUrl, username, req.user.id]
    );
    res.json({ user: publicUser(r.rows[0]) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Username tayari ipo" });
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "Password mpya iwe characters 8+" });
  const ok = await bcrypt.compare(currentPassword || "", req.user.password_hash);
  if (!ok) return res.status(400).json({ error: "Password ya zamani si sahihi" });
  const hash = await bcrypt.hash(newPassword, 12);
  await query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.user.id]);
  res.json({ message: "Password imebadilishwa" });
});

router.post("/logout", auth, async (req, res) => {
  await query("UPDATE users SET online=false,last_seen=NOW() WHERE id=$1", [req.user.id]);
  res.json({ message: "Logged out" });
});

module.exports = { router, publicUser };
