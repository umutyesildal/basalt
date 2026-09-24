# Managed V2 wallet lab

This is an isolated localnet transaction UI, separate from the public Basalt preview and immutable V0. It uses two locally minted, extension-free Token-2022 mock assets. It must not be presented as a live xStocks basket.

## Run locally

1. Build `target/deploy/managed_basket.so` with the **default** program feature set. Do not use the `localnet-fast-notice` test artifact for this lab.
2. Start the validator from the managed worktree: `bash scripts/managed-v2-lab.sh`. Leave it running. The script refuses to replace an existing process on its RPC or faucet port.
3. Start the app from the same worktree: `NEXT_PUBLIC_CLUSTER=localnet NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 npm --prefix app run dev -- -p 3002`.
4. Open `http://localhost:3002/managed/lab` and select **Create basket**. For an extension-free test, click **Use local test wallet**. It creates a disposable manager key in this browser tab's session storage and is available only in a loopback development build. Phantom and Solflare remain options when configured for the same local validator.
5. Click **Prepare sample**. The local development server airdrops local SOL, mints 100 units of each mock token to the connected wallet, revokes both mint authorities, and fills the token addresses and 10-unit seed amounts. It also fills a separate local test guardian address that you can later select from the wallet picker. The other amount fields have small editable examples. If the button is unavailable, check the wallet connection and local validator. For a CLI fallback, run `npx tsx scripts/managed-v2-wallet-fixture.ts <connected-wallet-pubkey>` and paste the returned mint addresses.
6. Create the basket. The page opens it after confirmation. Its URL includes the public basket address, so another browser can read the same on-chain state. A second wallet with both mock tokens can get shares. The manager can propose a mix change; the guardian wallet can approve the minimum output; holders can redeem throughout the notice. A taker with the output token may fill the complete trade after the notice period. Local test keys are disposable: never send real assets to them, and do not rely on them outside the current browser tab session.

The standard notice minimum is **216,000 slots**. This is a nominal slot interval, not a wall-clock timer. In routine hands-on testing, approval and redemption during the notice are immediately testable; a full delayed fill needs a long-running validator. The separate fast-notice artifact used in `managed-v2-localnet-proof.md` exercised fill without changing the default artifact.

## Scope and checks

- The lab checks for a loopback RPC endpoint and `NEXT_PUBLIC_CLUSTER=localnet` before enabling signatures. It also checks that the Managed V2 program is loaded.
- Basket and proposal account discriminators, ownership, derived identity/share addresses, and raw balances are checked on read. Amounts are parsed as integers, and the on-chain program rechecks every account and limit.
- The shared transaction flow simulates a v0 transaction before opening the wallet, then waits for confirmation. A rejected signature or program error is shown inline.
- For this local lab, the wallet signs the already simulated transaction and the app broadcasts it through the same local RPC connection. This avoids an extension broadcasting through a different selected network. The shared devnet transaction behavior is unchanged.
- The on-page fixture endpoint is available only in development, on a loopback app origin with a matching browser Origin header and a loopback localnet RPC. It never stores or prints a private key. The CLI fallback also refuses a non-loopback RPC URL. Both are conveniences for this local lab, not public faucets.
- Browser smoke: `/managed/lab` loaded an actual local basket. The extension-free manager was funded with **Prepare sample**, then the page created a new basket with 10 units of each mock token and showed 1 share. No user wallet was signed by an agent.
- Automated checks: `npx vitest run app/tests/managed-chain.test.ts --no-cache`, `npm --prefix app run typecheck`, `npm --prefix app run build`, `npx tsx --tsconfig app/tsconfig.json scripts/managed-v2-client-smoke.ts`, `npx tsx --tsconfig app/tsconfig.json scripts/managed-v2-fixture-create-smoke.ts` with a running local validator.

This UI does not connect the backend projection, let a user buy tokens for USD, provide a live price/quote service, rotate manager/guardian keys, or support public asset admission. The public `/managed` explainer stays simulated.
