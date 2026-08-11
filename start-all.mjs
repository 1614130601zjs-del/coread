import http from "http";
import { spawn } from "child_process";

spawn("node", ["server.mjs"], { stdio: "inherit" });
spawn("node", ["mcp-sse.mjs"], { stdio: "inherit" });

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
