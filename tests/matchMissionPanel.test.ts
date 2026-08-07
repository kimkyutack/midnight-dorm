import { describe, expect, it } from 'vitest';
import { matchMissionPanelVisibility } from '../src/client/matchMissionPanel';

describe('match mission panel visibility', () => {
  it('replaces an eligible hidden panel with only the compact restore button', () => {
    expect(matchMissionPanelVisibility(true, true)).toEqual({
      panelVisible: false,
      restoreVisible: true,
    });
  });

  it('removes both controls when match missions are not eligible', () => {
    expect(matchMissionPanelVisibility(false, true)).toEqual({
      panelVisible: false,
      restoreVisible: false,
    });
  });

  it('restores the full panel without leaving the compact button behind', () => {
    expect(matchMissionPanelVisibility(true, false)).toEqual({
      panelVisible: true,
      restoreVisible: false,
    });
  });
});
