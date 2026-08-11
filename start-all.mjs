import http from "http";
import { spawn } from "child_process";
import { initDB, uploadDB } from './db-sync.js';

// --- 启动前从 Supabase 下载最新数据库 ---
await initDB();

// --- 启动子进程 ---
const web = spawn("node", ["server.mjs"], { stdio: "inherit" });
const mcp = spawn("node", ["mcp-sse.mjs"], { stdio: "inherit" });

// --- 定时备份（每 5 分钟） ---
setInterval(async () => {
  await uploadDB();
}, 5 * 60 * 1000);

// --- 进程退出时备份（防止重启丢失数据） ---
const cleanup = async () => {
  console.log(' 正在保存数据库到 Supabase...');
  await uploadDB();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// --- 代理转发（原样保留） ---
const PORT = process.env.PORT || 3001;

const server = http.createServer((clientReq, clientRes) => {
  const isMCP = clientReq.url.startsWith("/mcp") ||
                clientReq.url.startsWith("/sse") ||
                clientReq.url.startsWith("/messages");

  const targetPort = isMCP ? 3001 : 3000;

  const options = {
    hostname: "localhost",
    port: targetPort,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const proxy = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  proxy.on("error", (err) => {
    clientRes.writeHead(502);
    clientRes.end("Bad Gateway: " + err.message);
  });

  clientReq.pipe(proxy, { end: true });
});

server.listen(PORT, () => {
  console.log(`Proxy on port ${PORT}`);
  console.log(`/mcp /sse /messages -> 3001 (MCP)`);
  console.log(`everything else -> 3000 (Web)`);
});
