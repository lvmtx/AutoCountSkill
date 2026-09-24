// Minimal static + Server-Sent-Events server shared by the three apps (no dependencies).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHARED_DIR = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8",
                ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml" };

export function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function sendFile(res, file){
  fs.readFile(file, (err, data) => {
    if (err){ res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control":"no-store" });
    res.end(data);
  });
}

function readBody(req, limit = 2_000_000){
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit){ reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * startServer({ port, appDir, routes: { "POST /path": async (json) => result }, snapshot: () => events[] })
 * Serves appDir/index.html at "/", shared files at "/shared/*", and an SSE stream at "/events".
 * Binds to 127.0.0.1 only.
 */
export function startServer({ port, appDir, routes = {}, snapshot = () => [], name = "app" }){
  const clients = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const key = req.method + " " + url.pathname;

    if (routes[key]){
      try {
        const raw = req.method === "POST" ? await readBody(req) : "";
        let json = {};
        if (raw){ try { json = JSON.parse(raw); } catch { res.writeHead(400); res.end("bad json"); return; } }
        const out = await routes[key](json, url);
        res.writeHead(200, { "Content-Type":"application/json" });
        res.end(JSON.stringify(out ?? { ok:true }));
      } catch (e){
        res.writeHead(500, { "Content-Type":"application/json" });
        res.end(JSON.stringify({ ok:false, error:String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/events"){
      res.writeHead(200, { "Content-Type":"text/event-stream", "Cache-Control":"no-cache", "Connection":"keep-alive" });
      res.write(`data: ${JSON.stringify({ type:"batch", events:snapshot() })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 20000);
      req.on("close", () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (req.method === "GET"){
      if (url.pathname === "/" || url.pathname === "/index.html") return sendFile(res, path.join(appDir, "index.html"));
      if (url.pathname.startsWith("/shared/")){
        const file = path.normalize(path.join(SHARED_DIR, url.pathname.slice("/shared/".length)));
        if (!file.startsWith(SHARED_DIR)){ res.writeHead(403); res.end(); return; }
        return sendFile(res, file);
      }
    }
    res.writeHead(404); res.end("not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[${name}] open http://localhost:${port}`);
  });

  function broadcast(evt){
    const data = `data: ${JSON.stringify(evt)}\n\n`;
    clients.forEach(c => c.write(data));
  }
  return { broadcast, server };
}
