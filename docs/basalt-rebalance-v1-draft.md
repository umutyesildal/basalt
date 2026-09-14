# Basalt Rebalance V1 — Taslak Tasarım Dokümanı

> Status: **DRAFT — owner kararı bekliyor** (kod yok; bu doküman onaylanmadan hiçbir implementasyon başlamaz) | Tarih: 2026-09-14
> Kapsam kısıtı: **Mimari değişmez.** Token-2022 sepet token'ı + atomic `mint_in_kind` / `redeem_in_kind` kalır. Program davranışını değiştiren hiçbir fikir bu dokümanda önerilmez.
> Reddedilen model: Cesto'nun "swap-into-wallet / motor kullanıcı adına işlem atar" modeli — **bkz. §1.2**.
> Referanslar: `docs/basalt-v0-spec.md` §2–6 (normatif), `README.md` (invariants), `docs/cesto-analiz/01` ve `04`, `brand.md` (ses kuralları), `app/lib/transactions.ts` (mevcut client builder'lar).
> Dil notu: Bu iç doküman Türkçedir; UI metin örnekleri İngilizce kalır. Ürün dili her yerde `strategy basket` kalır — asla "ETF"/"fund" denmez (`brand.md`, AGENTS.md §1).

---

## 1. Amaç ve kapsam

### 1.1 Problem

Basalt'ta bir sepet, oluşturulduktan sonra **değişmezdir** (`Basket` immutable; `update_basket` instruction'ı yok — spec §2.2/§3.2). Bu, "sepet tezi sonradan pivotlanamaz" güvencesinin kaynağıdır ve korunacak bir özelliktir. Yan etkisi ise şu: gerçek dünyada stratejiler yaşar — bir filing gelir, bir momentum rotasyonu olur, bir constituent whitelist dışı kalır. Bugün creator'ın tek seçeneği sepeti terk etmek ve sıfırdan yeni bir sepet kurmaktır; holder'ın tek seçeneği manuel redeem + manuel alım-satımdır. Her ikisi de yüksek sürtünme ve tutarlılık kaybı demektir.

**Rebalance V1'in hedefi:** holder'ın sepet pozisyonunu, **tek imzayla** (veya tx grubuyla), hedef kompozisyona dönüştürmesini sağlamak — mevcut program instruction'larının bir **kompozisyonu** olarak. Yeni instruction, yeni authority, yeni gate yok.

### 1.2 Cesto ile karşılaştırma: ne alıyoruz, ne reddediyoruz

Cesto'nun rebalance modeli (kanıt: `docs/cesto-analiz/01-urun-sayfalari-derin-inceleme.md` §5, `04-basalt-vs-cesto-karsilastirma.md` §1):

| Boyut | Cesto | Basalt (biz) |
|---|---|---|
| Versiyonlama | Sepet başına `version` int + `versionId` (uuid) + `changelog` (gerekçe metni). Gözlemlenen aralık v1–v14 (High-Growth Momentum v14; Pelosi v7; Stables v1'de bile operasyon notları) | Yok (V0). Bu doküman sunum katmanında bir eşini önerir (§4) |
| Execution | Strateji versiyonları arasında pozisyon **motor tarafından migrate edilir**: tracker'larda filing-tetikli, momentum'da quarterly, yield'te drift-tetikli. BYOW'da tek batch swap; Managed modda **Para MPC custodial cüzdanı imzalar** | **Kullanıcı-imzalı.** Backend asla imzalamaz (spec §2 kısıtı 5); "kullanıcımız adına işlem atan bir motor" yok |
| Atomicite | "Several independent transactions with no atomicity" — `PARTIALLY_COMPLETED` durumu mevcut | Tek Anchor işlemi, ya hep ya hiç; kompozit rebalance tx'i başarısızsa her şey geri döner |
| Custody | Managed = custodial (dokümanları "Managed positions are custodial" diye itiraf ediyor) | Non-custodial; sepet token'ı kullanıcı cüzdanında |
| Çıkış | Sepet token'ı yok → çıkış = swap; seans kısıtlı bacakta çıkış kilitlenebilir | `redeem_in_kind` 7/24, permissionless, oracle-free, constituent pause'luyken bile çalışır (devnet'te kanıtlı) |
| Şeffaflık | Changelog + gerekçe maddeleri güçlü; ama versiyon geçmişi public API'de yok (`/versions` → 404) | Her şey on-chain event; bizde tam geçmiş indexlenir |

**ALINAN (sunum/disiplin katmanı):**

1. **Versiyon numarası + tek paragraf gerekçe** kalıbı: "v1 → v2, neden değişti" bir bakışta görülür (örn. Pelosi v7 changelog'u: hangi filing, hangi ağırlık değişimi).
2. **Before → after allocation diff'i** UI'da net gösterilir (eski → yeni ağırlıklar, eklenen/çıkarılan bacaklar).
3. **Changelog'un olay-zamanlı olması:** Cesto'nun About metnini son filing'e göre güncellemesi gibi; bizde her versiyon kendi gerekçe metni + on-chain kanıtıyla (event imzaları) yaşar.

**REDDEDİLEN (mimari katmanı) — ve neden:**

1. **"Motor bizim adımıza işlem atar"** — gerekçe: non-custodial ilke + "backend never signs" sözü spec'te ve testte. Cesto'da bile bu opt-in ve Managed modda custodial; sessiz auto-rebalance düzenleyici ateş hattında (auto-copy tartışmasıyla aynı aile — spec Amendment 3'te gerekçelendirildi).
2. **"Swap-into-wallet, sepet token'ı yok"** — gerekçe: sepet token'ı bizim uzun vadeli composability avantajımız (teminat, LP, devir); Cesto'nun non-atomic çok bacaklı swap UX'i (`PARTIALLY_COMPLETED`) bilinçli olarak alınmaz.
3. **Canlı pozisyonun alttan alta migrate edilmesi** — gerekçe: kullanıcı her değişimin taraflısı olmalı; pozisyonu "en son versiyona" sessizce taşımak yerine biz taşima işleminin kendisini kullanıcıya imzalatır.

Sonuç: **Rebalance V1 = kullanıcı-imzalı, non-custodial, permissionless invariants korunmuş bir migrate akışı.** Versiyonlama bizde bir *sunum ve öneri* katmanıdır; execution her zaman kullanıcının imzasıyla gerçekleşir.

### 1.3 Kapsam dışı (V1'de yapılmaz)

- On-chain `rebalance` instruction'ı, `Basket` alanı ekleme/değiştirme, `update_basket` — mimari kısıtı.
- Otomatik/tetikli/zamanlanmış rebalance — "engine-executed" reddedildiği için kapsam dışı; ileride bile yalnızca "öneri üret + kullanıcıya bildir" düzeyinde olabilir.
- USDC zap, yield bacakları, prediction bacakları — bağımsız roadmap maddeleri.
- V2+ fikirleri: cross-basket doğrudan takas (escrow'lu swap), rebalance fee indirimi.

---

## 2. Tasarım seçenekleri

Üç seçenek değerlendirildi. Hepsi mevcut instruction yüzeyi üstünde tanımlıdır; hiçbiri program değişikliği gerektirmez (b'nin on-chain varyantı hariç — o da reddedilir, bkz. 2.2).

### 2.1 Seçenek a) `redeem_in_kind` + `mint_in_kind` kompozisyonu — yeni hedef kompozisyonda YENİ basket'e migrate

**Mekanik.** Sepetler değişmez olduğu için "yeni hedef kompozisyon" ancak **yeni bir Basket PDA'sı** olabilir (factory zaten permissionless — spec §3.2, devnet'te canlı). Holder:

1. Eski sepette `redeem_in_kind(shares_to_burn)` → pro-rata raw constituent'lar kullanıcı ATA'larına düşer (spec §5.3 matematiği: `amount_out_j = floor(V_j * burn_amount / S_before)`).
2. Hedef kompozisyon farkı kapanır: constituent değişimleri / ağırlık farkları için kullanıcı ATA'ları arasında swap bacakları (client'ta Jupiter, tıpkı V0 zap kalıbı gibi).
3. Yeni sepette `mint_in_kind(amounts, vault_balances)` → yeni hedef ağırlıklarına uygun deposit; her iki argüman da client tarafından zincirden okunarak kurulur (canlı imza — `programs/basket/src/lib.rs`). Pay hesabı 1% tolerance ile kontrol edilir: `max(gross_j) − min(gross_j) ≤ 0.01 · min`, aksi `WeightMismatch` — spec §5.2.

Bu üç adım **tek işlemde** atomik olarak zincirlenebilir: instruction'lar sırayla yürür, 2. adımın bacakları 1. adımın ürettiği bakiye üzerinde çalışır; herhangi bir bacak slippage dışına çıkarsa tüm tx revert eder ve kullanıcı yalnızca gas kaybeder. Bacak sayısı / compute bütçesi tek tx'e sığmadığında aynı sıra bir **tx grubu** olarak da çalışır (non-atomiclik V0 zap'ta zaten dokümante edilmiş tradeoff — spec §3.3).

**Artı:**
- Sıfır program değişikliği; devnet'te kanıtlanmış iki instruction + factory.
- Eski sepet invariant'ları hiç dokunulmadan kalır: eski sepet sonsuza dek redeem edilebilir.
- Atomicite Cesto'dan yapısal olarak üstün (tek tx = ya hep ya hiç).
- Fee muhasebesi spec'te zaten tanımlı; çift fee-accrual yok (bkz. §5.3).

**Eksi:**
- Her versiyon = yeni sepet = creator'ın yeni seed deposit'i (`seed_amounts[i] > 0` zorunlu — spec §3.2 madde 8). Seed, creator'ın genesis 1M payı olarak kilitli kalır; creator isterse tam redeem ile geri alabilir ama versiyon başına geçici sermaye bağlıyor.
- Ağırlık farkları swap bacağı gerektirir → mainnet'te xStocks Token-2022 Jupiter likiditesine bağımlılık; devnet mock'ta havuz yok (E2E stratejisi §7'de).
- Payda hesapları client tarafında yapılır → yanlış quote = `WeightMismatch` revert (atomik, zararsız ama UX sürtünmesi).

### 2.2 Seçenek b) Aynı basket içinde hedef ağırlık değişikliği + kullanıcı başına adaptif mint/redeem

**Önerilen mekanik (hayali):** tek Basket hesabında `target_weights_bps` alanı güncellenir; kullanıcılar kendi pozisyonlarını adaptif mint/redeem ile yeni ağırlığa çevirir.

**Neden dürüstçe eleniyor — sorunlar:**

1. **Vault'un tek kompozisyonu var ve değişmez.** `mint_in_kind` pay hesabını `gross_j = D_j · S / V_j` üzerinden kurar (spec §5.2): yani bir sepet token'ı **her zaman vault'un mevcut içeriğinin pro-rata makbuzudur**. Aynı vault içinde "kullanıcı başına farklı kompozisyon" matematiksel olarak tanımsızdır — makbuz ortak bir havuzu temsil etmeyi bırakır. Ayrıca `Basket` immutable'dır; ağırlık güncellemesi **program değişikliği** demektir → mimari kısıt ihlali (bu tek başına elenme sebebi).
2. **"Kullanıcı başına adaptif" aslında sepsten sapmadır.** Gerçekte uygulanabilir varyant, kullanıcının kısmi redeem edip kalanını kendi cüzdanında farklı varlıklarda tutmasıdır: bu, sepetin makbuz özelliğini kıran bir **bireysel sapma**dır, rebalance değil. Portföy görünümü, drift barı ve NAV pay-price ilişkisi bozulur; "sepet = tek token = tek tez" anlatısı yıkılır.
3. **Cesto'nun yanlışına düşer.** Ağırlığı on-chain değiştiren bir model, en azından creator tarafında değiştirme gücü ve governance sorusu üretir; "immutable thesis" güvencesi (spec §12 metadata immutability satırı) pazarlık konusu olur.

**Artı (neden yine de listeleniyor):** tek sepet sürer, versiyon başına seed maliyeti yok, tek bir pay token'ı "her zaman güncel" görünür. Bu çekicilik, yukarıdaki üç yapısal sorunla değiştirilemez biçimde dengesizdir. **RED: bu dokümanın konusu olan V1 için dışlanır.** (Aynı yönde: ağırlık değişikliği *sunum* katmanında bir "hedef" olarak gösterilse bile on-chain vault ağırlığıyla çelişir — drift barı yalan söylemek zorunda kalır.)

### 2.3 Seçenek c) "Clone & migrate" — yeni versiyon sepeti türetme + tek tıkla taşıma

**Mekanik.** `basket_factory::create_basket` permissionless olduğu için, creator (veya aslında herkes — bkz. açık soru 3) mevcut sepetten türetilmiş parametrelerle (değişen ağırlıklar/constituent'lar, aynı fee şeması veya güncellenmiş) **yeni bir sepet** kurar. Ürün katmanında bu yeni sepet "eski sepetin v2'si" olarak sunulur (off-chain metadata; bkz. §4). Holder'a `/basket/eski` sayfasında "Convert to v2" tek tık akışı sunulur; tıklama, 2.1'deki kompozit tx'i imzalatır.

**Artı:**
- Versiyon hikâyesini (v1, v2, v3…) ve changelog sunumunu doğal biçimde taşır — Cesto kalıbının temiz karşılığı.
- Eski sepet tamamen yaşamaya devam eder; migrasyon **opt-in**'dir; hiçbir holder zorlanmaz.
- Creator'a versiyon başına fee şeması güncelleme esnekliği verir (yeni sepet = yeni fee argümanları; yine cap'ler içinde — spec §3.2 madde 5).
- 2.1'in mekanik üst kümesi değil **paketlenmiş hâli**: mekanik aynı, fark ürün hikâyesinde (lineage, diff, changelog).

**Eksi:**
- 2.1'in taşıdığı seed maliyeti + likidite bağımlılığı aynen geçerli.
- "Herkes yeni versiyon türetebilir" permissionless'ın doğal sonucu; ürün katmanında lineage doğrulaması (aynı creator mu?) yapılmazsa taklit/spoof versiyonları ortaya çıkabilir → sunum katmanı kuralı gerekir (§4, açık soru 3).

### 2.4 Artı/eksi özet tablosu

| Kriter | a) Redeem+Mint kompoziti | b) Aynı basket ağırlık değişimi | c) Clone & migrate |
|---|---|---|---|
| Program değişikliği | Yok | **Gerekli (immutable ihlali)** | Yok |
| Mimari kısıta uyum | Tam | **İhlal** | Tam |
| Makbuz (receipt) özelliği | Korunur | **Bozulur** | Korunur |
| Atomicite | Tek tx mümkün | n/a | Tek tx mümkün (a ile aynı mekanik) |
| Invariant etkisi (redeem gate'siz, pauser yok) | Yok | Ağırlık değişimi yeni yetki sorusu doğurur | Yok |
| Eski pozisyonun akıbeti | Redeem edilebilir kalır | Sözde "güncellenir" (fiilen bozulur) | Redeem edilebilir kalır |
| Versiyon/changelog sunumu | Zorlanır | — | Doğal |
| Creator maliyeti | Seed per versiyon | Yok | Seed per versiyon |
| Likidite bağımlılığı (swap bacakları) | Var | Yok | Var |
| Kestirim | **Mekanik olarak seçildi** | **Red** | **Ürün paketi olarak seçildi** |

---

## 3. Önerilen yol: a + c hibrit

**Özet:** Mekanik 2.1'dir (redeem → swap bacakları → mint, kompozit tx veya tx grubu); ürün paketi 2.3'tür (permissionless factory ile türetilen versiyon sepetleri + tek tık migrate). Vault ve pay token modeli hiç değişmez; **`strategy_version` on-chain bir alan değil, metadata/sunum katmanında bir lineage'dır.**

**Katmanlar:**

1. **On-chain (değişmez):** eski Basket + yeni Basket, iki bağımsız immutable PDA. Aralarındaki tek ilişki, kullanıcıların imzaladığı `Redeemed(eski)` + `Minted(yeni)` event çiftidir.
2. **Metadata/sunum (off-chain, mevcut alanlar):** `baskets.metadata_json` (backend şemasında zaten var — spec §7) `strategy_version`, `strategy_lineage` (önceki sepet pubkey'i), `changelog` (gerekçe metni) alanlarını taşır. IPFS/Arweave içeriği `metadata_hash` ile sabitlenir (mevcut davranış). Indexer lineage'ı okur; `/basket/[pubkey]` sayfası v1→v2 rozetini ve diff'i çizer.
3. **Client/quote (yeni, read-only):** migrate önerisi motoru — eski pozisyon değeri, hedef ağırlıklar, delta bacak tutarları, Jupiter quote'ları, beklenen fee'ler (exit + entry + swap slippage aralığı) hesaplanır. Backend **imzasız** tx döndürür (mevcut kural: backend never signs).

**Tx planlaması:**

- **Kompozit tek tx (tercih edilen):** `[redeem_in_kind(eski) → Jupiter leg'leri → mint_in_kind(yeni)]`. v0 + ALT derlemesi gerekir (n ≥ 4'te mevcut builder kalıbı: `app/lib/transactions.ts` — `mintRedeemNeedsAlt`, `deriveMintRedeemAltAddresses`); compute bütçesi bacak sayısıyla büyür (mevcut `UI_COMPUTE_UNIT_LIMIT = 500_000`; kompozitte per-tx bütçe yeniden hesaplanmalı — açık soru 5).
- **Tx grubu (fallback):** n büyükse veya bir bacakta likidite yoksa: (i) redeem tx → (ii) swap tx'leri → (iii) mint tx. Non-atomic; V0 zap'la aynı, zaten dokümante edilmiş tradeoff (spec §3.3). UI'da "three transactions, funds settle in your wallet between steps" uyarısı gösterilir.
- **Manuel top-up modu (ikinci fallback):** kullanıcı gerekli tüm constituent'lara zaten sahipse swap bacağı olmadan da migrate edebilir; client "you need X more NVDAx" diff'ini gösterir, kullanıcı dışarıdan tamamlar. Jupiter Token-2022 routing doğrulanana kadar bu mod devnet E2E'nin de birincil yolu olur (§7).

**Neden bu hibrit:** (i) mimari kısıtını sıfır ihlalle karşılar; (ii) kullanıcı-imzalıdır, motor-execution yoktur; (iii) Cesto'nun bize değer katan tek kalıbı olan versiyon+gerekçe sunumunu, bizim on-chain-verified event gerçekliğimizle birleştirir; (iv) her fallback'i spec'te önceden var olan kalıplara (zap non-atomiclik notu, mevcut ALT builder'ları) dayandırır.

---

## 4. Etkileşim: UX akışı ve changelog kalıbı

Akış creator'ın yeni versiyonu **yayınlamasıyla** başlar, holder'ın **tek imzasıyla** biter. (UI metinleri İngilizce — buradaki Türkçe açıklama amaçlıdır.)

1. **Öneri (creator):** create wizard'a "Derive new version" girişi — kaynak sepet seçilir, ağırlıklar/constituent'lar düzenlenir, changelog gerekçe metni yazılır (zorunlu alan). Deploy → yeni BasketCreated + metadata'da `strategy_version: 2`, `strategy_lineage: <eski pubkey>`, `changelog: "<tek paragraf gerekçe>"`.
2. **Keşif:** eski sepet sayfasında "v2 available" rozeti; `/explore`'da eski sepet "superseded by v2" işaretiyle listelenmeye devam eder (listeden çekilme = sunum kararı; açık soru 2).
3. **Diff görünümü (holder, eski sepet sayfası):** "Convert your position to v2" paneli:
   - Eski → yeni ağırlık tablosu: `NVDAx 40% → 25% (−15pp)`, `ORCLx — → 10% (added)`, `TSLAx 30% → 30%`.
   - Pozisyon etkisi: `Your position: 12.5 v1 shares → est. 12.4 v2 shares`, fee dökümü satır satır: `Exit fee (v1, 50 bps): 0.006 shares`, `Entry fee (v2, 100 bps): 0.012 shares`, `Est. swap slippage: 0.1–0.4%`. *(Pre-signature estimate — net outcome is what the transaction confirms.)*
   - Whitelist durumu rozeti: yeni constituent'ın `Active` olduğu görünür (pause'luysa migrate CTA disabled — `mint_in_kind` fail-closed'dur, spec §3.3).
   - Tx modu rozeti: `1 transaction` veya `3 transactions (non-atomic between steps)`.
4. **Tek imza:** cüzdan onay penceresinde kompozit tx (veya tx grubunun ilki). İmza reddedilirse hiçbir şey olmaz; revert olursa pozisyon değişmez (atomik modda).
5. **Changelog kaydı feed'de:** indexer, aynı imzalayıcıdan gelen `Redeemed(v1)` + `Minted(v2)` çiftini **Migration** feed öğesine korele eder: "Migrated 12.5 v1 shares → 12.4 v2 shares · v1 → v2" + changelog metni + iki tx imzası. Cesto'nun changelog satırı kalıbı ("Increased BE and INTC following Pelosi's August 21 filing…") birebir ses düzeyinde benimsenir; fark: bizim gerekçe metni **on-chain event çiftiyle doğrulanabilir** durumdur — sunum iddia değil, kanıtla yan yana.
6. **Geçmiş:** sepet sayfasında versiyon zaman çizelgesi (v1 → v2 → v3), her düğüm changelog + doğrulayıcı tx linkleri. Cesto'nun kapalı olan `/versions` endpoint'ine karşılık bizde bu geçmiş public indexlenir (01. dosyanın §10.8 "zayıf nokta" saptamasının üzerimize lorsı).

**Ses kuralları denetimi:** akış metinlerinde "auto-rebalance", "we rebalance for you", "managed" **kullanılmaz**; kullanılan: "Convert your position", "You sign one transaction", "Estimates only". "ETF"/"fund" yasak; "strategy basket" kalır.

---

## 5. Güvenlik / invaryantlar

Her satır mevcut spec/README invariant'ıyla eşleştirilmiştir; rebalance tasarımının hiçbir öğesi bunları değiştirmez.

1. **`redeem_in_kind` gate'sizliği bozulmaz.** Migrate akışı redeem'e hiçbir yeni hesap/gate eklemez; 3n remaining-accounts sözleşmesi ve "NO whitelist, NO oracle, NO pauser, NO backend account" yapısı aynen korunur (program doc-comment + yapısal test `test_remaining_accounts_rejects_legacy_3n_layout`). Eski sepet versiyonlanıp "terk edilse bile" redeem her zaman çalışır — constituent pause'luyken bile (devnet kanıtı, README "Devnet live" bölümü). **Deprecation yalnızca sunum katmanıdır.**
2. **Pauser yok, yeni authority yok.** Hibrit yol hiçbir yeni imzalayıcı tanımlamaz; vault authority PDA ve share mint authority değişmez. Seçenek b'nin (ağırlık güncelleme) reddedilmesinin ikinci gerekçesi de budur: değiştirilebilir ağırlık, fiilen bir kontrol yetkisi doğurur.
3. **Fee etkisi — çift accrual yok, fee stack'i dürüst.**
   - *Yönetim ücreti:* accrual, instruction girişinde `elapsed = now − last_fee_accrual_ts` ile çalışır (spec §6.3). Kompozit tek tx'te eski sepetin accrual'ı redeem içinde, yeni sepetin accrual'ı mint içinde birer kez tetiklenir — **farklı basket hesapları**, birbirini etkilemez. Aynı tx'te aynı sepet için ikinci bir accrual çağrılsaydı bile aynı slot timestamp'i `elapsed = 0 → fee_shares = 0` verirdi; yani **fee accrual çift tetiklenmez** (hem matematiği hem mevcut `accrue_fee_internal` davranışı buna uygun).
   - *Exit + entry stack'i:* migrate, eski sepetin exit fee'sini ve yeni sepetin entry fee'sini öder (cap'ler: exit ≤ 100, entry ≤ 300 bps — spec §6.1). Bu **tasarım gereğidir ve diff ekranında satır satır gösterilir** (§4.3). Mitigasyon ürün katmanındadır: creator, sürümden kalkan eski sepette exit fee'yi düşük kurgulayabilir (yeni sepet zaten ayrı fee argümanlarıyla kuruluyor). Creator'ın migrate'i ücretsizleştirmek zorunda olmadığı gibi, "double-dip" algısına karşı UI'da iki fee'nin ayrı sepetlere ait olduğu etiketlenir.
4. **Tx boyutu / compute.** 1232 B legacy limiti v0 + ALT ile aşılmış durumda: `create_basket` n=6 → 631 B (MAG SIX devnet'te canlı; plan.md "KNOWN LIMIT → RESOLVED"), mint/redeem için de v0+ALT builder'ları mevcut. Kompozit migrate tx'i: eski sepet redeem (3n hesap) + bacaklar + yeni sepet mint (4n hesap) → tek tx için pratik üst sınır **n ≈ 6** (hem boyut hem compute; bacak başına ~100–200k CU). Üstü tx grubuna düşer. Kesin eşik, implementasyonda ölçülür (açıksoru 5). **n = 20'ye kadar tek-tx vaadi verilmez.**
5. **No-custody.** Quote/öneri motoru salt okunur; ürettiği tx **imzasız**dır ve mevcut "backend never signs" kuralı değişmez (spec §2 kısıtı 5; backend fee-crank'ta zaten aynı deseni kullanıyor). Swap bacakları kullanıcının kendi ATA'ları arasında, kullanıcı authority'siyle yürür. Managed/custodial hiçbir mod tanımlanmaz.
6. **Slippage / WeightMismatch güvenliği.** Client, `mint_in_kind(amounts, vault_balances)` argümanlarını hedef ağırlıklara göre kesin tutarlarla kurar (`amounts` = bacak sonrası beklenen bakiyeler; `vault_balances` = hedef sepetin güncel vault bakiyeleri — mevcut builder kalıbındaki `BasketCoreKeys` + bakiye okuma akışıyla aynı); her Jupiter bacağının `minOut`'u **gereken tutarın altına düşmez** şekilde ayarlanır. Fiyat toleransı aşılırsa tx atomik revert eder — kullanıcı pozisyonu eski sepette kalır, zarar yalnızca priority fee. `mint_in_kind`'in 1% ağırlık toleransı (spec §5.2) bacak sonrası minik sapmaları emer.
7. **Genesis / inflation attack etkilenmez.** Her yeni versiyon sepeti kendi sabit 1M genesis payıyla doğar (spec §5.2 örnek 3); migrate bu korunmayı değiştirmez.
8. **RAW-only ve Token-2022 muhasebesi.** Bacaklar dahil hiçbir adım scaled/raw karışımına yol açmaz; program katmanı raw ile çalışır, UI `scaled = raw × multiplier` gösterir (spec §4). Bacak CPI'ları kullanıcı authority'li normal swap'lardır; program CPI yüzeyine ekleme yoktur.
9. **Düzenleyici yüzey.** Migrate = redeem + mint'in kompozisyonu; yeni bir hizmet tanımı eklemez. Otomatik execution'ın reddi bu dokümanın birincil düzenleyici savunmasıdır (spec §12 "no rebalancing in V0" satırı V1'de "no auto-rebalancing, user-signed migration" olarak güncellenmelidir — spec eki, §7).

---

## 6. Açık sorular (owner kararı gerektirir)

1. **Fee politikası:** Migrate'te exit + entry fee stack'i aynen kabul mü? Creator'lara "sürümden kalkan sepette exit fee'yi düşük kur" yönlendirmesi yapılsın mı, yoksa platform önerisi olarak hedef sepet entry fee'si migrate akışında mı gösterilsin? (Ürün + hukuki izlenim meselesi; on-chain bir değişiklik gerekmez.)
2. **Eski sepetin listelenmesi:** Yeni versiyon yayınlandığında eski sepet `/explore`'da kalmalı mı ("superseded by v2" rozetiyle), ayrı bir "archived" sekmesine mi düşmeli? Eski sepetin yeni yatırımcı kabul etmesi (mint) açık kalmalı mı — `mint_in_kind` pause'lu constituent dışında bloklanamadığından bu salt sunum/künye kararıdır.
3. **Lineage sahipliği:** Versiyon sepetini yalnızca **aynı creator** türetmişse "v2" sunumu almalı mı? Permissionless factory herkesin türetmesine izin verir; öneri: "official lineage" = aynı creator + client doğrulaması, türetme herkese açık kalır. (Spoof-versiyon riski §2.3.)
4. **Jupiter Token-2022 likiditesi:** Tek-tx migrate vaadi, mainnet'te xStocks bacaklarının gerçek Jupiter routing'ine bağlı. Devnet mock'ta havuz yok. Owner kararı: V1 duyurusu "manual top-up mode first, swap legs when liquidity lands" mi, yoksa mainnet likidite doğrulaması V1 ön şartı mı?
5. **Compute bütçesi:** Kompozit tx'te per-tx CU limiti mevcut 500k'dan yükseltilecek (priority fee maliyeti kullanıcıya) — bacak başına CU ölçümü sonrası sabit limit mi (örn. 1.2M), yoksa client-side ölçüme göre dinamik mi?
6. **Feed korelasyonu:** `Redeemed(v1)+Minted(v2)` çifti tek "Migration" öğesi mi gösterilsin, yoksa V1'de iki ayrı event mi kalsın? (Indexer işi; tek öğe daha anlaşılır, ayrı öğeler daha "ham kanıt".)
7. **Min pozisyon / toz politikası:** Fee'lerin faydasını aşacağı küçük pozisyonlar için migrate CTA'sı uyarı eşiği (örn. estimated fees > 5% of position → "fees exceed typical benefit" uyarısı) konulsun mu, eşik kaç olsun?

---

## 7. 30 günlük uygulama taslağı

**Ana vurgu:** Önerilen yol (a+c hibrit) **program değişikliği gerektirmez** — `redeem_in_kind`, `mint_in_kind`, `create_basket`, permissionless factory, v0+ALT builder'ları ve metadata_json hepsi mevcut ve devnet'te kanıtlı. İşin tamamı **client + indexer/backend + sunum** katmanındadır; tek normatif doküman işi spec'e bir Amendment eki yazmaktır (davranış değişikliği değil: migrate akışının, fee stack'inin ve "no auto-rebalance" konumunun resmîleştirilmesi).

| Hafta | İş paketi | Çıktı |
|---|---|---|
| **1** | Spec eki: `docs/basalt-v0-spec.md` Amendment 4 — Rebalance V1 (kullanıcı-imzalı migrate; fee stack; "user-signed only, no engine execution" normatif kısıtı; §12 satır güncellemesi). Metadata şeması: `strategy_version` / `strategy_lineage` / `changelog` (IPFS içerik + `metadata_hash`, indexer'ın `metadata_json` okumasına alan ekleme). Create wizard'a "Derive new version" girişi (kaynak sepet seçimi + changelog zorunlu alan) | Onaylanmış spec eki; version-metadata şeması; wizard girişi |
| **2** | **Migrate quote motoru (read-only):** pozisyon değeri → hedef ağırlık delta hesabı (spec §5.2/§5.3 matematiğini client'ta aynalayan mevcut `basalt_math.test.ts` kalıbıyla test edilir) → bacak tutarları → Jupiter quote (varsa) → fee/slippage önizlemesi → whitelist durumu kontrolü → tx boyutu/CU preflight (`estimateMintRedeemTxSize`, `mintRedeemNeedsAlt` yeniden kullanımı) | `/api` quote ucu + client hesap kütüphanesi + TS testleri |
| **3** | **Kompozit tx builder:** `redeem_in_kind → leg'ler → mint_in_kind` tek v0+ALT tx (mevcut `buildMintInKindTransaction` / `buildRedeemInKindTransaction` + `ensureMintRedeemAlt` desenleriyle). Fallback'ler: tx grubu modu + manuel top-up modu. Devnet E2E: mock mint'ler üzerinde **iki-tx manuel mod** kanıtlanır (havuz yok); kompozit yol birim testleri + sahte-likidite varyantıyla localnet | Tek imzalı migrate akışı + iki fallback; devnet kanıt kaydı |
| **4** | **Sunum:** diff görünümü (eski→yeni ağırlıklar, fee dökümü, tx modu rozeti), v1→v2 rozet + changelog paneli + versiyon zaman çizelgesi, feed Migration öğesi (indexer `Redeemed+Minted` korelasyonu — açık soru 6'ya bağlı), `/explore` superseded rozeti. Brand/ses denetimi ("convert", "you sign"; auto/rebalancing-for-you dili yok). Docs: README + spec çapraz referanslar; owner review + açık soruların kapatılması | Yayına hazır V1 yüzeyi + gözden geçirilmiş dokümantasyon |

**Kabul kriterleri (hafta 4 sonu):** devnet'te (i) iki sepet arasında manuel-mod migrate tam turu kanıtlı (eski pozisyon → yeni pozisyon, fee event'leri mutabık); (ii) diff ekranındaki fee satırları on-chain `Redeemed`/`Minted` event alanlarıyla birebir mutabakatlı; (iii) pause'lu constituent içeren hedef sepette migrate CTA doğru kilitleniyor; (iv) eski sepetin redeem'i migrate sonrası da çalıştığı (gate'sizlik) bir turda yeniden kanıtlı; (v) tüm yeni client matematiği `basalt_math.test.ts` kalıbında negative-case'leriyle testli.

**Kapsam dışı bırakılan (bilinçli):** on-chain instruction ekleme, otomatik tetikleme, USDC zap entegrasyonu, cross-basket escrow swap (V2+ fikir listesi §1.3).
