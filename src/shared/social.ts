import type { RankId, RankedTier } from './types';

export type SocialInviteMode = 'defense' | 'hide-seek';

export interface SocialPerson {
  accountId: string;
  nickname: string;
  avatarUrl: string | null;
  rank: RankId;
  rankedTier: RankedTier;
}

export interface SocialFriend extends SocialPerson {
  acceptedAt: number;
}

export interface FriendRequest extends SocialPerson {
  createdAt: number;
  direction: 'incoming' | 'outgoing';
}

export interface DirectMessage {
  id: string;
  senderAccountId: string;
  recipientAccountId: string;
  body: string;
  createdAt: number;
}

export interface SocialConversation extends SocialPerson {
  lastMessage: DirectMessage | null;
  unreadCount: number;
}

export interface SocialInvite extends SocialPerson {
  id: string;
  roomCode: string;
  mode: SocialInviteMode;
  createdAt: number;
  expiresAt: number;
}

export interface SocialSnapshot {
  friendCode: string;
  friends: SocialFriend[];
  requests: FriendRequest[];
  conversations: SocialConversation[];
  invites: SocialInvite[];
  unreadCount: number;
}
