import { redirect } from "next/navigation";

/** Onchain creation is not available yet; keep the simulation as the only create flow. */
export default function OnchainCreatePage(): never {
  redirect("/create");
}
