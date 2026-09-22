"use client";

import type { LegalAcknowledgments } from "./types";
import {
  CREATOR_FEE_SPLIT_PERCENT,
  TREASURY_FEE_SPLIT_PERCENT,
} from "@/lib/protocol-policy";

interface AcknowledgmentSpec {
  key: keyof LegalAcknowledgments;
  statement: string;
  detail: string;
}

const ACKNOWLEDGMENTS: AcknowledgmentSpec[] = [
  {
    key: "notAdvice",
    statement: "I understand this is not investment advice.",
    detail:
      "Basalt provides tooling, not recommendations. Nothing here evaluates whether these constituents, weights, or fees suit any person. Weight selection, fee selection, and deployment are entirely the creator's decisions.",
  },
  {
    key: "jurisdiction",
    statement: "I am responsible for where I create and share this basket.",
    detail:
      "Distribution of tokenized equities is restricted in several jurisdictions (including, without limitation, US persons for many xStocks). Any frontend geo-check is off-chain only — the on-chain program cannot gate who signs.",
  },
  {
    key: "structuredInstrument",
    statement: "I understand these devnet tokens are mocks, not issuer-backed xStocks.",
    detail:
      "Current devnet sample mints are mock tokens and are not issuer-backed xStocks. If official xStocks are admitted later, issuer and jurisdiction risks must be reviewed separately.",
  },
  {
    key: "creatorNotAdviser",
    statement: "I am not acting as a licensed adviser; creator fees are compensation.",
    detail:
      `Unless separately licensed, deploying a basket does not make me an adviser or asset manager. The fee schedule I set (entry up to 3%, exit up to 1%, annual management up to 3%) affects basket holders, is split ${CREATOR_FEE_SPLIT_PERCENT}% creator / ${TREASURY_FEE_SPLIT_PERCENT}% treasury, and is immutable once deployed.`,
  },
];

/**
 * Review — four hard acknowledgments. Deploy stays blocked until all four are
 * checked, and the LEGAL_REVIEW_REQUIRED placeholder stays visible.
 */
export function LegalCheckboxes({
  legal,
  onChange,
}: {
  legal: LegalAcknowledgments;
  onChange: (key: keyof LegalAcknowledgments, value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <details className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Read full disclosures</summary>
        <dl className="mt-3 space-y-3">
          {ACKNOWLEDGMENTS.map((spec) => (
            <div key={spec.key}>
              <dt className="font-medium text-foreground">{spec.statement}</dt>
              <dd className="mt-1 leading-5">{spec.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-border/60 pt-3 leading-5">
          These acknowledgments are UI copy only. They are not stored on-chain and do not replace any jurisdiction-specific agreement.
        </p>
      </details>
      <ul className="flex flex-col gap-2">
        {ACKNOWLEDGMENTS.map((spec) => (
          <li
            key={spec.key}
            className={legal[spec.key] ? "rounded-lg border border-primary/40 bg-primary/5" : "rounded-lg border border-border"}
          >
            <label
              className="flex cursor-pointer gap-3 p-3 transition-colors hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={legal[spec.key]}
                onChange={(event) => onChange(spec.key, event.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{spec.statement}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

    </div>
  );
}
