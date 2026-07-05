import express from "express";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "changeme";
const PORT = 3000;

let queue = [];
let lastSeen = null;

// BLE中继轮询
app.get("/toy-next", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: "forbidden" });
  lastSeen = Date.now();
  const cmd = queue.shift();
  res.json({ cmd: cmd || null });
});

// AI发指令
app.post("/toy", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: "forbidden" });
  queue.push(req.body);
  res.json({ ok: true });
});

// 状态查询
app.get("/toy-status", (req, res) => {
  const online = lastSeen && (Date.now() - lastSeen < 5000);
  res.json({ online: !!online });
});

// MCP endpoint
app.post("/mcp", (req, res) => {
  const secret = req.query.secret;
  if (secret !== SECRET) return res.status(403).json({ error: "forbidden" });
  
  const { method, params } = req.body;
  
  if (method === "tools/list") {
    return res.json({ tools: [
      { name: "toy_set_speed", description: "设置强度 0-1", inputSchema: { type: "object", properties: { speed: { type: "number" }, sec: { type: "number" } } } },
      { name: "toy_set_pattern", description: "设置振动花样 1-8，强度 0-1", inputSchema: { type: "object", properties: { pattern: { type: "number" }, level: { type: "number" } } } },
      { name: "toy_stop", description: "停止", inputSchema: { type: "object", properties: {} } },
      { name: "toy_status", description: "查询中继是否在线", inputSchema: { type: "object", properties: {} } }
    ]});
  }
  
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    
    if (name === "toy_status") {
      const online = lastSeen && (Date.now() - lastSeen < 5000);
      return res.json({ content: [{ type: "text", text: online ? "中继在线" : "中继离线" }] });
    }
    
    if (name === "toy_stop") {
      queue.push({ stop: true });
      return res.json({ content: [{ type: "text", text: "已发送停止指令" }] });
    }
    
    if (name === "toy_set_speed") {
      queue.push({ speed: args.speed, sec: args.sec });
      return res.json({ content: [{ type: "text", text: `强度已设为 ${Math.round(args.speed * 100)}%` }] });
    }
    
    if (name === "toy_set_pattern") {
      queue.push({ pattern: args.pattern, level: args.level });
      return res.json({ content: [{ type: "text", text: `花样${args.pattern}已启动` }] });
    }
  }
  
  res.json({});
});

app.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
