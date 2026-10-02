# Basalt ve Colosseum karşılaştırması

2 Ekim 2026. Resmî Colosseum Copilot skill sürümü 2.0.1 kuruldu; tarayıcı onayından sonra araştırma erişimi doğrulandı. Üç ayrı inceleme ürün/kod, güncel rakipler ve Colosseum değerlendirme bağlamını ele aldı.

Basalt için en güçlü yön, anlaşılır bir hisse sepeti deneyimini doğrulanabilir pay sahipliği ve açık çıkış kurallarıyla birleştirmek. Sepet oluşturma, başka birinin stratejisini seçme ve yönetici ücretleri daha önce denenmiş fikirler. Bunları tek başına yenilik olarak sunmak zayıf kalır.

## En anlamlı karşılaştırmalar

| Ürün | İncelenen kanıt | Basalt açısından sonuç |
|---|---|---|
| [Cesto](https://colosseum.com/projects/explore/cesto-(prev-lomen)) | Frontier kazananı ve C5 şirketi. Tematik sepetler, tek adımda yatırım ve içerik üreticilerinin sepetlerini paylaşması bizim deneyime çok yakın. Güncel dokümanda varlıkların doğrudan kullanıcının cüzdanına gittiği, sepet pay tokenı verilmediği açıklanıyor. [İşleyiş](https://docs.cesto.co/cesto/how-it-works) | En yakın kullanıcı deneyimi karşılaştırması. Basalt'ın ortak vault ve tek pay tokenı modeli burada gerçek bir mimari fark. Ancak creator gelir fikri Cesto'nun tarihsel sunumunda da var. |
| [Instinct](https://colosseum.com/projects/explore/instinct) | Frontier projesi, ödül kaydı yok. Güncel site Symmetry ile tokenized stock vault'ları ve otomatik yeniden dengeleme anlatıyor; erişim için davet istiyor. Copilot teknik demo kaydı USDC yatırma arayüzünü gösteriyor, tamamlanmış işlemi göstermiyor. [Güncel site](https://www.instinctfi.com/) | Hisse sepeti ve sade tüketici deneyimi konusunda doğrudan karşılaştırma. Basalt'ın tek token anlatısı bu üründen ayrışmaya yetmez. Açık sepet yayınlama ve kullanıcı çıkış kuralları somut gösterilmeli. |
| [Symmetry](https://docs.symmetry.fi/) | Güncel dokümanlarda 100 varlığa kadar vault, oransal sahipliği temsil eden token, keeper/auction ile yeniden dengeleme ve SDK var. Management ve performance ücretleri şu anda kapalı. The Grid de V3'ü open beta olarak kaydediyor. | En yakın protokol referansı. Tek token, şeffaf holdings ve sepet mekanizması genel olarak yeni değil. Basalt V0'ın daha dar ve değişmez yapısı anlaşılabilirlik sağlayabilir; bunun bedeli aktif yönetimin olmaması. |
| [GLAM](https://colosseum.com/projects/explore/glam-1) | Renaissance DeFi & Payments ikincisi. Güncel ürün profesyonel varlık yöneticilerine altyapı sunuyor. [Resmî site](https://glam.systems/) Yönetici ücretleri, tokenized vault ve konfigüre edilen işlem kuralları var. [Ücretler](https://docs.glam.systems/v1/operations/fees) | Aynı altyapı ailesinde, farklı kullanıcı kitlesine odaklı. Basalt tüketicinin birkaç adımda sepet oluşturup paylaşmasına odaklanabilir. GLAM'in de anlık çıkış ve permissionless fulfillment seçenekleri bulunduğundan, rakibin kullanıcı çıkışını zorunlu olarak engellediği söylenemez. [Çıkış akışları](https://docs.glam.systems/v1/operations/flows) |
| [Peaks](https://colosseum.com/projects/explore/peaks) | Frontier kazananı ve C5 şirketi. Tarihsel sunumda bir fikir etrafında AI agent tarafından yönetilen portföy anlatılıyor. [Colosseum şirket kaydı](https://colosseum.com/companies/peaks) Güncel ürün sitesine bu incelemede erişilemedi. | Mesaj netliği için iyi karşılaştırma: kullanıcı önce ne yapabildiğini anlıyor. Basalt'ın AI yönetimi eklemesi gerektiği sonucu çıkmıyor; çalışan kullanıcı akışını açık anlatması daha önemli. |

Cesto ve Peaks'in Frontier kazananlığı [resmî sonuç duyurusunda](https://blog.colosseum.com/announcing-the-winners-of-the-solana-frontier-hackathon/) doğrulanıyor. Ödül, gelir veya bugünkü ürün olgunluğu kanıtı olarak kullanılmadı.

Ek olarak [DeMutual](https://colosseum.com/projects/explore/demutual) kaydı, basket yayınlama ve Jupiter üzerinden çoklu swap akışının benzer bir kullanıcı deneyimi sunduğunu gösteriyor. Demo kaydı fee paylaşımı modelini anlatıyor; bugünkü çalışan ürün durumu doğrulanamadı. [xVault](https://docs.xvaultsol.com/docs/protocol/overview) ise kullanıcı tarafından oluşturulan sepetler yerine dört kürasyonlu xStocks vault'u tasarlıyor. [Program adresleri sayfası](https://docs.xvaultsol.com/docs/onchain/program-ids) hâlâ dağıtım öncesi durum belirtiyor. İkisi de ana karşılaştırma tablosundaki ürünlerle aynı olgunlukta varsayılmadı.

## Bizde çalışan kısım ve hedeflenen kısım

| Alan | Repo kanıtı | Ürün açısından anlamı |
|---|---|---|
| Public Create | Wallet olmadan sepet oluşturma, ağırlık doğrulama ve paylaşılabilir link çalışıyor. `/create/onchain` şu an `/create` sayfasına yönlendiriyor. [Yönlendirme](../app/app/create/onchain/page.tsx) | Bugünkü erişilebilir deneyim sepet fikri oluşturma ve paylaşma. |
| Immutable V0 | 18/19 Eylül kayıtlarında mock Token-2022 varlıklarla devnet create/mint/redeem işlemleri kanıtlanmış. Resmî xStocks admission henüz desteklenmiyor. [Durum kaydı](current-state-2026-09-18.md) | Teknik temel var; tarihsel kanıt bugünkü deployment kontrolü veya gerçek hisse backing kanıtı sayılmaz. |
| Managed V2 | İki varlıklı localnet prototipi. Manager proposal, ayrı guardian, bildirim süresi ve bounded fill var. Ücretler sıfır, public deployment yok. [Prototip kapsamı](managed-basket-v2-prototype-status.md) | Aktif yönetim ve management fee gelirini bugün kullanılabilir ürün gibi anlatmak için henüz erken. |
| Çıkış hakkı | V0 protokolü oracle veya backend'e ihtiyaç duymadan oransal çıkış sağlıyor. Kullanıcı arayüzünün backend kesintisinde RPC fallback işi ise açık. [BAS-034](implementation-backlog.md) | Protokol hakkı ile uygulamanın her koşulda bu hakkı kullandırabilmesi ayrı kanıtlar gerektiriyor. |

## Öncelik önerisi

1. **Tek bir akışı tamamla.** Bir kişi sepet yayımlasın, başka kişi içeriği ve ücretini anlayıp pay alsın, ardından gerçek vault bakiyeleriyle çıkış yapsın. xStocks entegrasyonu ve wallet akışı burada belirleyici. İlk yatırım pilotunun, ihraççı ve erişim sağlayıcısının uygunluk koşullarına uyan kullanıcılarla yürütülmesi gerekiyor; xStocks herkese ve her bölgede açık değil. [Resmî xStocks kapsamı](https://xstocks.com/)
2. **V0 ile V2'yi tutarlı anlat.** Sabit sepet yayımlayan kişi ile sepeti sonradan değiştirebilen yönetici farklı davranışlar sunuyor. Hangisi ilk ürünse demo ve ücret modeli onunla eşleşmeli.
3. **Anlaşılmayı ve talebi ölç.** Beş sepet hazırlayan kişi ve on potansiyel yatırımcıyla test yap. İlk ekrandan ne anladıkları, paylaşım linkini açanların sepeti incelemesi ve tekrar kullanması, yalnızca sayfa görüntülenmesinden daha faydalı kanıtlar olur. Bunlar önerilen ilk test boyutları, mevcut traction sayıları değil.

Colosseum'un [hackathon sayfası](https://colosseum.com/hackathon?year=fall2026) ürün demosu, pazar doğrulaması ve ekip bilgisi istiyor. Bizim çıkarımımız, sonraki yatırımın daha fazla landing efekti kadar çalışan uçtan uca akışa ve gerçek kullanıcı geri bildirimine gitmesi gerektiği.

## Araştırma sırasında önerilen landing yönü

Üç fikir sırayla anlaşılmalı: sepet nedir, başkasının sepetini neden seçerim, kendi sepetimi neden yayımlarım. Başlık ve kısa bir açıklama yeterli; kalan işi tek bir örnek sepet görseli yapsın.

- **Stock baskets on Solana.** A basket brings xStocks together. These tokens track stocks and ETFs.
- **Choose someone's strategy.** See their picks, weights, and fees. Find a basket that matches your view.
- **Build your own basket.** Pick the assets, set the mix, and share it. We're building a way for others to invest and pay you management fees.

Sayfa değiştirme scroll, klavye ve 1/2/3 navigasyonuyla kullanıcıda kalsın. Section içindeki animasyon görünürken sırayla oynasın; sayfa otomatik aşağı kaymasın. Sol açıklama ile sağ örnek aynı üst ve alt çizgileri kullansın, CTA altta sabit bir yerde dursun. Bir bölümde aynı sepeti anlatırken timer ile kişi, tez ve composition değiştirilmesin.

Her kartta tekrarlanan preview veya concept metni yerine, gerekiyorsa tek ortak durum cümlesi yeterli: sepet paylaşımının bugün açık olduğu, yatırım ve fee gelirinin geliştirildiği anlaşılmalı. “Creator” ve “social trading” yerine yapılan iş doğrudan anlatılsın. “En başarılı” sıralaması kullanılacaksa dönem, veri kaynağı ve ölçüt görünür olmalı.

## Kanıt sınırları

Copilot'tan Cesto, Peaks, GLAM, Instinct ve DeMutual'ın tam kayıtları okundu. Tarihsel video özetlerinin source capture tarihi bilinmiyor; ilgili özetler 19 Eylül 2026'da indekslenmiş. Güncel site ve dokümanlar ayrı kontrol edildi. The Grid sorgularında bulunan kayıtlar ürün kapsamını desteklemek için kullanıldı; eksik kayıtlar rakibin olmadığı şeklinde yorumlanmadı. Rakiplerin yatırılan para, kullanıcı ve partner iddiaları bağımsız doğrulanmış traction olarak sunulmadı. Repo incelemesi salt okunurdu; bu araştırmada yeni chain smoke testi çalıştırılmadı.


## Uygulama kaydı

Bu rapor 2 Ekim araştırma bulgularını korur; yeni bir rakip veya deployment doğrulaması değildir. Önerilen metinler ile son uygulanan metinler farklı olabilir. Son tasarım, yapılan kontroller ve resmî skill kurulumunun ayrıntıları [oturum güncellemelerinde](session-updates-2026-10-02.md) ve [landing tasarımında](design-home-discovery-2026-10-02.md) kayıtlıdır. Kimlik doğrulama materyali bu rapora dahil edilmemiştir.
