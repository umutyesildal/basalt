/** Compare authenticated immutable chain fields before publishing a position snapshot. */
import type { PgLike } from "../db/client.js";
import type { DecodedBasketState } from "./basketState.js";

export async function assertBasketProjectionMatches(db: PgLike, state: DecodedBasketState): Promise<void> {
  const result = await db.query(`SELECT 1 FROM baskets WHERE pubkey=$1 AND factory=$2 AND creator=$3 AND treasury=$4
    AND share_mint=$5 AND nonce=$6::bigint AND created_at=$7::timestamptz AND metadata_hash=$8
    AND num_constituents=$9 AND constituents=$10::text[] AND weights_bps=$11::int[]
    AND entry_fee_bps=$12 AND exit_fee_bps=$13 AND management_fee_bps=$14 FOR SHARE`, [
    state.pubkey, state.factory, state.creator, state.treasury, state.shareMint, state.nonce,
    state.createdAt, state.metadataHash, state.numConstituents, state.constituents, state.weightsBps,
    state.entryFeeBps, state.exitFeeBps, state.managementFeeBps,
  ]);
  if (result.rows.length !== 1) throw new Error("Indexed basket immutable fields do not match authenticated chain state");
}
