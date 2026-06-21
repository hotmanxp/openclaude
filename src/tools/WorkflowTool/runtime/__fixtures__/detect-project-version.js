// src/tools/WorkflowTool/runtime/__fixtures__/detect-project-version.js
//
// End-to-end test fixture that exercises the args feature synced from
// upstream claude-code 2.1.185. The script:
//
//   1. Reads `args.projectDir` (defaults to '.' if the LLM caller
//      did not pass it).
//   2. Phase 1 — `agent()` identifies the project type from
//      manifest files (package.json / pyproject.toml / Cargo.toml /
//      go.mod / ...).
//   3. Phase 2 — `agent()` reads the type-specific manifest and
//      returns the version string.
//   4. Returns `{ projectDir, projectType, version }`.
//
// The fixture uses the modern `export const meta = {...}` form (the
// legacy `async function userScript(args) { ... }` form is also
// supported by runWorkflowInVm, but the new shape is what upstream
// 2.1.185 documents in the tool description).
//
// The agent() calls in this file are stubbed by the test that
// loads this fixture (see detect-project-version.test.ts). The
// real LLM is not invoked — the test only validates the
// args → phase-1 agent → phase-2 agent → return value flow.

export const meta = {
  name: 'detect-project-version',
  description: 'Two-phase workflow: identify project type, then find version',
  phases: [
    {
      title: 'Identify type',
      detail: 'Inspect the project directory and identify what kind of project it is (node/python/rust/go/...)',
    },
    {
      title: 'Find version',
      detail: 'Read the type-specific manifest file (package.json / pyproject.toml / Cargo.toml / ...) and extract the version string',
    },
  ],
}

// `args` is the value passed verbatim from the LLM tool's `args` input.
// Per the new schema (z.unknown() — port of upstream 2.1.185), the
// caller can pass any JSON-serializable value. We accept the object
// shape `{ projectDir: string }` and fall back to '.' when the LLM
// did not provide one. The host caller is responsible for resolving
// the actual cwd before invocation — the VM context has no `process`.
//
// The `args && args.projectDir` guard handles three cases:
//   - args is undefined (LLM omitted `args`)          → '.'
//   - args is null (LLM passed `args: null`)         → '.'
//   - args is { projectDir: '...' }                  → that path
//   - args is { projectDir: undefined, ... }         → '.'
const projectDir = (args && typeof args === 'object' && args.projectDir) || '.'

phase('Identify type')
log(`Inspecting project at: ${projectDir}`)

const typeResult = await agent(
  `Look at the project directory at "${projectDir}" and identify what kind of project it is. ` +
    `Common manifest files: package.json (Node), pyproject.toml or setup.py (Python), ` +
    `Cargo.toml (Rust), go.mod (Go), pom.xml or build.gradle (Java), *.csproj (C#), ` +
    `Gemfile (Ruby). Return the type as a single lowercase word (e.g. "node", "python", ` +
    `"rust", "go", "java", "csharp", "ruby", "unknown").`,
  {
    schema: {
      type: 'object',
      properties: { type: { type: 'string' } },
      required: ['type'],
    },
  },
)
const projectType = (typeResult && typeResult.type) || 'unknown'
log(`Detected project type: ${projectType}`)

phase('Find version')
const versionResult = await agent(
  `For a ${projectType} project at "${projectDir}", find the project version. ` +
    `Read the appropriate manifest file (e.g. package.json "version" field for Node, ` +
    `pyproject.toml "version" for Python, Cargo.toml [package].version for Rust, ` +
    `go.mod module line for Go) and return the version string. If no version is found, ` +
    `return "unknown".`,
  {
    schema: {
      type: 'object',
      properties: { version: { type: 'string' } },
      required: ['version'],
    },
  },
)
const version = (versionResult && versionResult.version) || 'unknown'
log(`Detected version: ${version}`)

return { projectDir, projectType, version }
