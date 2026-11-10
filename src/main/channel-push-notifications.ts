import type { ChannelPage, ChannelReadInput, ChannelSummary } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import {
  type ChannelMentionNotificationContent,
  ChannelMentionNotifications,
} from "@openbot/team-client/channel-notifications";

export interface ChannelPushViewer {
  memberId: string;
  protocol: number;
  capabilities: ReadonlySet<string>;
}

/** The same visibility and read rules as the authenticated channel routes, without changing history. */
export interface ChannelPushHistory {
  list(viewer: ChannelPushViewer): ChannelSummary[];
  page(viewer: ChannelPushViewer, input: ChannelReadInput): ChannelPage;
  unread(memberId: string, channelId: string, sequence: number): boolean;
}

/** Keeps the mention baseline of one phone, independently of the desktop and other phones. */
export class ChannelPushReader {
  readonly #tracker = new ChannelMentionNotifications();
  readonly #revisions = new Map<string, number>();
  readonly #history: ChannelPushHistory;
  readonly #viewer: ChannelPushViewer;

  constructor(history: ChannelPushHistory, viewer: ChannelPushViewer, translate: AppTranslate) {
    this.#history = history;
    this.#viewer = viewer;
    // Capture the startup pages now, before a new message arrives. An offline phone must never
    // receive historical mentions just because its saved registration was loaded after a restart.
    void this.refresh(translate, null).catch(() => undefined);
  }

  refresh(
    translate: AppTranslate,
    redact: ((text: string) => string) | null,
  ): Promise<ChannelMentionNotificationContent[]> {
    const channels = this.#history.list(this.#viewer);
    const pages = new Map(
      channels
        .filter((channel) => this.#revisions.get(channel.id) !== channel.revision)
        .map((channel) => [channel.id, this.#history.page(this.#viewer, { channelId: channel.id })]),
    );
    this.#revisions.clear();
    for (const channel of channels) this.#revisions.set(channel.id, channel.revision);
    return this.#tracker.read(channels, {
      readerId: this.#viewer.memberId,
      translate,
      redact,
      readPage: async (input) => {
        const page = input.beforeSequence === undefined ? pages.get(input.channelId) : undefined;
        return page ?? this.#history.page(this.#viewer, input);
      },
    });
  }

  /** Recheck after an await or a held event: the message can be read, deleted, or hidden by then. */
  unseen(mention: ChannelMentionNotificationContent): boolean {
    if (!this.#history.unread(this.#viewer.memberId, mention.channelId, mention.sequence)) return false;
    const channel = this.#history.list(this.#viewer).find((entry) => entry.id === mention.channelId && !entry.archived);
    if (!channel) return false;
    return this.#history
      .page(this.#viewer, { channelId: mention.channelId, beforeSequence: mention.sequence + 1 })
      .messages.some((entry) => entry.id === mention.messageId && !entry.superseded);
  }
}
