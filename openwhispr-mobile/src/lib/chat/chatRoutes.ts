/** The `[id]` param of a chat that has no conversation yet. */
export const NEW_CHAT_ID = 'new';

export const CHAT_HOME_ROUTE = '/(tabs)/(chat)';
export const CHAT_HISTORY_ROUTE = '/(tabs)/(chat)/history';

export const chatConversationRoute = (conversationId: string): `/(tabs)/(chat)/${string}` =>
  `/(tabs)/(chat)/${conversationId}`;
