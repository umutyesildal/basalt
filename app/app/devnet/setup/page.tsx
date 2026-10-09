import type { Metadata } from "next";
import DevnetOwnerSetup from "@/components/devnet/devnet-owner-setup";

export const metadata: Metadata = {
  title: "Devnet owner setup",
  description: "Review and accept the designated devnet whitelist administration with your own wallet.",
};
export default function DevnetSetupPage() { return <DevnetOwnerSetup />; }
