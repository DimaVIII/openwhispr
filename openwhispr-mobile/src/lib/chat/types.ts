export type ChatRole = 'user' | 'assistant';
export type ChatStepId = 'calendar' | 'search' | 'read' | 'write';

export interface ChatStep {
  id: ChatStepId;
  status: 'active' | 'done';
  label: string;
  detail?: string;
}

export interface ChatSource {
  noteId: number;
  title: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  text: string;
  steps: ChatStep[];
  sources: ChatSource[];
  createdAt: number;
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatConversationSummary extends ChatConversation {
  preview: string;
}

export interface NewChatMessage {
  conversationId: string;
  role: ChatRole;
  text: string;
  steps?: ChatStep[];
  sources?: ChatSource[];
}
