import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type {
  ChannelPreview,
  ChannelSummary,
  ClientAgentSummary,
  ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { type AgentNotificationChannel, plainPreview } from "./agent-notifications";

export interface ChannelNotificationContent {
  title: string;
  body: string;
  channelId: string;
  agentId: string;
}

export interface ChannelMentionNotificationContent extends ChannelNotificationContent {
  messageId: string;
  sequence: number;
}

export interface ChannelNotificationOptions {
  agents: readonly ClientAgentSummary[];
  translate: AppTranslate;
  level: ServerNotificationLevel;
  /** Hides the secrets in the preview. Null when the user keeps the agent's words out of notifications. */
  redact: ((text: string) => string) | null;
}

type SettledReply = ChannelPreview & { author: { kind: "agent"; id: string } };

/**
 * The newest message of a channel when it is an agent reply and the work of the channel has ended:
 * the message stopped streaming and no task is queued, waits or runs. A turn can write many messages,
 * ask a question on the way, or pass work to other agents, so only the end of the work is a reply to
 * tell.
 */
function settledReply(channel: ChannelSummary): SettledReply | null {
  const last = channel.lastMessage;
  if ((channel.openTasks ?? channel.activeTasks) > 0 || last?.author?.kind !== "agent") return null;
  if (last.status !== "completed" && last.status !== "failed") return null;
  return { ...last, author: { kind: "agent", id: last.author.id } };
}

/**
 * The channels of a new list that show an agent reply that is news: its work ended since the
 * previous list, and the reader has not read it. It needs no agent list, so a caller can skip the
 * agent lookup when there is none.
 *
 * The first list of a server is only the baseline: `previous` null gives none. A host without
 * channel-attention-v1 sends no author or status, so its replies are never news.
 */
export function newChannelReplies(
  previous: readonly ChannelSummary[] | null,
  next: readonly ChannelSummary[],
): { channel: ChannelSummary; reply: SettledReply }[] {
  if (previous === null) return [];
  const before = new Map(previous.map((channel) => [channel.id, settledReply(channel)] as const));
  return next.flatMap((channel) => {
    if (channel.archived || channel.unreadCount === 0) return [];
    const reply = settledReply(channel);
    if (!reply) return [];
    const earlier = before.get(channel.id);
    // The same reply, already settled in the list before: it was news then, not now.
    if (earlier?.author.id === reply.author.id && earlier.at === reply.at) return [];
    return [{ channel, reply }];
  });
}

/**
 * The notifications of the new replies, one for each channel. The level and the agent's own switch
 * apply as for an agent chat reply (`notificationForAgentEvent`): a reply notifies only at "all".
 */
export function channelReplyNotifications(
  previous: readonly ChannelSummary[] | null,
  next: readonly ChannelSummary[],
  options: ChannelNotificationOptions,
): ChannelNotificationContent[] {
  if (options.level !== "all") return [];
  return newChannelReplies(previous, next).flatMap(({ channel, reply }) => {
    const agentId = reply.author.id;
    const agent = options.agents.find((candidate) => candidate.id === agentId);
    if (!agent?.notifications) return [];
    const body =
      reply.status === "failed"
        ? options.translate("notification.failed")
        : (options.redact && plainPreview(options.redact(reply.text))) ||
          options.translate("notification.channelMessage");
    const title = options.translate("notification.channelTitle", { agent: agent.name, channel: channel.name });
    return [{ title, body, channelId: channel.id, agentId }];
  });
}

/** The channel that owns `threadId` in a channel list, from the threads of channel-attention-v1. */
export function channelForThread(
  channels: readonly ChannelSummary[],
  threadId: string | null,
): AgentNotificationChannel | null {
  if (threadId === null) return null;
  const channel = channels.find((candidate) => candidate.threads?.some((thread) => thread.threadId === threadId));
  return channel ? { id: channel.id, name: channel.name } : null;
}

/**
 * Reads full messages for mentions: the sidebar preview is truncated and has no stable member IDs.
 * The first list is a baseline. Later lists inspect every new page, including a streamed message
 * when it completes. Reading history does not mark it read or change the released wire contract.
 */
export interface ChannelMentionReadOptions {
  readerId: string;
  readPage: (
    input: import("@openbot/contracts/ipc").ChannelReadInput,
  ) => Promise<import("@openbot/contracts/ipc").ChannelPage>;
  translate: AppTranslate;
  redact: ((text: string) => string) | null;
}

export class ChannelMentionNotifications {
  readonly #channels = new Map<string, { through: number; pending: Set<number>; stamp: string }>();

  #initialized = false;
  #reading: Promise<void> = Promise.resolve();

  read(
    channels: readonly ChannelSummary[],
    options: ChannelMentionReadOptions,
  ): Promise<ChannelMentionNotificationContent[]> {
    const result = this.#reading.then(() => this.#read(channels, options));
    this.#reading = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #read(
    channels: readonly ChannelSummary[],
    options: ChannelMentionReadOptions,
  ): Promise<ChannelMentionNotificationContent[]> {
    const notifications: ChannelMentionNotificationContent[] = [];
    const staged = new Map(this.#channels);
    const ids = new Set(channels.map((channel) => channel.id));
    for (const id of staged.keys()) if (!ids.has(id)) staged.delete(id);
    for (const channel of channels) {
      const last = channel.lastMessage;
      const stamp = JSON.stringify([channel.revision, last]);
      const previous =
        this.#channels.get(channel.id) ??
        (this.#initialized ? { through: 0, pending: new Set<number>(), stamp: "" } : undefined);
      if (previous?.stamp === stamp) continue;
      if (!previous && !last) {
        staged.set(channel.id, { through: 0, pending: new Set(), stamp });
        continue;
      }
      const page = await options.readPage({ channelId: channel.id });
      const pending = new Set(previous?.pending);
      const messages = [...page.messages];
      let cursor = page.olderCursor;
      const floor = previous ? Math.min(previous.through, ...pending) : page.throughSequence;
      // The first page may contain only a single long message. Read down to the previous baseline.
      while (previous && cursor !== null && cursor > floor) {
        const older = await options.readPage({ channelId: channel.id, beforeSequence: cursor });
        messages.push(...older.messages);
        if (older.olderCursor !== null && older.olderCursor >= cursor)
          throw new Error("Channel history did not advance.");
        cursor = older.olderCursor;
      }
      const found: ChannelMentionNotificationContent[] = [];
      for (const entry of messages.sort((a, b) => a.sequence - b.sequence)) {
        if (!previous || (entry.sequence <= previous.through && !pending.has(entry.sequence))) continue;
        if (entry.message.status === "streaming") {
          pending.add(entry.sequence);
          continue;
        }
        pending.delete(entry.sequence);
        if (
          channel.archived ||
          entry.superseded ||
          entry.author.id === options.readerId ||
          entry.author.kind === "coordinator"
        )
          continue;
        if (!chatTagReferences(entry.message.text).some((tag) => tag.kind === "user" && tag.id === options.readerId))
          continue;
        found.push({
          title: options.translate("notification.channelTitle", { agent: entry.author.name, channel: channel.name }),
          body:
            (options.redact && plainPreview(options.redact(entry.message.text))) ||
            options.translate("notification.userMention"),
          channelId: channel.id,
          messageId: entry.id,
          sequence: entry.sequence,
          agentId: entry.author.kind === "agent" ? entry.author.id : "",
        });
      }
      staged.set(channel.id, { through: page.throughSequence, pending, stamp });
      notifications.push(...found);
    }
    this.#initialized = true;
    this.#channels.clear();
    for (const [id, value] of staged) this.#channels.set(id, value);
    return notifications;
  }
}
