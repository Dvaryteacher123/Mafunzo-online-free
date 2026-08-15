require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { query } = require("./db");

const { router: authRoutes } = require("./routes/auth");
const chatRoutes = require("./routes/chat");
const paymentRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");
const { auth } = require("./middleware/auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req,res)=>res.json({ok:true,service:"solo-chat"}));
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);

const onlineSockets = new Map();

io.on("connection", socket => {
  socket.on("identify", async ({ token }) => {
    try {
      const jwt = require("jsonwebtoken");
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.id;
      onlineSockets.set(String(payload.id), socket.id);
      await query("UPDATE users SET online=true,last_seen=NOW() WHERE id=$1", [payload.id]);
      io.emit("presence", { userId: payload.id, online: true });
    } catch {}
  });

  socket.on("join_conversation", async ({ conversationId }) => {
    if (socket.userId) socket.join(`conversation:${conversationId}`);
  });

  socket.on("typing", ({ conversationId, typing }) => {
    if (socket.userId) socket.to(`conversation:${conversationId}`).emit("typing", { userId: socket.userId, typing });
  });

  socket.on("disconnect", async () => {
    if (!socket.userId) return;
    onlineSockets.delete(String(socket.userId));
    await query("UPDATE users SET online=false,last_seen=NOW() WHERE id=$1", [socket.userId]).catch(()=>{});
    io.emit("presence", { userId: socket.userId, online: false });
  });
});

app.set("io", io);

app.get("*", (req,res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({error:"API route not found"});
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = Number(process.env.PORT || 3000);
server.listen(port, async () => {
  console.log(`SOLO CHAT running on port ${port}`);
  try {
    const fs = require("fs");
    const schema = fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8");
    await query(schema);
    console.log("Database schema ready");
  } catch (e) {
    console.error("Database setup error:", e.message);
  }
});
