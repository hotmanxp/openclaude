/**
 * Shared external dependency lists for CLI and SDK bundles.
 *
 * Used by build.ts and validate-externals.ts.
 * When adding a new dependency to package.json, check if it should be
 * added here (large packages, native modules, or packages with many exports).
 */

// Packages that should be kept external in ALL bundles (CLI + SDK)
export const COMMON_EXTERNALS: string[] = [
  // OpenTelemetry — too many named exports to stub, kept external
  '@opentelemetry/api',
  '@opentelemetry/api-logs',
  '@opentelemetry/core',
  '@opentelemetry/exporter-trace-otlp-grpc',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/exporter-logs-otlp-http',
  '@opentelemetry/exporter-logs-otlp-proto',
  '@opentelemetry/exporter-logs-otlp-grpc',
  '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/exporter-metrics-otlp-grpc',
  '@opentelemetry/exporter-metrics-otlp-http',
  '@opentelemetry/exporter-prometheus',
  '@opentelemetry/resources',
  '@opentelemetry/sdk-trace-base',
  '@opentelemetry/sdk-trace-node',
  '@opentelemetry/sdk-logs',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/semantic-conventions',
  // Native image processing
  'sharp',
  // Cloud provider SDKs
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-providers',
  '@azure/identity',
  'google-auth-library',
  // @vscode/ripgrep ships a platform-specific binary alongside its
  // index.js and resolves the path via __dirname at runtime. Bundling
  // would freeze the build host's absolute path into dist/cli.mjs, so we
  // keep it external and rely on the npm package being installed.
  '@vscode/ripgrep',
  // Orama search engine
  '@orama/orama',
  '@orama/plugin-data-persistence',
]

// Additional packages external only in the SDK bundle (TUI + heavy deps)
export const SDK_ONLY_EXTERNALS: string[] = [
  'react',
  'react-reconciler',
  'ink',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
]

// Optional runtime packages: dynamically imported only when a provider/feature
// needs them, and NOT listed in package.json `dependencies`, so a default
// install stays small and warning-free. Restored from upstream — the fork's
// optional-runtime feature (src/utils/optionalRuntimeModule.ts, used by
// services/api/client.ts, utils/auth.ts, utils/proxy.ts) still depends on this
// contract being validated by scripts/optionalRuntimeSpecifiers.test.ts and
// scripts/externalsValidation.ts.
export const OPTIONAL_RUNTIME_EXTERNALS: string[] = [
  // Cloud provider SDKs (dynamically imported per-provider)
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-provider-node',
  '@aws-sdk/credential-providers',
  '@smithy/core',
  '@smithy/node-http-handler',
  '@azure/identity',
  // Anthropic Bedrock client — loaded via the runtime importer in
  // services/api/client.ts. Not bundled (it statically imports @aws-sdk) and
  // not shipped; Bedrock users install it on demand (it pulls @aws-sdk itself).
  '@anthropic-ai/bedrock-sdk',
  // Anthropic Foundry client — also loaded only via the runtime importer in
  // services/api/client.ts (CLAUDE_CODE_USE_FOUNDRY).
  '@anthropic-ai/foundry-sdk',
  // GCP/Vertex auth — loaded via runtime import in services/api/client.ts.
  'google-auth-library',
  // Native image processing — loaded via dynamic import in the image tools.
  'sharp',
  // Sentry error reporting — loaded via require() in utils/sentry.ts only
  // when SENTRY_DSN is set.
  '@sentry/node',
]

// OPTIONAL_RUNTIME_EXTERNALS that are loaded ONLY through the runtime importer
// (the `new Function` indirection in src/utils/optionalRuntimeModule.ts), so
// esbuild never sees a static reference to them. These must NOT appear in the
// externals lists.
export const RUNTIME_INDIRECTION_ONLY_EXTERNALS: string[] = [
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/foundry-sdk',
]

// OPTIONAL_RUNTIME_EXTERNALS that are NOT direct devDependencies because they
// are pulled transitively by another optional package's dependency tree.
export const TRANSITIVE_OPTIONAL_EXTERNALS: string[] = [
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/credential-providers',
]

// Computed full lists
export const CLI_EXTERNALS: string[] = COMMON_EXTERNALS
export const SDK_EXTERNALS: string[] = [...COMMON_EXTERNALS, ...SDK_ONLY_EXTERNALS]

// Packages intentionally bundled (not external, not flagged by validation)
// These are small utilities that are fine to inline into the output bundle.
export const INTENTIONALLY_BUNDLED: string[] = [
  // Test utilities (bundled, not external)
  // Anthropic provider variants (bundled, not the main SDK)
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/foundry-sdk',
  '@anthropic-ai/sandbox-runtime',
  '@anthropic-ai/vertex-sdk',
  // CLI / TUI utilities
  '@alcalzone/ansi-tokenize',
  '@commander-js/extra-typings',
  'bidi-js',
  'chalk',
  'cli-boxes',
  'cli-highlight',
  'commander',
  'emoji-regex',
  'env-paths',
  'figures',
  'get-east-asian-width',
  'indent-string',
  'supports-hyperlinks',
  'wrap-ansi',
  // Data formats
  'jsonc-parser',
  'yaml',
  'marked',
  'turndown',
  'xss',
  // Data utilities
  'acorn',
  'ajv',
  'auto-bind',
  'diff',
  'jsonrepair',
  'fflate',
  'fuse.js',
  'ignore',
  'lodash-es',
  'lru-cache',
  'p-map',
  'picomatch',
  'proper-lockfile',
  'semver',
  'shell-quote',
  'signal-exit',
  'stack-utils',
  'code-excerpt',
  'type-fest',
  // Networking
  'axios',
  'cross-spawn',
  'duck-duck-scrape',
  'execa',
  'https-proxy-agent',
  'tree-kill',
  'undici',
  'ws',
  // React ecosystem (react/react-reconciler are SDK_ONLY_EXTERNALS, bundled in CLI)
  'react',
  'react-compiler-runtime',
  'react-reconciler',
  'usehooks-ts',
  // Anthropic SDK (external in SDK bundle, bundled in CLI)
  // MCP SDK (external in SDK bundle, bundled in CLI)
  '@modelcontextprotocol/sdk',
  // Schema validation
  'ajv-formats',
  // Terminal / TUI (CLI bundle inlines ink)
  'asciichart',
  'ink',
  // gRPC (bundled into CLI, not external)
  '@grpc/grpc-js',
  '@grpc/proto-loader',
  // Web scraping
  '@mendable/firecrawl-js',
  // Language server protocol
  'vscode-languageserver-protocol',
  // File watching
  'chokidar',
  // Test / build tooling (devDeps; not bundled, not external)
  '@testing-library/react-hooks',
  '@types/bun',
  '@types/node',
  '@types/react',
  'react-devtools-core',
  'react-test-renderer',
  'tsx',
  'typescript',
]
