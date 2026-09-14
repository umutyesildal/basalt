# Basalt UI Geliştirme Planı

> Tarih: 2026-09-14. Kaynak: `docs/` altındaki cesto-analiz serisi (özellikle 04 §5 "Tasarım dersi") + README "Frontend" bölümü + `brand.md`.
> Yöntem: her dalgada **4 paralel alt ajan**, dosya sahipliği çakışmayacak şekilde bölünür. Dalga bitince ana ajan tam doğrulama yapar (tsc + build).

## 0. Kilitli kurallar (her ajan, her dalga)

1. **Kimlik kilitli:** monochrome chrome + ethereal chart paleti (sage/rose/blue/sand/lavender) + **Chakra Petch display + BASALT MARK** (güncel kimlik: `brand.md` 2026-09-12; Cinzel/Roman katmanı emekli edildi). Cesto'nun koyu yeşil/neon teması ASLA kopyalanmaz — onlardan alınan tek şey bilgi hiyerarşisi ve etkileşim kalıplarıdır.
2. **Mimari kilitli:** Token-2022 sepet token'ı + atomic mint/redeem; `app/lib/transactions.ts`, backend, programs'a UI dalgalari dokunmaz.
3. **Ses:** asla ETF/fund; getiri iddiası yok; sahte veri yok (`source`/`asOf`, dürüst boş durum).
4. **Hareket ölçülü:** 150–250ms ease-out; hover yükselmesi, staggered fade-up, sayı geçişleri. Konfeti/neon/parıltı yok.
5. UI metinleri İngilizce; doküman Türkçe.

## 1. Tasarım ilkeleri (Cesto'dan öğrenilenler, monochrome'e uyarlandı)

- **Kart anatomisi:** isim-önce, tek cümlelik bağlam, kompozisyon avatar-chipleri + `+N` taşma, `30d`/`24h` mikro-etiket satırı, kartın tamamı tıklanabilir.
- **Mikro-tipografi:** `text-[10-11px] uppercase tracking-wide` ikincil bilgi için; sayılar tek kaynaklı `ChangeValue`.
- **Sticky işlem rayı:** alım-satım her sekmede görünür; canlı fee önizleme satırı; Half/Max kalıbı.
- **Skeleton + dürüst boş durum:** shimmer iskeletler, boşken öneri bloğu.
- **Nefes alan yoğunluk:** tutarlı section-header ritmi, tek container genişliği, tutarlı radius/border.

## 2. Dalgalar

### Dalga 1 (tamamlandı — 4 ajan)
| Ajan | Sahip olduğu dosyalar | Kapsam |
|---|---|---|
| U1 | `app/components/ui/*` (yalnız YENİ dosyalar), `docs/ui-primitives.md` | Primitif kütüphanesi: shimmer Skeleton, MicroLabel, StatTile, Tooltip, SectionHeader, motion yardımcıları. Sayfalara dokunmaz; entegrasyon Dalga 2'de. |
| U2 | `app/app/explore/`, `app/app/stocks/`, `app/app/etfs/`, yeni `app/components/cards/*` | Kart anatomisi yükseltmesi: avatar-chipler, +N, 30d/24h satırı, tutarlı grid ritmi. |
| U3 | `app/app/basket/**`, `app/components/basket/*` | İşlem rayı: fee önizlemesi, Half/Max, durum geri bildirimleri; grafik UX (aralık seçici, expand); About/Risk/Thesis tipografi geçişi. |
| U4 | `app/app/page.tsx` + home bileşenleri, header/nav, `app/app/feed/`, `app/app/leaderboard/` | Ana sayfa ritmi, header aktif durum + mobil davranış, feed/leaderboard kart hiyerarşisi ve equity sparkline stili. |

> Sonuç: U1 primitifleri (SkeletonShimmer + motion.css zinciri dâhil), kart anatomisi, işlem rayı ve ana sayfa ritmi teslim edildi; Dalga 2 entegrasyonuna hazır.

### Dalga 2 (tamamlandı)
- U1 primitiflerinin sayfalara entegrasyonu (skeleton/tooltip/micro-label yaygınlaştırma).
- Create wizard'a canlı önizleme paneli: canlı donut + allocation breakdown (Cesto /labs/create kalıbı) + ilerleme göstergesi cilası.
- OG image sepet-başına (kompozisyon donutlu), 404/empty sayfalarının cilası, dark/light tutarlılık denetimi.
- Share butonu + breadcrumb (Cesto kalıbı, monochrome uygulama).

> Sonuç: primitif entegrasyonu yaygınlaştırıldı; wizard canlı önizleme, sepet-başına OG image ve share/breadcrumb tamamlandı; sayfa başlığı tekleştirme kalıbı (`title: { absolute }` — `market`, `portfolio/layout`) bu dalgada başlatıldı.

### Dalga 3 (tamamlandı — 2026-09-14)
- Grafik derinleştirme: benchmark (SPYx) toggle, expand/zoom, karşılaştırma modu.
- Mobil alt-navigasyon deneyi (Cesto yüzen pill kalıbı — owner kararı gerekir).
- Erişilebilirlik denetimi + motion-reduce desteği.

> Sonuç: kalan eski iskeletler `SkeletonShimmer`'a geçirildi, 5 sayfa başlığı `absolute` kalıbına alındı; motion/erişilebilirlik denetimi yapıldı — düzeltme bulguları Dalga 4'e aktarıldı (bkz. `docs/ui-audit-wave3.md`).

### Dalga 4 (yolda — 2026-09-14)
- Dalga 3 denetim bulgularının düzeltilmesi (`docs/ui-audit-wave3.md` §2/§4: `transition-all` temizliği, `motion-reduce` kapsamı, 44px altı dokunma hedefleri, `EtfGridSkeleton` ↔ `EtfGridShimmerSkeleton` ikilemesi).
- Smoke script + dokümantasyon senkronu (README, `llms.txt`, `basalt-agent-guide.md`).

## 3. Owner kararları (açık)
1. `brand.md` "plain text buttons, never boxed pill wrappers" kuralı ↔ /explore kategori pilleri çelişkisi: pill kalıyorsa brand.md güncellenmeli.
2. Footer politikası: "footer yok" kuralı korunuyor (bilinçli).
3. Mobilde alt-navigasyon yapılacak mı (Dalga 3).
