import type { Metadata } from "next";
import DevnetOwnerSetup from "@/components/devnet/devnet-owner-setup";

export const metadata: Metadata = {
  title: "Devnet owner setup",
  description: "Accept program ownership and initialize the devnet basket setup with your own wallet.",
};
export default function DevnetSetupPage() { return <DevnetOwnerSetup />; }
