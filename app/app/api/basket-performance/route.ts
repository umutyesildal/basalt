import { getBasketPerformance } from "@/lib/server/basket-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const payload = await getBasketPerformance();
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
