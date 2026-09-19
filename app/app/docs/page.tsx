import type { Metadata } from "next";
import Link from "next/link";

import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeader } from "@/components/ui/section-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ENTRY_FEE_CAP_BPS,
  EXIT_FEE_CAP_BPS,
  GENESIS_SHARES,
  MANAGEMENT_FEE_CAP_BPS,
  MAX_CONSTITUENTS,
  MIN_CONSTITUENTS,
  SHARE_MINT_DECIMALS,
  WEIGHTS_DENOMINATOR,
} from "@/lib/create-basket";
import { PROTOCOL_FEE_SPLIT_LABEL } from "@/lib/protocol-policy";
import { PROGRAMS } from "@/lib/solana";

/**
 * /docs — the Stax-style in-app documentation page (docs/stax-analiz/05
 * §5.12 pattern): ONE page, numbered "> 01 —" sections, written to be read,
 * not skimmed. This is a technical summary of the mechanics, not a landing
 * page — no CTAs beyond quiet pointers, no marketing claims.
 *
 * Content is compiled from the normative sources, never invented:
 *   - docs/basalt-v0-spec.md (§1 architecture, §2 accounts, §3 instructions,
 *     §5 mint/redeem math, §6 fees, §12 regulatory checklist)
 *   - lib/create-basket.ts (fee caps + structural constants — imported, so
 *     the numbers on this page ARE the constants the client and the program
 *     share, the "immutable constants from the verified source" pattern)
 *   - lib/solana.ts (deployed program IDs for the verify section)
 *
 * Static server component — no data fetching, no client JS except the copy
 * buttons. The legal register lives on /legal; this page stays mechanical
 * and keeps its language free of ETF/fund/guarantee vocabulary (spec §12).
 */

const SECTIONS = [
  { id: "overview", num: 1, label: "WHAT THIS IS", toc: "What this is" },
  { id: "minting", num: 2, label: "HOW MINTING WORKS", toc: "Minting" },
  { id: "redemption", num: 3, label: "HOW REDEMPTION WORKS", toc: "Redemption" },
  { id: "baskets", num: 4, label: "BASKETS", toc: "Baskets" },
  { id: "fees", num: 5, label: "FEES", toc: "Fees" },
  { id: "risk", num: 6, label: "RISK", toc: "Risk" },
  { id: "verify", num: 7, label: "VERIFY IT YOURSELF", toc: "Verify" },
] as const;

export const metadata: Metadata = {
  // absolute — the root layout's title template would append a second "· Basalt".
  title: { absolute: "Documentation — Basalt" },
  description:
    "How Basalt works — the mechanics, the fees, the risk, verifiable on-chain.",
};

/** Two-digit section numeral, same register as the steps-strip numerals. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Numbered step list — the steps-strip numeral language (mono, tracked,
 * whisper-muted) folded into a reading-width hairline list.
 */
function StepList({
  items,
}: {
  items: { title: string; body: string }[];
}) {
  return (
    <ol className="mt-6 border-t border-border/50">
      {items.map((step, i) => (
        <li
          key={step.title}
          className="flex gap-5 border-b border-border/50 py-4 last:border-b-0"
        >
          <span
            aria-hidden="true"
            className="pt-0.5 font-mono text-xs tabular-nums leading-5 tracking-[0.22em] text-muted-foreground/60"
          >
            {pad(i + 1)}
          </span>
          <div className="min-w-0">
            <p className="font-mono text-xs font-medium text-foreground">
              {step.title}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {step.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A quiet body paragraph — the page's default reading voice. */
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-7 text-muted-foreground">{children}</p>;
}

/** Mono micro sub-head inside a section (e.g. IN-KIND / ZAP). */
function SubHead({ children }: { children: React.ReactNode }) {
  return <h3 className="section-label mt-8">{children}</h3>;
}

/** Faint mono code comment line, for the constants block. */
function CodeComment({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <header className="max-w-2xl">
        <p className="section-label">BASALT / PROTOCOL DOCS</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground">
          Documentation
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          How Basalt works — the mechanics, the fees, the risk, verifiable
          on-chain.
        </p>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
          Seven short sections, written to be read. Every number on this page
          is enforced by a program, not asserted by us — where a value is a
          constant, it is the same constant the client builds transactions
          with, imported straight from the source.
        </p>
      </header>

      <div className="mt-12 md:grid md:grid-cols-[180px_minmax(0,1fr)] md:gap-12 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        {/* ── Sticky mono index (md+) ───────────────────────────────── */}
        <aside className="hidden md:block">
          <nav aria-label="On this page" className="sticky top-24">
            <p className="section-label">ON THIS PAGE</p>
            <ol className="mt-4 space-y-2.5">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="group flex items-baseline gap-2.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="tabular-nums text-muted-foreground/50 transition-colors group-hover:text-primary/80">
                      {pad(section.num)}
                    </span>
                    {section.toc}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        {/* ── Sections ───────────────────────────────────────────────── */}
        <div className="min-w-0 max-w-2xl space-y-16">
          {/* > 01 — WHAT THIS IS */}
          <section id="overview" aria-labelledby="overview-heading" className="scroll-mt-24">
            <SectionHeader
              id="overview-heading"
              size="display"
              index={1}
              label="WHAT THIS IS"
            />
            <div className="mt-5 space-y-4">
              <P>
                Basalt is three Solana programs — a whitelist, a basket
                factory, and a basket program — that hold tokenized equities
                and issue one share token per basket. The equities are
                xStocks: Token-2022 tokens issued by Backed Finance, each
                tracking a listed stock. A basket is a fixed recipe over those
                tokens: {MIN_CONSTITUENTS}–{MAX_CONSTITUENTS} constituents and
                weights in basis points, set once at deployment.
              </P>
              <P>
                The share token is the whole product. One basket, one
                Token-2022 mint, {SHARE_MINT_DECIMALS} decimals. Holding it
                means holding a pro-rata claim on the basket&apos;s vault: at
                every moment, your share of each constituent equals your share
                of the total supply, computed on raw on-chain balances. There
                is no manager with discretion — no rebalancing, no trading, no
                discretionary anything in V0.
              </P>
              <P>
                Everything a basket will ever do is decided in the transaction
                that creates it. Parameters are written to an immutable
                program-owned account, and no update instruction exists in the
                program. The rest of this page is what the programs do with
                that.
              </P>
            </div>
          </section>

          {/* > 02 — HOW MINTING WORKS */}
          <section id="minting" aria-labelledby="minting-heading" className="scroll-mt-24">
            <SectionHeader
              id="minting-heading"
              size="display"
              index={2}
              label="HOW MINTING WORKS"
            />
            <div className="mt-5">
              <P>There are two ways in. The honest one first.</P>

              <SubHead>IN-KIND — ONE TRANSACTION</SubHead>
              <div className="mt-3 space-y-4">
                <P>
                  <span className="font-mono text-sm text-foreground">
                    mint_in_kind
                  </span>{" "}
                  takes the actual xStocks, in the basket&apos;s target
                  proportions, and returns shares in the same transaction. The
                  program prices your deposit from each constituent against the
                  vault and mints the minimum across constituents — an
                  off-weight deposit mints to its least generous reading, and
                  deviating more than 1% from target weights reverts outright
                  (WeightMismatch). Fees are taken in shares, never in tokens.
                  No oracle is consulted: the vault&apos;s actual contents are
                  the price.
                </P>
              </div>
              <StepList
                items={[
                  {
                    title: "Pick a basket and amounts",
                    body: "The app previews your net shares after the entry fee before anything is signed.",
                  },
                  {
                    title: "One transaction",
                    body: "Raw xStocks move from your token accounts into the vault's program-owned accounts via transfer_checked — correct mint and decimals enforced.",
                  },
                  {
                    title: "Shares mint net of the entry fee",
                    body: `The fee splits ${PROTOCOL_FEE_SPLIT_LABEL} between the basket creator and the treasury, and a Minted event lands on-chain — readable by anyone.`,
                  },
                ]}
              />

              <SubHead>ZAP — USDC IN, SEQUENTIAL</SubHead>
              <div className="mt-3 space-y-4">
                <P>
                  Deposit USDC and the app routes through Jupiter: swap legs
                  run first, then the same{" "}
                  <span className="font-mono text-sm text-foreground">
                    mint_in_kind
                  </span>{" "}
                  call. In V0 these are separate transactions, and that is the
                  honest tradeoff: the swaps are not atomic with the mint. A
                  failed leg leaves you holding intermediate
                  tokens — nothing is lost, but you finish the remaining legs
                  yourself. Typical slippage runs 1–3% and can be worse in fast
                  markets. The atomic on-chain zap is deferred to V1,
                  deliberately.
                </P>
              </div>
            </div>
          </section>

          {/* > 03 — HOW REDEMPTION WORKS */}
          <section id="redemption" aria-labelledby="redemption-heading" className="scroll-mt-24">
            <SectionHeader
              id="redemption-heading"
              size="display"
              index={3}
              label="HOW REDEMPTION WORKS"
            />
            <div className="mt-5 space-y-4">
              <P>
                Redemption is the path the whole design bends around.{" "}
                <span className="font-mono text-sm text-foreground">
                  redeem_in_kind
                </span>{" "}
                burns your shares and pays out the vault pro-rata: for each
                constituent, amount out = floor(vault balance × shares burned ÷
                total supply). Rounding floors to the raw token unit, so the
                vault can never pay out more than it holds. The only thing that
                runs before your payout is the management-fee checkpoint, so
                exit math is never based on a stale accrual.
              </P>
              <P>
                Three properties, enforced structurally rather than by policy.
                Oracle-free: the instruction reads no price account of any kind
                — your pro-rata share of the vault&apos;s actual contents is
                the payout. Permissionless: the only signer is you — no
                approval, no claim window, no processing delay. Ungateable: the
                redeem path contains no pause check, because pausing redemption
                is the one move that would turn self-custody into a promise.
              </P>
            </div>

            {/* The strongest line on the page — the yellow hairline is the
                only accent it gets; the words do the work. */}
            <aside className="mt-6 border-l-2 border-primary pl-4">
              <p className="text-[15px] font-medium leading-7 text-foreground">
                A whitelist pause stops new mints. It can never stop a
                redemption.
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Pausing a constituent mint blocks mint_in_kind for baskets that
                contain it — fail-closed, MintPaused error. redeem_in_kind has
                no such check, no oracle account, and no authority that can
                stand between you and your vault entitlement. Only you can burn
                your shares.
              </p>
            </aside>

            <p className="mt-6 text-[15px] leading-7 text-muted-foreground">
              This holds when everything else fails. If the website or the
              indexer is offline, redemption still works by talking to the
              basket program directly through any Solana RPC.
            </p>
          </section>

          {/* > 04 — BASKETS */}
          <section id="baskets" aria-labelledby="baskets-heading" className="scroll-mt-24">
            <SectionHeader
              id="baskets-heading"
              size="display"
              index={4}
              label="BASKETS"
            />
            <div className="mt-5 space-y-4">
              <P>
                A basket is defined by three immutable lists written at
                creation: the constituent mints (every one whitelisted and
                active at deploy time), their weights in basis points, and the
                fee schedule. Deployment is atomic — the basket account, the
                share mint, the vault token accounts, and the creator&apos;s
                seed deposit settle in one transaction. A basket cannot exist
                empty.
              </P>
              <P>
                Weights are targets, not managed positions. Prices move and the
                vault drifts with them; nothing trades to pull it back. The
                basket page shows actual versus target weight so drift is
                visible, not discovered. Genesis is deliberately boring: the
                seed deposit mints exactly{" "}
                {GENESIS_SHARES.toLocaleString("en-US")} shares — a fixed
                number chosen so a first depositor cannot engineer a
                share-price inflation attack.
              </P>
            </div>

            {/* Structural constraints table — the same ui/table hairline
                language as the basket page holdings table. */}
            <div className="mt-6 overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                      Parameter
                    </TableHead>
                    <TableHead className="font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                      Constraint
                    </TableHead>
                    <TableHead className="pr-5 text-right font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                      Enforced
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="py-2.5 pl-5 font-mono text-xs text-foreground">
                      Constituents
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                      {MIN_CONSTITUENTS}–{MAX_CONSTITUENTS} mints, whitelist active
                    </TableCell>
                    <TableCell className="py-2.5 pr-5 text-right font-mono text-xs text-muted-foreground">
                      create_basket
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="py-2.5 pl-5 font-mono text-xs text-foreground">
                      Weights
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                      basis points, sum = {WEIGHTS_DENOMINATOR.toLocaleString("en-US")} exactly
                    </TableCell>
                    <TableCell className="py-2.5 pr-5 text-right font-mono text-xs text-muted-foreground">
                      create_basket
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="py-2.5 pl-5 font-mono text-xs text-foreground">
                      Share token
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                      Token-2022 · {SHARE_MINT_DECIMALS} decimals
                    </TableCell>
                    <TableCell className="py-2.5 pr-5 text-right font-mono text-xs text-muted-foreground">
                      fixed
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="py-2.5 pl-5 font-mono text-xs text-foreground">
                      Genesis supply
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                      {GENESIS_SHARES.toLocaleString("en-US")} shares, minted to creator
                    </TableCell>
                    <TableCell className="py-2.5 pr-5 text-right font-mono text-xs text-muted-foreground">
                      inflation guard
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="py-2.5 pl-5 font-mono text-xs text-foreground">
                      Off-weight mint
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                      reverts above 1% deviation
                    </TableCell>
                    <TableCell className="py-2.5 pr-5 text-right font-mono text-xs text-muted-foreground">
                      WeightMismatch
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="py-2.5 pl-5 font-mono text-xs text-foreground">
                      Updates
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">
                      none exist — parameters immutable
                    </TableCell>
                    <TableCell className="py-2.5 pr-5 text-right font-mono text-xs text-muted-foreground">
                      program
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          {/* > 05 — FEES */}
          <section id="fees" aria-labelledby="fees-heading" className="scroll-mt-24">
            <SectionHeader
              id="fees-heading"
              size="display"
              index={5}
              label="FEES"
            />
            <div className="mt-5 space-y-4">
              <P>
                Creators choose three fees within hard caps, and the caps are
                enforced by the factory at deploy — not by policy. Every fee is
                charged in basket shares, never in the underlying tokens, and
                splits {PROTOCOL_FEE_SPLIT_LABEL} between the basket&apos;s creator and the
                treasury. Entry is one-time on mint. Exit is one-time on
                redeem. Management accrues continuously as share dilution
                through a permissionless crank — (then-current supply × rate × elapsed +
                stored numerator remainder) ÷
                ({WEIGHTS_DENOMINATOR.toLocaleString("en-US")} × seconds per
                year) — and is checkpointed inside every mint and redeem so the
                accrual is never stale. Fee shares join supply, so later
                intervals compound slightly.
              </P>
            </div>

            {/* Immutable constants from the verified source — the values are
                interpolated from the imports above, not retyped, so this page
                cannot drift from the code the client and program share. */}
            <pre className="mt-6 overflow-x-auto rounded-xl border bg-card p-5 font-mono text-xs leading-6 text-foreground">
              <code>
                <CodeComment>
                  {"// Caps enforced by FactoryConfig at deploy.\n"}
                  {"// Imported from app/lib/create-basket.ts — the same\n"}
                  {"// constants the client validates with.\n"}
                </CodeComment>
                {"ENTRY_FEE_CAP_BPS      = "}
                {ENTRY_FEE_CAP_BPS}
                <CodeComment>{"   // 3.00% — one-time, on mint\n"}</CodeComment>
                {"EXIT_FEE_CAP_BPS       = "}
                {EXIT_FEE_CAP_BPS}
                <CodeComment>{"   // 1.00% — one-time, on redeem\n"}</CodeComment>
                {"MANAGEMENT_FEE_CAP_BPS = "}
                {MANAGEMENT_FEE_CAP_BPS}
                <CodeComment>{"   // 3.00%/yr — share dilution\n"}</CodeComment>
              </code>
            </pre>

            <p className="mt-4 text-[15px] leading-7 text-muted-foreground">
              A basket&apos;s fee schedule is immutable once deployed, and it is
              disclosed on every basket page and in the create wizard before
              you sign. Read it there — this page shows only the ceiling.
            </p>
          </section>

          {/* > 06 — RISK */}
          <section id="risk" aria-labelledby="risk-heading" className="scroll-mt-24">
            <SectionHeader
              id="risk-heading"
              size="display"
              index={6}
              label="RISK"
            />
            <div className="mt-5 space-y-4">
              <P>
                The short version, without the small-print voice: holding a
                Basalt basket is exposure to tokenized equities and to the
                programs that wrap them. What can go wrong, plainly:
              </P>
              <ul className="space-y-4">
                <li className="border-l border-border/60 pl-4">
                  <p className="font-mono text-xs font-medium text-foreground">
                    Market risk
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    A basket tracks its xStocks; when they fall, the value of
                    your claim falls with them. There is no leverage — and
                    there is no floor.
                  </p>
                </li>
                <li className="border-l border-border/60 pl-4">
                  <p className="font-mono text-xs font-medium text-foreground">
                    Issuer and depeg risk
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    xStocks are structured instruments issued by Backed.
                    Holding one is a claim on the issuer&apos;s arrangement, not
                    the underlying share: no shareholder rights, no votes, and
                    the token can trade away from the asset it tracks.
                    Redemption returns xStock tokens, never off-chain shares.
                  </p>
                </li>
                <li className="border-l border-border/60 pl-4">
                  <p className="font-mono text-xs font-medium text-foreground">
                    Smart-contract and upgrade risk
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    The programs hold the vaults, and code can be wrong. The
                    programs are currently upgradable: their upgrade authority
                    can deploy changed logic. Immutability is promised for
                    basket parameters, not for program code — the upgrade
                    authority is a disclosed trust assumption.
                  </p>
                </li>
                <li className="border-l border-border/60 pl-4">
                  <p className="font-mono text-xs font-medium text-foreground">
                    No vetting, no advice
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Constituents, weights, and fees are chosen by whoever
                    deploys a basket. Basalt indexes the chain; it does not
                    evaluate anyone&apos;s thesis and nothing here is investment
                    advice. Do your own research, and read the full disclosures
                    on{" "}
                    <Link
                      href="/legal"
                      className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
                    >
                      Risks &amp; Disclosures
                    </Link>
                    .
                  </p>
                </li>
              </ul>
            </div>
          </section>

          {/* > 07 — VERIFY IT YOURSELF */}
          <section id="verify" aria-labelledby="verify-heading" className="scroll-mt-24">
            <SectionHeader
              id="verify-heading"
              size="display"
              index={7}
              label="VERIFY IT YOURSELF"
            />
            <div className="mt-5">
              <P>
                Nothing on this page requires trust in this website. Every
                number here is either a program constant or a fact on the
                chain, and the chain can be read by anyone.
              </P>
              <StepList
                items={[
                  {
                    title: "Open any basket page",
                    body: "The share mint and every constituent mint sit beside the data — each one a copy button. The verify block there is this section, applied.",
                  },
                  {
                    title: "Paste an address into Solana Explorer",
                    body: "explorer.solana.com, with the cluster matching the app. The Token-2022 mint, its authority, and its extensions are all readable there.",
                  },
                  {
                    title: "Read the vault",
                    body: "The basket's program-derived authority owns one token account per constituent. Those balances are the actual backing — no off-chain ledger involved.",
                  },
                  {
                    title: "Read the events",
                    body: "Minted, Redeemed, and FeeAccrued are emitted for every action. The indexer only replays them; it computes nothing you cannot recompute.",
                  },
                ]}
              />

              <SubHead>PROGRAM IDS</SubHead>
              <ul className="mt-3 divide-y divide-border/60 rounded-xl border bg-card px-5">
                {(
                  [
                    ["whitelist", PROGRAMS.whitelist],
                    ["basket_factory", PROGRAMS.factory],
                    ["basket", PROGRAMS.basket],
                  ] as const
                ).map(([name, pubkey]) => (
                  <li
                    key={name}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-medium text-foreground">
                        {name}
                      </p>
                      <p
                        className="truncate font-mono text-[11px] tabular-nums text-muted-foreground"
                        title={pubkey.toBase58()}
                      >
                        {pubkey.toBase58()}
                      </p>
                    </div>
                    <CopyButton
                      value={pubkey.toBase58()}
                      label={`Copy ${name} program ID`}
                    />
                  </li>
                ))}
              </ul>

              <p className="mt-6 text-[15px] leading-7 text-muted-foreground">
                If this site disappeared tomorrow, redemption would still work:
                build a redeem_in_kind transaction against the basket program
                from any wallet and any RPC. The indexer computes NAV and
                rankings for convenience; it never signs, and it is never in
                the path of your exit.
              </p>
            </div>
          </section>

          {/* ── Quiet pointers — the only CTAs this page gets ──────────── */}
          <footer className="border-t border-border/50 pt-6">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <Link
                href="/legal"
                className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Full disclosures → /legal
              </Link>
              <Link
                href="/explore"
                className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Explore baskets → /explore
              </Link>
              <Link
                href="/create"
                className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Create a basket → /create
              </Link>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
