const jwt = require("jsonwebtoken");
const { query } = require("../db");

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Login required" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query("SELECT * FROM users WHERE id=$1", [payload.id]);
    if (!result.rows[0]) return res.status(401).json({ error: "User not found" });
    req.user = result.rows[0];
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}

function adminOnly(req, res, next) {
  if (!["admin", "superadmin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

module.exports = { auth, adminOnly };
