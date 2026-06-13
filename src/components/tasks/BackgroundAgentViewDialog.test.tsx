/**
 * Tests for BackgroundAgentViewDialog (T9 of bg-agent-view plan).
 *
 * Strategy: test the data layer (`loadJobs`, `killJob`) with a fake
 * daemon over a loopback unix socket. Ink tree snapshotting is
 * intentionally skipped — `react-ink-testing-library` is not in this
 * repo, and Ink's ANSI-stripped output is notoriously fragile to
 * snapshot. The hook's surface (jobs / loading / error / kill /
 * refresh) is the user-facing behavior of the dialog anyway: the
 * renderer just paints what the hook returns.
 *
 * @see docs/superpowers/plans/2026-06-13-plan-bg-agent-view.md §T9
 */
import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  createServer,
  type Server,
} from 'node:net'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encodeFrame,
  type BGRequest,
  type BGResponse,
  type JobRecord,
  type JobShortId,
} from '../../utils/daemon/protocol.js'
import { requestOnPath } from '../../utils/daemon/socket.js'
import {
  loadJobs,
  killJob,
} from './BackgroundAgentViewDialog.jsx'

// ---------- Fake daemon server ----------

interface FakeDaemon {
  server: Server
  path: string
  /** Requests received by the server, in arrival order. */
  requests: BGRequest[]
  /**
   * Queue responses to send for the next N incoming requests (FIFO).
   * When the queue runs out, the server returns a benign
   * `{ok:true, op:'kill'}` for any op, which keeps the test from
   * hanging on a typo.
   */
  stageResponses: (resps: BGResponse[]) => void
  close: () => Promise<void>
}

function startFakeDaemon(): Promise<FakeDaemon> {
  return new Promise(resolve => {
    const tmp = mkdtempSync(join(tmpdir(), 'bg-agents-t9-sock-'))
    const sockPath = join(tmp, 'test.sock')
    const requests: BGRequest[] = []
    const staged: BGResponse[] = []
    const consume = (): BGResponse => {
      if (staged.length > 0) return staged.shift() as BGResponse
      return { ok: true, op: 'kill' } as BGResponse
    }
    const server = createServer(sock => {
      let buffer = Buffer.alloc(0)
      sock.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length < 5) return
        const len = buffer.readUInt32BE(0)
        if (buffer.length < 5 + len) return
        const kind = buffer.readUInt8(4)
        if (kind !== 0) return
        let req: BGRequest
        try {
          req = JSON.parse(buffer.subarray(5, 5 + len).toString('utf8'))
        } catch {
          sock.destroy()
          return
        }
        requests.push(req)
        const resp = consume()
        sock.write(
          encodeFrame({
            kind: 0,
            body: Buffer.from(JSON.stringify(resp), 'utf8'),
          }),
        )
      })
    })
    server.listen(sockPath, () => {
      resolve({
        server,
        path: sockPath,
        requests,
        stageResponses: resps => {
          staged.push(...resps)
        },
        close: () =>
          new Promise<void>(res => {
            server.close(() => res())
          }),
      })
    })
  })
}

const liveServers: FakeDaemon[] = []

function trackServer(srv: FakeDaemon): FakeDaemon {
  liveServers.push(srv)
  return srv
}

afterEach(async () => {
  for (const srv of liveServers) {
    try {
      await srv.close()
    } catch {
      // best-effort cleanup
    }
  }
  liveServers.length = 0
})

// ---------- Helpers ----------

/** Build a {@link JobRecord} with sensible defaults for tests. */
function makeJob(
  short: string,
  createdAt: number,
  overrides: Partial<JobRecord> = {},
): JobRecord {
  // JobShortIdSchema is `/^[a-f0-9]{8}$/` (lowercase hex).
  return {
    short: short as JobShortId,
    nonce: 'a'.repeat(8),
    sessionId: 'sess-' + short,
    source: 'shell',
    cwd: '/tmp/' + short,
    createdAt,
    isolation: 'none',
    ...overrides,
  }
}

// ---------- Tests ----------

describe('loadJobs', () => {
  test('fetches jobs from daemon list op', async () => {
    const srv = trackServer(await startFakeDaemon())
    srv.stageResponses([
      {
        ok: true,
        op: 'list',
        jobs: [makeJob('aaaa1111', 100), makeJob('bbbb2222', 200)],
      },
    ])
    const r = await loadJobs(srv.path, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.jobs.map(j => j.short as string)).toEqual([
        'bbbb2222',
        'aaaa1111',
      ])
    }
    expect(srv.requests.map(req => req.op)).toEqual(['list'])
  })

  test('sorts jobs by createdAt desc (newest first)', async () => {
    const srv = trackServer(await startFakeDaemon())
    srv.stageResponses([
      {
        ok: true,
        op: 'list',
        jobs: [
          makeJob('00000001', 100),
          makeJob('00000003', 300),
          makeJob('00000002', 200),
        ],
      },
    ])
    const r = await loadJobs(srv.path, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.jobs.map(j => j.short as string)).toEqual([
        '00000003',
        '00000002',
        '00000001',
      ])
    }
  })

  test('empty list resolves ok with no jobs', async () => {
    const srv = trackServer(await startFakeDaemon())
    srv.stageResponses([{ ok: true, op: 'list', jobs: [] }])
    const r = await loadJobs(srv.path, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.jobs).toEqual([])
  })

  test('returns {ok:false} with EPROTO code on proto mismatch', async () => {
    const srv = trackServer(await startFakeDaemon())
    srv.stageResponses([
      { ok: false, code: 'EPROTO', error: 'proto mismatch' },
    ])
    const r = await loadJobs(srv.path, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('EPROTO')
      expect(r.error).toMatch(/proto mismatch/)
    }
  })

  test('returns {ok:false} with ENOCONN code when daemon is not running', async () => {
    // No fake server started — connection will be refused.
    const tmp = mkdtempSync(join(tmpdir(), 'bg-agents-t9-no-sock-'))
    rmSync(tmp, { recursive: true, force: true })
    const sockPath = join(tmp, 'no-such-sock.sock')
    const r = await loadJobs(sockPath, 200, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('ENOCONN')
    }
  })

  test('returns {ok:false} with EPROTO on unexpected op in response', async () => {
    const srv = trackServer(await startFakeDaemon())
    srv.stageResponses([{ ok: true, op: 'kill' } as BGResponse])
    const r = await loadJobs(srv.path, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('EPROTO')
      expect(r.error).toMatch(/unexpected op/)
    }
  })
})

describe('killJob', () => {
  test('sends {op:kill, short} and returns ok on success', async () => {
    const srv = trackServer(await startFakeDaemon())
    srv.stageResponses([{ ok: true, op: 'kill' }])
    const r = await killJob(srv.path, 'aaaa1111' as JobShortId, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(true)
    expect(srv.requests).toHaveLength(1)
    expect(srv.requests[0]?.op).toBe('kill')
    expect((srv.requests[0] as { short?: string }).short).toBe('aaaa1111')
  })

  test('returns {ok:false} with ENOJOB code when daemon rejects', async () => {
    const srv = trackServer(await startFakeDaemon())
    srv.stageResponses([
      { ok: false, code: 'ENOJOB', error: 'short id aaaa1111 not in registry' },
    ])
    const r = await killJob(srv.path, 'aaaa1111' as JobShortId, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('ENOJOB')
      expect(r.error).toMatch(/not in registry/)
    }
  })

  test('returns {ok:false} with ENOCONN when daemon is unreachable', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bg-agents-t9-no-sock-'))
    rmSync(tmp, { recursive: true, force: true })
    const sockPath = join(tmp, 'no-such-sock.sock')
    const r = await killJob(sockPath, 'aaaa1111' as JobShortId, 200, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('ENOCONN')
    }
  })
})

describe('end-to-end list then kill', () => {
  test('list returns sorted jobs, kill removes by short id', async () => {
    const srv = trackServer(await startFakeDaemon())
    srv.stageResponses([
      {
        ok: true,
        op: 'list',
        jobs: [
          makeJob('aaaa1111', 100),
          makeJob('bbbb2222', 200),
          makeJob('cccc3333', 300),
        ],
      },
      { ok: true, op: 'kill' },
    ])
    const list = await loadJobs(srv.path, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(list.ok).toBe(true)
    if (!list.ok) throw new Error('expected ok')

    const target = list.jobs.find(j => (j.short as string) === 'bbbb2222')
    expect(target).toBeDefined()
    if (!target) throw new Error('unreachable')

    const r = await killJob(srv.path, target.short, 1000, {
      requestOnPathFn: requestOnPath,
    })
    expect(r.ok).toBe(true)

    // Verify ordering: cccc newest, then aaaa oldest.
    expect(list.jobs.map(j => j.short as string)).toEqual([
      'cccc3333',
      'bbbb2222',
      'aaaa1111',
    ])
    expect(srv.requests.map(req => req.op)).toEqual(['list', 'kill'])
    expect((srv.requests[1] as { short?: string }).short).toBe('bbbb2222')
  })
})