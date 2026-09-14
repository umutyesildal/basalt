# Basalt UI Primitif Kütüphanesi

> Tarih: 2026-09-14. U1 dalgası çıktısı. Kapsam: `app/components/ui/` altında **yalnızca yeni** primitifler — mevcut hiçbir dosya (tailwind.config, globals.css, section-header.tsx dahil) değiştirilmedi. Kaynak kurallar: `docs/ui-plan.md` §0–1, `brand.md`.

## Kurulum notu: motion.css

`tailwind.config.js` paralel ajan sahipliğinde olduğu için keyframe'ler `app/components/ui/motion.css` içinde yaşar. `motion.ts` bu dosyayı side-effect import eder; `skeleton-shimmer.tsx` de `motion.ts` üzerinden aynı garantiye bağlıdır. Yani:

- `motion.ts` veya `skeleton-shimmer.tsx` import eden **her modül keyframe'leri otomatik alır.**
- Sadece sınıf string'lerini (`FADE_UP` vb.) kullanan bir sayfa, dosyanın en üstüne **bir kez** `import "@/components/ui/motion.css";` eklemelidir (App Router'da global CSS her layout/page/component'tan import edilebilir).

---

## 1. `skeleton-shimmer.tsx` — SkeletonShimmer

**Amaç:** Shimmer süpürmeli tek iskelet çubuğu; `components/states/skeleton.tsx`'teki pulse varyantlarını tamamlar (o dosyaya dokunulmadı). Yükleme içerikle aynı alanı kaplar — layout kayması yok, sahte veri yok. `prefers-reduced-motion`'da animasyon kapanır, çubuk statik `bg-muted` yüzey olarak kalır.

**Prop'lar:**

| Prop | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `width` | `string \| number` | `"100%"` | Herhangi CSS genişliği (number = px). |
| `height` | `string \| number` | `"1rem"` | Herhangi CSS yüksekliği (number = px). |
| `rounded` | `"none" \| "sm" \| "md" \| "lg"` | `"sm"` | Token radius ölçeği (--radius 0.25rem). |
| `label` | `string?` | — | Verilirse çubuğun kendisi `role="status"` + etiketle duyurur; verilmezse `aria-hidden` olur (durum sarmalayıcısı çağıranın). |
| `className` | `string?` | — | Ek sınıf. |

**Örnek:**

```tsx
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";

<SkeletonShimmer height="1.5rem" width="12rem" label="Loading NAV" />
```

**Entegrasyon:** Dalga 1 U2 — explore/stocks/etfs grid'lerinin yükleme durumları (kart yüzü iskeletleri); U3 — basket NAV/holdings beklerken; Dalga 2'de tüm sayfalara yaygınlaştırma.

---

## 2. `micro-label.tsx` — MicroLabel

**Amaç:** `text-[10px] uppercase tracking-wide` + **zorunlu Geist Mono** ikincil etiket (`24h`, `30d`, `APY`, sütun başları, eyebrow). `brand.md` kuralı: uppercase + tracked etiketler daima mono.

**Renk kararı:** positive/negative, yön renginin **tek kaynağı** olan `ChangeValue` sınıflarını import eder (`--status-positive` / `--destructive`) — sınıf tekrarı yok. Grafik palette renkleri (sage/rose/blue/sand/lavender) yön kodlaması için **kullanılmaz** (globals.css 2026-09-12 değişikliği); onlar yalnızca chart/avatar içindedir.

**Prop'lar:**

| Prop | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `variant` | `"default" \| "muted" \| "positive" \| "negative"` | `"muted"` | default = foreground; muted = muted-foreground; positive/negative = ChangeValue sınıfları. |
| `as` | `"span" \| "div" \| "p"` | `"span"` | Render edilen etiket. |
| `className` | `string?` | — | Ek sınıf (ör. boyut esnetme). |

**Örnek:**

```tsx
import { MicroLabel } from "@/components/ui/micro-label";

<MicroLabel>24h</MicroLabel>
<MicroLabel variant="positive">verified</MicroLabel>
```

**Entegrasyon:** U2 kart anatomisi (kompozisyon chipleri, `30d/24h` mikro satırı); U4 feed/leaderboard zaman ve sayaç etiketleri; U3 işlem rayı durum satırları.

---

## 3. `stat-tile.tsx` — StatTile

**Amaç:** Kompakt istatistik kutusu: MicroLabel başlık + mono tabular değer + opsiyonel sağa yaslı delta. `MetricCardSkeleton`'ın (label çubuğu + değer çubuğu) yüklü hâli.

**Yüzey kararı (kart token'larıyla):** iki varyant —
- `card`: tam kart yüzü (`rounded-lg border bg-card p-4` — card.tsx'teki kanonik `p-5` tam kartlara ait; tile tanımından daha yoğundur),
- `flush`: yüzey yok — **mevcut bir Card'ın içindeki** grid satırları için (parent çizimi çizer). Varsayılan kompozisyon tercihi `flush`'a yakın kullanım içindir; asla Card içine `card` varyantı yığılmaz.

**Prop'lar:**

| Prop | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `label` | `ReactNode` | — | MicroLabel başlık ("NAV", "Holders"). |
| `value` | `ReactNode` | — | Değer; mono tabular, biçimlendirme çağıranın. |
| `delta` | `ReactNode?` | — | Sağa yaslı delta; tipik olarak `<ChangeValue changePct={…} />`. |
| `variant` | `"card" \| "flush"` | `"card"` | Yüzey. |
| `labelVariant` | MicroLabel varyantı | `"muted"` | MicroLabel geçişi. |
| `valueClassName` / `className` | `string?` | — | Değer / kök esnetme. |

**Örnek:**

```tsx
import { StatTile } from "@/components/ui/stat-tile";
import { ChangeValue } from "@/components/stocks/change-value";

<StatTile label="NAV" value="$1,284.02" delta={<ChangeValue changePct={1.24} />} />
```

**Entegrasyon:** U3 basket sayfa metrikleri (NAV/arz/fee satırları — `card`), U2 kart içi kompakt metrikler (`flush`), Dalga 2 portfolio/creator sayfaları.

---

## 4. `tooltip.tsx` — Tooltip

**Amaç:** Sessiz veri öğeleri için hover/focus ipucu (kırpılmış adresler, fee matematiği, source/asOf). Chrome monochrome: yalnızca popover token'ları.

**Yaklaşım:** `package.json`'da **Radix paketi yok**; projenin primitive kütüphanesi Radix ekibinin **Base UI**'ı (`@base-ui/react` — button.tsx/badge.tsx zaten alt modüllerini import ediyor) ve `@base-ui/react/tooltip` mevcut. Yeni bağımlılık eklemek yasak olduğundan sarmalayıcı bunu kullanır; parts API'si (Provider/Root/Trigger/Portal/Positioner/Popup) bilinçli olarak Radix biçimlidir, Dalga 2'de geçiş maliyeti düşük kalır. Trigger odaklanabilir inline `<span>` olarak render olur (altındaki içerik tıklanabilir kalır; klavye odağında açılır). Geçiş 150ms ease-out opacity — `motion-reduce`'da kapalı.

**Prop'lar:**

| Prop | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `content` | `ReactNode` | — | Tek kısa cümle (marka sesi). |
| `children` | `ReactNode` | — | Sarılan öğe; etkileşimli kalır, `aria-describedby` alır. |
| `side` / `align` | `"top"...` / `"start"...` | `"top"` / `"center"` | Konum. |
| `sideOffset` | `number` | `6` | Tetik–popup boşluğu (px). |
| `delay` | `number` | `300` | Açılış gecikmesi (ms). |
| `className` / `contentClassName` | `string?` | — | Trigger sarmalayıcı / popup yüzeyi. |

**Örnek:**

```tsx
import { Tooltip } from "@/components/ui/tooltip";

<Tooltip content="Management fee accrues per second, settled on redeem.">
  <span className="text-muted-foreground">fee ⓘ</span>
</Tooltip>
```

**Entegrasyon:** U3 işlem rayı (fee önizleme satırı, Half/Max açıklamaları), U2 kart chipleri (kırpılmış ticker listesi), Dalga 2'de FreshnessBadge yanına source/asOf ipuçları.

---

## 5. `section-heading.tsx` — SectionHeading

**Amaç:** Eyebrow-önce bölüm başlığı: MicroLabel eyebrow + display tracked-caps başlık + sağda opsiyonel aksiyon.

**İsim notu:** `section-header.tsx` (SectionHeader) **mevcut ve sayfalarda kullanılıyor** — değiştirilmedi. Bu dosya ona çakışmayan adda (SectionHeading) mono-eyebrow varyanttır; sayfa başlıkları ve display eyebrow'ler SectionHeader'da kalır. Bir bölümde **ikisinden biri** kullanılır, iç içe girmez.

**Ritim:** Site konteyneri `mx-auto max-w-6xl px-4 sm:px-6` içine yerleştirilir ("6xl rhythm"); dikey nefes bölümün kendisine aittir. `right` verilince başlık, grid üstü end-hizalı flex satırına döner (Explore'daki range-links düzeniyle aynı).

**Prop'lar:**

| Prop | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `eyebrow` | `ReactNode` | — | Mono mikro-eyebrow ("01 — PICK"). |
| `title` | `ReactNode` | — | Display başlık (SectionHeader "display" ölçeği: `text-xl md:text-2xl`). |
| `right` | `ReactNode?` | — | Sağ aksiyon yuvası (range links, FreshnessBadge). |
| `as` | `"h1" \| "h2" \| "h3"` | `"h2"` | Başlık etiketi. |
| `id` / `className` | `string?` | — | Heading id (aria-labelledby için) / kök sınıf. |

**Örnek:**

```tsx
import { SectionHeading } from "@/components/ui/section-heading";
import Link from "next/link";

<section aria-labelledby="trending-h">
  <div className="mx-auto max-w-6xl px-4 sm:px-6">
    <SectionHeading
      id="trending-h"
      eyebrow="02 — TRENDING"
      title="Top baskets"
      right={<Link href="/explore" className="text-sm text-muted-foreground hover:text-foreground">Browse all</Link>}
    />
  </div>
</section>
```

**Entegrasyon:** U4 ana sayfa bölüm ritmi + feed/leaderboard bölüm başları; Dalga 2'de explore/stocks grid başları.

---

## 6. `motion.ts` (+ `motion.css`) — hareket yardımcıları

**Amaç:** ui-plan §0.4 hareket bütçesinin (150–250ms ease-out, staggered fade-up, konfeti/neon yok) tek kaynaklı sınıf sabitleri. `motion.css` keyframe'leri barındırır (yukarıdaki kurulum notuna bakın); `transition-all` marka gereği yasaktır — sabitler duration/easing parçasıdır, özellik utility'siyle (`transition-colors` vb.) eşlenir.

**Dışa açılanlar:**

| İhraç | Değer / İmza | Kullanım |
|---|---|---|
| `DURATION` | `{ fast: 150, base: 200, slow: 250 }` | Inline style / dokümantasyon. |
| `EASING` | `"ease-out"` | Aynı. |
| `TRANSITION_FAST` / `_BASE` / `_SLOW` | `"duration-150 ease-out"` vb. | `cn("transition-colors", TRANSITION_FAST)`. |
| `FADE_UP` | `"basalt-fade-up"` | Tek atımlık giriş (220ms, translateY 8px, `both`). |
| `FADE_UP_DELAYS` | `["basalt-fade-up-0" … "-5"]` | 60ms'lik stagger adımları. |
| `fadeUpStagger(i)` | `(i: number) => string` | i. çocuğun tam sınıfı; 5'te kelepçeler. |
| `SHIMMER` | `"basalt-shimmer"` | SkeletonShimmer'ın kullandığı parlama sınıfı. |

**Örnek:**

```tsx
import { fadeUpStagger } from "@/components/ui/motion";

{baskets.map((basket, i) => (
  <BasketCard key={basket.id} className={fadeUpStagger(i)} {...basket} />
))}
```

**Entegrasyon:** U4 bölüm girişleri (hero sonrası bantlar), U2 grid giriş kaskadı; Dalga 2'de wizard adım geçişleri. Tüm sınıflar `prefers-reduced-motion` ile kapanır (motion.css).

---

## Uyumluluk özeti

- Yeni dosyalar: `skeleton-shimmer.tsx`, `micro-label.tsx`, `stat-tile.tsx`, `tooltip.tsx`, `section-heading.tsx`, `motion.ts`, `motion.css` (`app/components/ui/`) + bu doküman. Mevcut dosyalara dokunulmadı.
- Yeni npm paketi yok; Tooltip mevcut `@base-ui/react` alt modülünü kullanır.
- Renkler yalnızca mevcut token'lar (`bg-muted`, `--status-positive`, `--destructive`, popover/card/border seti); parlak/yeşil tema yok; konfeti/neon yok.
- Doğrulama: `cd app && npx tsc --noEmit --incremental false` → 0 hata.
