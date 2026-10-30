// @va/tools-demo: the example pack, and the contract every real pack follows. Two read-only tools
// (the voice worker names them in its allowlist, `apps/voice/src/tools.ts`) and one write tool
// (chat only). A pack names no channel: the app that composes it decides.
import type { ToolPack } from '@va/core'

import { createNote } from './tools/create-note.js'
import { getItem } from './tools/get-item.js'
import { searchItems } from './tools/search-items.js'

export const demoPack: ToolPack = {
  name: 'demo',
  tools: [searchItems, getItem, createNote],
}

export { createNote, getItem, searchItems }
