/* eslint-disable react-refresh/only-export-components */
// The provider calls useChatStore exactly once; consumers use useChat(). It sits above the router
// (App.tsx) so the conversation and its open stream survive navigation.
import { createContext, type ReactNode, useContext } from 'react'

import { type ChatStore, useChatStore } from './hooks/useChatStore'

const ChatContext = createContext<ChatStore | null>(null)

export default function ChatProvider({ children }: { children: ReactNode }) {
  const store = useChatStore()
  return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>
}

export function useChat(): ChatStore {
  const store = useContext(ChatContext)
  if (store === null) throw new Error('useChat must be used within <ChatProvider>')
  return store
}
