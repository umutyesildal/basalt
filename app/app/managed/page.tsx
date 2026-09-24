import type { Metadata } from "next";

import { ManagedOverview } from "@/components/managed/managed-overview";

export const metadata: Metadata = {
  title: { absolute: "Managed basket prototype — Basalt" },
  description:
    "A read-only, simulated walkthrough of managed basket shares, proposed allocations, and creator fees.",
};

export default function ManagedPage() {
  return <ManagedOverview />;
}
