import { lstat, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

const ROUTE = '/session-delete/delete'
const REMOVED_EVENT = 'api-session/removed'
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const LOG_FILE = /^session\.[^/\\]+\.jsonl(\.zstd)?$/
const MAX_BODY_BYTES = 2048

class Refusal extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  const connection = ctx.get('connection')
  const persistence = ctx.get('sessionPersistence')
  const sessionController = ctx.get('sessionController')
  const domains = ctx.get('storageDomain')
  if (webServer === undefined || connection === undefined) {
    ctx.logger?.warn?.('session-delete: no Web carrier in this composition; inactive')
    return
  }

  async function logDirectoryOf(sessionId) {
    const snapshot = await persistence?.stat(sessionId).catch(() => undefined)
    const location = snapshot?.location
    if (location === undefined || location.kind !== 'jsonl') return undefined
    const directory = dirname(location.path)
    const ownDirectory = basename(directory) === sessionId && LOG_FILE.test(basename(location.path))
    return ownDirectory ? directory : undefined
  }

  async function isRunning(sessionId) {
    try {
      const state = await sessionController?.state?.({ sessionId }, AbortSignal.timeout(2000))
      return state?.running === true
    } catch {
      return false
    }
  }

  async function deleteSession(sessionId) {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Refusal(400, 'session-delete/failed')
    if (persistence === undefined) throw new Refusal(500, 'session-delete/failed')
    const directory = await logDirectoryOf(sessionId)
    if (directory === undefined) throw new Refusal(404, 'session-delete/not-found')
    if (await isRunning(sessionId)) throw new Refusal(409, 'session-delete/in-use')
    const stats = await lstat(directory).catch(() => undefined)
    if (stats === undefined || !stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Refusal(404, 'session-delete/not-found')
    }
    try {
      await domains?.get('session_projcache')?.table('sessions').delete(sessionId)
    } catch {}
    await rm(directory, { recursive: true, force: true })
    ctx.emit(REMOVED_EVENT, sessionId)
  }

  async function readBody(request) {
    const chunks = []
    let total = 0
    for await (const chunk of request) {
      total += chunk.length
      if (total > MAX_BODY_BYTES) return undefined
      chunks.push(chunk)
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
    } catch {
      return undefined
    }
  }

  function respond(response, status, payload) {
    const body = JSON.stringify(payload)
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    response.end(body)
  }

  async function handleDelete(request, response) {
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' })
      response.end()
      return
    }
    if ('rejection' in connection.admit(request)) {
      respond(response, 401, { ok: false })
      return
    }
    try {
      const body = await readBody(request)
      await deleteSession(body?.sessionId)
      respond(response, 200, { ok: true })
    } catch (error) {
      const refusal = error instanceof Refusal ? error : new Refusal(500, 'session-delete/failed')
      if (!(error instanceof Refusal)) ctx.logger?.warn?.(`session-delete: ${String(error)}`)
      respond(response, refusal.status, { ok: false, code: refusal.code })
    }
  }

  ctx.effect(() => webServer.register({ kind: 'exact', path: ROUTE, handler: handleDelete }),
    'session-delete: delete route')
}
