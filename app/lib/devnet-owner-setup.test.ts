import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Buffer } from "buffer";
import bs58 from "bs58";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { createDevnetOwnerSetupClient, DEVNET_OWNER_SETUP_POLICY, DevnetOwnerSetupError, describeDevnetOwnerSetupError, ownerProgramData, type OwnerSetupArtifacts, type OwnerSetupIntent, type OwnerSetupPolicy, type OwnerSetupReceipt, type OwnerSetupRpc, type OwnerSetupSubmission } from "./devnet-owner-setup";
import { UPGRADEABLE_LOADER } from "./devnet-owner-claim";
import { DEVNET_GENESIS_HASH } from "./program-namespaces";
import { DEVNET_MOCK_TOKENS } from "./devnet-faucet";
import { TOKEN_2022_PROGRAM_ID } from "./token-2022";

const owner = Keypair.fromSeed(new Uint8Array(32).fill(11)), bootstrap = Keypair.fromSeed(new Uint8Array(32).fill(12));
const nonce = Keypair.fromSeed(new Uint8Array(32).fill(13)).publicKey;
const nonceValue = Keypair.fromSeed(new Uint8Array(32).fill(14)).publicKey.toBase58();
const sourceCommit = "a".repeat(40);
const policy: OwnerSetupPolicy = { ...DEVNET_OWNER_SETUP_POLICY, owner: owner.publicKey.toBase58(), bootstrapAuthority: bootstrap.publicKey.toBase58(), treasury: owner.publicKey.toBase58() };
const programs = [policy.programs.whitelist, policy.programs.factory, policy.programs.basket].map(value => new PublicKey(value));
const [config, configBump] = PublicKey.findProgramAddressSync([Buffer.from("config")], programs[0]);
const [factory, factoryBump] = PublicKey.findProgramAddressSync([Buffer.from("factory")], programs[1]);
const admissionKeys = DEVNET_MOCK_TOKENS.map(token => PublicKey.findProgramAddressSync([Buffer.from("mint"), token.mint.toBuffer()], programs[0]));
const code = [Buffer.from("reviewed-whitelist"), Buffer.from("reviewed-factory"), Buffer.from("reviewed-basket")];
const artifacts: OwnerSetupArtifacts = { sourceCommit, programs: Object.fromEntries(["whitelist", "basket_factory", "basket"].map((role, i) => [role, { programId: programs[i].toBase58(), programData: ownerProgramData(programs[i]).toBase58(), elfBytes: code[i].length, elfSha256: createHash("sha256").update(code[i]).digest("hex"), deployedSlot: "99" }])) as OwnerSetupArtifacts["programs"] };
const client = createDevnetOwnerSetupClient(policy, artifacts);
const account = (ownerKey: PublicKey, data: Buffer, executable = false, lamports = 10_000_000_000): AccountInfo<Buffer> => ({ owner: ownerKey, data, executable, lamports, rentEpoch: 0 });
const discriminator = (value: string) => createHash("sha256").update(value).digest().subarray(0, 8);
function fixture(initialAuthority: "bootstrap" | "owner" = "bootstrap") {
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const programBytes: Buffer[] = [], loaderBytes: Buffer[] = [];
  programs.forEach((program, i) => {
    const bytes = Buffer.alloc(36); bytes.writeUInt32LE(2); ownerProgramData(program).toBuffer().copy(bytes, 4);
    const loader = Buffer.alloc(45 + code[i].length + 8); loader.writeUInt32LE(3); loader.writeBigUInt64LE(99n, 4); loader[12] = 1;
    (initialAuthority === "owner" ? owner : bootstrap).publicKey.toBuffer().copy(loader, 13); code[i].copy(loader, 45);
    programBytes.push(bytes); loaderBytes.push(loader);
    accounts.set(program.toBase58(), account(UPGRADEABLE_LOADER, bytes, true));
    accounts.set(ownerProgramData(program).toBase58(), account(UPGRADEABLE_LOADER, loader));
  });
  const nonceBytes = Buffer.alloc(80); nonceBytes.writeUInt32LE(1); nonceBytes.writeUInt32LE(1, 4); bootstrap.publicKey.toBuffer().copy(nonceBytes, 8); new PublicKey(nonceValue).toBuffer().copy(nonceBytes, 40); nonceBytes.writeBigUInt64LE(5000n, 72);
  accounts.set(nonce.toBase58(), account(SystemProgram.programId, nonceBytes));
  accounts.set(owner.publicKey.toBase58(), account(SystemProgram.programId, Buffer.alloc(0)));
  accounts.set(bootstrap.publicKey.toBase58(), account(SystemProgram.programId, Buffer.alloc(0)));
  DEVNET_MOCK_TOKENS.forEach(token => {
    const bytes = Buffer.alloc(226); bytes[44] = token.decimals; bytes[45] = 1; bytes[165] = 1;
    bytes.writeUInt16LE(25, 166); bytes.writeUInt16LE(56, 168); bootstrap.publicKey.toBuffer().copy(bytes, 170); bytes.writeDoubleLE(token.multiplier, 202); bytes.writeBigInt64LE(0n, 210); bytes.writeDoubleLE(token.multiplier, 218);
    accounts.set(token.mint.toBase58(), account(TOKEN_2022_PROGRAM_ID, bytes));
  });
  let genesis = DEVNET_GENESIS_HASH, slot = 100, height = 100, fee = 5000, rent = 1_000_000, sends = 0, simulations = 0, reads = 0, walletSigns = 0;
  let ambiguous = false, noStatus = false, simulationError: unknown = null, beforeRead: (() => void) | undefined, beforeSimulation: (() => void) | undefined;
  let prepared: OwnerSetupReceipt | null = null;
  const sent: Buffer[] = [], quotedMessages: Buffer[] = [], simulatedMessages: Buffer[] = [], minimumSlots: number[] = [];
  const initializeWhitelist = (authority = owner.publicKey, pending: PublicKey | null = null, count = 0) => {
    const bytes = Buffer.alloc(78); discriminator("account:WhitelistConfig").copy(bytes); authority.toBuffer().copy(bytes, 8); bytes[40] = pending ? 1 : 0; pending?.toBuffer().copy(bytes, 41);
    const offset = pending ? 73 : 41; bytes.writeUInt32LE(count, offset); bytes[offset + 4] = configBump;
    accounts.set(config.toBase58(), account(programs[0], bytes));
  };
  const initializeFactory = () => {
    const bytes = Buffer.alloc(89); discriminator("account:FactoryConfig").copy(bytes); owner.publicKey.toBuffer().copy(bytes, 8); owner.publicKey.toBuffer().copy(bytes, 40);
    bytes.writeUInt16LE(9000, 72); bytes.writeUInt16LE(300, 74); bytes.writeUInt16LE(100, 76); bytes.writeUInt16LE(300, 78); bytes[88] = factoryBump;
    accounts.set(factory.toBase58(), account(programs[1], bytes));
  };
  const admit = (i: number) => {
    const token = DEVNET_MOCK_TOKENS[i], [key, bump] = admissionKeys[i], source = Buffer.from(`mock:${token.symbol}`), bytes = Buffer.alloc(119);
    discriminator("account:WhitelistedMint").copy(bytes); token.mint.toBuffer().copy(bytes, 8); bytes[40] = token.decimals; bytes.writeBigUInt64LE(1_000_000n, 41); bytes.writeUInt32LE(source.length, 50); source.copy(bytes, 54); bytes[54 + source.length] = bump;
    accounts.set(key.toBase58(), account(programs[0], bytes));
    const current = accounts.get(config.toBase58())!; const offset = current.data[40] ? 73 : 41;
    current.data.writeUInt32LE(admissionKeys.filter(([address]) => accounts.has(address.toBase58())).length, offset);
  };
  const rpc = {
    getGenesisHash: async () => { reads++; return genesis; },
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[], options: { commitment: string; minContextSlot: number }) => {
      reads++; beforeRead?.(); assert.equal(options.commitment, "finalized"); minimumSlots.push(options.minContextSlot);
      return { context: { slot }, value: keys.map(key => accounts.get(key.toBase58()) ?? null) };
    },
    getLatestBlockhash: async () => ({ blockhash: nonceValue, lastValidBlockHeight: 200 }),
    getMinimumBalanceForRentExemption: async () => rent,
    getFeeForMessage: async (message: import("@solana/web3.js").Message) => { quotedMessages.push(Buffer.from(message.serialize())); return { context: { slot }, value: fee }; },
    simulateTransaction: async (transaction: import("@solana/web3.js").VersionedTransaction, options: { sigVerify: boolean; replaceRecentBlockhash: boolean }) => {
      simulations++; simulatedMessages.push(Buffer.from(transaction.message.serialize())); beforeSimulation?.(); assert.equal(options.replaceRecentBlockhash, false);
      if (options.sigVerify) assert.equal(Transaction.from(transaction.serialize()).verifySignatures(true), true);
      return { context: { slot }, value: { err: simulationError } };
    },
    sendRawTransaction: async (bytes: Buffer, options: { maxRetries: number; skipPreflight: boolean; minContextSlot: number }) => {
      sends++; sent.push(Buffer.from(bytes)); assert.equal(options.maxRetries, 0); assert.equal(options.skipPreflight, false); assert.ok(prepared, "receipt must be persisted before transport");
      const tx = Transaction.from(bytes); assert.equal(tx.verifySignatures(true), true);
      if (ambiguous) throw new Error("transport outcome unknown");
      if (tx.instructions[0].programId.equals(SystemProgram.programId)) {
        loaderBytes.forEach(bytes => owner.publicKey.toBuffer().copy(bytes, 13)); nonceBytes[40] ^= 1;
      } else {
        for (const ix of tx.instructions) {
          if (ix.programId.equals(ComputeBudgetProgram.programId)) {
            assert.equal(ix.keys.length, 0);
            assert.ok(["02400d0300", "030000000000000000"].includes(ix.data.toString("hex")), "only the prepared setup budget is allowed");
            continue;
          }
          const disc = ix.data.subarray(0, 8);
          if (disc.equals(discriminator("global:init_config"))) initializeWhitelist();
          else if (disc.equals(discriminator("global:init_factory"))) initializeFactory();
          else if (disc.equals(discriminator("global:claim_authority"))) initializeWhitelist(owner.publicKey, null, admissionKeys.filter(([key]) => accounts.has(key.toBase58())).length);
          else if (disc.equals(discriminator("global:add_mint"))) admit(DEVNET_MOCK_TOKENS.findIndex(token => ix.keys.some(key => key.pubkey.equals(token.mint))));
          else assert.fail("unreviewed instruction sent");
        }
      }
      return bs58.encode(tx.signatures[0].signature!);
    },
    getSignatureStatuses: async () => ({ context: { slot }, value: [noStatus ? null : { confirmationStatus: "finalized", err: null, slot, confirmations: null }] }),
    getBlockHeight: async () => height,
  } as unknown as OwnerSetupRpc;
  let current: OwnerSetupIntent = { connection: rpc, wallet: policy.owner, active: true, accepted: true, reviewKey: "review" };
  const options: OwnerSetupSubmission = {
    wallet: owner.publicKey, current: () => current, reviewKey: "review",
    signTransaction: async tx => { walletSigns++; tx.partialSign(owner); return tx; },
    onPrepared: receipt => { prepared = receipt; },
  };
  return { rpc, options, accounts, programBytes, loaderBytes, nonceBytes, initializeWhitelist, initializeFactory, admit, sent, quotedMessages, simulatedMessages, minimumSlots,
    counts: () => ({ sends, simulations, reads, walletSigns }), receipt: () => prepared,
    changeIntent: (value: Partial<OwnerSetupIntent>) => { current = { ...current, ...value }; },
    setGenesis: (value: string) => { genesis = value; }, setSlot: (value: number) => { slot = value; }, setHeight: (value: number) => { height = value; }, setFee: (value: number) => { fee = value; }, setRent: (value: number) => { rent = value; },
    setAmbiguous: () => { ambiguous = true; }, setNoStatus: () => { noStatus = true; }, setSimulationError: () => { simulationError = { custom: 1 }; },
    onRead: (fn: () => void) => { beforeRead = fn; }, onSimulation: (fn: () => void) => { beforeSimulation = fn; },
  };
}
function packageFixture(mutate?: (tx: Transaction) => void, sign = true) {
  const checked = Buffer.alloc(4); checked.writeUInt32LE(7);
  const tx = new Transaction({ feePayer: bootstrap.publicKey, recentBlockhash: nonceValue }).add(
    SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: bootstrap.publicKey }),
    ...programs.map(program => new TransactionInstruction({ programId: UPGRADEABLE_LOADER, data: checked, keys: [{ pubkey: ownerProgramData(program), isWritable: true, isSigner: false }, { pubkey: bootstrap.publicKey, isWritable: false, isSigner: true }, { pubkey: owner.publicKey, isWritable: false, isSigner: true }] })),
  );
  mutate?.(tx); if (sign) tx.partialSign(bootstrap);
  return { version: 1 as const, cluster: "devnet" as const, genesisHash: DEVNET_GENESIS_HASH, sourceCommit, owner: policy.owner, bootstrapAuthority: policy.bootstrapAuthority, nonceAccount: nonce.toBase58(), nonceValue, transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") };
}

test("canonical public package validates the real bootstrap signature and contains only the four reviewed instructions", () => {
  const pkg = client.parsePackage(JSON.stringify(packageFixture()));
  assert.equal(Object.isFrozen(pkg), true);
  const tx = Transaction.from(Buffer.from(pkg.transactionBase64, "base64"));
  assert.equal(tx.instructions.length, 4); assert.equal(tx.signatures.length, 2); assert.equal(tx.signatures[1].signature, null);
  assert.equal(tx.verifySignatures(false), true); assert.equal(tx.verifySignatures(true), false);
  assert.equal(client.parsePackage({ ...pkg, sourceCommit: "b".repeat(40) }).sourceCommit, "b".repeat(40), "metadata is informational, never artifact authority");
});
for (const [name, mutate] of Object.entries({
  "extra transfer": (tx: Transaction) => { tx.add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: bootstrap.publicKey, lamports: 1 })); },
  "unchecked authority": (tx: Transaction) => { tx.instructions[1].data = Buffer.from([4, 0, 0, 0]); },
  "foreign ProgramData": (tx: Transaction) => { tx.instructions[1].keys[0].pubkey = nonce; },
  "reordered roles": (tx: Transaction) => { [tx.instructions[1], tx.instructions[2]] = [tx.instructions[2], tx.instructions[1]]; },
  "extra account": (tx: Transaction) => { tx.instructions[1].keys.push({ pubkey: config, isSigner: false, isWritable: false }); },
  "wrong fee payer": (tx: Transaction) => { tx.feePayer = owner.publicKey; },
  "owner already signed": (tx: Transaction) => { tx.partialSign(owner); },
})) test(`package rejects ${name}`, () => { assert.throws(() => client.parsePackage(packageFixture(mutate))); });
test("package rejects missing, corrupted bootstrap signatures and unexpected metadata", () => {
  assert.throws(() => client.parsePackage(packageFixture(undefined, false)), /signature/);
  const pkg = packageFixture(), bytes = Buffer.from(pkg.transactionBase64, "base64"); bytes[2] ^= 1;
  assert.throws(() => client.parsePackage({ ...pkg, transactionBase64: bytes.toString("base64") }), /signature/);
  for (const change of [{ owner: bootstrap.publicKey.toBase58() }, { cluster: "mainnet-beta" }, { sourceCommit: "main" }, { secretKey: [1, 2] }, { transactionBase64: `${pkg.transactionBase64}\n` }]) assert.throws(() => client.parsePackage({ ...pkg, ...change }));
  assert.throws(() => client.parsePackage("x".repeat(8193)), /too large/);
});
test("handoff authenticates all three pinned release payloads and initialized durable nonce", async () => {
  const f = fixture(); assert.equal((await client.inspectHandoff(f.rpc, packageFixture(), 90)).contextSlot, 100);
  assert.deepEqual(f.minimumSlots, [90]);
});
for (const [name, mutate] of Object.entries({
  "replayed nonce": (f: ReturnType<typeof fixture>) => { f.nonceBytes[40] ^= 1; },
  "wrong nonce authority": (f: ReturnType<typeof fixture>) => { owner.publicKey.toBuffer().copy(f.nonceBytes, 8); },
  "uninitialized nonce": (f: ReturnType<typeof fixture>) => { f.nonceBytes.writeUInt32LE(0, 4); },
  "old nonce format": (f: ReturnType<typeof fixture>) => { f.nonceBytes.writeUInt32LE(0); },
  "executable nonce": (f: ReturnType<typeof fixture>) => { f.accounts.get(nonce.toBase58())!.executable = true; },
  "non-System nonce": (f: ReturnType<typeof fixture>) => { f.accounts.get(nonce.toBase58())!.owner = UPGRADEABLE_LOADER; },
  "changed program bytes": (f: ReturnType<typeof fixture>) => { f.loaderBytes[0][45] ^= 1; },
  "changed deployment slot": (f: ReturnType<typeof fixture>) => { f.loaderBytes[1].writeBigUInt64LE(98n, 4); },
  "nonzero program padding": (f: ReturnType<typeof fixture>) => { f.loaderBytes[2][f.loaderBytes[2].length - 1] = 1; },
  "wrong program pointer": (f: ReturnType<typeof fixture>) => { f.programBytes[0][4] ^= 1; },
  "immutable program": (f: ReturnType<typeof fixture>) => { f.loaderBytes[0][12] = 0; },
  "mixed loader ownership": (f: ReturnType<typeof fixture>) => { owner.publicKey.toBuffer().copy(f.loaderBytes[2], 13); },
})) test(`handoff rejects ${name} before owner signing`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(client.submitHandoff(f.rpc, packageFixture(), f.options)); assert.equal(f.counts().walletSigns, 0); assert.equal(f.counts().sends, 0);
});
test("wrong cluster or wrong owner intent fails before wallet invocation", async () => {
  const f = fixture(); f.setGenesis("wrong"); await assert.rejects(client.submitHandoff(f.rpc, packageFixture(), f.options), /devnet only/); assert.equal(f.minimumSlots.length, 0);
  for (const change of [{ wallet: policy.bootstrapAuthority }, { connection: {} }, { active: false }, { accepted: false }, { reviewKey: "changed" }]) {
    const f = fixture(); f.changeIntent(change); await assert.rejects(client.submitHandoff(f.rpc, packageFixture(), f.options)); assert.deepEqual(f.counts(), { sends: 0, simulations: 0, reads: 0, walletSigns: 0 });
  }
});
test("wallet switch during async simulation is rejected before the owner signs", async () => {
  const f = fixture(); f.onSimulation(() => f.changeIntent({ wallet: policy.bootstrapAuthority }));
  await assert.rejects(client.submitHandoff(f.rpc, packageFixture(), f.options), /wallet or network changed/); assert.equal(f.counts().walletSigns, 0); assert.equal(f.counts().sends, 0);
});
test("wallet cannot change the reviewed message or corrupt a required signature", async () => {
  for (const kind of ["message", "signature", "intent"] as const) {
    const f = fixture(); f.options.signTransaction = async tx => {
      if (kind === "message") tx.add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: bootstrap.publicKey, lamports: 1 }));
      tx.partialSign(owner);
      if (kind === "signature") tx.signatures[1].signature![0] ^= 1;
      if (kind === "intent") f.changeIntent({ accepted: false });
      return tx;
    };
    await assert.rejects(client.submitHandoff(f.rpc, packageFixture(), f.options)); assert.equal(f.counts().sends, 0);
  }
});
test("code upgraded while wallet approval is open is rejected before broadcast", async () => {
  const f = fixture(); f.options.signTransaction = async tx => { tx.partialSign(owner); f.loaderBytes[1][45] ^= 1; return tx; };
  await assert.rejects(client.submitHandoff(f.rpc, packageFixture(), f.options), /program bytes/); assert.equal(f.counts().sends, 0);
});
test("valid owner handoff preserves message and bootstrap signature and broadcasts once", async () => {
  const f = fixture(), pkg = packageFixture(); const receipt = await client.submitHandoff(f.rpc, pkg, f.options);
  assert.equal(receipt.status, "finalized"); assert.equal(f.counts().walletSigns, 1); assert.equal(f.counts().sends, 1); assert.equal(f.counts().simulations, 2);
  const before = Transaction.from(Buffer.from(pkg.transactionBase64, "base64")), after = Transaction.from(f.sent[0]);
  assert.deepEqual(after.serializeMessage(), before.serializeMessage()); assert.deepEqual(after.signatures[0].signature, before.signatures[0].signature);
  assert.deepEqual(f.minimumSlots, [0, 100, 100]);
  assert.equal((await client.inspect(f.rpc)).loaderAuthority, "owner");
  await assert.rejects(client.submitHandoff(f.rpc, pkg, f.options), /already changed/); assert.equal(f.counts().sends, 1);
});
test("durable receipt is required before broadcast and ambiguous outcomes are never resent", async () => {
  const storage = fixture(); storage.options.onPrepared = () => { throw new Error("storage failed"); };
  await assert.rejects(client.submitHandoff(storage.rpc, packageFixture(), storage.options), /storage failed/); assert.equal(storage.counts().sends, 0);
  const f = fixture(); f.setAmbiguous(); f.setNoStatus();
  const receipt = await client.submitHandoff(f.rpc, packageFixture(), f.options);
  assert.equal(receipt.status, "prepared"); assert.equal(f.counts().sends, 1); assert.equal(f.receipt()?.signature, receipt.signature);
  assert.equal((await client.reconcile(f.rpc, receipt)).status, "prepared"); assert.equal(f.counts().sends, 1);
});
test("owner-first six setup actions fit one bounded transaction with exact treasury and fee split", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  assert.deepEqual(review.steps, ["init-whitelist", "init-factory", "admit-BSTESTA", "admit-BSTESTB", "admit-BSTESTC", "admit-BSTESTD"]);
  assert.ok(review.transaction!.serialize({ requireAllSignatures: false }).length <= 1232); assert.equal(review.rentLamports, 6_000_000); assert.equal(review.feeLamports, 5000);
  assert.deepEqual(review.transaction!.instructions.slice(0, 2).map(ix => [ix.programId.toBase58(), ix.data.toString("hex"), ix.keys.length]), [
    [ComputeBudgetProgram.programId.toBase58(), "02400d0300", 0],
    [ComputeBudgetProgram.programId.toBase58(), "030000000000000000", 0],
  ]);
  const factoryIx = review.transaction!.instructions[3]; assert.deepEqual(factoryIx.data.subarray(8, 40), owner.publicKey.toBuffer()); assert.equal(factoryIx.data.readUInt16LE(40), 9000);
  assert.deepEqual(factoryIx.keys.map(key => key.pubkey.toBase58()), [factory, owner.publicKey, SystemProgram.programId, programs[1], ownerProgramData(programs[1])].map(String));
  const receipt = await client.submitSetup(f.rpc, review, f.options);
  assert.equal(receipt.status, "finalized"); assert.equal(receipt.lastValidBlockHeight, 200); assert.equal(receipt.blockhash, nonceValue);
  const final = await client.inspect(f.rpc); assert.equal(final.whitelist, "owner"); assert.equal(final.factoryInitialized, true); assert.equal(final.admitted.length, 4); assert.deepEqual(final.steps, []);
  const done = await client.prepare(f.rpc, owner.publicKey); assert.equal(done.transaction, null); assert.deepEqual(done.steps, []); assert.equal(f.counts().sends, 1);
});
test("existing proposed whitelist claim is retained and already completed steps are omitted", async () => {
  const f = fixture("owner"); f.initializeWhitelist(bootstrap.publicKey, owner.publicKey); f.initializeFactory(); f.admit(0);
  const review = await client.prepare(f.rpc, owner.publicKey);
  assert.deepEqual(review.steps, ["claim-whitelist", "admit-BSTESTB", "admit-BSTESTC", "admit-BSTESTD"]);
  assert.equal(review.transaction!.instructions[2].data.toString("hex"), "de84b97b7f6b061f");
  await client.submitSetup(f.rpc, review, f.options); assert.deepEqual((await client.inspect(f.rpc)).steps, []);
});
test("no owner factory init before checked loader handoff, and no arbitrary pending authority claim", async () => {
  const f = fixture(); await assert.rejects(client.prepare(f.rpc, owner.publicKey), /ownership/);
  const legacy = fixture("owner"); legacy.initializeWhitelist(bootstrap.publicKey);
  await assert.rejects(client.prepare(legacy.rpc, owner.publicKey), /propose/); assert.equal(legacy.counts().sends, 0);
  legacy.initializeWhitelist(bootstrap.publicKey, nonce); await assert.rejects(client.prepare(legacy.rpc, owner.publicKey), /Unexpected whitelist/);
});
test("factory bootstrap authority, different treasury, noncanonical split and false admission count fail closed", async () => {
  for (const mutation of [(f: ReturnType<typeof fixture>) => bootstrap.publicKey.toBuffer().copy(f.accounts.get(factory.toBase58())!.data, 8), (f: ReturnType<typeof fixture>) => nonce.toBuffer().copy(f.accounts.get(factory.toBase58())!.data, 40), (f: ReturnType<typeof fixture>) => f.accounts.get(factory.toBase58())!.data.writeUInt16LE(8000, 72), (f: ReturnType<typeof fixture>) => f.accounts.get(config.toBase58())!.data.writeUInt32LE(1, 41)]) {
    const f = fixture("owner"); f.initializeWhitelist(); f.initializeFactory(); mutation(f);
    await assert.rejects(client.prepare(f.rpc, owner.publicKey)); assert.equal(f.counts().walletSigns, 0);
  }
});
test("missing treasury, excessive costs and insufficient owner balance produce no signing request", async () => {
  const f = fixture("owner"); await assert.rejects(createDevnetOwnerSetupClient({ ...policy, treasury: null }, artifacts).prepare(f.rpc, owner.publicKey), /treasury/);
  for (const mutate of [(f: ReturnType<typeof fixture>) => f.setFee(100_001), (f: ReturnType<typeof fixture>) => f.setRent(4_000_000), (f: ReturnType<typeof fixture>) => { f.accounts.get(owner.publicKey.toBase58())!.lamports = 1; }]) {
    const f = fixture("owner"); mutate(f); await assert.rejects(client.prepare(f.rpc, owner.publicKey)); assert.equal(f.counts().walletSigns, 0);
  }
});
test("displayed actions and quoted spending bind the owner approval", async () => {
  for (const change of ["fee", "rent", "steps"] as const) {
    const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
    if (change === "fee") f.setFee(6000); else if (change === "rent") f.setRent(1_100_000); else review.steps.pop();
    await assert.rejects(client.submitSetup(f.rpc, review, f.options), /spending changed/); assert.equal(f.counts().walletSigns, 0); assert.equal(f.counts().sends, 0);
  }
});
test("state changes, wrong wallets, failed simulations and upgraded code prevent setup broadcast", async () => {
  const wrong = fixture("owner"); await assert.rejects(client.prepare(wrong.rpc, bootstrap.publicKey), /designated owner/); assert.equal(wrong.counts().reads, 0);
  const state = fixture("owner"), review = await client.prepare(state.rpc, owner.publicKey); state.initializeWhitelist(); await assert.rejects(client.submitSetup(state.rpc, review, state.options), /setup changed/); assert.equal(state.counts().sends, 0);
  const simulation = fixture("owner"), next = await client.prepare(simulation.rpc, owner.publicKey); simulation.setSimulationError(); await assert.rejects(client.submitSetup(simulation.rpc, next, simulation.options), /simulation/); assert.equal(simulation.counts().walletSigns, 0);
  const changed = fixture("owner"), checked = await client.prepare(changed.rpc, owner.publicKey); changed.options.signTransaction = async tx => { tx.partialSign(owner); changed.loaderBytes[2][45] ^= 1; return tx; };
  await assert.rejects(client.submitSetup(changed.rpc, checked, changed.options), /program bytes/); assert.equal(changed.counts().sends, 0);
});
test("expired absent normal setup receipts reconcile through fresh finalized state without signing or resending", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey); f.setAmbiguous(); f.setNoStatus();
  const receipt = await client.submitSetup(f.rpc, review, f.options); assert.equal(receipt.status, "prepared");
  f.setHeight(201); assert.equal((await client.reconcile(f.rpc, receipt)).status, "expired"); assert.equal(f.counts().sends, 1); assert.equal(f.counts().walletSigns, 1);
  f.loaderBytes[0][45] ^= 1; await assert.rejects(client.reconcile(f.rpc, receipt), /program bytes/); assert.equal(f.counts().sends, 1);
});

test("expiry reconciliation catches a finalization racing the initial absent status", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey); f.setAmbiguous(); f.setNoStatus();
  const receipt = await client.submitSetup(f.rpc, review, f.options); f.setHeight(201);
  let reads = 0; f.rpc.getSignatureStatuses = (async () => ({ context: { slot: 100 }, value: [reads++ === 0 ? null : { confirmationStatus: "finalized", err: null, slot: 100, confirmations: null }] })) as typeof f.rpc.getSignatureStatuses;
  assert.equal((await client.reconcile(f.rpc, receipt)).status, "finalized"); assert.equal(reads, 2); assert.equal(f.counts().sends, 1);
});

test("wallet metadata mutation cannot change the saved setup expiry", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  f.options.signTransaction = async tx => { tx.partialSign(owner); tx.lastValidBlockHeight = 999999; return tx; };
  const receipt = await client.submitSetup(f.rpc, review, f.options);
  assert.equal(receipt.lastValidBlockHeight, 200);
});

test("prefunded System-owned empty setup PDAs remain vacant and can initialize normally", async () => {
  const f = fixture("owner");
  for (const address of [config, factory, ...admissionKeys.map(([key]) => key)]) f.accounts.set(address.toBase58(), account(SystemProgram.programId, Buffer.alloc(0), false, 100000));
  const review = await client.prepare(f.rpc, owner.publicKey); assert.equal(review.steps.length, 6);
  const receipt = await client.submitSetup(f.rpc, review, f.options); assert.equal(receipt.status, "finalized");
  assert.deepEqual((await client.inspect(f.rpc)).steps, []);
});

test("foreign-owned, executable, malformed and nonempty prefunded PDA accounts are never vacant", async () => {
  for (const address of [config, factory, admissionKeys[0][0]]) {
    for (const value of [account(UPGRADEABLE_LOADER, Buffer.alloc(0)), account(SystemProgram.programId, Buffer.from([1])), account(SystemProgram.programId, Buffer.alloc(0), true), account(SystemProgram.programId, Buffer.alloc(0), false, NaN)]) {
      const f = fixture("owner"); f.accounts.set(address.toBase58(), value);
      await assert.rejects(client.prepare(f.rpc, owner.publicKey)); assert.equal(f.counts().walletSigns, 0); assert.equal(f.counts().sends, 0);
    }
  }
});

test("processed signature-status context cannot block finalized expiry recovery", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey); f.setAmbiguous(); f.setNoStatus();
  const receipt = await client.submitSetup(f.rpc, review, f.options); f.setHeight(201);
  f.rpc.getSignatureStatuses = (async () => ({ context: { slot: 132 }, value: [null] })) as typeof f.rpc.getSignatureStatuses;
  assert.equal((await client.reconcile(f.rpc, receipt)).status, "expired");
  assert.equal(f.minimumSlots.at(-1), 100); assert.equal(f.counts().sends, 1); assert.equal(f.counts().walletSigns, 1);
});


test("setup errors expose reviewed public reasons and hide arbitrary wallet/RPC payloads", () => {
  const known = new DevnetOwnerSetupError("The wallet changed the reviewed transaction. Nothing was broadcast.");
  assert.equal(describeDevnetOwnerSetupError(known, "signing"), known.message);
  const sensitive = "opaque-rpc-payload containing an access token";
  const unknown = describeDevnetOwnerSetupError(new Error(sensitive), "signing");
  assert.match(unknown, /requesting your wallet signature/); assert.ok(!unknown.includes(sensitive));
  assert.match(describeDevnetOwnerSetupError(new Error("Blockhash not found / expired")), /expired/);
  assert.match(describeDevnetOwnerSetupError(new Error("429 rate limit")), /Devnet is busy/);
  assert.match(describeDevnetOwnerSetupError(new Error("User rejected request")), /declined/);
  assert.match(describeDevnetOwnerSetupError(new Error("Failed to fetch")), /connection did not respond/);
});

test("setup accepts the standard-wallet serialized transaction roundtrip", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  f.options.signTransaction = async tx => {
    const decoded = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
    decoded.partialSign(owner);
    return Transaction.from(decoded.serialize({ requireAllSignatures: true, verifySignatures: true }));
  };
  const receipt = await client.submitSetup(f.rpc, review, f.options);
  assert.equal(receipt.status, "finalized"); assert.equal(f.counts().sends, 1);
});


// The installed package exposes separate Node/browser constructor identities even
// when npm has deduplicated its version. This reproduces that boundary offline.
const BrowserTransaction = createRequire(import.meta.url)("@solana/web3.js/lib/index.browser.cjs.js").Transaction as typeof Transaction;
const foreignWire = (wire: unknown): Transaction => ({ serialize: () => wire }) as unknown as Transaction;
const walletCopy = (tx: Transaction) => Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));

test("exact signed wire from another installed web3 constructor is accepted for setup", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  f.options.signTransaction = async tx => {
    const other = BrowserTransaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
    assert.equal(other instanceof Transaction, false);
    other.partialSign(owner);
    assert.deepEqual(Buffer.from(other.serializeMessage()), tx.serializeMessage());
    return other;
  };
  const receipt = await client.submitSetup(f.rpc, review, f.options);
  assert.equal(receipt.status, "finalized"); assert.equal(receipt.lastValidBlockHeight, 200);
  assert.equal(f.counts().sends, 1); assert.equal(f.counts().simulations, 2);
});

test("foreign constructor handoff preserves the exact bootstrap signature and nonce message", async () => {
  const f = fixture(), pkg = packageFixture();
  f.options.signTransaction = async tx => {
    const other = BrowserTransaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
    other.partialSign(owner); return other;
  };
  const receipt = await client.submitHandoff(f.rpc, pkg, f.options);
  const expected = Transaction.from(Buffer.from(pkg.transactionBase64, "base64")), actual = Transaction.from(f.sent[0]);
  assert.equal(receipt.status, "finalized"); assert.deepEqual(actual.serializeMessage(), expected.serializeMessage());
  assert.deepEqual(actual.signatures[0].signature, expected.signatures[0].signature); assert.equal(f.counts().sends, 1);
});

test("foreign structural wallet result contributes bytes only, never trusted verification methods", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  f.options.signTransaction = async tx => {
    const copy = walletCopy(tx); copy.partialSign(owner);
    return { serialize: () => new Uint8Array(copy.serialize()), serializeMessage: () => { throw new Error("must not be called"); }, verifySignatures: () => { throw new Error("must not be called"); }, lastValidBlockHeight: 999999 } as unknown as Transaction;
  };
  const receipt = await client.submitSetup(f.rpc, review, f.options);
  assert.equal(receipt.status, "finalized"); assert.equal(receipt.lastValidBlockHeight, 200); assert.equal(f.counts().sends, 1);
});

for (const [name, result] of Object.entries({
  "null result": (_: Transaction): unknown => null,
  "missing serializer": (_: Transaction) => ({}),
  "throwing serializer": (_: Transaction) => ({ serialize: () => { throw new Error("private wallet payload"); } }),
  "string wire": (_: Transaction) => foreignWire("not bytes"),
  "array wire": (_: Transaction) => foreignWire([1, 2, 3]),
  "empty wire": (_: Transaction) => foreignWire(new Uint8Array()),
  "oversized wire": (_: Transaction) => foreignWire(new Uint8Array(1233)),
  "truncated wire": (_: Transaction) => foreignWire(new Uint8Array([1, 2, 3])),
  "versioned wire": (tx: Transaction) => {
    const v0 = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: tx.recentBlockhash!, instructions: tx.instructions }).compileToV0Message());
    v0.sign([owner]); return foreignWire(v0.serialize());
  },
  "trailing wire": (tx: Transaction) => { const copy = walletCopy(tx); copy.partialSign(owner); return foreignWire(Buffer.concat([copy.serialize(), Buffer.from([0])])); },
  "noncanonical compact length": (tx: Transaction) => { const copy = walletCopy(tx); copy.partialSign(owner); const wire = copy.serialize(); return foreignWire(Buffer.concat([Buffer.from([0x81, 0]), wire.subarray(1)])); },
})) test(`wallet normalization rejects ${name} before signed simulation or broadcast`, async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  f.options.signTransaction = async tx => result(tx) as Transaction;
  await assert.rejects(client.submitSetup(f.rpc, review, f.options), error => error instanceof DevnetOwnerSetupError && !error.message.includes("private wallet payload"));
  assert.equal(f.counts().sends, 0); assert.equal(f.counts().simulations, 1); assert.equal(f.receipt(), null);
});

for (const [name, mutate, reason] of [
  ["compute limit", (tx: Transaction) => { tx.instructions.find(ix => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 2)!.data = ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }).data; }, /compute budget/],
  ["priority fee", (tx: Transaction) => { tx.instructions.find(ix => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 3)!.data = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000 }).data; }, /compute budget/],
  ["blockhash", (tx: Transaction) => { tx.recentBlockhash = nonce.toBase58(); }, /blockhash/],
  ["fee payer", (tx: Transaction) => { tx.feePayer = bootstrap.publicKey; }, /fee payer/],
  ["program accounts", (tx: Transaction) => { tx.instructions.find(ix => ix.programId.equals(programs[0]))!.keys[0].pubkey = nonce; }, /transaction accounts/],
  ["factory fee split", (tx: Transaction) => { tx.instructions.find(ix => ix.programId.equals(programs[1]))!.data.writeUInt16LE(8000, 40); }, /program instructions/],
] as const) test(`wallet normalization rejects genuinely altered ${name} with a fixed public reason`, async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  f.options.signTransaction = async tx => {
    const copy = walletCopy(tx); mutate(copy); copy.partialSign(owner);
    if (name === "fee payer") copy.partialSign(bootstrap);
    return foreignWire(copy.serialize({ requireAllSignatures: false, verifySignatures: false }));
  };
  await assert.rejects(client.submitSetup(f.rpc, review, f.options), reason);
  assert.equal(f.counts().sends, 0); assert.equal(f.counts().simulations, 1); assert.equal(f.receipt(), null);
});

for (const kind of ["missing owner", "corrupted owner", "missing bootstrap", "corrupted bootstrap"] as const) test(`foreign wire with ${kind} fails independent signature verification`, async () => {
  const handoff = kind.includes("bootstrap"), f = fixture(handoff ? "bootstrap" : "owner");
  const review = handoff ? null : await client.prepare(f.rpc, owner.publicKey);
  f.options.signTransaction = async tx => {
    const copy = walletCopy(tx); copy.partialSign(owner);
    const index = kind.includes("bootstrap") ? 0 : copy.signatures.length - 1;
    if (kind.startsWith("missing")) copy.signatures[index].signature = null;
    else copy.signatures[index].signature![0] ^= 1;
    return foreignWire(copy.serialize({ requireAllSignatures: false, verifySignatures: false }));
  };
  await assert.rejects(handoff ? client.submitHandoff(f.rpc, packageFixture(), f.options) : client.submitSetup(f.rpc, review!, f.options), /exact required signatures/);
  assert.equal(f.counts().sends, 0); assert.equal(f.counts().simulations, 1);
});

test("returning exact signed wire cannot hide mutation of the original reviewed transaction", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  f.options.signTransaction = async tx => {
    const copy = walletCopy(tx); copy.partialSign(owner);
    tx.instructions.find(ix => ix.programId.equals(programs[1]))!.data.writeUInt16LE(8000, 40);
    return foreignWire(copy.serialize());
  };
  await assert.rejects(client.submitSetup(f.rpc, review, f.options), /mutated the reviewed transaction/);
  assert.equal(f.counts().sends, 0); assert.equal(f.counts().simulations, 1);
});

// Model Phantom's documented auto-priority behavior without calling a wallet or
// broadcasting: unsigned, no budget, and enough room for the added instructions.
function phantomPriorityCopy(transaction: Transaction) {
  const copy = walletCopy(transaction);
  const hasSignature = copy.signatures.some(pair => pair.signature !== null);
  const hasBudget = copy.instructions.some(ix => ix.programId.equals(ComputeBudgetProgram.programId));
  if (!hasSignature && !hasBudget) {
    const candidate = walletCopy(copy);
    candidate.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
    );
    if (candidate.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1_232) return { transaction: candidate, enhanced: true };
  }
  return { transaction: copy, enhanced: false };
}

test("explicit setup budget keeps documented Phantom priority enhancement out of the reviewed message", async () => {
  const f = fixture("owner"), review = await client.prepare(f.rpc, owner.publicKey);
  const withoutBudget = walletCopy(review.transaction!); withoutBudget.instructions.splice(0, 2);
  assert.equal(phantomPriorityCopy(withoutBudget).enhanced, true, "the previous unsigned setup satisfies Phantom's enhancement conditions");
  let reviewedMessage: Buffer | undefined;
  f.options.signTransaction = async transaction => {
    reviewedMessage = Buffer.from(transaction.serializeMessage());
    const candidate = phantomPriorityCopy(transaction);
    assert.equal(candidate.enhanced, false);
    candidate.transaction.partialSign(owner); return candidate.transaction;
  };
  const receipt = await client.submitSetup(f.rpc, review, f.options);
  assert.equal(receipt.status, "finalized"); assert.equal(f.counts().sends, 1);
  assert.deepEqual(Transaction.from(f.sent[0]).serializeMessage(), reviewedMessage);
  assert.deepEqual(f.quotedMessages.at(-1), reviewedMessage);
  assert.deepEqual(f.simulatedMessages, [reviewedMessage, reviewedMessage]);
  assert.equal(receipt.lastValidBlockHeight, 200); assert.equal(receipt.blockhash, nonceValue);
});

test("partially signed owner handoff remains unchanged by the documented priority rule", async () => {
  const f = fixture(), pkg = packageFixture();
  f.options.signTransaction = async transaction => {
    const candidate = phantomPriorityCopy(transaction);
    assert.equal(candidate.enhanced, false);
    assert.equal(candidate.transaction.instructions.some(ix => ix.programId.equals(ComputeBudgetProgram.programId)), false);
    candidate.transaction.partialSign(owner); return candidate.transaction;
  };
  const receipt = await client.submitHandoff(f.rpc, pkg, f.options);
  assert.equal(receipt.status, "finalized"); assert.equal(f.counts().sends, 1);
  assert.deepEqual(Transaction.from(f.sent[0]).serializeMessage(), Transaction.from(Buffer.from(pkg.transactionBase64, "base64")).serializeMessage());
});
