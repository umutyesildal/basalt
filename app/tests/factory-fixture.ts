import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { PROGRAMS } from "../lib/solana";

export const [FACTORY_FIXTURE_ADDRESS,FACTORY_FIXTURE_BUMP] = PublicKey.findProgramAddressSync([Buffer.from("factory")],PROGRAMS.factory);
export function factoryFixture(treasury = new PublicKey(Buffer.alloc(32,91))): AccountInfo<Buffer> {
  const data = Buffer.alloc(89);
  createHash("sha256").update("account:FactoryConfig").digest().subarray(0,8).copy(data);
  new PublicKey(Buffer.alloc(32,90)).toBuffer().copy(data,8);
  treasury.toBuffer().copy(data,40);
  data.writeUInt16LE(9000,72); data.writeUInt16LE(300,74); data.writeUInt16LE(100,76); data.writeUInt16LE(300,78);
  data[88] = FACTORY_FIXTURE_BUMP;
  return {owner:PROGRAMS.factory,executable:false,lamports:1,data};
}
