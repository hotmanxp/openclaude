/**
 * Global type declarations for build-time injected constants.
 * These are normally injected by the Bun build process but need
 * to be declared for tsc --noEmit to work correctly.
 */

declare const MACRO: {
  VERSION: string
  DISPLAY_VERSION?: string
  BUILD_TIME?: string
  ISSUES_EXPLAINER?: string
  PACKAGE_URL?: string
  NATIVE_PACKAGE_URL?: string
  VERSION_CHANGELOG?: string
  FEEDBACK_CHANNEL?: string
}

/**
 * Stub for resolveAntModel - appears to be a build-time resolved constant
 * Note: actual function is in utils/model/antModels.ts
 */

/**
 * PromiseWithResolvers is a ES2023 proposal type that TypeScript 5.2+ includes,
 * but we need to declare it here for older lib configurations.
 */
interface PromiseWithResolvers<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

declare module 'qrcode' {
  export function toString(data: string, options?: object): Promise<string>
}

declare module '*postCommitAttribution*' {
  export interface PostCommitAttributionModule {
    installPrepareCommitMsgHook: (
      worktreePath: string,
      worktreeHooksDir?: string,
    ) => Promise<void>
  }
  const m: PostCommitAttributionModule
  export default m
}

// Conditional module declarations for ant-only or feature-gated modules
// These modules don't exist in external builds but are conditionally imported

declare module './assistant/gate.js' {
  export interface KairosGate {
    isKairosEnabled(): Promise<boolean>
  }
  const kairosGate: KairosGate
  export default kairosGate
}

declare module './utils/eventLoopStallDetector.js' {
  export function startEventLoopStallDetector(): Promise<void>
}

declare module './server/parseConnectUrl.js' {
  export function parseConnectUrl(url: string): { host: string; port: number; path: string }
}

declare module '../components/FeedbackSurvey/useFrustrationDetection.js' {
  interface FrustrationDetectionState {
    state: 'closed' | 'open'
    handleTranscriptSelect: () => void
  }
  export function useFrustrationDetection(): FrustrationDetectionState
}

declare module '../hooks/notifs/useAntOrgWarningNotification.js' {
  export function useAntOrgWarningNotification(): void
}

declare module '../tools/WebBrowserTool/WebBrowserPanel.js' {
  export const WebBrowserPanelModule: unknown
}

declare module './utils/sdkHeapDumpMonitor.js' {
  export function startSdkHeapDumpMonitor(): Promise<void>
}

declare module './utils/sessionDataUploader.js' {
  export function uploadSessionData(sessionId: string): Promise<void>
}

declare module './assistant/sessionDiscovery.js' {
  export function discoverAssistantSessions(): Promise<unknown[]>
}

declare module './utils/ccshareResume.js' {
  export interface CcshareResumeResult {
    sessionId: string
    success: boolean
  }
  export function resumeFromCcshare(token: string): Promise<CcshareResumeResult>
}

declare module './server/server.js' {
  export interface ServerModule {
    startServer(): Promise<void>
    stopServer(): Promise<void>
  }
  const serverModule: ServerModule
  export default serverModule
}

declare module './server/sessionManager.js' {
  export interface SessionManagerModule {
    createSession(): Promise<unknown>
    getSession(id: string): unknown
  }
  const sessionManagerModule: SessionManagerModule
  export default sessionManagerModule
}

declare module './server/backends/dangerousBackend.js' {
  export interface DangerousBackendModule {
    start(): Promise<void>
    stop(): Promise<void>
  }
  const dangerousBackendModule: DangerousBackendModule
  export default dangerousBackendModule
}

declare module './server/serverBanner.js' {
  export function showServerBanner(): void
}

declare module './server/serverLog.js' {
  export interface ServerLogModule {
    info(msg: string): void
    error(msg: string): void
  }
  const serverLogModule: ServerLogModule
  export default serverLogModule
}

declare module './server/lockfile.js' {
  export interface LockfileModule {
    acquire(): Promise<boolean>
    release(): Promise<void>
  }
  const lockfileModule: LockfileModule
  export default lockfileModule
}

declare module './server/connectHeadless.js' {
  export interface ConnectHeadlessOptions {
    host: string
    port: number
  }
  export function connectHeadless(options: ConnectHeadlessOptions): Promise<unknown>
}

declare module 'src/cli/up.js' {
  export interface UpOptions {
    force?: boolean
  }
  export function runUp(options?: UpOptions): Promise<void>
  export const up: typeof runUp
}

declare module './cli/handlers/ant.js' {
  export interface AntHandlerModule {
    handleAntCommand(args: unknown): Promise<void>
  }
  const antHandlerModule: AntHandlerModule
  export default antHandlerModule

  export function logHandler(logId: string | number | undefined): Promise<void>
  export function errorHandler(number: number | undefined): Promise<void>
  export function exportHandler(source: string, outputFile: string): Promise<void>
  export function taskCreateHandler(subject: string, opts: { description?: string; list?: string }): Promise<void>
  export function taskListHandler(opts: { list?: string; pending?: boolean; json?: boolean }): Promise<void>
  export function taskGetHandler(id: string, opts: { list?: string }): Promise<void>
}

declare module 'src/cli/rollback.js' {
  export interface RollbackOptions {
    version?: string
  }
  export function runRollback(options?: RollbackOptions): Promise<void>
  export const rollback: typeof runRollback
}

declare module './components/agents/SnapshotUpdateDialog.js' {
  export function buildMergePrompt(agentType: string, memory: unknown): string
  export function SnapshotUpdateDialog(props: unknown): unknown
}

declare module './jobs/classifier.js' {
  export interface JobClassifierModule {
    classifyAndWriteState(
      jobDir: string,
      messages: unknown[],
    ): Promise<unknown>
  }
  const jobClassifierModule: JobClassifierModule
  export default jobClassifierModule
}

// Conditional module declarations for feature-gated modules
declare module './tools/SendUserFileTool/prompt.js' {
  export const SEND_USER_FILE_TOOL_NAME: string
}
