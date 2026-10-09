import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConceptPreviewClient from "@/app/preview/preview-client";
import { basketPreviewMetadata } from "@/lib/basket-preview-metadata";
import { loadSharedBasket } from "@/lib/shared-basket";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const basket = await loadSharedBasket(id);
  return basketPreviewMetadata(basket, basket ? `/b/${id}` : undefined);
}

export default async function SharedBasketPage({ params }: Props) {
  const { id } = await params;
  const basket = await loadSharedBasket(id);
  if (!basket) notFound();
  return <ConceptPreviewClient basket={basket} publicHref={`/b/${id}`} />;
}
