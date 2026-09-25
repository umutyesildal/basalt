# Basalt — karşılaştırma ve konumlandırma araştırması

Tarih: 2026-09-26. Kapsam: Stocklana anlatımı ve ana sayfa; yatırım tavsiyesi, güvenlik denetimi veya rakiplerin zincir üstü işlemlerinin doğrulanması değildir.

## Sonuç

Basalt’ın en savunulabilir ilk odağı, creator’ın fikrini görünür bir dağılıma dönüştürmek ve bu dağılımı yeniden kullanılabilir kılmak: **creator → thesis → allocation → remix**. Onchain pay sahipliği bunun devamı; halka açık managed basket bugün mevcut değil.

“İlk/tek Solana basket”, “kimsenin durduramayacağı çıkış”, “başarılı trader’a güvenli para emanet etme” veya yalnızca “çok varlık, tek token” üzerine kurulu farklılaşma desteklenmiyor. İlk üçü ayrıca mevcut ürün sınırlarını aşar. Bunları vaat etmek yerine payın neyi temsil ettiğini ve yönetim değişikliğinin hangi aşamalardan geçtiğini göster.

## Yöntem ve sınırlar

- Yedi ürün/ürün ailesi, resmî ürün sayfaları ve dokümanları üzerinden karşılaştırıldı. M1’in pie anlatımı ayrıca tarayıcıda görsel olarak incelendi.
- Solana-new katalogları belirtilen `.claude`, `.agents` ve `.codex` kurulum yollarında bulunamadı. Katalogdan ilgili giriş sayısı çıkarılamadı; canlı resmî kaynaklara geçildi.
- Statü ifadeleri kaynağın iddiası veya doğrudan gözlemdir; TVL, aktif kullanıcı ve güvenlik performansı ölçülmedi. Doküman varlığı çalışan ürün kanıtı sayılmadı.
- Stocklana’nın [resmî işleyiş sayfası](https://hackathons.solana.com/how-it-works) başvuruların jüri sürecinde özel olduğunu söylüyor. Diğer 2026 başvurularını eksiksiz karşılaştırdığımız iddia edilmiyor.
- Geniş sosyal yatırım/portföy kategorisi kalabalık. Solana stock-basket alt alanındaki canlı doğrudan rekabetin yoğunluğunu bu taramayla kesin ölçemiyoruz; Symmetry açık bir yakın rakip, xVault ise ayrıca izlenecek dokümante edilmiş bir yaklaşım.

## Karşılaştırma

| Ürün | İlişki | Statü / kanıt sınırı | İyi yaptığı | Basalt kararı |
|---|---|---|---|---|
| [Symmetry](https://symmetry.fi/) | Doğrudan / Solana basket altyapısı | Resmî sayfa V3 mainnet beta diyor; işlem veya TVL bağımsız doğrulanmadı. | Çoklu varlığı tek basket token ile temsil ediyor; ağırlıklar ve otomasyon belirgin. | “Solana’da tek token basket” tek başına fark değil. Creator’ın gerekçesi ve remix deneyimi öne çıkmalı. |
| [Chamber (eski dHEDGE)](https://chamberfi.com/) | Doğrudan / yönetilen vault | dhedge.org güncel Chamber ürününe yönleniyor; resmî ürün yüzeyi incelendi. | Vault oluşturma ve keşif için iki net giriş; manager ile katılımcıyı birlikte ele alıyor. | İki eşit CTA korunmalı. Güven söylemi yalnızca uygulanmış mekanizma ve doğrulanabilir kanıtla desteklenmeli. |
| [Enzyme](https://docs.enzyme.finance/getting-started/enzyme-vault) | Doğrudan / tokenlaştırılmış vault altyapısı | Resmî dokümantasyon doğrulandı; yatırma/çekme işlemi denenmedi. | Katılım karşılığında pay tokenı ve yapılandırılabilir sahiplik/transfer kuralları anlatılıyor. | “Your share” dekoratif bir etiket kalmamalı: toplam pay → kişinin payı → mevcut varlıklardan oransal hak. |
| [xVault](https://docs.xvaultsol.com/docs/protocol/overview) | Yakın / Solana tokenized-equity basket | Yalnızca ürün dokümanı; canlı dağıtım, backing ve kullanım doğrulanmadı. | Kürasyonlu endeks vault’ları; v1’de kullanıcı basket’i kapsam dışı olarak belirtiliyor. | Kullanıcı/creator üretimi olası konumlandırma alanı. Dokümanı çalışan ürün veya doğrulanmış güvenlik kanıtı sayma. |
| [eToro CopyTrader](https://www.etoro.com/en-us/copytrader/) | İkame / merkezi sosyal yatırım | Güncel resmî ürün ve işleyiş sayfaları incelendi. | Kişiyi bul → portföyünü incele → kopyala; gelecekteki işlemler otomatik aynalanıyor. | Basalt remix’i bu anlamda copy trading değil. “Use this mix” doğru; otomatik takip vaadi ekleme. |
| [M1 Pies](https://m1.com/invest/brokerage/) | İkame / aracı kurum portföyü | Resmî sayfa ve yardım merkezi; görsel slider tarayıcıda incelendi. | Bir pie görseli üzerinden varlık, ağırlık ve düzenleme adımlarını tek tek gösteriyor. | Tek somut örnek uzun açıklamadan daha anlaşılır. Basket üretme ve paylaşma da tek başına yeni bir kategori değil. |
| [TokenSets / Set mirası](https://www.tokensets.com/) | Tarihsel / erişilemeyen ürün yüzeyi | Alan adı inceleme tarihinde park sayfası gösteriyor; kapanma nedeni doğrulanmadı. | Index Coop, 2024 yazısında eski Set altyapısının artık yükseltilemediğini ve geçişini açıklıyor. | Ürün arayüzünün sürekliliği ile zincir üstü erişimi ayrı değerlendir. Bu bulgudan protokol iflası veya fon kaybı sonucu çıkarma. |

## Üç farklı model

1. **Remix:** Birinin mevcut dağılımını kendi editörüne alırsın. Sonraki işlemlerini kopyalamaz. Basalt’ın halka açık deneyimi bu modelde.
2. **Copy trading:** Seçtiğin kişinin gelecekteki işlemleri hesabında aynalanır. eToro’nun [işleyiş açıklaması](https://www.etoro.com/copytrader/how-it-works/) bunu açıkça tanımlar. Basalt’ta canlı değil.
3. **Vault payı:** Ortak kasanın bir pay tokenını tutarsın. Hak, kasadaki mevcut varlıklara oransaldır. Basalt V0 devnet ve ayrı Managed V2 localnet deneyinin teknik modeli budur.

## Uygulanan kararlar

- Ana sayfanın onaylanan başlığı ve iki eşit CTA’sı korunur. Alt cümle kendi basket’ini oluşturmayı da creator’dan başlamayı da açıkça anlatır.
- Managed görseli, genel bir kutu ve kişi ikonları yerine tutarlı bir sahiplik örneği gösterir: 100 toplam payın 10’u = mevcut her varlığın %10’u. Açıkça illüstrasyon, gerçek bakiye veya işlem değil.
- “Güvenli” sıfatı yerine sabit varlık çifti, ayrı guardian onayı ve önceden bildirim gibi uygulanmış kurallar anlatılır. Bunlar riskleri ortadan kaldırmaz.
- Başvuru kullanıcı problemini ve denenebilir akışı öne alır. Devnet/localnet kanıtları ayrı bölümde, kısa ve doğrulanabilir kalır.
- Yeni performans rakamı, sosyal kanıt, sıralama, kullanıcı sayısı veya creator başarısı uydurulmaz.

## Tasarım yönü

Mevcut koyu Basalt yüzeyi, sarı aksiyonlar ve logoya bağlı allocation renkleri korunur. Yoğunluk rahat; managed bölümünde tek açıklayıcı sahiplik görseli vardır. Tipografi teknik ama kısa; hareket yalnızca kullanıcı değişikliğini anlatır ve reduced-motion tercihini izler. İlave kart duvarı, pazarlama istatistikleri ve süslü güven rozetleri eklenmez.

## Savunulabilirlik ve sonraki doğrulama

Bugün kalıcı bir rekabet hendeği gösterilmiş değil. Basket matematiği ve tokenizasyon rakiplerde de var. Olası değer creator dağıtımı, güvenilir strateji geçmişi ve tekrar kullanılan basket grafiğinde; bunlar henüz doğrulanacak hipotezler.

İlk ölçüm planı: kullanıcı bir creator’ın gerekçesini bulabiliyor mu, mix’i editöre taşıyabiliyor mu, ağırlıkları değiştirip paylaşabiliyor mu? Ayrı anlaşılabilirlik testi: remix’in gelecekteki işlemleri kopyalamadığını ve bir vault payının sabit dolar getirisi olmadığını kendi sözcükleriyle açıklayabiliyor mu? Bu testler henüz yapılmadı; başarı oranı iddiası yok.

## Ek kaynaklar

- [M1 custom Pies](https://help.m1.com/en/articles/9332051-investing-in-custom-pies-on-m1): oluşturma ve gerçek yatırımın ayrı adımlar olması.
- [M1 Pie tanımı](https://help.m1.com/en/articles/9331915-what-is-a-pie): arkadaşın paylaştığı Pie ile başlama.
- [Index Coop 2024 planı](https://www.indexcoop.com/blog/what-index-coop-is-building-in-2024): eski Set altyapısından geçiş. Kapanmanın nedeni hakkında çıkarım yapılmadı.
- [Stocklana kuralları](https://hackathons.solana.com/hackathons/stocklana): gerçek kullanıcı/problem, çalışan demo, Solana gerekçesi, uygulama kalitesi.
- Yerel ürün doğrusu: `docs/managed-basket-v2-prototype-status.md`, `brand.md`, `AGENTS.md`.
