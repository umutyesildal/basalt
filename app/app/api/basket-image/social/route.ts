import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getBasketCover } from "@/lib/basket-covers";
import { decodeConceptBasket } from "@/lib/concept-share";
import { basketSocialImage } from "@/lib/server/basket-social-image";

export const runtime = "nodejs";

/** Public link previews use validated basket data and bundled artwork only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.getAll("d").length !== 1 || [...params.keys()].some((key) => key !== "d")) return new Response(null, { status: 400 });
  const basket = decodeConceptBasket(params.get("d"));
  if (!basket) return new Response(null, { status: 400 });
  try {
    const cover = getBasketCover(basket.coverId);
    const bytes = await readFile(join(process.cwd(), "public/images/baskets/social", `${cover.id}.jpg`));
    const image = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    const response = new ImageResponse(basketSocialImage(basket, image), {
      width: 1200, height: 630,
      headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" },
    });
    return new Response(await response.arrayBuffer(), { headers: response.headers });
  } catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
