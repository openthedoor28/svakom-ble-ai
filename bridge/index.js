import express from "express";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "changeme";
const PORT = process.env.PORT || 3000;

let queue = [];
let lastSeen = null;

app.get("/toy-next", (req, res) => {
  const secret = req.query.secret || req.headers["x-bridge-secret"] || req.headers["x-secret"];
if (secret !== SECRET) return res.status(403).json({ error: "forbidden" });
  lastSeen = Date.now();
  const cmd = queue.shift();
  res.json({ cmd: cmd || null });
});

app.post("/toy", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: "forbidden" });
  queue.push(req.body);
  res.json({ ok: true });
});

app.get("/toy-status", (req, res) => {
  const online = lastSeen && (Date.now() - lastSeen < 5000);
  res.json({ online: !!online });
});

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({ resource: `https://${req.headers.host}`, authorization_servers: [] });
});

app.post("/mcp", (req, res) => {
  const { method, params, id } = req.body;
  const reply = (result) => res.json({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    return reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "svakom-bridge", version: "1.0.0" } });
  }
  if (method === "tools/list") {
    return reply({ tools: [
      { name: "toy_set_speed", description: "设置振动强度 0-1，可指定秒数", inputSchema: { type: "object", properties: { speed: { type: "number" }, sec: { type: "number" } }, required: ["speed"] } },
      { name: "toy_set_pattern", description: "设置振动花样 1-8，强度 1-5", inputSchema: { type: "object", properties: { pattern: { type: "number" }, level: { type: "number" } }, required: ["pattern", "level"] } },
      { name: "toy_stop", description: "停止振动", inputSchema: { type: "object", properties: {} } },
      { name: "toy_status", description: "查询设备是否在线", inputSchema: { type: "object", properties: {} } }
    ]});
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === "toy_status") {
      const online = lastSeen && (Date.now() - lastSeen < 5000);
      return reply({ content: [{ type: "text", text: online ? "设备在线" : "设备离线" }] });
    }
    if (name === "toy_stop") { queue.push({ stop: true }); return reply({ content: [{ type: "text", text: "已停止" }] }); }
    if (name === "toy_set_speed") { queue.push({ speed: args.speed, sec: args.sec }); return reply({ content: [{ type: "text", text: `强度${Math.round(args.speed * 100)}%` }] }); }
    if (name === "toy_set_pattern") { queue.push({ pattern: args.pattern, level: args.level }); return reply({ content: [{ type: "text", text: `花样${args.pattern}启动` }] }); }
  }
  res.json({ jsonrpc: "2.0", id, result: {} });
});

app.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
