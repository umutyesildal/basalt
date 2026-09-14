"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { ActorLine } from "@/components/social/avatar";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { BasketSectionHeader } from "@/components/basket/basket-page-section-header";
import {
  fetchComments,
  fetchFeed,
  fetchPost,
  type CommentItem,
  type FeedItem,
  type FullPost,
} from "@/lib/social-api";
import { formatRelativeTime } from "@/lib/format";

const PAGE_LIMIT = 50;
/** Feed pages scanned client-side for theses linked to this basket. */
const MAX_PAGES = 3;

/**
 * Thesis tab — thesis posts linked to this basket, reused from the social
 * layer that powers /feed (GET /feed type=theses filtered to this basket
 * client-side; inline expansion fetches GET /posts/:id + comments).
 *
 * The feed endpoint has no basket filter yet, so coverage is "latest posts,
 * first pages" — the empty state says so honestly instead of implying
 * completeness. Writes (like/comment) stay on /feed; this panel is read-only.
 */
export function BasketPageTheses({
  pubkey,
  onWriteThesis,
}: {
  pubkey: string;
  /** Opens the shared ThesisComposerModal hosted by the detail page. */
  onWriteThesis: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [posts, setPosts] = useState<Extract<FeedItem, { kind: "thesis" }>[]>([]);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    async function load() {
      try {
        const found: Extract<FeedItem, { kind: "thesis" }>[] = [];
        let cursor: string | null = null;
        let scannedTotal = 0;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const payload = await fetchFeed(
            { scope: "all", type: "theses", limit: PAGE_LIMIT, cursor },
            controller.signal,
          );
          scannedTotal += payload.items.length;
          for (const item of payload.items) {
            if (item.kind === "thesis" && item.basket === pubkey) found.push(item);
          }
          cursor = payload.nextCursor;
          if (!cursor) break;
        }
        setPosts(found);
        setScanned(scannedTotal);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not reach the social feed.");
        setStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [pubkey, reloadKey]);

  // One header rhythm for every state (loading / error / empty / list) so the
  // empty state keeps the same hierarchy as a populated tab — the honest copy
  // itself is unchanged.
  let body: ReactNode;
  if (status === "loading") {
    body = (
      <div className="space-y-3 pt-2" role="status" aria-label="Loading theses">
        <span className="sr-only">Loading theses</span>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full max-w-md" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (status === "error") {
    body = (
      <ErrorState
        title="Theses unavailable"
        message={error ?? undefined}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  } else if (posts.length === 0) {
    body = (
      <EmptyState
        chip="EMPTY"
        title="No theses published for this basket yet"
        description={`No thesis post in the latest ${scanned} feed entries links to this basket. Theses are self-published reasoning attached to a basket — write yours to explain the composition.`}
        action={
          <Button size="sm" onClick={onWriteThesis}>
            Write the first thesis
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <ul className="border-l-2 border-l-border/60">
          {posts.map((post) => (
            <ThesisRow key={post.id} post={post} />
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3 pt-4">
          <Button variant="outline" size="sm" onClick={onWriteThesis}>
            Write thesis
          </Button>
          <Link
            href="/feed"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Open the feed
          </Link>
        </div>
      </>
    );
  }

  return (
    <section aria-label="Theses" className="space-y-4 pt-2">
      <BasketSectionHeader
        eyebrow="Self-published"
        title="Theses"
        note={
          status === "ready"
            ? `${posts.length} linked · latest ${scanned} feed entries scanned · self-reported, not advice`
            : undefined
        }
      />
      {body}
    </section>
  );
}

/** One thesis: author line, title, body with Read-more expansion + comments. */
function ThesisRow({ post }: { post: Extract<FeedItem, { kind: "thesis" }> }) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<FullPost | null>(null);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [expandError, setExpandError] = useState<string | null>(null);

  const toggleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || full) return;
    setExpandError(null);
    try {
      const [postRes, commentsRes] = await Promise.all([
        fetchPost(post.id),
        fetchComments(post.id).catch(() => null),
      ]);
      setFull(postRes.post);
      setComments(commentsRes?.items ?? []);
    } catch (err) {
      setExpandError(err instanceof Error ? err.message : "Could not load the full thesis.");
    }
  };

  return (
    <li className="ml-4 border-l-2 border-l-primary/30 py-4 pl-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Link
          href={`/creator/${post.wallet}`}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ActorLine
            emphasis
            wallet={post.wallet}
            handle={post.handle}
            displayName={post.displayName}
            avatarUrl={post.avatarUrl}
          />
        </Link>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatRelativeTime(post.ts)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => void toggleExpand()}
        aria-expanded={expanded}
        className="mt-2 block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="block text-[15px] font-semibold text-foreground">{post.title}</span>
        <span className="mt-1 block whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {expanded && full ? full.body : post.body}
          {expanded && !full ? "" : post.bodyTruncated && !expanded ? "…" : ""}
        </span>
      </button>
      {!expanded && post.bodyTruncated ? (
        <button
          type="button"
          onClick={() => void toggleExpand()}
          className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Read more
        </button>
      ) : null}

      {expandError ? (
        <p role="alert" className="mt-2 text-xs text-foreground">
          {expandError}{" "}
          <button
            type="button"
            onClick={() => {
              setFull(null);
              void toggleExpand();
            }}
            className="underline underline-offset-4"
          >
            Retry
          </button>
        </p>
      ) : null}

      {expanded && full ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {full.likeCount} likes · {comments === null ? "…" : comments.length} comments
          </p>
          {comments === null ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading comments…
            </p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((comment) => (
                <li key={comment.id}>
                  <p className="text-xs">
                    <Link
                      href={`/creator/${comment.wallet}`}
                      className="font-medium text-foreground hover:underline underline-offset-4"
                    >
                      {comment.handle
                        ? `@${comment.handle}`
                        : comment.displayName?.trim() || "anonymous wallet"}
                    </Link>
                    <span className="ml-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {formatRelativeTime(comment.ts)}
                    </span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">
                    {comment.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Likes and comments live on the{" "}
            <Link href="/feed" className="underline underline-offset-4 hover:text-foreground">
              feed
            </Link>
            .
          </p>
        </div>
      ) : null}
    </li>
  );
}

export default BasketPageTheses;
