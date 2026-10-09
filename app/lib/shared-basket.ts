import { cache } from "react";
import { apiFetch } from "@/lib/api-client";
import { BASKET_SHARE_ID_RE } from "@/lib/basket-social-share";
import { decodeConceptBasket } from "@/lib/concept-share";

/** Resolve one immutable snapshot. Request parameters can never choose its host. */
export const loadSharedBasket = cache(async (id: string) => {
  if (!BASKET_SHARE_ID_RE.test(id)) return null;
  const response = await apiFetch(`/api/v1/basket-shares/${id}`, {
    cache: "no-store", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new Error("Basket links are temporarily unavailable.");
  const value = await response.json();
  if (value?.data?.id !== id || typeof value.data.encoded !== "string" || value.data.encoded.length > 4096) {
    throw new Error("Invalid basket link response");
  }
  return decodeConceptBasket(value.data.encoded);
});
