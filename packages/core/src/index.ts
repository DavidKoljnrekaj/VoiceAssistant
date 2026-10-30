// @va/core public surface. Test helpers (fakes, fixtures, harness) are exported from
// `@va/core/test`.
export { authenticateToken, isAuthError } from './auth.js'
export type { AuthContext, AuthError, AuthResult, Language, Role } from './auth.js'
export { CHANNEL_DEFAULTS, channelSettings } from './channel.js'
export type { Channel, ChannelSettings, Effort } from './channel.js'
export { MESSAGES_HR, mapAnthropicError } from './errors.js'
export type { ErrorCode, MappedError } from './errors.js'
export { errorReason, log, REASON_MAX_CHARS } from './log.js'
export type { LogLevel } from './log.js'
export { dispatchTool, dispatchToolWithTimeout } from './loop/dispatch.js'
export type { ToolOutcome } from './loop/dispatch.js'
export { applyMessageCacheBreakpoint, assembleHistory, withoutToolBlocks } from './loop/history.js'
export type { AssembleOptions, HistoryRow } from './loop/history.js'
export { runOrchestrationLoop, TRUNCATED_HR } from './loop/orchestrator.js'
export type {
  ContentBlock,
  EventSink,
  InMemoryMessage,
  LoopConfig,
  LoopHooks,
  LoopInput,
  LoopMark,
  MessageRow,
  MessageStore,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
  Usage,
  UsageReport,
} from './loop/ports.js'
export { FALLBACK_BETA, modelProfile } from './model.js'
export type { ModelExtra, ModelProfile } from './model.js'
export { buildStaticSystemPrompt, buildUserContext, dateLine, DOMAIN_RULES_HR } from './prompts/index.js'
export { BufferedSink } from './sinks/buffered.js'
export { speakable } from './sinks/speakable.js'
export { FILLERS_HR, HOLD_MS, SpokenTextSink } from './sinks/spoken.js'
export type { SpokenEnd } from './sinks/spoken.js'
export { defineTool } from './tools/define.js'
export type { ToolDefinition, ToolHandlerExtras, ToolPack } from './tools/define.js'
export { ToolRegistry } from './tools/registry.js'
export type { ChannelAllowlist, RefusalReason } from './tools/registry.js'
export { toAnthropicTool } from './tools/schema.js'
