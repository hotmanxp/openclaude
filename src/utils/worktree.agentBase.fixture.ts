// Child-process fixture for worktree.agentBase.test.ts.
//
// createAgentWorktree shells out to git via execFileNoThrow.js, which other
// test suites mock with `mock.module` — a process-global override Bun cannot
// reliably revert. Running the call in this standalone process (which loads
// only worktree.ts and its real dependencies, never any *.test.ts) guarantees
// it sees the genuine modules, immune to whatever the shared test process has
// leaked.
//
// Usage: bun run worktree.agentBase.fixture.ts <cfgDir> <repoDir> <name>
// Prints { worktreePath } as JSON on stdout.
//
// OpenCC fork adaptation: upstream uses `setClaudeConfigHomeDirForTesting()`
// from envUtils.js to override the config dir at runtime. OpenCC's envUtils.js
// has no such setter — `getClaudeConfigHomeDir()` is memoized off
// `process.env.OPENCC_CONFIG_DIR`. Set the env var BEFORE importing
// worktree.js (the import chain pulls in envUtils, and the first call freezes
// the cache key), so the child process picks up the test's cfgDir.
export {}

const [cfgDir, repoDir, slug] = process.argv.slice(2)

if (!cfgDir || !repoDir || !slug) {
  process.stderr.write('usage: <cfgDir> <repoDir> <slug>\n')
  process.exit(2)
}

process.env.OPENCC_CONFIG_DIR = cfgDir
delete process.env.CLAUDE_CONFIG_DIR

const { createAgentWorktree } = await import('./worktree.js')

const result = await createAgentWorktree(slug, { cwd: repoDir })
process.stdout.write(JSON.stringify({ worktreePath: result.worktreePath }))
