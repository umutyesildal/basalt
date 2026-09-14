# Basalt UI Denetimi — Dalga 3

> Tarih: 2026-09-14. Dalga 3 ajanı çıktısı. Üç iş: (1) kalan 2 eski iskeletin `SkeletonShimmer`'a geçişi, (2) sayfa başlıklarının (`metadata.title`) tekleştirilmesi — kök `template: "%s · Basalt"` ile çiftlenen "… Basalt · Basalt" hatasının giderilmesi, (3) motion/erişilebilirlik denetimi (READ-ONLY tarama; yalnızca sahiplikteki dosyalar düzeltildi).
>
> Kaynak kurallar: `docs/ui-plan.md` §0, `docs/ui-primitives.md`, `brand.md` (`transition-all` yasağı).

---

## 1. Yapılan değişiklikler

### 1.1 Skeleton → SkeletonShimmer geçişi

Footprint birebir korundu: aynı `role="status"` + `aria-label` sarmalayıcı, aynı `aria-hidden` kart kabukları (`rounded-lg border border-border bg-card p-5`), aynı çubuk boyutları (Tailwind `h-*/w-*` değerleri `SkeletonShimmer`'ın `height`/`width` prop'larına px/rem karşılıklarıyla taşındı; varsayılan `rounded="sm"` eski `Skeleton`'ın `rounded-sm`'i ile aynı). Export edilen API'ler (`StocksGrid`, `EtfGridSkeleton`) kırılmadı.

| Dosya | Değişiklik |
|---|---|
| `app/components/stocks/stocks-grid.tsx` | Yükleme iskeletindeki 4 `Skeleton` çubuğu → `SkeletonShimmer` (import `@/components/states/skeleton` → `@/components/ui/skeleton-shimmer`). |
| `app/components/etfs/etf-grid.tsx` | `EtfGridSkeleton` içindeki 4 `Skeleton` çubuğu → `SkeletonShimmer` (import `@/components/states` → `@/components/ui/skeleton-shimmer`; `cn` import'u korundu). |

Notlar:
- `skeleton-shimmer.tsx` → `motion.ts` → `motion.css` zinciri sayesinde keyframe'ler otomatik geldi; ayrıca `prefers-reduced-motion` kapsamı motion.css'ten bedavaya sağlandı (eski `Skeleton`'daki `motion-reduce:animate-none` eşdeğeri).
- **Kopya bulundu:** `app/app/etfs/grid-skeleton.tsx`'teki `EtfGridShimmerSkeleton`, `EtfGridSkeleton`'ın birebir shimmer kopyası olarak önceki dalgada yazılmış; bu geçişle iki bileşen artık aynı çıktıyı üretiyor. `EtfGridSkeleton` şu an hiçbir yerden kullanılmıyor (`/etfs` sayfası ve `loading.tsx` shimmer varyantını kullanıyor). → Dalga 4: `EtfGridSkeleton`'ı silip `EtfGridShimmerSkeleton`'ı `components/etfs/`'e taşıyın veya tersini yapın; tek kaynak kalsın.

### 1.2 Başlık tekleştirme (metadata)

Kök `app/app/layout.tsx`'teki `title.template: "%s · Basalt"` bilinçli olarak **dokunulmadan** bırakıldı (basket/create/metrix sahipliği + davranış: düz string başlıklarda çiftleme kaynağı o). Çözüm, Dalga 2'de `market` ve `portfolio/layout`'ta uygulanan kalıbın aynısı: `title: { absolute: "Basalt | <Sayfa>" }` + açıklama yorumu. Mevcut başlık metinleri korundu — yalnızca marka sona eklenip "— Basalt" sonekine gömülü olduğu için marka öne alındı (ör. `Stocks — Basalt` → `Basalt | Stocks`).

| Dosya | Eski (hatalı render) | Yeni |
|---|---|---|
| `app/app/stocks/page.tsx` | `Stocks — Basalt · Basalt` | `Basalt | Stocks` |
| `app/app/etfs/page.tsx` | `Tokenized ETFs — Basalt · Basalt` | `Basalt | Tokenized ETFs` |
| `app/app/explore/page.tsx` | `Baskets — Basalt · Basalt` | `Basalt | Baskets` |
| `app/app/feed/page.tsx` | `Feed — Basalt · Basalt` | `Basalt | Feed` |
| `app/app/leaderboard/page.tsx` | `Leaderboard — Basalt · Basalt` | `Basalt | Leaderboard` |

**Düzeltilen başlık sayısı: 5.** (`market/page.tsx` ve `portfolio/layout.tsx` Dalga 2'de zaten `absolute` kalıbına geçirilmişti; `portfolio/page.tsx` client bileşen olduğu için metadata'yı layout'tan alıyor — dokunulmadı.)

---

## 2. Motion / erişilebilirlik denetimi (READ-ONLY tarama)

Tarama kapsamı: `app/app/**` + `app/components/**` (`grep`, `transition-all`, `aria-pressed`/`aria-current`/`role="tab*`, `animate-*` × `motion-reduce`, `h-6/h-7/h-8` + `py-0.5/py-1` buton sınıfları, `<button`/`<Button` × svg tek çocuk). **Sahiplikteki dosyalarda (`components/stocks/**`, `components/etfs/**`) düzeltme gerektiren bulgu yok** — aşağıdaki tüm bulgular diğer ajanların sahipliğindedir ve rapor amaçlıdır.

### 2.a `transition-all` (marka yasağı)

| Dosya:satır | Bulgu | Önem | Dalga 4 önerisi |
|---|---|---|---|
| `components/charts/legend/legend-progress.tsx:39` | `transition-all duration-500` — tüm özellikleri geçişe bağlar; ayrıca 500ms, ui-plan §0.4'ün 150–250ms bütçesini aşıyor. | Orta | `transition-[width] duration-250 ease-out` (ya da hedeflenen özellik) yap. |
| `components/charts/legend/legend-item.tsx:23` | `transition-all duration-150 ease-out` | Orta | `transition-colors duration-150 ease-out`. |

(`motion.ts` ve `components/home/section-reveal.tsx`'teki eşleşmeler yalnızca yasağı anlatan yorum satırlarıdır.)

### 2.b Sekme/pill durum semantiği (`aria-pressed` / `aria-current`)

**İhlal bulunmadı.** Doğrulanan pozitif örnekler: `stocks-grid`/`etf-grid` filtre-sıralama butonları (`aria-pressed`), `explore-client` kategori pilleri, `feed-client` beğeni butonu, `leaderboard-client` aralık sekmesi (`aria-current`), `ui/range-links.tsx` (her iki modda `aria-current`), `basket-page-range-pills` + `basket-page-history` expand (`aria-pressed`), `buy/page.tsx` sekmeleri (tam `role="tablist"/tab/tabpanel` + `aria-selected` + ok tuşu), `create/stepper.tsx` (`aria-current="step"`), `site-header`/`mobile-nav` (`aria-current="page"`).

| Dosya | Bulgu | Önem | Dalga 4 önerisi |
|---|---|---|---|
| `components/ui/range-links.tsx` | Link modunda da `aria-current="true"` kullanılıyor; bağlantılar için deyimsel değer `"page"`. | Düşük | `hrefFor` modunda `aria-current="page"` üret. |

### 2.c `prefers-reduced-motion` kapsamı olmayan animasyonlar

`motion.css` (basalt-fade-up/shimmer) tam kapsamlı; `states/skeleton.tsx`, `shell/network-indicator`, `create/mint-picker`, `home/live-proof-section` (`useReducedMotion`) kapsamlı. Eksikler:

| Dosya:satır | Bulgu | Önem | Dalga 4 önerisi |
|---|---|---|---|
| `app/create/page.tsx:29–31` | 3 `animate-pulse` iskelet çubuğunda `motion-reduce:animate-none` yok (rota yüklemesi; motion.css'i import etmiyor). | Orta | SkeletonShimmer'a geç veya sınıflara `motion-reduce:animate-none` ekle. |
| `app/basket/[pubkey]/redeem/page.tsx:600` | `animate-spin` spinner, `motion-reduce:animate-none` yok. | Düşük | `motion-reduce:animate-none` ekle (spinner işlevsel geri bildirim; statik halka kalsın). |
| `components/basket/tx-review-modal.tsx:307` | Aynı desen. | Düşük | Aynı. |
| `components/basket/inkind-mint-form.tsx:645` | Aynı desen. | Düşük | Aynı. |
| `components/feedback/pending-tx-banner.tsx:82` | Aynı desen. | Düşük | Aynı. |
| `components/create/deploy-panel.tsx:511,637,662` | Aynı desen, 3 tekrar. | Düşük | Paylaşılan bir `<Spinner />` bileşenine topla; motion-reduce'u tek yerde çöz. |

### 2.d 44px altı dokunma hedefi şüpheleri

Ev kalıbı: filtre pill'lerinde mobilde 40px (`max-md:h-10`), masaüstünde kompakt 32px — bu kabul edilmiş desendir. Aşağıdakiler kalıbın da altında:

| Dosya:satır | Bulgu | Önem | Dalga 4 önerisi |
|---|---|---|---|
| `components/ui/copy-button.tsx:46` | `h-5` (20px) copy butonu. | Yüksek | `h-6 max-md:h-10` veya hedef alanını padding ile büyüt. |
| `app/stock/[ticker]/MintCopyButton.tsx:38` | `h-6 w-6` (24px) **ikon-only** buton — aria-label var, hedef küçük. | Yüksek | `size-8 max-md:size-10`. |
| `components/copy-button.tsx:66` | `h-6` (24px). | Orta | Üsttekiyle aynı. |
| `components/ui/button.tsx` (`xs`/`sm`/`icon` varyantları) | `h-6`/`h-7`/`size-8` — mobil ölçek yok; `size="xs"` kullanımı (`market`, `breadcrumb`) 24px'e düşürüyor. | Orta | `xs`/`sm`/`icon` varyantlarına `max-md:h-10`-türünde dokunma ölçeği ekle (kütüphane düzeyinde tek değişiklik, tüm tüketiciyi iyileştirir). |
| `app/explore/explore-client.tsx:227` | Kategori pilli `h-7 max-md:h-9` (mobil 36px; ev kalıbı 40px). | Orta | `max-md:h-10`'a çek. |
| `components/basket/basket-page-range-pills.tsx:38` | `px-2.5 py-1 text-[10px]` ≈ 22px. | Orta | `min-h-10 max-md` ölçüsü ekle. |
| `components/basket/basket-page-half-max.tsx:71` | `px-1.5 py-0.5` ≈ 20px Half/Max butonu. | Orta | Aynı. |
| `app/feed/feed-client.tsx:645` | Beğeni butonu `px-1.5 py-0.5` ≈ 20px (aria-pressed doğru). | Orta | Aynı. |
| `components/basket/basket-page-history.tsx:175` | Expand/Collapse pill ≈ 22px. | Düşük | Aynı. |

(Not: taramadaki `px-1.5 py-0.5` eşleşmelerinin çoğu etkileşimsiz chip `<span>`'lerdir — hedef sayılmaz; yalnızca `focus-visible:ring`/`onClick` taşıyanlar listelendi.)

### 2.e İkonlu butonlarda eksik `aria-label`

**İhlal bulunmadı.** `MintCopyButton`, `components/copy-button.tsx`, `components/ui/copy-button.tsx`, `wallet-picker` menüsü etiketli; `basket-page-breadcrumb`'daki Share butonu ikon + görünür metinli; `tx-review-modal`'da ikon-only kapatma butonu yok.

---

## 3. Doğrulama

- `cd app && npx tsc --noEmit --incremental false` → **sahiplikteki tüm dosyalarda 0 hata.** Komutun tamamında kalan tek hata kümesi `app/app/create/create-client.tsx`'tedir (JSX kapanış hatası); bu dosya Dalga 3 dokunma yasağı listesindedir ve paralel ajanın çalışma kopyasında (`git status: M`) henüz tamamlanmamış düzenlemedir — Dalga 3 kapsamı dışıdır, sahibi tarafından kapatılmalıdır. `npm run build` talimat gereği çalıştırılmadı.

## 4. Dalga 4 önerileri (özet)

1. `EtfGridSkeleton` ↔ `EtfGridShimmerSkeleton` ikilemesini tek kaynakta topla (bkz. §1.1 not).
2. `transition-all`'ları hedeflenen özellik geçişlerine çevir; legend-progress süresini 250ms bütçesine indir (§2.a).
3. `animate-spin`/`animate-pulse` kalan 8 noktaya `motion-reduce:animate-none`; spinner'ı paylaşılan bileşende standartlaştır (§2.c).
4. `Button` kütüphanesine mobil dokunma ölçeği ekle; copy-buton ailesini tek bileşende birleştir (§2.d) — üç kopya (`MintCopyButton`, `copy-button`, `ui/copy-button`) zaten aynı davranışı tekrarlıyor.
