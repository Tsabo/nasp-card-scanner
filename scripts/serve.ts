/**
 * @file A tiny web server for trying the built site on this computer.
 * `npm start` builds the site, then runs this; open http://localhost:8000.
 *
 * The app uses JavaScript modules, which browsers won't load from a file
 * opened directly (file://), so it has to be served over HTTP.
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const PORT = Number(process.env.PORT) || 8000;
const SITE = resolve(import.meta.dirname, "..", "_site");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

createServer((request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  let filePath = normalize(join(SITE, urlPath));
  // Refuse paths like /../secret that try to escape the site folder.
  if (filePath !== SITE && !filePath.startsWith(SITE + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    statSync(filePath);
  } catch {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(response);
}).listen(PORT, () => {
  console.log(`NASP Card Scanner running at http://localhost:${PORT}`);
});
