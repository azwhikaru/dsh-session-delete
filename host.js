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

/**
 * Delete one Session's local log directory from the sidebar.
 *
 * Mount on `webServer`, never read Host services while the plugin applies:
 * sibling plugins activate without waiting for each other, so a mount-time
 * `ctx.get()` sees no service for anything provided later in the tree — and
 * `connection`, `sessionController`, `sessionPersistence`, and `storageDomain`
 * all finish their own async init after this bundle mounts. Every service is
 * therefore resolved per request, and only `webServer` itself is a mount
 * dependency.
 * @param ctx - the plugin's Host context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    /** Services are read per request; any of them may still be initializing at mount. */
    function services() {
      return {
        connection: ctx.get('connection'),
        persistence: ctx.get('sessionPersistence'),
        sessionController: ctx.get('sessionController'),
        domains: ctx.get('storageDomain'),
      }
    }

    async function logDirectoryOf(persistence, sessionId) {
      let snapshot
      try {
        snapshot = await persistence?.stat(sessionId)
      } catch {
        return undefined
      }
      const location = snapshot?.location
      if (location === undefined || location.kind !== 'jsonl') return undefined
      const directory = dirname(location.path)
      const ownDirectory = basename(directory) === sessionId && LOG_FILE.test(basename(location.path))
      return ownDirectory ? directory : undefined
    }

    async function isRunning(sessionController, sessionId) {
      try {
        const state = await sessionController?.state?.({ sessionId }, AbortSignal.timeout(2000))
        return state?.running === true
      } catch {
        return false
      }
    }

    async function deleteSession(sessionId) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Refusal(400, 'session-delete/failed')
      const { persistence, sessionController, domains } = services()
      if (persistence === undefined) throw new Refusal(500, 'session-delete/failed')
      const directory = await logDirectoryOf(persistence, sessionId)
      if (directory === undefined) throw new Refusal(404, 'session-delete/not-found')
      if (await isRunning(sessionController, sessionId)) throw new Refusal(409, 'session-delete/in-use')
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
      const { connection } = services()
      if (connection === undefined) {
        respond(response, 503, { ok: false, code: 'session-delete/failed' })
        return
      }
      try {
        if ('rejection' in connection.admit(request)) {
          respond(response, 401, { ok: false })
          return
        }
      } catch (error) {
        ctx.logger?.warn?.(`session-delete: admission failed: ${String(error)}`)
        respond(response, 401, { ok: false })
        return
      }
      try {
        const body = await readBody(request)
        if (body === undefined) throw new Refusal(400, 'session-delete/failed')
        await deleteSession(body.sessionId)
        respond(response, 200, { ok: true })
      } catch (error) {
        const refusal = error instanceof Refusal ? error : new Refusal(500, 'session-delete/failed')
        if (!(error instanceof Refusal)) ctx.logger?.warn?.(`session-delete: ${String(error)}`)
        respond(response, refusal.status, { ok: false, code: refusal.code })
      }
    }

    hostCtx.effect(() => {
      const webServer = hostCtx.get('webServer')
      if (webServer === undefined) return () => {}
      return webServer.register({ kind: 'exact', path: ROUTE, handler: handleDelete })
    }, 'session-delete: delete route')
  })
}
