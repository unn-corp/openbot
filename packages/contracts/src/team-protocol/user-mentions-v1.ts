/**
 * Optional channel user mentions. Message text can contain `@[Name](user:memberId)` (or its
 * `user+uri` encoding). A post addressed only to people starts no agent task. Clients notify the
 * authenticated named member from full channel history. Phones with this capability also receive
 * sealed push content with kind `mention` and `channelId`; `agentId` is empty for a person-written
 * message and `threadId` is null. A tap opens the channel. No Team API field or route is added.
 * The picker stays hidden on a host without this capability, whose routing still treats every
 * person-written channel message as an agent request.
 */
export const USER_MENTIONS_CAPABILITY = "user-mentions-v1";
