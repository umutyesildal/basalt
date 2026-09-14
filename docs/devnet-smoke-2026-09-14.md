# Devnet Canlı Duman Testi — 2026-09-14 (Dalga 4)

Bu dosya, 2026-09-14 günü yapılan Basalt devnet canlı duman testinin **kanıt
kayıdıdır** ve aynı testi herkesin aynı şekilde tekrar edebilmesi için yazılan
`scripts/smoke-dev.sh` betiğinin ilk koşu çıktısını belgeler.

- **Ağ:** Solana devnet (backend `backend/.env.devnet` ile yapılandırıldı)
- **Backend:** `npx tsx src/index.ts`, `:3001` (PORT=3001)
- **App:** `NEXT_PUBLIC_API=http://localhost:3001 NEXT_PUBLIC_CLUSTER=devnet npm run build` + `npm run start -- -p 3000`
- **Sonuç:** **24 PASS / 0 FAIL** — betik exit kodu 0, temizlik onaylı

## Nasıl tekrar edilir

Repo kökünden:

```bash
bash scripts/smoke-dev.sh
```

Betik sırasıyla: ön kontroller (env dosyası + portlar boş mu) → backend'i
`.env.devnet` ile arka planda başlatır ve `/api/v1/health` **200 + db.connected
+ basketCount** olana dek bekler (max 60 sn) → app'i devnet env'iyle build edip
`:3000`'de başlatır → rota matrisini curl'le denetler (basket pubkey'i
`/api/v1/baskets?limit=1` yanıtından **dinamik** alınır; sabit pubkey'e bağlı
değildir) → `/api/v1/events` 200 kontrolü yapar → EXIT trap'i ile süreç
gruplarını kapatır, portların boşaldığını doğrular ve PASS/FAIL özeti basar.

Env değerleri (DATABASE_URL, RPC_URL, …) hiçbir çıktıya basılmaz; hata durumunda
log kuyrukları bu değerleri maskeler.

## Health çıktısı özeti (betik koşusu, 2026-09-14)

`GET http://localhost:3001/api/v1/health` → 200:

```
db.connected=True basketCount=3 indexer=running navEngine=running feeCrank=running
```

Gün içindeki manuel koşuda health gövdesi de aynı tabloyu verdi: `db.connected:
true`, `basketCount: 3`, indexer / NAV engine / fee crank `running`.

## Rota matrisi (betik koşusu 2026-09-14, hepsi gerçek curl sonuçları)

| Rota | Beklenen | Sonuç |
|---|---|---|
| `/` | 200 | PASS |
| `/explore` | 200 | PASS |
| `/feed` | 200 | PASS |
| `/leaderboard` | 200 | PASS |
| `/portfolio` | 200 | PASS |
| `/market` | 200 | PASS |
| `/stocks` | 200 | PASS |
| `/etfs` | 200 | PASS |
| `/create` | 200 | PASS |
| `/legal` | 200 | PASS |
| `/robots.txt` | 200 | PASS |
| `/sitemap.xml` | 200 | PASS |
| `/llms.txt` | 200 | PASS |
| `/basalt-agent-guide.md` | 200 | PASS |
| `/api/agent/basket/CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo` | 200 | PASS |
| `/basket/CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo` | 200 | PASS |
| `/olmayan-sayfa-404` | 404 | PASS (404 döndü) |
| `GET /api/v1/events?basket=<pubkey>&limit=1` | 200 | PASS (events=1, ilk=FeeAccrued) |

Not: Basket rotaındaki pubkey betik tarafından o koşuda
`/api/v1/baskets?limit=1`'den dinamik alındı (bu koşuda `CZCH…` döndü; betik
herhangi bir basket için çalışır).

## Agent-markdown endpoint örneği (gerçek çıktı)

`GET /api/agent/basket/CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo`
(`content-type: text/markdown`) yanıtının ilk bölümü — aynen alındığı gibi:

```markdown
# Foundry Tech — Basalt strategy basket

## Identity

- Basket: `CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo`
- Share mint: `GZzEofuvUyxzGAnYqNJiJuAt6j4HLAtPGRbpNaPV362D` (Token-2022 receipt token, fixed 6 decimals)
- Creator: `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE`
- Created: 2026-09-04 19:42 UTC

## Composition

| Ticker | Target weight | Constituent mint |
|---|---|---|
| NVDA | 25.00% (2500 bps) | `Duagr7hYLnUcG42gu3xqhbSj1E6xwEvRMEN14CG5BKwn` |
| AAPL | 20.00% (2000 bps) | `7T5QwHsqHd5YmMSoJqg69kGsUVF7MMVzmy2bAumgPD23` |
| MSFT | 15.00% (1500 bps) | `4gZh5JxhrfKMg7x14evWcrhM3hWHfrtcq6cNgFPH5kQa` |
| META | 15.00% (1500 bps) | `E4SnZpaaQorTGtZNznYEFNTp3U1a3au9B4cwJBdjvZjG` |

## Fees

- Entry fee: 1.00% (on mint)
- Exit fee: 0.50% (on redeem)
- Management fee: 2.00% per year — accrues by share dilution via a permissionless crank; creator/treasury split 90/10

## Latest NAV

- Basket NAV: $223,019,871.02
- Share price: $0.3712 (reference, not a quote)
- Share supply: 600.747695 shares
- Snapshot: 2026-09-14 19:51 UTC

## Recent verified trades

- 2026-09-04 19:46 UTC · Minted — shares by 48CU…A3bg · est. $198.06 — sig RCdyWw…2ZCT5c
- 2026-09-04 19:46 UTC · Redeemed — shares by 48CU…A3bg · est. $0.02 — sig 3nz45q…3Mog8E

_Source: latest trade-feed page (limit 50) — absence here is not a claim of inactivity._

## Provenance

- Source: `onchain-indexed` · asOf 2026-09-14 19:51 UTC — read-only indexer data; the backend never signs transactions.
```

## Events rotası örneği (gerçek kayıt)

`GET /api/v1/events?basket=CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo&limit=3`
yanıtındaki (200) ilk kayıt, alan adları aynen korundu:

```json
{
  "sig": "23TPhP6GkjDCTKKutPHoJ5fPmLiCQ7ZuwLtFmJMKCJPsRxYPZDdNxZM51tRqGXuuPowM494RJ44FSyYEqfwSZ8ri",
  "slot": "493721911",
  "basket": "CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo",
  "type": "FeeAccrued",
  "data": {
    "type": "FeeAccrued",
    "basket": "CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo",
    "programId": "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k",
    "elapsedSec": "153",
    "sharesMinted": "58"
  },
  "ts": "2026-09-05T20:48:43.000Z",
  "source": "onchain-indexed",
  "asOf": "2026-09-05T20:48:43.000Z"
}
```

## Tarayıcı denetim bulguları (2026-09-14 manuel canlı test)

- **/explore:** kartlarda avatar-chip, 24h / 30d / vs SPY performans etiketleri
  canlı endpoint'lerden geliyor; uydurma sayı yok.
- **/basket/[pubkey]:** breadcrumb + paylaşım; About / History / Risk / Thesis
  bölümleri dolu; constituent mint'ler kopyalanabilir; holdings hem raw hem
  scaled gösteriliyor.
- **History sekmesi:** vs SPYx toggle + Expand çalışıyor; olay işaretçileri
  gerçek indexer verisi — **Mint×2, Redeem×1, FeeAccrued×11**; grafik
  yanında "not a backtest" notu mevcut.
- **404:** `/olmayan-sayfa-404` özel 404 sayfasına düşüyor.

## Temizlik / tekrarlanabilirlik

- Betik, EXIT trap'i ile backend ve app süreç **gruplarını** kapatır (`set -m`
  sayesinde npm→sh→next zinciri eksiksiz ölür), ardından `lsof` ile `:3000` ve
  `:3001`'in boşaldığını doğrular. İlk koşunun kapanış satırı:
  `OK :3000 ve :3001 boşaldı (dinleyici kalmadı)`.
- Devnet RPC'sine saygı: betik günde bir kez koşulacak şekilde tasarlandı;
  indexer read-only'dir, backend hiçbir işlemi imzalamaz.
