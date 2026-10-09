import type { Connection } from "@solana/web3.js";
import { APP_NAMESPACE_ROUTING, type NamespaceRouting } from "../../lib/program-namespaces";
import { assertSafeCreateBasketFactory } from "../../lib/create-basket-security";

export type CreateAvailability = "checking" | "ready" | "unavailable";
export const CREATE_UNAVAILABLE_NOTICE = "New devnet baskets are temporarily unavailable. Existing baskets can still be redeemed.";

export class CreateFactoryUnavailableError extends Error {
  constructor() { super(CREATE_UNAVAILABLE_NOTICE); this.name = "CreateFactoryUnavailableError"; }
}

type FactoryConnection = Pick<Connection, "getAccountInfo" | "getGenesisHash">;

/** Read before any draft/ALT/wallet preparation, even after an earlier ready check. */
export async function withAvailableCreateFactory<T>(connection: FactoryConnection, prepare: () => Promise<T>, routing: NamespaceRouting = APP_NAMESPACE_ROUTING): Promise<T> {
  try { await assertSafeCreateBasketFactory(connection, routing); }
  catch { throw new CreateFactoryUnavailableError(); }
  return prepare();
}

/** Fail closed while disconnected from a verifiable factory, without requiring a wallet. */
export async function checkCreateAvailability(connection: FactoryConnection, routing: NamespaceRouting = APP_NAMESPACE_ROUTING): Promise<Exclude<CreateAvailability, "checking">> {
  try { return await withAvailableCreateFactory(connection, async () => "ready" as const, routing); }
  catch { return "unavailable"; }
}
