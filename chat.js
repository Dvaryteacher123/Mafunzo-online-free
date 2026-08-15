const express = require("express");
const { query } = require("../db");
const { auth } = require("../middleware/auth");

const router = express.Router();

router.get("/users", auth, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const r = await query(
    `SELECT id,username,display_name,avatar_url,bio,country,interests,plan,online,last_seen
     FROM users WHERE id<>$1 AND (username ILIKE $2 OR display_name ILIKE $2)
     ORDER BY online DESC,last_seen DESC LIMIT 30`,
    [req.user.id, `%${q}%`]
  );
  res.json({ users: r.rows });
});

router.post("/conversation", auth, async (req, res) => {
  const otherId = Number(req.body.userId);
  if (!otherId || otherId === req.user.id) return res.status(400).json({ error: "User si sahihi" });

  const existing = await query(
    `SELECT c.id FROM conversations c
     JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=$1
     JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=$2
     WHERE c.is_random=false LIMIT 1`,
    [req.user.id, otherId]
  );
  if (existing.rows[0]) return res.json({ conversationId: existing.rows[0].id });

  const c = await query("INSERT INTO conversations(is_random) VALUES(false) RETURNING id");
  const id = c.rows[0].id;
  await query("INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2),($1,$3)", [id, req.user.id, otherId]);
  res.json({ conversationId: id });
});

router.get("/conversations", auth, async (req, res) => {
  const r = await query(
    `SELECT c.id,
      (SELECT json_build_object('id',u.id,'username',u.username,'display_name',u.display_name,'avatar_url',u.avatar_url,'online',u.online)
       FROM conversation_members cm2 JOIN users u ON u.id=cm2.user_id
       WHERE cm2.conversation_id=c.id AND u.id<>$1 LIMIT 1) AS other,
      (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1
     ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  res.json({ conversations: r.rows });
});

router.get("/messages/:conversationId", auth, async (req, res) => {
  const id = Number(req.params.conversationId);
  const member = await query("SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2", [id, req.user.id]);
  if (!member.rows[0]) return res.status(403).json({ error: "No access" });
  const r = await query(
    `SELECT m.id,m.body,m.created_at,m.seen_at,m.sender_id,u.username,u.display_name
     FROM messages m JOIN users u ON u.id=m.sender_id
     WHERE m.conversation_id=$1 ORDER BY m.created_at ASC LIMIT 200`, [id]
  );
  res.json({ messages: r.rows });
});

router.post("/message", auth, async (req, res) => {
  const { conversationId, body } = req.body;
  if (!body || !String(body).trim()) return res.status(400).json({ error: "Message tupu" });
  const member = await query("SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2", [conversationId, req.user.id]);
  if (!member.rows[0]) return res.status(403).json({ error: "No access" });
  const r = await query(
    `INSERT INTO messages(conversation_id,sender_id,body) VALUES($1,$2,$3)
     RETURNING id,conversation_id,sender_id,body,created_at,seen_at`,
    [conversationId, req.user.id, String(body).slice(0, 5000)]
  );
  res.json({ message: r.rows[0] });
});

router.get("/friends", auth, async (req, res) => {
  const r = await query(
    `SELECT u.id,u.username,u.display_name,u.avatar_url,u.online,u.last_seen,f.status
     FROM friends f JOIN users u ON u.id=f.friend_id
     WHERE f.user_id=$1 ORDER BY u.online DESC,u.display_name`, [req.user.id]
  );
  res.json({ friends: r.rows });
});

router.post("/friends/request", auth, async (req, res) => {
  const otherId = Number(req.body.userId);
  if (!otherId || otherId === req.user.id) return res.status(400).json({ error: "User si sahihi" });
  await query(
    `INSERT INTO friends(user_id,friend_id,status) VALUES($1,$2,'pending')
     ON CONFLICT(user_id,friend_id) DO NOTHING`, [req.user.id, otherId]
  );
  await query(
    `INSERT INTO notifications(user_id,type,title,body) VALUES($1,'friend_request','Friend request mpya',$2)`,
    [otherId, `@${req.user.username} amekutumia friend request.`]
  );
  res.json({ message: "Request sent" });
});

router.get("/notifications", auth, async (req, res) => {
  const r = await query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [req.user.id]);
  res.json({ notifications: r.rows });
});

router.post("/notifications/read", auth, async (req, res) => {
  await query("UPDATE notifications SET read=true WHERE user_id=$1", [req.user.id]);
  res.json({ ok: true });
});

router.get("/rooms", auth, async (req, res) => {
  const r = await query("SELECT * FROM rooms ORDER BY name");
  res.json({ rooms: r.rows });
});

router.post("/rooms/:id/join", auth, async (req, res) => {
  await query("INSERT INTO room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.params.id, req.user.id]);
  res.json({ message: "Joined room" });
});

router.post("/report", auth, async (req, res) => {
  const { reportedId, reason, details = "" } = req.body;
  await query(
    "INSERT INTO reports(reporter_id,reported_id,reason,details) VALUES($1,$2,$3,$4)",
    [req.user.id, reportedId, reason, details]
  );
  res.json({ message: "Report imetumwa" });
});

module.exports = router;
