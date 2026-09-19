import type { ReactNode } from "react";
import { PublicKey } from "@solana/web3.js";

import { IconCopyButton as CopyButton } from "@/components/ui/copy-button";
import { truncateAddress } from "@/lib/format";
import { BASKET_SEED, PROGRAMS } from "@/lib/solana";
import { CLUSTER, RPC_ENDPOINT, explorerClusterQuery } from "@/lib/wallet";

/**
 * "Verify it yourself" — the Stax §5.6 trust block, ported to Solana. Where
 * Stax points at Blockscout contract reads, this points at the real addresses
 * a reader needs on explorer.solana.com: the share mint, the vault authority
 * PDA, the token-holder tabs and the basket program.
 *
 * Every address shown here is REAL, never illustrative:
 *  - share mint comes from the indexed basket row;
 *  - the vault authority is derived exactly the way the program derives it
 *    (seeds ["basket", basket] under the BASKET program id — see
 *    lib/create-basket.ts and basket_factory/src/lib.rs:446);
 *  - the program id is the constant from lib/solana.ts that the tx builders
 *    themselves target.
 *
 * Server-compatible on purpose: only the copy buttons are client islands, so
 * the block can mount straight from the route's server component. Explorer
 * links carry the same cluster query as every other explorer link in the app
 * (lib/wallet.explorerClusterQuery), so devnet builds never link to mainnet.
 */

/** Cluster-aware explorer URL — path first, cluster query last. */
function explorerHref(path: string): string {
  return `https://explorer.solana.com${path}${explorerClusterQuery(CLUSTER, RPC_ENDPOINT)}`;
}

/**
 * Vault authority PDA for a basket address. Returns null only for malformed
 * input (the page already gates on an indexed basket, so this is a guard,
 * not a data path — a null never fabricates a placeholder address).
 */
function deriveVaultAuthority(basket: string): string | null {
  try {
    const seed = new TextEncoder().encode(BASKET_SEED);
    return PublicKey.findProgramAddressSync(
      [seed, new PublicKey(basket).toBytes()],
      PROGRAMS.basket,
    )[0].toBase58();
  } catch {
    return null;
  }
}

/** Inline explorer link — the house quiet-link treatment, mono-sized. */
const LINK_CLASS =
  "underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** One copyable address + its explorer link, the About-tab address-row rhythm. */
function AddressRef({
  address,
  copyLabel,
  linkLabel,
  href,
}: {
  address: string;
  copyLabel: string;
  linkLabel: string;
  href: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
      <span className="truncate" title={address}>
        {truncateAddress(address, 6, 6)}
      </span>
      <CopyButton value={address} label={copyLabel} showCopiedText={false} />
      <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
        {linkLabel}
      </a>
    </div>
  );
}

/** Quiet bare-link row (steps that point at tabs rather than accounts). */
function LinkRef({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`font-mono text-[11px] tabular-nums text-muted-foreground ${LINK_CLASS}`}
    >
      {label}
    </a>
  );
}

interface VerifyStep {
  title: string;
  body: string;
  refs: ReactNode;
}

export function BasketPageVerify({
  basket,
  shareMint,
}: {
  /** The indexed basket address (the route param, resolved on the server). */
  basket: string;
  /** The basket's Token-2022 share mint, from the indexed basket row. */
  shareMint: string;
}) {
  const vaultAuthority = deriveVaultAuthority(basket);
  const programId = PROGRAMS.basket.toBase58();

  const steps: VerifyStep[] = [
    {
      title: "Copy the basket mint",
      body: "The share token is the basket — a single Token-2022 mint. Every claim on this page resolves from this address, so start here.",
      refs: (
        <AddressRef
          address={shareMint}
          copyLabel="Copy basket share mint"
          linkLabel="mint on Explorer"
          href={explorerHref(`/address/${shareMint}`)}
        />
      ),
    },
    {
      title: "Open the basket vault on Solana Explorer",
      body: vaultAuthority
        ? 'The vault is not an app account — it is a program-owned PDA derived from the basket address (seeds ["basket", basket] under the basket program, the same derivation the program itself runs). Its Token Accounts tab is the vault: one token account per constituent.'
        : "Open the share mint's token accounts on Solana Explorer — the vault's share of every constituent is listed there.",
      refs: vaultAuthority ? (
        <AddressRef
          address={vaultAuthority}
          copyLabel="Copy vault authority address"
          linkLabel="vault authority on Explorer"
          href={explorerHref(`/address/${vaultAuthority}`)}
        />
      ) : (
        <div className="mt-2">
          <LinkRef
            label="share token accounts on Explorer"
            href={explorerHref(`/address/${shareMint}/tokens`)}
          />
        </div>
      ),
    },
    {
      title: "Check the token holders",
      body: "Share holders are listed on the mint's token-accounts tab; the vault's balances sit in the authority's token accounts. What backs a share is a real Token-2022 balance on-chain — not an IOU and not a database row.",
      refs: (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <LinkRef
            label="share token holders"
            href={explorerHref(`/address/${shareMint}/tokens`)}
          />
          {vaultAuthority ? (
            <LinkRef
              label="vault balances"
              href={explorerHref(`/address/${vaultAuthority}/tokens`)}
            />
          ) : null}
        </div>
      ),
    },
    {
      title: "Read the program",
      body: "Mint, redeem and the fee-accrual crank are permissionless instructions on one program. Any transaction this interface builds can be opened in the explorer and read instruction by instruction.",
      refs: (
        <AddressRef
          address={programId}
          copyLabel="Copy basket program id"
          linkLabel="program on Explorer"
          href={explorerHref(`/address/${programId}`)}
        />
      ),
    },
  ];

  return (
    <section
      id="verify"
      aria-labelledby="verify-heading"
      className="hairline-primary rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      {/* Section header — the BasketSectionHeader rhythm, text-display title
          per the Stax block's editorial voice. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-4">
        <div className="space-y-1">
          <p className="section-label">On-chain proof</p>
          <h2 id="verify-heading" className="text-display text-lg text-foreground">
            VERIFY IT YOURSELF
          </h2>
        </div>
        <div className="pb-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          solana explorer · {CLUSTER}
        </div>
      </div>

      <ol className="divide-y divide-border/60">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 py-4 first:pt-0 last:pb-0"
          >
            {/* Step numbers use the one mono micro scale (.section-label). */}
            <span className="section-label pt-1">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{step.title}</p>
              <p className="mt-1 text-sm font-normal leading-6 text-muted-foreground">
                {step.body}
              </p>
              {step.refs}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-2 border-t border-border/60 pt-4 font-mono text-[11px] leading-5 text-muted-foreground">
        Every claim on this page is checkable on-chain — start from the addresses
        above, not from us. These declared IDs do not prove current program bytes
        or matching source bytes. A finalized read-only devnet RPC audit on
        2026-09-19 confirmed that all three program upgrade authorities and the
        whitelist configuration authority remain the same single wallet; no
        multisig or timelock is active.
      </p>
    </section>
  );
}

export default BasketPageVerify;
