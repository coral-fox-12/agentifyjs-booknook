// Static dev server with CORS (peers must be cross-origin fetchable) and a
// request log used by the tests to prove no Authorization header ever reaches
// a peer origin. Usage: node serve.mjs <port> <dir> <logfile>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [port, dir, logfile] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const root = path.resolve(dir);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".md": "text/markdown" };

const server = http.createServer((req, res) => {
  // NB: do NOT use new URL(req.url, base) here — a path starting with "//"
  // would be parsed as a protocol-relative URL (host), not a path.
  const rawPath = req.url.split("?")[0];
  const url = { pathname: rawPath };
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(root, rel);
  fs.appendFileSync(logfile, JSON.stringify({
    t: new Date().toISOString(), method: req.method, url: url.pathname,
    origin: req.headers.origin || null,
    authorization: Boolean(req.headers.authorization),
  }) + "\n");
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end("not found"); return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  });
  fs.createReadStream(file).pipe(res);
});
server.listen(port, "127.0.0.1", () => console.log(`serving ${root} on 127.0.0.1:${port} (log ${logfile})`));
