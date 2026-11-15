import { useState } from 'react';

export const ACTIVITY_KINDS = ['note', 'call', 'task', 'meeting'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * State for a record page's tab card: which tab is open and which activity is being added. Picking
 * Note / Call / Task / Meeting in the toolbar opens the Activity tab with that form.
 */
export function useActivityTabs(initialTab = 'activity') {
  const [tab, setTab] = useState(initialTab);
  const [composing, setComposing] = useState<ActivityKind | null>(null);
  return {
    tab,
    setTab,
    composing,
    compose: (kind: ActivityKind) => {
      setComposing(kind);
      setTab('activity');
    },
    closeComposer: () => {
      setComposing(null);
    },
  };
}
