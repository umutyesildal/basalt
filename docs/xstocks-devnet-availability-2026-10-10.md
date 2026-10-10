# xStocks devnet availability, 2026-10-10

## Result

No public official Solana devnet xStocks mint list or issuer faucet was found in the current issuer developer guide, quickstart, asset API, xChange guide, or targeted official-domain searches. This is a statement about the public evidence reviewed, not proof that the issuer has no private sandbox.

The four official addresses fetched fresh from the issuer public API are not usable xStocks mints on Solana devnet. AAPLx, NVDAx and SPYx are absent there. The TSLAx address exists only as a zero-data System account. Reusing a mainnet address on devnet cannot create an issuer-backed asset.

## Official sources checked

- [xStocks developers](https://docs.xstocks.fi/developers): public metadata/prices/multipliers versus authenticated issuer operations; Solana Token-2022 and Scaled UI Amount.
- [API quickstart](https://docs.xstocks.fi/developers/quickstart): public `https://api.backed.fi/api/v2/public/assets`; authenticated trades use an issuer API key.
- [Public asset schema](https://docs.xstocks.fi/apis/openapi/assets): deployment discovery by network and address.
- [xChange integration](https://docs.xstocks.fi/developers/xchange-atomic-rfq): issuer API key and a registered wallet are prerequisites. The supplied Solana execution example uses `https://api.mainnet-beta.solana.com`. No devnet network or faucet is documented in that guide.

Fresh read-only public asset requests succeeded at `api.backed.fi` for AAPLx, NVDAx, SPYx and TSLAx. The newer `api.xstocks.fi` hostname shown by the asset reference returned HTTP 403 from this environment. No authenticated endpoint was called and no API key was read or used.

## Fresh cluster verification

Direct `getMultipleAccounts` against `https://api.devnet.solana.com`, commitment `finalized`, observed slot **509516760**:

| Issuer symbol | Address returned by issuer API for Solana | Devnet result |
| --- | --- | --- |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | Absent |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | Absent |
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | Absent |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | System-owned, 0 data bytes; not a token mint |

Raw public API deployment fields, finalized RPC response and a compact result summary are saved in [the public API/RPC evidence](evidence/xstocks-devnet-rpc-2026-10-10.json). No private data is included. Only these four official token addresses were checked on devnet; this is not an exhaustive scan of every Solana account.

## What this means for Basalt

The current canonical app intentionally uses the same four project-issued BSTESTA–D Token-2022 mocks for new devnet baskets, with a separate share mint per basket. The mocks reproduce the observed issuer extension profile and raw/scaled accounting, but have no official issuer backing or asserted market price. The current UI borrows stock names, issuer artwork and logo-derived colors as clearly marked demo decoration: Tesla, NVIDIA, Palantir and Coinbase themes for the exact four BSTEST mints. Each detail row says `test token`, a shared context identifies project test tokens, and the exact raw mint remains available. This does not claim Tesla/NVIDIA/Palantir/Coinbase equity backing or actual issuer xStocks custody. No USD valuation or return is derived from unrelated mainnet xStocks quotes.

The repository records a funded project-token faucet and historical finalized create/mint/redeem proofs. Current supported creation remains disabled until the separate owner namespace and accepted immutable treasury are complete; the owner has selected their own devnet wallet as treasury, while the source policy and owner-role signature remain unresolved. Treasury selection does not establish wallet control or activate creation. [The current onboarding audit](devnet-onboarding-audit-2026-10-10.md) records the partial deployment and remaining gates. The existing mock-token infrastructure is the fastest basis for a simpler public test flow: one clear devnet context, connect wallet, guide any missing SOL/test-token step, then create the basket with the minimum required wallet approvals and automatic confirmation. Keep actual token identities and amounts available without repeating labels in every row.

If authentic issuer devnet assets become available, obtain an issuer-published or directly authenticated cluster/mint/faucet list first, then verify Token-2022 ownership, initialized mint state, extension profile, transfer restrictions and whitelist admission before offering them. Issuer private-sandbox access has not been requested in this research. A local mainnet-state fork can test compatibility, but does not provide publicly spendable issuer devnet tokens.

## Scope

Read-only public web/API/RPC research and repository documentation inspection, followed by durable documentation/evidence copies. No wallet access, transactions, whitelist changes, application source edits, custody or external messages. Existing October 3 runtime records supersede older blanket extension-rejection documentation.
