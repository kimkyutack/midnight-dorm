import { describe, expect, it } from 'vitest';
import { decodeSocialRoomInvite, encodeSocialRoomInvite, socialInviteDecisionColumn } from '../src/server/social';

describe('social room invites', () => {
  it('maps invite decisions to the persisted D1 column names', () => {
    expect(socialInviteDecisionColumn('accept')).toBe('accepted_at');
    expect(socialInviteDecisionColumn('decline')).toBe('declined_at');
  });

  it('keeps legacy defense invites compatible', () => {
    expect(encodeSocialRoomInvite('ABCD2345', 'defense')).toBe('ABCD2345');
    expect(decodeSocialRoomInvite('ABCD2345')).toEqual({ roomCode: 'ABCD2345', mode: 'defense' });
  });

  it('round-trips hide-and-seek invites without changing the visible room code', () => {
    const stored = encodeSocialRoomInvite('CHASE234', 'hide-seek');
    expect(stored).toBe('HS:CHASE234');
    expect(decodeSocialRoomInvite(stored)).toEqual({ roomCode: 'CHASE234', mode: 'hide-seek' });
  });
});
