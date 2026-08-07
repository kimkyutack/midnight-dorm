import { describe, expect, it } from 'vitest';
import { socialInviteDecisionColumn } from '../src/server/social';

describe('social room invites', () => {
  it('maps invite decisions to the persisted D1 column names', () => {
    expect(socialInviteDecisionColumn('accept')).toBe('accepted_at');
    expect(socialInviteDecisionColumn('decline')).toBe('declined_at');
  });
});
