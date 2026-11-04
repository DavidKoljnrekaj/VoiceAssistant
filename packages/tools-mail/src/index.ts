// @va/tools-mail: the email pack. Part 13a ships only the Graph client; the read tools (13b) and
// the confirmed writes (13c) and `createMailPack` come later. Surface: docs/MAIL.md.
export {
  createGraphClient,
  GRAPH_BASE_URL,
  GraphError,
  MAX_RETRY_AFTER_MS,
  type GraphClient,
  type GraphClientConfig,
  type GraphErrorKind,
  type GraphRequestOptions,
} from './graph.js'
