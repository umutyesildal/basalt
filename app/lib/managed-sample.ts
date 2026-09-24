export type ManagedChartTone = "chart-1" | "chart-2" | "chart-3";

export interface ManagedAssetExample {
  symbol: string;
  name: string;
  tone: ManagedChartTone;
  currentBps: number;
  proposedBps: number;
}

export interface ManagedBasketExample {
  name: string;
  currentVersion: number;
  proposedVersion: number;
  noticeHours: number;
  rationale: string;
  assets: readonly ManagedAssetExample[];
  fees: {
    entryBps: number;
    exitBps: number;
    annualManagementBps: number;
  };
  illustrativeCreatorSplitBps: number;
  illustrativeTreasurySplitBps: number;
  provenance: {
    kind: "simulated";
    isConnectedToChain: false;
    label: string;
  };
}

/** Static fixture for the read-only managed-basket explainer. */
export const managedBasketExample = {
  name: "Steady compounders",
  currentVersion: 1,
  proposedVersion: 2,
  noticeHours: 24,
  rationale: "Illustrative shift toward AI infrastructure.",
  assets: [
    { symbol: "AAPL", name: "Apple", tone: "chart-1", currentBps: 5000, proposedBps: 4000 },
    { symbol: "NVDA", name: "Nvidia", tone: "chart-2", currentBps: 5000, proposedBps: 6000 },
  ],
  fees: { entryBps: 0, exitBps: 0, annualManagementBps: 0 },
  illustrativeCreatorSplitBps: 9000,
  illustrativeTreasurySplitBps: 1000,
  provenance: {
    kind: "simulated",
    isConnectedToChain: false,
    label: "Prototype · simulated example · no live trades",
  },
} as const satisfies ManagedBasketExample;
