// @va/tools-demo: the example pack, and the contract every real pack follows. Two read-only tools
// (on the voice allowlist in @va/core) and one write tool (chat only).
import type { ToolPack } from '@va/core'

import { createNote } from './tools/create-note.js'
import { getItem } from './tools/get-item.js'
import { searchItems } from './tools/search-items.js'

export const demoPack: ToolPack = {
  name: 'demo',
  tools: [searchItems, getItem, createNote],
}

export { createNote, getItem, searchItems }
