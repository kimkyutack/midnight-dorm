export interface MatchMissionPanelVisibility {
  panelVisible: boolean;
  restoreVisible: boolean;
}

/** Keep the full panel and its compact restore control mutually exclusive. */
export function matchMissionPanelVisibility(
  eligible: boolean,
  userHidden: boolean,
): MatchMissionPanelVisibility {
  return {
    panelVisible: eligible && !userHidden,
    restoreVisible: eligible && userHidden,
  };
}
