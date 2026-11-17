// serve.mjs: a tiny static file server for local development, no dependencies.
//
//   node tools/serve.mjs            serves the repo root on http://localhost:8000
//   node tools/serve.mjs 3000       another port
//
// Why it exists: browsers refuse ES modules from file://, so the app must be served over
// http. This avoids installing a server package (or Python) just for that.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
// Port: command-line argument, else the PORT environment variable (set by preview tools), else 8000.
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8000

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
}

const server = createServer(async (req, res) => {
  // Strip the query string, decode %20 etc., and block "../" escapes out of the repo.
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  let filePath = normalize(join(ROOT, urlPath))
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html')
    const body = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store' // always serve the latest edit while developing
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${urlPath}`)
  }
})

server.listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`))
