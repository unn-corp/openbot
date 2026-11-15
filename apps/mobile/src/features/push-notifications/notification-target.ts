import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
/** What a notification names: its agent, and the server and thread of the event. */
export interface NotificationTarget {
  agentId: string;
  serverId: string | null;
  /** The thread of the event. A thread of a channel opens the channel. */
  threadId: string | null;
  /** A user mention can name a channel without any agent or execution thread. */
  channelId?: string | null;
}

/** Data supplied only after the native extension has authenticated the server's sealed content. */
export function notificationTargetFromData(data: unknown): NotificationTarget | null {
  if (!isDynamicRecord(data)) return null;
  const serverId = isString(data.serverId) && data.serverId ? data.serverId : null;
  const channelId = isString(data.channelId) && data.channelId ? data.channelId : null;
  const agentId = isString(data.agentId) ? data.agentId : "";
  if (channelId && !serverId) return null;
  if (!channelId && !agentId) return null;
  return {
    agentId,
    serverId,
    threadId: isString(data.threadId) && data.threadId ? data.threadId : null,
    channelId,
  };
}
