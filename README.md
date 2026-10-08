# Multi-Tenant SLA Platform

Şirketlerin destek ve iş taleplerini takip ettiği, çok kiracılı (multi-tenant) bir ticket sistemi. Her şirket kendi kullanıcıları, ekipleri ve SLA kurallarıyla aynı uygulamayı kullanıyor ama diğer şirketlerin verisini göremiyor.

Her biletin önceliğine göre iki süresi var: ilk yanıt ve çözüm. Süre dolmaya yaklaştığında ve dolduğunda ilgili kişilere e-posta gidiyor, açık olan ekranlar da Socket.io ile anında güncelleniyor.

Backend Express 5 ve TypeScript ile yazıldı, arayüz React 19. Veriler PostgreSQL'de duruyor, kuyruk ve gerçek zamanlı olaylar için Redis kullanılıyor. Hepsi Docker Compose ile tek komutla ayağa kalkıyor.

## Çalıştırma

Sadece Docker gerekiyor.

```bash
cp .env.example .env
docker compose up --build
```

Servisler açıldıktan sonra:

- Uygulama: http://localhost:8080
- Mailpit (giden e-postalar burada görünüyor): http://localhost:8025
- API sağlık kontrolü: http://localhost:4000/api/health

`migrate` servisi önce şemayı kuruyor, sonra iki demo şirket (`kuzey` ve `acme`) ile toplam 68 örnek bilet oluşturuyor. Demo veri istemiyorsanız `SEED_DEMO=false docker compose up --build` ile başlatabilirsiniz. Compose her açılışta bu iki demo kiracıyı sıfırlıyor, sonradan kaydolan kiracılara dokunmuyor.

Durdurup verileri de silmek için `docker compose down -v`.

### Demo hesapları

Hepsinin şifresi `Passw0rd!`. Giriş ekranında kiracı adı da isteniyor.

| Kiracı | E-posta | Rol |
|---|---|---|
| kuzey | admin@kuzey.io | Yönetici |
| kuzey | mert@kuzey.io | Ekip lideri (Platform) |
| kuzey | deniz@kuzey.io | Ekip lideri (Mobil) |
| kuzey | burak@kuzey.io | Geliştirici |
| acme | admin@acme.com | Yönetici |

Kiracı izolasyonunu denemek için `kuzey` ile girip bir bilet numarası alın, sonra `acme` hesabıyla aynı numarayı aratın.

## Özellikler

- Şirket (kiracı) kaydı, giriş ve rol bazlı yetkilendirme
- Bilet açma, atama, öncelik ve durum değiştirme, yorumlar ve dahili notlar
- Her bilet için değişiklik geçmişi
- Öncelik başına ayarlanabilen SLA süreleri
- Bilet beklemeye alınınca SLA saati duruyor, devam edince kaldığı yerden sayıyor
- Sürenin %80'i dolunca risk, tamamı dolunca ihlal e-postası
- Panelde SLA uyum oranı, günlük açılan/çözülen bilet trendi ve öncelik dağılımı
- Açık ve koyu tema

Üç rol var. Yönetici şirketteki her şeyi görüp yönetebiliyor: kullanıcılar, ekipler, SLA politikaları, bilet silme. Ekip lideri kendi ekibinin biletlerinde atama yapıp öncelik ve durum değiştirebiliyor. Geliştirici kendi ekibinin biletlerini, kendisine atananları ve kendi açtıklarını görüyor. Durum değiştirmeyi ise sadece kendisine atanan biletlerde yapabiliyor.

## Teknik notlar

### Kiracı izolasyonu

Sorgulardaki `tenant_id` filtresine ek olarak PostgreSQL Row Level Security açık. API veritabanına `NOBYPASSRLS` olan, düşük yetkili `app_user` rolüyle bağlanıyor. Her istek bir transaction içinde çalışıyor ve başta kiracı kimliği `set_config('app.tenant_id', ..., true)` ile ayarlanıyor (`server/src/db/pool.ts`, `withTenant`). Bu sayede bir sorguda `WHERE` unutulsa bile başka kiracının satırı dönmüyor. Kiracı kimliği istek gövdesinden değil, imzalı JWT'den okunuyor.

Worker ise SLA taraması bütün kiracıları kapsadığı için yönetici bağlantısını kullanıyor. Bu bağlantı HTTP tarafında hiç kullanılmıyor.

### SLA hesabı

`server/src/modules/sla/sla.engine.ts` saf fonksiyonlardan oluşuyor ve şu anki zaman dışarıdan parametre olarak geliyor. Eşiğe gelme, ihlal ve arka arkaya beklemeye alma gibi durumlar bu sayede veritabanı olmadan test edilebiliyor.

Bilet beklemeye alındığında geçen süre `paused_total_seconds` alanına ekleniyor ve hedef tarihler o kadar ileri kaydırılıyor. Hedef tarih her zaman gerçek son tarih olduğu için tarayıcı sorgusu basit kalıyor ve kapalı biletleri içermeyen kısmi bir indeksi kullanabiliyor.

### Bildirimlerin tekrarlanmaması

Worker dakikada bir tarama yapıyor. Adaylar `FOR UPDATE SKIP LOCKED` ile seçildiği için iki worker aynı bileti almıyor. Durum değişikliği ve "bildirildi" işareti tek bir `UPDATE ... RETURNING` içinde yapılıyor. Bunun üstüne BullMQ işine bilet ve bildirim türünden oluşan sabit bir `jobId` veriliyor, böylece aynı bildirim ikinci kez kuyruğa girmiyor.

### Canlı güncellemeler

Worker'ın Socket.io bağlantısı yok. Olaylar Redis'teki bir kanala yayınlanıyor, her API örneği bu kanalı dinleyip mesajı kendi bağlı soketlerine iletiyor. Bu yüzden API birden fazla örnekle de çalışabiliyor. Odalar `tenant:{id}`, `user:{id}` ve `ticket:{id}` şeklinde.

### Oturumlar

Access token 15 dakikalık ve tarayıcıda sadece bellekte tutuluyor. Refresh token httpOnly çerezde duruyor, veritabanında SHA-256 özeti saklanıyor ve her kullanımda yenisiyle değiştiriliyor. İptal edilmiş bir refresh token tekrar kullanılırsa token çalınmış sayılıyor ve kullanıcının bütün oturumları kapatılıyor. Kayıt ve giriş uçlarında genel limitten daha sıkı bir hız sınırı var.

## Docker olmadan çalıştırma

Node.js 22.12 veya üzeri gerekiyor, PostgreSQL 16 ve Redis 7 de çalışıyor olmalı. `.env` dosyası kök dizinde duruyor, `DATABASE_ADMIN_URL` ve `REDIS_URL` değerlerini kendi kurulumunuza göre düzenleyin.

```bash
cp .env.example .env

cd server
npm install
npm run migrate      # şema ve app_user rolü
npm run seed         # demo veri (isteğe bağlı)
npm run dev          # API, port 4000
npm run dev:worker   # ayrı bir terminalde

cd ../web
npm install
npm run dev          # http://localhost:5173
```

Vite geliştirme sunucusu `/api` ve `/socket.io` isteklerini 4000 portuna yönlendiriyor. SMTP sunucusu yoksa e-postalar gönderilemiyor ve `email_log` tablosuna `failed` olarak yazılıyor, uygulamanın geri kalanı etkilenmiyor. Mailpit'i tek başına çalıştırmak için `docker run -p 1025:1025 -p 8025:8025 axllent/mailpit` yeterli.

## Testler

```bash
cd server
npm test             # birim testleri
npm run typecheck

# PostgreSQL gerekir, önce npm run migrate
RUN_DB_TESTS=1 npm run test:db

cd ../web
npm run build        # tsc + vite build
```

Birim testleri SLA motorunu, bilet durum geçişlerini, token üretimi ve doğrulamasını, rol izinlerini, bilet görünürlük kapsamını ve istek doğrulamasını kapsıyor. Veritabanına ya da Redis'e bağlanmıyorlar.

`tests/integration` altındaki testler gerçek bir PostgreSQL'e `app_user` rolüyle bağlanıp başka bir kiracının biletini okumayı, güncellemeyi ve onun adına kayıt eklemeyi deniyor. Üçünün de veritabanı tarafından engellendiğini ve kiracı ayarının transaction bitince bağlantıda kalmadığını doğruluyor.

GitHub Actions her push'ta tip kontrolünü, birim testlerini, web derlemesini ve bir Postgres servisi açıp bu entegrasyon testlerini çalıştırıyor.

## Klasör yapısı

```
server/
  src/
    config/       ortam değişkenleri (zod ile doğrulanıyor)
    db/           bağlantı havuzu, migration, seed
    middleware/   auth, rbac, hız sınırı, hata yakalama
    modules/      auth, tickets, sla, teams, users, reports
    queue/        BullMQ kuyrukları ve worker
    realtime/     Socket.io ve Redis pub/sub
  tests/
web/
  src/
    api/          fetch istemcisi ve React Query hook'ları
    context/      oturum, socket ve bildirimler
    components/   arayüz bileşenleri ve SVG grafikler
    pages/        panel, biletler, ekipler, kullanıcılar, SLA
docker-compose.yml
```

## Eksikler

- SLA saati 7/24 işliyor, mesai saatleri ve tatil günleri hesaba katılmıyor.
- Entegrasyon testleri RLS izolasyonunu kapsıyor, API uçları için uçtan uca test henüz yok.
- Biletlere dosya eklenemiyor.
- E-posta şablonları sadece Türkçe.
- `.env.example` içindeki JWT anahtarları geliştirme için. Gerçek ortamda `openssl rand -hex 48` gibi bir komutla yenileri üretilmeli.

## Lisans

MIT
