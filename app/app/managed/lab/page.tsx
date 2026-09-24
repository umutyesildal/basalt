import type { Metadata } from "next";
import { ManagedLab } from "./managed-lab";

export const metadata: Metadata = {
  title: { absolute: "Managed basket lab — Basalt" },
  description: "Connect a wallet to try the Managed V2 basket flow on a local validator.",
};

export default function ManagedLabPage() {
  return <ManagedLab />;
}
