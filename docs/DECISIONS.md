# Keputusan

Entri baru ditambahkan di bawah. Jangan hapus atau tulis ulang entri lama; kalau
sebuah keputusan dibatalkan, tulis entri baru yang menyebut entri mana yang diganti.

Apa yang produk ini harus bisa ada di [PRD.md](PRD.md).

> **Catatan untuk entri lama.** Sejak 2026-08-17 folder `src/` jadi `backend/` dan
> `public/` jadi `frontend/`. Entri lama masih memakai nama lama dan sengaja tidak
> ditulis ulang, mengikuti aturan di atas.

## [2026-08-08] Simpan agregat, bukan baris per konsumen

**Konteks:** Import bulanan ~17rb baris dari Excel. Baseline menyimpan tiap konsumen
sebagai satu baris di sheet `Data_Konsumen`, lengkap dengan nama dan alamat, lalu
mengirim semuanya ke frontend.
**Keputusan:** Sheet `AGREGAT` menyimpan (periode, kode_kelurahan, kode_dealer,
kode_pos) → jumlah. Excel mentah masuk `STAGING` dan dikosongkan setelah diproses.
**Alasan:** Yang dibutuhkan tim channel adalah sebaran per kelurahan per dealer,
bukan identitas orang. Agregat memangkas ukuran data dan menghapus alasan menyimpan
PII sejak awal.
**Alternatif yang ditolak:** Menyimpan baris konsumen lalu mengagregasi saat render —
ditolak karena datanya tetap ada di spreadsheet dan tetap ikut terkirim, dan 17rb
baris per bulan akan menabrak limit 6 menit dalam beberapa bulan.
**Konsekuensi:** Analisis apa pun yang butuh detail per konsumen tidak mungkin
dilakukan dari data ini — harus balik ke sumber Excel. Import wajib idempoten (hapus
baris periode X, tulis ulang) karena tidak ada ID baris yang bisa di-upsert.

## [2026-08-08] Jangan simpan atau kirim PII

**Konteks:** Baseline menulis `nama_konsumen` dan alamat lengkap ke sheet
(`Code.js:44`) dan memasukkannya ke JSON yang dibaca frontend
(`Code.js:131-133`).
**Keputusan:** Nama konsumen, alamat lengkap, dan nomor HP tidak disimpan dan tidak
dikirim. Sama sekali.
**Alasan:** Dashboard dipakai tim non-IT lewat berkas yang berpindah-pindah; data
yang tidak pernah ada tidak bisa bocor.
**Alternatif yang ditolak:** Menyimpan tapi menyembunyikan di UI — ditolak, data
tetap ada di JSON dan bisa dibaca siapa pun yang membuka file.
**Konsekuensi:** Fitur "lihat detail pelanggan" di `Index.html` baseline tidak bisa
dipertahankan. Deduplikasi konsumen tidak bisa lagi pakai kunci nama+alamat seperti
`Code.js:239`.

## [2026-08-08] Frontend baca JSON statis, tidak memanggil Apps Script

**Konteks:** Baseline memanggil `google.script.run` setiap dashboard dibuka, dan
tiap save/delete satu baris memicu `generateStaticJSON()` penuh (`Code.js:289`,
`Code.js:306`).
**Keputusan:** Apps Script hanya dipakai untuk import dan build JSON. Saat dipakai,
frontend membaca file JSON statis dan tidak menyentuh Apps Script.
**Alasan:** Menghindari limit eksekusi 6 menit di jalur yang dipakai pengguna, dan
membuat dashboard tetap responsif tanpa bergantung kuota Apps Script.
**Alternatif yang ditolak:** Web app Apps Script yang melayani data langsung —
ditolak karena setiap pengguna menanggung waktu baca spreadsheet, dan kuota harian
dibagi seluruh tim.
**Konsekuensi:** Ada jeda antara import dan apa yang terlihat di dashboard; rebuild
JSON jadi langkah eksplisit. Butuh tempat hosting file JSON — belum diputuskan, dan
`ANYONE_WITH_LINK` tidak boleh dipakai (lihat PROGRESS.md → Diblokir).

## [2026-08-08] Kode kelurahan pakai kode BPS/Kemendagri, bukan turunan nama

**Konteks:** Baseline membuat ID sendiri dari nama: `KEL-{kodeKota}-{NAMA}`
(`Code.js:238`).
**Keputusan:** Kunci kelurahan adalah kode wilayah level 4 dari BPS/Kemendagri.
Pencocokan nama mentah ke kode dilakukan hirarkis — `kode_kota` dulu, baru nama —
dan hasilnya disimpan di `MAPPING_KELURAHAN` dengan status verifikasi.
**Alasan:** Nama kelurahan tidak unik antar kota, berubah ejaannya antar file Excel,
dan tidak bisa disambungkan ke poligon peta. Kode BPS stabil dan cocok dengan sumber
batas wilayah.
**Alternatif yang ditolak:** Fuzzy matching nama secara global tanpa kode kota —
ditolak karena nama yang sama di kota berbeda akan tertukar diam-diam.
**Konsekuensi:** Butuh tabel referensi kode wilayah level 4 dan proses verifikasi
manual untuk nama yang tidak cocok. Baris yang belum terverifikasi harus punya
status sendiri, bukan dipaksa masuk ke kode terdekat.

## [2026-08-08] Poligon disiapkan offline dengan geopandas

**Konteks:** Apps Script tidak punya fungsi spasial, dan file batas kelurahan
Indonesia berukuran jauh di atas yang wajar untuk dimuat di browser.
**Keputusan:** Pipeline Python terpisah di `../geo-kelurahan/`: `inspeksi.py` untuk
membaca struktur sumber, `build.py` untuk filter kode kota, membatasi properti ke
`kode/nama/kode_kota/nama_kota`, simplify, dan ekspor GeoJSON EPSG:4326 di bawah 2 MB.
**Alasan:** Simplifikasi dan reproyeksi tidak mungkin dilakukan di Apps Script, dan
hasilnya tidak berubah tiap bulan — cukup dibangun sekali lalu dipakai sebagai aset
statis.
**Alternatif yang ditolak:** Memuat batas wilayah penuh di frontend dan
menyederhanakannya di browser — ditolak karena ukuran unduhan dan waktu render.
**Konsekuensi:** Ada dependensi Python (geopandas) di luar repo Apps Script, dan
langkah manual yang harus diulang kalau daftar kode kota berubah. Output-nya aset,
bukan hasil kalkulasi runtime.

## [2026-08-08] Simplify di CRS metrik, bukan di derajat

**Konteks:** `simplify()` bekerja di satuan CRS. Di EPSG:4326 satuannya derajat,
dan panjang satu derajat bujur berubah menurut lintang.
**Keputusan:** Reproject ke UTM zona yang sesuai (`estimate_utm_crs()`, fallback
EPSG:3857) → `simplify(toleransi_meter, preserve_topology=True)` → reproject balik ke
4326. Presisi koordinat output dipotong ke 5 desimal.
**Alasan:** Toleransi dalam meter bisa dinalar dan konsisten di seluruh Indonesia.
`preserve_topology=True` mencegah celah antar poligon bertetangga.
**Alternatif yang ditolak:** Toleransi dalam derajat — ditolak karena tingkat
penyederhanaannya berbeda-beda tergantung lokasi. Menurunkan presisi saja tanpa
simplify — ditolak, tidak cukup memangkas ukuran.
**Konsekuensi:** Wilayah yang melintasi dua zona UTM memakai zona hasil estimasi dari
centroid; kalau cakupannya melebar jauh, hasilnya perlu diperiksa ulang.

## [2026-08-08] Skrip inspeksi dinamai `inspeksi.py`, bukan `inspect.py`

**Konteks:** Nama `inspect.py` diminta di spesifikasi awal. Saat diuji, file dengan
nama itu di folder skrip menutupi modul stdlib `inspect` yang di-import numpy dan
pandas, sehingga `build.py` gagal dengan circular import saat `import geopandas`.
**Keputusan:** File dinamai `inspeksi.py`.
**Alasan:** Direktori skrip berada di awal `sys.path`, jadi `import inspect` dari
library mana pun akan mengambil file kita. Sudah direproduksi, bukan dugaan.
**Alternatif yang ditolak:** Membuang direktori skrip dari `sys.path` di awal file —
ditolak karena hanya menolong saat file itu yang dijalankan langsung; `build.py` tetap
mati. Memuat ulang stdlib `inspect` lewat `importlib` — ditolak, terlalu pintar untuk
masalah yang selesai dengan ganti nama.
**Konsekuensi:** Semua dokumen dan pesan error menyebut `inspeksi.py`. Jangan ada
file bernama `inspect.py` di folder itu.

## [2026-08-08] Peta ditunda ke fase 2

**Konteks:** Baseline `Index.html` sudah memuat Google Maps, marker clusterer,
polygon layer, dan API key yang tertulis langsung di file.
**Keputusan:** Fase 1 hanya tabel dan chart. Peta menyusul di fase 2.
**Alasan:** Nilai analisis utama sudah tercapai dari agregat per kelurahan per
dealer. Peta menambah dependensi eksternal, biaya, dan permukaan bug sebelum jalur
datanya sendiri benar.
**Alternatif yang ditolak:** Mempertahankan peta baseline sambil merapikan backend —
ditolak karena peta itu bergantung pada data per konsumen yang justru sedang dibuang.
**Konsekuensi:** GeoJSON dari `../geo-kelurahan/` belum terpakai di fase 1; dibangun
sekarang supaya siap, bukan karena sudah dibutuhkan. API key Google Maps di
`Index.html:294` masih harus ditangani sebelum apa pun dipublikasikan.

## [2026-08-08] MapLibre + OSM raster menggantikan Google Maps

**Konteks:** `Index.html` baseline memakai Google Maps JS API dengan key tertulis
langsung di file (`Index.html:294`), plus marker clusterer dari CDN. Perlu tahu
apakah ada pengganti yang tidak butuh key sebelum peta fase 2 dirancang.
**Keputusan:** Prototipe peta memakai MapLibre GL (CDN) dengan basemap raster
OpenStreetMap, tanpa API key sama sekali. Diuji terpisah di
`../geo-kelurahan/peta/`, belum disatukan ke Apps Script.
**Alasan:** Menghapus satu key rahasia dari file yang dikirim ke browser, menghapus
ketergantungan kuota berbayar, dan poligonnya bisa dilayani sebagai aset statis
seperti JSON agregat.
**Alternatif yang ditolak:** Tetap Google Maps — ditolak karena key-nya tidak bisa
disembunyikan di frontend statis dan biayanya ikut jumlah pemuatan. Basemap
demotiles MapLibre — ditolak, cuma sampai zoom rendah, tidak berguna untuk DIY.
**Konsekuensi:** Tile OSM tunduk pada kebijakan pemakaian OSM; untuk pemakaian
sungguhan perlu penyedia tile sendiri atau tile berbayar. Marker dealer/pos,
klaster, dan radius 5 km belum diuji di MapLibre — tiga hal itu masih dipakai di
baseline dan belum terbukti sepadan.

## [2026-08-08] Sumber batas wilayah: cahyadsn/wilayah_boundaries

**Konteks:** Butuh batas kelurahan DIY untuk menguji visualisasi. BIG
(tanahair.indonesia.go.id) perlu registrasi dan unduhannya besar.
**Keputusan:** Pakai `cahyadsn/wilayah_boundaries` (MIT), dump SQL per kabupaten,
dikonversi oleh `sql2geojson.py`. Hasil: 438 kelurahan DIY, cocok dengan jumlah
resmi.
**Alasan:** Kodenya sudah kode Kemendagri level 4 — persis kunci yang dipakai
AGREGAT — jadi tidak perlu pencocokan nama. Ukurannya kecil dan lisensinya jelas.
**Alternatif yang ditolak:** Shapefile BIG — ditolak untuk sekarang karena perlu
registrasi dan atributnya belum tentu memuat kode Kemendagri. Bisa ditinjau ulang
kalau ketelitian batas jadi masalah.
**Konsekuensi:** Ketelitian batas mengikuti sumber komunitas, bukan sumber resmi
BIG. Kalau ada sengketa batas wilayah, ini bukan rujukan. Format kodenya bertitik
(`34.01.01.2001`), jadi format kunci AGREGAT harus diselaraskan.

## [2026-08-09] Basemap: tile sendiri dari OSM (PMTiles), bukan langganan provider

**Konteks:** `tile.openstreetmap.org` boleh dipakai — kebijakannya tidak melarang
aplikasi internal perusahaan dan tidak menyebut batas angka — tapi menyatakan akses
bisa diputus tanpa pemberitahuan, dan trafik yang `Referer`-nya distrip proxy bisa
ikut diblokir. Free tier Stadia Maps dan MapTiler tidak bisa dipakai karena
dashboard perusahaan termasuk commercial use; berbayarnya $20-30/bulan.
**Keputusan:** Generate tile sendiri dari data OpenStreetMap dengan
`pmtiles extract` dari daily build Protomaps, area DIY saja, maxzoom 13 → satu file
`diy.pmtiles` 11 MB. Basemap memakai tema `grayscale` varian `noLabels`.
**Alasan:** Tidak ada API key, tidak ada kuota, tidak ada pihak yang bisa memutus
akses. Cocok dengan arsitektur "frontend cuma baca file statis". Ekstraknya murah —
40 HTTP range request, 12 MB transfer, 14 detik — tidak perlu unduh planet atau
menjalankan Planetiler. Label basemap dimatikan supaya tidak berebut dengan label
kelurahan, dan grayscale tidak melawan warna choropleth.
**Alternatif yang ditolak:** Lanjut pakai `tile.openstreetmap.org` — ditolak bukan
karena melanggar kebijakan, tapi karena dashboard yang dipakai tim bergantung pada
layanan yang bisa memblokir tanpa notice dan di luar kendali Astra. Langganan
Stadia/MapTiler — ditolak untuk sekarang; kapasitasnya jauh berlebih untuk puluhan
pengguna dan mengurus langganan lewat procurement lebih repot daripada menaruh satu
file tambahan. Menyalin tile jadi dari provider mana pun — ditolak, melanggar
lisensi.
**Konsekuensi:** Atribusi OpenStreetMap wajib tampil (ODbL) dan tidak boleh dihapus
dari `index.html`. Tile jadi aset yang perlu di-generate ulang berkala — bukan
otomatis, harus dijadwalkan. Ukuran ikut maxzoom: z12 5.8 MB, z13 11 MB, z14 24 MB;
kalau nanti butuh level jalan kecil, ukurannya naik. Hosting harus salah satu dari
dua bentuk: file statis dengan dukungan HTTP Range request, atau `pmtiles serve`
sebagai service internal — dan itu mengunci keputusan hosting yang masih terbuka.

## [2026-08-09] Matching kelurahan tiga tingkat, bukan dua

**Konteks:** CLAUDE.md semula menetapkan matching hirarkis `kode_kota` dulu, baru
nama kelurahan. Aturan itu diuji terhadap 3.466 kelurahan cakupan operasional.
**Keputusan:** Kunci matching adalah `kode_kota + nama_kecamatan + nama_kelurahan`.
Aturan lama diganti, bukan ditambah.
**Alasan:** Kunci dua tingkat tabrakan di **171** tempat — Kabupaten Cilacap punya
dua kelurahan "Tambakreja" dan tiga "Sidaurip" di kecamatan berbeda. Dengan
kecamatan ikut: **0 tabrakan dari 3.466**. Kecamatan sudah ada di Excel bulanan
(`INPUT UTAMA` kolom D), jadi tidak menambah beban input.
**Alternatif yang ditolak:** Tetap dua tingkat dan menerima baris pertama yang cocok
— ditolak, itu tepatnya "gagal diam-diam": angka masuk ke kelurahan yang salah tanpa
ada yang tahu. Menambahkan kode kecamatan ke Excel — ditolak, tim channel tidak
mengisi kode, mereka mengisi nama.
**Konsekuensi:** `MAPPING_KELURAHAN` wajib punya kolom `nama_kecamatan`. Kalau
kecamatan di Excel salah eja atau kosong, barisnya tidak akan cocok dan masuk
`perlu_verifikasi` — lebih baik daripada masuk ke kelurahan yang keliru.

## [2026-08-09] Format kode bertitik di semua sisi

**Konteks:** GeoJSON menyimpan `kode` bertitik (`34.04.01.2001`) sementara
`kode_kota` polos (`3404`). Kalau AGREGAT memakai format berbeda dari aset peta,
join-nya gagal tanpa error.
**Keputusan:** Bertitik di semua sisi, termasuk `kode_kota` (`34.04`). `build.py`
punya `kode_kota_bertitik()`, `Code.js` punya `kodeKotaBertitik()` yang identik.
**Alasan:** Google Sheets selalu memperlakukan string bertitik sebagai teks. Kode
polos 10 digit bisa diam-diam jadi bilangan waktu orang non-IT menempel data, dan
join-nya gagal karena beda tipe. Bertitik juga sama dengan format sumber cahyadsn.
**Alternatif yang ditolak:** Polos di JSON, bertitik di sheet — ditolak, dua format
untuk satu hal adalah sumber bug yang persis ingin dihindari.
**Konsekuensi:** Ada dua salinan logika normalisasi (Python dan Apps Script) yang
harus tetap sama. Sudah diuji terpisah di `test_build.py` dan `test_agregasi.js`.

## [2026-08-09] Hitung per baris, bukan dedupe per konsumen

**Konteks:** Baseline men-dedupe konsumen dengan kunci `nama+alamat`
(`Code.js:239` versi lama), jadi satu orang yang muncul dua kali dihitung sekali.
Kunci itu memakai PII, yang sekarang tidak boleh dibaca sama sekali.
**Keputusan:** Setiap baris STAGING dihitung satu. Tidak ada deduplikasi.
**Alasan:** Tanpa PII tidak ada cara mengenali "orang yang sama". Lagipula untuk
distribusi motor, dua baris umumnya berarti dua unit — yang justru ingin dihitung.
**Alternatif yang ditolak:** Dedupe pakai hash dari nama+alamat — ditolak, hash dari
PII tetap turunan PII dan tetap harus dibaca dulu.
**Konsekuensi:** Angka akan berbeda dari dashboard lama. **Selisih ini harus
disebutkan ke tim channel sebelum mereka membandingkan dua versi**, kalau tidak akan
dikira ada yang rusak.

## [2026-08-09] Satu sistem warna di permukaan peta; kuota warna dari validator

**Konteks:** Poligon diwarnai menurut volume, sementara tiap dealer juga punya warna
identitas. Dua sistem warna di satu peta tidak bisa dibaca. `colorForKey()` lama
mengalamatkan hash ke palet 12: diuji atas 15 nama kota cakupan, hanya memakai 8
warna dan menabrakkan 5 kelompok — Kota Yogyakarta, Kota Magelang, dan Purbalingga
semuanya cyan.
**Keputusan:** Poligon HANYA pernah mengkodekan volume. Identitas dealer hidup di
benda kecil berlabel: titik, rincian kelurahan, legenda, bar, tabel. Saat satu dealer
difilter, ramp peta berganti hue jadi warna dealer itu — hue menyatakan siapa,
gelap-terang menyatakan berapa, jadi keduanya menyatu bukan bersaing. Kuota warna:
**8 di daftar berlabel, maksimal 3 di permukaan peta.** Dealer di luar kuota abu,
tidak pernah warna daur ulang.
**Alasan:** Angka 8 dan 3 bukan selera, itu hasil `validate_palette.js`. Delapan hue
lolos saat dibandingkan bersebelahan (CVD dE 9.1, normal 19.6) — di bar dan tabel
nama selalu menempel di sebelah swatch. Delapan hue GAGAL saat dibandingkan sembarang
seperti di peta: merah vs oranye dE 7.1 untuk mata normal (ambang 15), hijau vs
oranye dE 3.2 untuk protanopia. Tiga slot pertama lolos all-pairs (CVD 9.2, normal
24.0).
**Alternatif yang ditolak:** Poligon diwarnai dealer dominan dengan opacity sebagai
volume — ditolak, dua variabel dalam satu mark, dan kelurahan 51/49 akan terlihat
dikuasai penuh. Legenda menampilkan semua dealer — tidak mungkin, puluhan dealer.
Daur ulang hue setelah warna ke-8 habis — ditolak, dua dealer sewarna lebih
menyesatkan daripada abu.
**Konsekuensi:** Pertanyaan "dealer mana yang menguasai kelurahan ini" tidak dijawab
oleh warna poligon, tapi oleh panel rincian dan kolom share di tabel. Warna dealer
ditetapkan sekali dari SELURUH agregat, bukan dari hasil filter — kalau dihitung
ulang per filter, dealer yang bertahan berganti warna. Urutannya ikut volume total,
jadi bisa bergeser saat bulan baru masuk; kalau mengganggu, tambahkan kolom
`urutan_warna` di `MASTER_DEALER_POS`.

## [2026-08-09] Dashboard tinggal di halaman statis, Apps Script berhenti menyajikan halaman

**Konteks:** Rencana semula "ganti Index.html". Tapi Index.html disajikan Apps Script,
sementara aset poligonnya 3,66 MB dan keputusan hosting belum turun. Menyalurkannya
lewat `google.script.run` justru melanggar aturan "frontend tidak memanggil Apps
Script saat dipakai".
**Keputusan:** Dashboard dibangun di `../geo-kelurahan/peta/index.html` sebagai
halaman statis. `Index.html`, `doGet()`, dan blok `webapp` di `appsscript.json`
dihapus. Apps Script sekarang murni pengubah Excel jadi `agregat.json`.
**Alasan:** Persis arsitektur yang sudah diputuskan sebelumnya, dan halaman statis
bisa saya jalankan serta uji langsung — halaman Apps Script tidak bisa diuji dari
luar spreadsheet.
**Alternatif yang ditolak:** Menyajikan poligon lewat `google.script.run` — ditolak,
melanggar aturan wajib dan menaruh 3,66 MB di jalur yang dipakai pengguna.
**Konsekuensi:** Skrip Apps Script bukan web app lagi. Dashboard butuh tempat
hosting statis sebelum bisa dipakai tim channel — keputusan yang masih terbuka itu
sekarang menjadi satu-satunya penghalang antara pipeline dan pengguna.

## [2026-08-09] "% dalam radius" dihitung dari proporsi luas, bukan jarak ke centroid

**Konteks:** Data pembeli tidak punya koordinat. Versi lama memakai jarak dealer ke
centroid kelurahan, lalu menampilkan "Jarak ke Pos: 2.34 KM" per konsumen — padahal
semua konsumen di kelurahan yang sama dapat angka identik. Presisi palsu.
**Keputusan:** `radius.py` menghitung offline berapa bagian LUAS tiap kelurahan yang
beririsan dengan lingkaran radius tiap POS, keluar sebagai `rasio_luas` 0..1. Angka
itu jadi bobot terhadap jumlah konsumen kelurahan.
**Alasan:** Menghasilkan persentase yang punya dasar geometris, bukan biner "semua
masuk / semua keluar" untuk seluruh kelurahan sekaligus. Radius bisa berbeda per POS
lewat kolom `radius_m`.
**Alternatif yang ditolak:** Jarak ke centroid — ditolak, biner dan kasar untuk
kelurahan besar. Membuang metrik radius sama sekali — ditolak, itu salah satu
pertanyaan utama yang ingin dijawab tim channel.
**Konsekuensi:** Hasilnya tetap perkiraan yang berasumsi konsumen tersebar merata di
dalam kelurahan — salah untuk kelurahan yang setengahnya sawah. Asumsi itu harus
disebut di UI, jangan ditampilkan sebagai angka pasti. Butuh lat/lng POS, yang belum
ada.

## [2026-08-09] Tampilan mengikuti Index.html rekan; yang diganti cuma data dan peta

**Konteks:** Sehari sebelumnya dashboard dibangun ulang dari nol sebagai halaman
statis dengan tampilan bikinan sendiri, dan `Index.html` sempat dihapus. Itu keliru
arah — permintaannya tampilan tetap seperti yang ada di Apps Script, yang perlu
dibenahi hanya integrasi data dan bagian petanya.
**Keputusan:** `Index.html` dikembalikan dari git dan dikerjakan di tempat. Seluruh
markup, CSS, navbar, kartu, panel kaca, dan gaya Astra dipertahankan. Yang diganti:
blok Google Maps jadi MapLibre, sumber data jadi `agregat.json` lewat satu konstanta
`DATA_BASE`, tab "Data Konsumen" dan modal detail pelanggan dibuang karena PII, dan
seluruh interpolasi di-escape. Membatalkan keputusan "dashboard tinggal di halaman
statis" pada tanggal yang sama; `geo-kelurahan/peta/` kembali jadi folder data dan
prototipe, bukan dashboard.
**Alasan:** UI-nya memang sudah bagus dan sudah dikenal penggunanya. Menggantinya
menambah pekerjaan tanpa menambah nilai, dan membuat dua tampilan yang harus dijaga
sinkron.
**Alternatif yang ditolak:** Mempertahankan dua halaman — ditolak, itu persis yang
bikin bingung ("Command Center Distribusi" yang mana). Menyalin komponen peta saja ke
Index.html — ditolak, setengah pekerjaan dengan hasil yang sama.
**Konsekuensi:** Kartu KPI "Ideal (<=5 KM)" dan "Luar Jangkauan" diganti "Kelurahan
Terlayani" dan "Kelurahan Kosong", karena data radius belum ada dan label lama akan
berbohong. Toggle Heatmap dan Label Jumlah dibuang (tambalan zaman tanpa poligon),
toggle Radius ditunda sampai lat/lng POS ada. `doGet` dan blok `webapp` dikembalikan
dengan `access: MYSELF` seperti di git — yang live sempat `ANYONE`, dan melebarkan
akses harus keputusan sadar, bukan warisan.

## [2026-08-09] Kembali ke versi rekan; hanya peta dan visualisasi yang diperbarui

**Konteks:** Selama dua hari `Code.js` dan `Index.html` dirombak ke rancangan
agregat (STAGING → AGREGAT → agregat.json, tanpa PII, matching kelurahan tiga
tingkat). Pemilik proyek memutuskan itu terlalu jauh untuk sekarang.
**Keputusan:** `Code.js`, `Index.html`, dan `appsscript.json` dikembalikan ke commit
`364e61d`. Alur tetap upload manual ke `INPUT UTAMA` lalu `syncInputUtama()`, dan
isi analisis mengikuti tampilan asli. Yang dikerjakan hanya bagian peta dan
visualisasi data. Membatalkan untuk sementara keputusan-keputusan 2026-08-08
tentang skema agregat dan penghapusan PII; berkas pendukungnya dipindah ke
`arsip/`, bukan dihapus.
**Alasan:** Keputusan pemilik proyek. Rancangan agregat menuntut perubahan alur
kerja tim dan verifikasi manual ribuan nama kelurahan sebelum satu pun peta bisa
tampil; nilai yang dikejar sekarang ada di peta dan visualisasinya.
**Alternatif yang ditolak:** Meneruskan rancangan agregat — ditolak oleh pemilik
proyek.
**Konsekuensi — ini yang perlu disadari:**
- Nama, alamat lengkap, dan ID konsumen kembali disimpan di sheet `Data_Konsumen`
  dan kembali dikirim utuh ke browser lewat `getAllData()`. Prinsip "PII tidak
  boleh masuk sistem" yang ditetapkan 2026-08-08 tidak berlaku lagi pada kode ini.
- Kode kelurahan kembali diturunkan dari nama (`KEL-3404-CATURTUNGGAL`), sehingga
  belum bisa disambungkan ke poligon BPS. Ini penghalang langsung untuk pekerjaan
  peta yang diminta.
- Tidak ada `LockService`, rebuild JSON penuh tetap terjadi di tiap simpan satu
  baris, dan `Index.html` tetap punya ~30 interpolasi tanpa escape.
- Satu penyimpangan dari `364e61d`: baris
  `file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, ...)` dicabut. Terbukti tidak
  terpakai — `Index.html` mengambil data lewat `google.script.run.getAllData()` dan
  tidak punya satu pun rujukan ke `drive.google.com`. Jadi tautan publik itu tidak
  memberi fungsi apa pun, hanya membuka nama dan alamat konsumen bagi siapa saja
  yang memegang tautannya.

## [2026-08-09] Dibatalkan: kembali lagi ke rancangan agregat

**Konteks:** Beberapa jam setelah proyek dikembalikan ke versi rekan, pemilik proyek
memutuskan kembali lagi ke rancangan agregat yang datanya sudah tersambung.
**Keputusan:** Entri "Kembali ke versi rekan" di atas **dibatalkan**. `Index.html`
dan `Code.js` kembali ke rancangan agregat (STAGING/AGREGAT, tanpa PII, MapLibre,
marker dealer/POS, area jangkauan). `arsip/` dibubarkan.
**Alasan:** Keputusan pemilik proyek.
**Konsekuensi — pelajaran yang mahal:** perubahan itu tidak pernah di-commit, jadi
`git checkout 364e61d -- Code.js Index.html` menghapusnya dari git secara permanen.
`Index.html` bisa dipulihkan dari salinan sisa uji mutasi (`mutg/Index.html`) yang
kebetulan masih ada di folder sementara, setelah satu bug sengaja-suntik dibatalkan,
lalu lima patch berikutnya dipasang ulang. `Code.js` tidak punya salinan sama sekali
dan harus ditulis ulang dari awal — bisa diverifikasi hanya karena
`test_agregasi.js` mengunci perilakunya (5 dari 5 mutasi tertangkap sebelumnya).
**Aturan yang lahir dari ini:** commit sebelum operasi git yang menimpa berkas.
Pekerjaan yang tidak di-commit bukan pekerjaan yang tersimpan.

## [2026-08-13] Database pindah dari SQLite ke MySQL, dua database terpisah

**Konteks:** Tim meminta MySQL. Sebelumnya `node:sqlite` — dipilih karena sudah ada di
dalam Node 24, nol paket npm, dan membuat "pindah server = salin folder" berlaku apa
adanya (entri 2026-08-10).
**Keputusan:** Ganti total ke MySQL 8 lewat `mysql2/promise`. SQLite dilepas, bukan
dipertahankan sebagai jalur kedua. Dua DATABASE terpisah, `astra` dan
`astra_customers`, bukan dua tabel di database yang sama.
**Alasan:** Dua jalur database berarti dua jalur yang harus diuji dan dua tempat bug
bisa bersembunyi, untuk kemampuan yang tidak diminta siapa pun. Database terpisah
adalah padanan MySQL dari berkas terpisah — sifat yang dijaga sejak 2026-08-08 tidak
berubah: mencabut PII tetap satu perintah, dan aplikasinya tetap jalan penuh tanpanya.
**Konsekuensi:**
- **Seluruh lapisan data jadi async.** `node:sqlite` sinkron, mysql2 tidak, dan
  membungkusnya jadi sinkron tidak bisa dilakukan dengan benar. Merambat ke
  `repository`, `importer`, `coverage-store`, rute, dan semua skrip seed.
- **`store.transaction(pool, fn)` mengoper satu koneksi ke `fn`.** BEGIN di satu
  koneksi pool dan INSERT di koneksi lain bukan transaksi yang sama. Ini aturan, bukan
  gaya penulisan — perintah di dalam transaksi WAJIB memakai koneksi yang dioper.
- **`decimalNumbers: true` wajib.** `SUM()` bertipe DECIMAL dan bawaannya mysql2
  mengembalikannya sebagai string, jadi `'3' + '4'` jadi `'34'` di frontend tanpa satu
  pun error. Presisi Number tidak akan pernah jadi masalah untuk jumlah unit motor.
- **"Pindah server = salin folder" tidak berlaku lagi.** Sekarang ada `mysqldump` dan
  `mysql <`. Ini kerugian nyata dari keputusan ini, dan ditebus hanya sejauh
  `PINDAH.md` menulis langkahnya lengkap dengan cara memeriksa tiap langkah.
- **Tes butuh MySQL jalan.** Dulu `npm test` cukup Node saja; sekarang berkas tes yang
  menyentuh database membuat `astra_test_<label>` sendiri dan membuangnya di akhir,
  dan butuh hak GRANT tambahan atas pola nama `astra_test_*` (lihat ROADMAP.md).
**Alternatif yang ditolak:** Menyimpan SQLite sebagai bawaan dan MySQL sebagai opsi —
ditolak karena dua jalur berarti dua kali beban uji untuk kemampuan yang tidak diminta.

## [2026-08-13] Bukti COMMIT harus lewat koneksi kedua

**Konteks:** Uji mutasi terhadap jalur MySQL. Menghapus `conn.commit()` dari
`store.transaction()` tidak membuat satu tes pun merah.
**Keputusan:** `test/test-db.js` menyediakan `queryOutsidePool()`, dan
`import.test.js` memakainya untuk memastikan data hasil impor terlihat dari koneksi
lain.
**Alasan:** Pool memakai koneksi yang sama sepanjang tes satu-utas, dan koneksi itu
melihat tulisannya sendiri walaupun transaksinya menggantung. Memeriksa lewat pool
akan hijau meski COMMIT-nya tidak pernah terjadi — persis kelas kesalahan yang membuat
`test_halaman.js` lama lolos tanpa menjaga apa pun (catatan di CLAUDE.md).
**Konsekuensi:** Tiap sifat "sudah tersimpan" di MySQL harus diperiksa dari luar pool,
bukan lewat `repo.*`. Setelah ditambahkan, 5/5 mutasi MySQL tertangkap.

## [2026-08-13] PostgreSQL + PostGIS menggantikan MySQL; jangkauan dihitung di database

**Konteks:** Beberapa jam setelah pindah ke MySQL (entri di atas), muncul pertanyaan
apakah PostgreSQL lebih cocok "untuk mapping seperti ini".
**Premis yang perlu diluruskan lebih dulu:** untuk aplikasi ini apa adanya waktu itu,
MySQL dan PostgreSQL **sama saja**. Nol fungsi `ST_*`, nol kolom geometri; poligon ada
di berkas, `lat`/`lng` cuma DOUBLE, dan hitungannya di JavaScript. Yang membuat
PostgreSQL unggul adalah PostGIS.
**Keputusan:** Pindah ke PostgreSQL 17 + PostGIS **dan** memindahkan hitungan jangkauan
ke database dengan `ST_Intersection`/`ST_Area`. Dua-duanya, bukan salah satu.
**Alasan:** Tukar mesin database tanpa memakai PostGIS tidak menghasilkan apa pun dan
tetap membayar seluruh biaya migrasinya. Dengan PostGIS, rasionya eksak dan deterministik,
dan hal-hal yang tadinya mustahil jadi query biasa: radius bebas, radius berbeda per pos,
kelurahan yang tidak terjangkau siapa pun, tumpang tindih antar pos.
**Yang TIDAK didapat, dan harus tetap disebut:** angkanya tidak jadi jauh lebih akurat.
Galat terbesar bukan sampling, tapi asumsi "konsumen tersebar merata di dalam
kelurahannya" — dan asumsi itu tidak berubah. "Eksak" juga eksak terhadap poligon yang
sudah disederhanakan, bukan terhadap batas administrasi sebenarnya. Kalimat asumsi di
panel tetap dipasang.
**Konsekuensi:**
- **Alias SQL camelCase wajib dikutip.** Postgres menurunkan huruf pengenal yang tidak
  dikutip; `AS outletCode` menjadi `outletcode` dan pembacanya dapat `undefined` tanpa
  error. Kena 25 alias waktu migrasi.
- **Placeholder tetap ditulis `?`**, diterjemahkan jadi `$n` oleh `toPositional()` di
  `db.js`. Diputuskan begitu supaya ~60 titik query tidak perlu ditulis ulang — dan
  risikonya dipindahkan ke satu fungsi yang punya tesnya sendiri (`db.test.js`).
- **`quad_segs=32` wajib di `ST_Buffer`.** Bawaannya segi-32 yang luasnya 0,65% lebih
  kecil daripada lingkaran, searah, jadi biasnya tidak saling menghapus.
- **Pindah server mensyaratkan PostGIS terpasang di tujuan sebelum restore.**
- **`npm test` sekarang butuh PostgreSQL jalan** dan role dengan CREATEDB.
**Alternatif yang ditolak:** Tukar mesin ke Postgres tanpa memakai PostGIS — membayar
seluruh biaya migrasi untuk nol manfaat. Memasang geopandas agar `radius.py` bisa
dipakai — menarik GDAL ±100 MB dan tetap meninggalkan hitungannya di luar aplikasi.

## [2026-08-13] `src/core/coverage.js` dipertahankan sebagai pembanding, bukan dibuang

**Konteks:** Setelah jangkauan dihitung PostGIS, implementasi sampling di
`src/core/coverage.js` tidak lagi dipakai server.
**Keputusan:** Dipertahankan. Bukan kode mati.
**Alasan:** Dua sebab. Pertama, prototipe proposal memakainya — berkas HTML mandiri
tanpa database. Kedua, dia jadi pembanding independen: `test/coverage-postgis.test.js`
menjalankan keduanya atas geometri yang sama dan membandingkan hasilnya. Dua cara yang
tidak berbagi satu baris kode pun, saling mengoreksi, jauh lebih bernilai daripada satu
cara yang tidak punya alat membuktikan dirinya sendiri.
**Konsekuensi:** Tesnya menguji **bias**, bukan kesamaan per kelurahan. Sampling
berderau — kelurahan yang tepinya dipotong lingkaran meleset sampai 3 poin, dan sampling
terhadap dirinya sendiri dengan benih berbeda meleset sebesar itu juga. Yang tidak boleh
ada adalah bias sistematis. Batasnya diukur, bukan ditebak: bias -0,01 poin, rerata
selisih 0,41 poin, derau sampling murni 0,34 poin.

## [2026-08-16] Kolom waktu jadi TIMESTAMPTZ, bukan teks ISO-8601

**Konteks:** `imports.started_at`, `imports.finished_at`, `outlets.updated_at`, dan
`access_log.at` bertipe `VARCHAR(32)` berisi `new Date().toISOString()` — warisan dari
zaman SQLite lalu MySQL, yang memang tidak punya tipe waktu yang enak dipakai. Di
Postgres bentuk itu punya biaya nyata: tiap hitungan selisih waktu gagal dengan
`operator does not exist: character varying - character varying`. Sudah terjadi sekali
di `pg.log` 2026-08-15 23:11 waktu ada yang mencoba menghitung lama impor.
**Keputusan:** Keempat kolom diubah jadi `TIMESTAMPTZ`, di skema maupun di database
yang sudah ada.
**Alasan:** Yang lama tidak pernah *terlihat* salah — ISO-8601 kebetulan urut secara
abjad, jadi `ORDER BY` dan indeksnya benar, dan tampilannya benar. Dia cuma menolak
dihitung, dan menolaknya baru ketahuan waktu ada yang butuh. Menyimpan waktu sebagai
teks di database yang punya tipe waktu berarti menabung kegagalan yang sama untuk
orang berikutnya.
**Alternatif yang ditolak:** Membiarkan teks dan menambahkan `::timestamptz` di query
yang butuh — ditolak: itu memindahkan beban ke tiap pemanggil dan tetap gagal diam-diam
di pemanggil yang lupa. Menambah kolom durasi hasil hitungan — ditolak, itu menyimpan
sesuatu yang bisa diturunkan.
**Konsekuensi:** Sisi JavaScript **tidak berubah**: `pg` menerima string ISO-8601 apa
adanya untuk kolom `TIMESTAMPTZ`, jadi `new Date().toISOString()` di `importer.js` dan
`repository.js` tetap benar. Yang berubah arah baca — kolomnya kembali sebagai objek
`Date`, dan `res.json()` menjadikannya ISO-8601 lagi, jadi bentuk yang sampai ke
browser sama persis. `import.js:273` yang memotong 10 karakter pertama tetap benar.

Yang TIDAK ikut dibereskan, dan harus disebut: **belum ada penjalan migrasi.**
`schema.sql` cuma `CREATE TABLE IF NOT EXISTS`, jadi perubahan tipe di sana hanya
berlaku untuk database yang belum ada. Database di mesin ini sudah diubah dengan tangan:

```sql
ALTER TABLE imports ALTER COLUMN started_at  TYPE TIMESTAMPTZ USING NULLIF(started_at,'')::timestamptz;
ALTER TABLE imports ALTER COLUMN finished_at TYPE TIMESTAMPTZ USING NULLIF(finished_at,'')::timestamptz;
ALTER TABLE outlets ALTER COLUMN updated_at  TYPE TIMESTAMPTZ USING NULLIF(updated_at,'')::timestamptz;
-- database astra_customers:
ALTER TABLE access_log ALTER COLUMN at TYPE TIMESTAMPTZ USING NULLIF(at,'')::timestamptz;
```

Mesin lain yang databasenya sudah berisi WAJIB menjalankan keempat perintah itu; kalau
tidak, dia jalan terus dengan tipe lama tanpa satu pun peringatan. Begitu ada mesin
kedua, `schema_version` harus berhenti jadi angka yang ditulis ulang dan mulai jadi
migrasi bernomor yang dijalankan berurutan. Catatannya ada di `db.js:21`.

## [2026-08-16] Kode dealer ditentukan server, nama yang sama menggabungkan

**Konteks:** Fase 5 — memindahkan pos ke dealer lain lewat aplikasi. Pengelompokan
dealer awalnya tebakan dari nama pos (bagian sebelum " - "), dan CLAUDE.md melarang
identitas diturunkan dari nama. Peredam yang dijanjikan: "hasilnya jadi tabel yang bisa
disunting manusia". Separuhnya sudah ada (koordinat dan alamat); separuh yang justru
melanggar aturannya belum.
**Keputusan:** Halaman mengirim **nama dealer**, tidak pernah kodenya.
`resolveDealer()` di `repository.js` yang menentukan kode: nama yang sudah dipakai
dealer lain memakai ulang kode dealer itu; nama baru diturunkan lewat `toDealerCode()`
dari `src/core/grouping.js`. Pencocokan nama tanpa memandang besar-kecil huruf dan
spasi berlebih.
**Alasan:** Kode dealer itu identitas. Kalau browser boleh menentukannya, aturan
"jangan turunkan identitas dari nama" jadi tersebar ke tempat yang tidak bisa dijaga.
Memakai ulang kode yang ada juga yang membuat "pindahkan pos ini ke NUSANTARA SAKTI"
benar-benar MENGGABUNGKAN — kalau kodenya diturunkan ulang, hasilnya dealer kedua
dengan nama sama persis, dan dua-duanya muncul terpisah di treemap dan dropdown.
**Alternatif yang ditolak:** Browser mengirim `dealerCode` hasil pilihan dropdown —
ditolak karena tidak ada cara memeriksa kode yang datang dari klien tanpa mengulang
seluruh logikanya di server. Tabel `dealers` terpisah — ditolak: dealer memang cuma
"kumpulan pos dengan kode yang sama", dan tabel terpisah bisa menyimpang dari kenyataan
tanpa ada yang menyadarinya.
**Konsekuensi:**
- `patch.dealerCode` MASIH dihormati kalau diberikan langsung, untuk skrip dan tes.
  Rute HTTP tidak pernah meneruskannya.
- Nama yang seluruhnya tanda baca ditolak: kodenya akan kosong, dan kode kosong
  menggabungkan semua outlet bernasib sama jadi satu dealer hantu.
- Perpindahan dealer tidak memicu hitung ulang jangkauan — jangkauan bergantung pada
  lokasi, bukan pengelompokan. Diuji.
- `updateOutlet()` mengembalikan `dealerChanged` supaya halaman tahu harus mengambil
  data ulang: warna, treemap, dan isi dropdown semuanya berubah.

## [2026-08-16] Dokumentasi dijaga tes, bukan kehati-hatian

**Konteks:** Escape `\a` dan `\b` di skrip penyunting menaruh karakter kontrol ke dalam
perintah di `README.md` dan `docs/PINDAH.md` — `C:\astra-data` jadi `C:` + karakter bel,
`ops\backup.bat` jadi `ops` + backspace. Kejadian kedua; `.env.example` kena lebih dulu.
**Keputusan:** `test/docs.test.js` menolak karakter kontrol di berkas teks mana pun,
memeriksa tautan antar dokumen, dan memastikan berkas yang disebut README benar-benar
ada. Path di dokumen memakai garis miring biasa yang tidak punya escape sama sekali.
**Alasan:** Dokumen di proyek ini bukan hiasan — penggunanya tidak punya orang IT, dan
`PINDAH.md` adalah satu-satunya jalan mereka memindahkan server. Perintah yang rusak di
sana sama seriusnya dengan kode yang rusak, dan rusaknya TIDAK KELIHATAN: tidak di
editor, tidak di GitHub, cuma waktu ada yang menyalin lalu bingung kenapa gagal.
**Konsekuensi:** Tesnya langsung membuktikan diri — beberapa menit setelah dipasang, dia
menolak commit yang memasangnya, karena paragraf yang menjelaskan bahaya karakter
kontrol ternyata memuat tiga karakter kontrol baru. Kesalahan yang sama, penulis yang
sama, lima menit berselang.

## [2026-08-17] Database memuat seluruh Jateng + DIY; browser cuma yang berarti

**Konteks:** Perluasan cakupan ke kabupaten baru butuh poligon, dan itu selama ini
berarti menjalankan pipeline Python. Pertanyaannya: siapkan saja semuanya sekaligus?
**Diukur dulu:** tabel `villages` se-Indonesia ~135 MB (aman), tapi `kelurahan.geojson`
~84 MB dan `/api/summary` ~15 MB tiap halaman dibuka (mustahil — MapLibre memuat
geojson sekaligus, dan summary dikirim tiap kali halaman dibuka).
**Keputusan:** Database memuat SELURUH Jawa Tengah + DIY (8.999 kelurahan, 40
kabupaten/kota). Yang dikirim ke browser disaring: kelurahan yang punya penjualan, ATAU
masuk radius sebuah pos, ATAU ditambah manual. 4.003 dari 8.999.
**Alasan:** Ekspansi jadi tanpa setelan — kabupaten baru di Excel langsung cocok karena
kelurahannya sudah ada beserta poligonnya. Cakupan dibatasi Jateng + DIY karena 93%
baris yang belum cocok ada di Jawa Tengah; pembeli dari provinsi lain memang di luar
radius pos mana pun, jadi menambah cakupan untuk mereka tidak mengubah angka apa pun.
**Alternatif yang ditolak:** Menyaring dengan "kota yang punya penjualan" — diukur dan
ditolak: 38 dari 40 kota punya setidaknya satu penjualan, jadi penyaringnya cuma
membuang 3%. Mengirim semua 8.999 ke halaman — ditolak bukan karena ukurannya (2,31 vs
3,18 MB, halaman tetap siap 1,4 detik) tapi karena KPI "Kelurahan Kosong" berubah makna
diam-diam dari 439 jadi 5.673.
**Konsekuensi:**
- Kriteria penyaring HARUS sama di `repository.summary()` dan `scripts/export-geo.js`.
  Kalau berbeda, peta dan tabel menampilkan himpunan kelurahan yang berlainan.
- `geom_m IS NULL` ikut disertakan di summary: kelurahan yang ditambah manual belum
  punya penjualan maupun poligon, dan tanpa syarat itu dia hilang dari layar begitu
  disimpan.
- Angka jangkauan turun 15,1% -> 14,8% karena 403 baris yang tadinya tak terlihat kini
  terhitung. Turunnya benar, bukan kemunduran.
- Poligon di database detail penuh; penyederhanaan 50 m HANYA untuk yang digambar.

## [2026-08-17] geopandas tidak diperlukan untuk memuat batas wilayah

**Konteks:** Dua kali dalam proyek ini geopandas jadi penghalang: pertama waktu memilih
sampling Monte Carlo daripada `radius.py`, kedua waktu perluasan cakupan dianggap butuh
GDAL 100 MB.
**Keputusan:** `scripts/seed-boundaries.js` membaca berkas sumber langsung di Node dan
menyerahkan geometrinya ke PostGIS.
**Alasan:** Asumsinya ternyata salah. Kolom `path` di `cahyadsn/wilayah_boundaries`
adalah array JSON biasa — kedalaman 3 untuk poligon, 4 untuk multipoligon — bukan WKB
yang butuh pustaka geometri. PostGIS sudah ada di proyek ini dan mengerjakan validasi,
proyeksi, serta penyederhanaan lewat fungsi yang sudah dipakai `seed-regions.js`.
**Konsekuensi:** Koordinat sumber `[lintang, bujur]`, GeoJSON `[bujur, lintang]` —
penukarannya WAJIB dan tidak pernah menimbulkan error kalau salah. Poligonnya tetap
sah, luasnya tetap masuk akal, jangkauannya cuma jadi 0% di mana-mana. Karena itu
`checkOrientation()` berjalan sebelum satu baris pun masuk database, dan batas kotaknya
diukur dari 8.999 kelurahan sungguhan (-8,212..-5,725) — bukan ditebak dari peta
daratan, yang menolak Karimunjawa.

## [2026-08-17] Struktur folder jadi `backend/` + `frontend/`

**Konteks:** Pertanyaan pemilik proyek: "harusnya ada folder backend, frontend gitu biar
langsung keliatan bagian front dan back?" Struktur sebelumnya `src/core`, `src/server`,
`public/`, `src/styles`.
**Keputusan:** Dipindah jadi `backend/core`, `backend/server`, `frontend/`,
`frontend/styles`.
**Alasan:** `src/` + `public/` itu konvensi Express yang sah dan bukan kesalahan, jadi
alasannya bukan "yang lama salah". Yang menentukan dua hal yang diukur lebih dulu.
Pertama, pemisahannya sudah bersih — `public/js/` tidak meng-import apa pun dari `src/`,
nol — jadi memotongnya di situ jujur, bukan mengganti nama supaya kelihatan rapi.
Kedua, `src/styles/` memang salah tempat: dia sumber frontend yang duduk di sisi
backend, dan itu keliru terlepas dari konvensi mana yang dipakai. Konvensi
`backend/`+`frontend/` biasanya untuk sistem yang dibangun dan dideploy terpisah, yang
BUKAN kasus di sini; yang dimenangkan cuma keterbacaan sekali lihat, dan itu memang
yang diminta.
**Konsekuensi:** Require relatif di dalam tree yang pindah tidak berubah. Yang berubah
cuma yang mengeja `src/` atau `public/` utuh — 43 berkas, plus tiga yang lolos karena
merakit path per segmen (`path.join(ROOT, 'src', 'server', ...)`) dan baru ketahuan
waktu `npm test` merah. `@source` di Tailwind ikut berubah dan itu titik paling rawan:
path yang salah TIDAK melempar error, cuma menghasilkan CSS tanpa kelas yang tidak
ditemukannya. Entri lama di ROADMAP dan DECISIONS sengaja tetap memakai nama lama.

## [2026-08-17] PRD ditulis mundur; PLAN.md diarsipkan, bukan diperbarui

**Konteks:** Proyek berjalan enam fase tanpa PRD. `docs/PLAN.md` — yang ditunjuk
`CLAUDE.md` sebagai "rencana lengkap" — masih menjelaskan SQLite, folder `logika/`
`publik/` `tes/`, dan tabel bernama Indonesia. Tidak satu pun masih benar.
**Keputusan:** `docs/PRD.md` baru, ditulis dari sistem yang berjalan. `PLAN.md` dipindah
ke `docs/archive/PLAN-2026-08-12.md` **tanpa disunting**, diberi tabel "yang di sini
sudah tidak benar" di kepalanya.
**Alasan:** Memperbarui PLAN.md di tempat akan menghapus jejak bahwa rancangan awalnya
berbeda, dan nama berkasnya tetap "PLAN" walau isinya PRD. Menghapusnya membuang
satu-satunya sumber tertulis untuk alasan "laptop dulu, VPS menyusul". Mengarsipkan
menahan keduanya: sejarahnya utuh, dan tidak bisa lagi menyesatkan karena peringatannya
dibaca lebih dulu.
**Konsekuensi:** 68 kebutuhan ber-ID (`KF-*`, `KNF-*`), masing-masing menyebut berkas
tes yang menjaganya; delapan ditandai `belum dijaga` apa adanya. `docs.test.js` menjaga
daftar itu supaya tidak membusuk: berkas tes yang disebut harus ada, ID tidak boleh
kembar, berkas kode yang disebut harus ada, dan dokumen aktif tidak boleh menunjuk
PLAN.md lagi. Penjaga folder sengaja dibedakan — berkas diperiksa di mana pun, folder
telanjang hanya di dalam blok peta struktur, supaya prosa tetap boleh menyebut nama
lama waktu bercerita tentang masa lalu.

## [2026-08-18] Simpan data konsumen jadi menyala secara bawaan di halaman impor

**Konteks:** Centang "simpan juga nama dan alamat konsumen" di halaman impor sebelumnya
mati secara bawaan — opt-in. Pemilik proyek menunjukkan bahwa tim memang memerlukan data
itu tiap bulan, jadi default mati berarti tiap bulan ada peluang lupa lalu harus impor
ulang.
**Keputusan:** Centangnya menyala secara bawaan di halaman. `npm run import` di baris
perintah TETAP memerlukan `--konsumen` eksplisit.
**Alasan:** Default seharusnya mencerminkan apa yang biasanya benar, dan di sini yang
biasanya benar adalah menyimpannya. Opt-in melindungi dari menyimpan PII yang tidak
diperlukan — tapi PII ini memang diperlukan, jadi yang dicegah bukan risiko, cuma
pekerjaan yang terlewat. CLI dibedakan karena dipakai untuk skrip dan perbaikan cepat,
dan perintah yang menyimpan data pribadi tanpa diminta adalah kejutan yang salah arah.
**Alternatif yang ditolak:** Menyalakan keduanya — ditolak, lihat alasan CLI di atas.
Membiarkan keduanya mati — ditolak, itu pertanyaan yang sudah dijawab pemilik proyek.
**Konsekuensi:** Jaminan sisi server tidak berubah sedikit pun dan itu yang penting:
`runImport` tanpa `withCustomers` tetap tidak menyentuh `astra_customers`, database
konsumen tetap terpisah, dan `DROP DATABASE` tetap mencabut semuanya. Yang berpindah
cuma nilai bawaan di satu atribut HTML.

Dua jebakan yang lahir dari keputusan ini, dan penangkalnya:

1. **Beda perilaku halaman dan CLI.** Orang yang terbiasa dengan halaman akan mengira
   CLI sama, lalu bingung kenapa tab Data Konsumen kosong. CLI sekarang menyebutkannya
   di layar tiap kali dijalankan tanpa `--konsumen`.
2. **Atribut `checked` bisa hilang tanpa gejala.** Impor berikutnya tetap berjalan mulus
   dan angkanya tetap benar; yang hilang cuma data konsumen, dan baru ketahuan
   berminggu kemudian. `test/page.test.js` menjaga atribut itu, dan menjaga labelnya
   tetap menjelaskan cara mematikannya — dengan default menyala, itu satu-satunya
   petunjuk bahwa menolak menyimpan PII masih mungkin.

## [2026-08-18] Pilihan simpan data konsumen dibuang dari halaman impor

**Menggantikan keputusan [2026-08-18] "Simpan data konsumen jadi menyala secara bawaan"**
yang diambil beberapa jam sebelumnya.
**Konteks:** Setelah defaultnya dinyalakan, pemilik proyek menegaskan bahwa pilihannya
sendiri tidak perlu ada — data nama dan alamat wajib tersimpan tiap bulan.
**Keputusan:** Centangnya dibuang dari halaman impor. Impor lewat halaman selalu
menyimpan. `npm run import` tetap memerlukan `--konsumen` eksplisit.
**Alasan:** Pilihan yang jawabannya selalu sama bukan pilihan, cuma peluang salah. Yang
hilang bukan perlindungan — perlindungannya ada di pemisahan database dan di jaminan
sisi server, bukan di centang.
**Konsekuensi:** Satu-satunya jalur mengimpor tanpa PII sekarang baris perintah. Semua
impor lewat halaman, termasuk impor coba-coba dan berkas demo, menyimpan isi kolom nama
dan alamat apa adanya.

Dua hal yang dijaga karena keputusan ini:

1. **Arah nilai bawaan.** Halaman tidak lagi mengirim field `withCustomers`, jadi aturan
   `=== '1'` akan berarti tidak pernah menyimpan — kebalikan persis dari yang diminta,
   tanpa error dan tanpa tes merah. Sekarang `!== '0'`, dikurung dalam
   `simpanKonsumen()` yang diekspor supaya bisa diuji langsung.
2. **Pemberitahuan tetap ada.** Pengunggah tidak lagi bisa menolak, jadi setidaknya
   berhak tahu. Menghapus pilihan boleh; menghapus pemberitahuannya tidak, dan
   `test/page.test.js` menjaganya.

## [2026-08-29] Kota, dealer, dan pos berbagi satu slot filter

Tim meminta: periode dan provinsi selalu bisa dipakai, plus **tepat satu** dari kota,
dealer, atau pos — dan berpindah di antara ketiganya mereset yang sebelumnya.

Cara yang jelas adalah menyimpan tiga field lalu menulis fungsi penjaga yang
mengosongkan dua lainnya. Itu ditolak. Yang menulis lingkup di aplikasi ini ada enam
jalur: dropdown, marker peta, blok treemap, baris panel performa, chip kartu dealer, dan
poligon kelurahan. Penjaga yang harus dipanggil enam kali adalah penjaga yang suatu hari
lupa dipanggil sekali, dan gagalnya diam — dua lingkup aktif bersamaan cuma terlihat
sebagai panel kosong yang tidak dijelaskan siapa pun.

Yang dipakai: satu slot, `{scopeKind, scopeCode}`. Dua lingkup aktif bersamaan **tidak
bisa direpresentasikan**. Tidak ada kode "reset filter sebelumnya" karena tidak ada yang
perlu direset — resetnya konsekuensi bentuk datanya.

Provinsi sengaja TIDAK ikut ke dalam slot: tim memutuskan dia tetap penyaring mandiri
yang boleh dipakai bersama salah satu dari ketiganya.

Harganya nyata dan diterima sadar: drill-down "klik dealer lalu klik salah satu posnya"
hilang. Mengklik pos membuang dealernya, di peta maupun di dropdown. Aturan yang sama di
dua tempat lebih murah dijelaskan ke pengguna non-IT daripada dua perilaku yang mirip
tapi berbeda.

## [2026-08-29] Nilai filter di objek per halaman, bukan di `<select>`

Sejak awal, sumber kebenaran filter adalah nilai `<select>` di DOM. Itu sederhana dan
bertahan lama. Yang mematahkannya: tim meminta tiap halaman punya filter sendiri, dan
satu set `<select>` tidak bisa menyimpan empat halaman sekaligus. Menyimpan-dan-memuat
nilainya tiap kali tab berpindah bisa saja — tapi gagalnya diam kalau urutan di
`switchTab()` bergeser sedikit.

Sekarang nilainya di `S.filters[halaman]`, dan `<select>` cuma cermin satu arah
(objek → DOM, lewat `syncFilterBar()`).

Keuntungan yang tidak dicari tapi ternyata paling besar: `filters.js` jadi **bebas DOM**.
Aturan saling-eksklusif, rentang periode, dan pemisahan per halaman sekarang bisa diuji
dengan `import()` biasa di Node — `test/filters.test.js`, tanpa browser dan tanpa
database. Selama nilainya di DOM, satu-satunya tes yang mungkin adalah pemeriksaan teks,
dan CLAUDE.md sudah mencatat kelas kegagalan itu.

Dua konsekuensi yang harus diingat:

1. `renderAll()` sekarang berarti "gambar halaman Peta", bukan "gambar semuanya". Dia
   berhenti di baris pertama kalau `S.filterPage !== 'peta'`.
2. `renderAll()` juga yang memanggil `syncFilterBar()`. Semua jalur klik di peta
   mengubah lingkup lewat `applyScope()` tanpa menyentuh `<select>` sama sekali; tanpa
   baris itu, peta sudah berpindah sementara bilahnya masih menunjukkan filter lama.
   Sudah pernah terjadi — ditemukan waktu memeriksa di browser, bukan oleh tes.

## [2026-08-29] Periode: dropdown bulan + dropdown tahun, tanpa tombol "1 bulan"

Bentuk kendali ini berubah tiga kali dalam satu sesi. Ditulis lengkap karena yang
berharga bukan bentuk akhirnya, tapi kenapa dua bentuk sebelumnya gagal — dua-duanya
terlihat benar di kepala dan baru salah waktu dipakai orang.

**Versi 1 — dua `<select>` daftar bulan + sakelar "1 bulan".** Daftarnya diisi dari
periode yang sudah diimpor, jadi mustahil salah pilih. Tim: *"langsung isi MM YY aja,
gaperlu ada pilihan 1 bulan"*.

**Versi 2 — dua `<input type="month">`, dibatasi `min`/`max` ke periode yang ada.**
Nilainya sudah `YYYY-MM`, persis format kolom `period`. Rapi di atas kertas. Tim:
*"biasa aja gaperlu ngikutin bulan tahun yang udah keupload"* — batas yang menolak
bulan lain terasa seperti kotaknya rusak, bukan seperti aturan. `min`/`max` dilepas.

**Versi 3 — dua `<select>` per ujung: bulan dan tahun.** Yang masih tersisa di versi 2:
`type="month"` **tidak punya daftar tahun**. Bulannya bisa diklik dari pemilih tanggal,
tahunnya cuma bisa diketik — dan mengetik bukan afordansi yang terlihat untuk pengguna
non-IT. Tim: *"tahunnya juga harus bisa dipilih"*.

Daftar tahunnya 2020 sampai tahun depan, **daftar biasa** yang tidak diturunkan dari
data. Bulan yang belum ada datanya boleh dipilih dan jawabannya nol — nol yang terlihat
apa adanya lebih jujur daripada dropdown yang diam-diam tidak memuat tahun yang dicari.

**Efek samping yang bagus:** `<select>` jalan di semua browser. Peringatan versi 2
(`type="month"` cuma didukung Chrome dan Edge; di Firefox dan Safari jatuh jadi kotak
teks yang menerima apa saja) hilang bersama masalahnya.

**Satu perbedaan halus yang wajib dijaga**, dan sudah sempat salah: "tanpa batas" harus
datang dari orang MEMILIH tanda hubung, bukan dari salah satu dropdown yang kebetulan
belum terisi. Waktu keduanya disamakan, memilih bulan dari keadaan kosong langsung
dihapus lagi oleh `syncFilterBar()` — dari kosong, periodenya mustahil diisi. Sekarang
`onPeriodChange` menerima elemen yang disentuh: nilainya kosong berarti dikosongkan
sengaja; kalau tidak, sisi yang belum terisi **dilengkapi** (Januari untuk ujung awal,
Desember untuk ujung akhir, tahun dari periode terakhir). Melengkapi tetap menebak, tapi
tebakannya langsung tertulis di dropdown sebelahnya dan bisa diganti — itu yang
membedakannya dari menebak diam-diam di dalam kode.

Tombol "1 bulan" hilang berarti melihat satu bulan butuh dua tindakan, bukan satu.
Ditukar sadar dengan bilah yang lebih sedikit isinya. Bersamanya ikut hilang field
`single` di objek filter dan fungsi `setSingleMonth()` — perbedaan default antar halaman
sekarang ditulis eksplisit di `fillFilterBar()`, di sebelah kode yang menyetelnya, bukan
disimpulkan dari sebuah flag.

## [2026-08-29] Dropdown sendiri menggantikan `<select>`, pencarian masuk ke dalamnya

Versi pertama menempelkan kotak cari sebagai `<input>` terpisah di sebelah tiap
`<select>`. Tim menolaknya: dua kendali untuk satu pilihan, dan yang kedua tidak terlihat
seperti bagian dari yang pertama. Yang diminta: kotak carinya di dalam dropdown.

`<select>` bawaan tidak bisa memuat apa pun di dalam daftarnya, jadi tidak ada jalan
selain membuat sendiri. Yang dipertimbangkan dan ditolak: `<input list>` + `<datalist>`.
Itu native dan nol komponen, tapi nilai yang tersimpan jadi **teks label**, bukan kode —
dan menerjemahkan label balik ke kode berarti salah ketik diam-diam mengubah filter.
Persis kelas kegagalan yang komentar `select-search.js` sudah memperingatkan sejak dulu.

`combobox.js` (~120 baris) menggantikan `select-search.js`. Yang dijaga:

- **Yang tersimpan selalu KODE.** Kotak cari hanya menyaring apa yang tampil; memilih
  harus menekan salah satu barisnya. Tidak ada jalan nilai filter berasal dari ketikan.
- **Daftar opsi menempel di elemen hostnya** (`el._combo`), bukan di objek global
  berkunci id. Itu pelajaran langsung dari `S.allOptions` — objek global yang tidak
  pernah dibuat siapa pun dan mematikan pencarian dropdown sejak hari pertama tanpa satu
  pun tes merah. Sekarang yang membuat dan yang membaca ada di berkas yang sama.
- **Kotak cari muncul hanya kalau daftarnya lebih dari 8 baris.** Provinsi punya dua
  pilihan; kotak cari di situ cuma ribut.

Yang sengaja TIDAK dibuat: navigasi panah atas/bawah di dalam daftar. Ditandai
`ponytail:` di berkasnya. Daftarnya bisa dicari dan diklik; roving tabindex sekarang
berarti menebak kebutuhan yang belum ada.

## [2026-08-29] Pil yang menyala: aturan filter jadi sesuatu yang terlihat

Tim bilang bilah filternya "terlalu flat, mau menarik tapi tetap simple". Perbaikan yang
gampang adalah menambah bayangan, ikon, dan badge jumlah di tiap filter. Itu ditolak:
menarik dan ramai bukan hal yang sama, dan penggunanya melihat bilah ini tiap hari.

Yang dipakai, tanpa satu pun warna atau font baru:

1. Bilahnya dapat gradien setipis `#ffffff → #f6f8fc` dan garis rambut bawah, supaya dia
   punya bidang sendiri di bawah nav navy alih-alih terbaca sebagai sambungan kosong.
2. Nama sumbu masuk ke dalam pil sebagai teks kecil uppercase — perangkat yang sudah
   dipakai kartu KPI, bukan perangkat baru yang harus dipelajari.
3. Periode memakai JetBrains Mono. Dia satu-satunya filter yang berupa **koordinat**,
   bukan nama, dan mono di aplikasi ini sudah berarti "ini angka".
4. **Pil menyala navy kalau filternya benar-benar sedang menyempitkan tampilan.**

Nomor 4 itu yang sebenarnya dikerjakan. Karena kabupaten, dealer, dan pos berbagi satu
slot, tidak akan pernah ada dua di antara ketiganya yang menyala bersamaan — jadi aturan
yang jadi dasar seluruh perombakan ini berhenti jadi sesuatu yang harus dijelaskan dan
mulai jadi sesuatu yang terlihat. "Kok kabupaten saya hilang waktu saya pilih dealer?"
menjawab dirinya sendiri.

Kesederhanaannya dijaga dengan membuang, bukan menahan diri: tidak ada badge jumlah,
tidak ada ikon per filter, tidak ada animasi pil. Satu ikon corong, satu caret, dan satu
transisi 120 md waktu panelnya muncul.

## [2026-08-29] Bilah filter di luar area gulir, bukan `position: sticky`

Permintaannya "filter fix di bawah panel halaman, selalu ada meski di-scroll". Judul tiap
halaman ada DI DALAM area yang menggulir, jadi satu bilah tidak bisa sekaligus "di bawah
judul" dan "selalu terlihat". Tim memilih bilah di ATAS judul.

Bilahnya ditaruh sebagai saudara `<main>`, bukan di dalamnya. `<main>` satu-satunya
elemen yang menggulir, jadi apa pun di luarnya memang tidak pernah bergerak — nol baris
CSS, dan tidak bisa mati diam kalau suatu hari ada ancestor ber-`overflow` yang membuat
`position: sticky` berhenti bekerja tanpa error.

Mode layar penuh peta (`position: fixed; inset: 0`) menutupi bilah itu. Jawabannya bukan
bilah kedua: `appendChild` MEMINDAH node ke dalam panel layar penuh dan mengembalikannya
saat keluar. Nilai tiap `<select>` ikut utuh karena memang elemen yang sama. Cermin
`fs-*` yang lama dibuang — dua daftar yang harus disamakan terus-menerus pasti
menyimpang suatu hari.

## [2026-08-30] Dealer jadi tabel sendiri, bukan lagi kolom yang diduplikasi di `outlets`

**Konteks:** `dealer_code`/`dealer_name` tadinya cuma kolom string di tiap baris
`outlets` yang kebetulan sama untuk pos-pos milik dealer yang sama (12 dari 79 outlet
berbagi dealer, sampai 8 outlet untuk NUSANTARA SAKTI). Dropdown pemilih dealer di
editor pos menebak daftarnya dari `S.outlets`, bukan dari master sungguhan — dealer
yang belum punya pos sama sekali tidak bisa dibuat lebih dulu, dan tidak ada tempat
menyimpan alamat/koordinat kantor dealer.
**Keputusan:** Tabel `dealers` baru (`dealer_code` PK, `dealer_name`, `address`,
`lat`, `lng`), dengan `outlets.dealer_code` jadi FOREIGN KEY sungguhan ke situ.
`resolveDealer()` mencari dan menulis ke `dealers`, bukan lagi menebak dari `outlets`.
**Alasan:** Master Dealer dan Master Pos adalah dua entitas berbeda bagi tim channel
— diminta eksplisit waktu membahas rencana ini. Tanpa tabel sendiri, "tambah dealer
baru sebelum ada posnya" dan "sunting alamat kantor dealer" tidak punya tempat untuk
disimpan.
**Alternatif yang ditolak:** Menyimpan alamat/koordinat dealer sebagai kolom
tambahan di baris `outlets` pertama milik dealer itu — ditolak, itu memilih satu baris
secara sewenang-wenang untuk mewakili sesuatu yang levelnya beda dari baris lainnya,
dan pecah begitu baris itu dihapus.
**Konsekuensi:** FK ditambahkan lewat `NOT VALID` (bukan `ADD CONSTRAINT` polos) karena
`schema.sql` jalan tiap server start, termasuk terhadap database production yang sudah
punya 79 outlet sebelum `dealers` pernah ada — `scripts/backfill-dealers.js` mengisi
data lama lalu memvalidasi FK-nya sekali secara terpisah. Tiga jalur tulis
(`resolveDealer()`, jalur `patch.dealerCode` langsung, dan `resolveGroups()` di impor
bulanan) semuanya wajib meng-upsert `dealers` sebelum menulis `outlets` — kalau tidak,
FK menolak baris yang menunjuk dealer yang belum tercatat.

## [2026-08-30] Impor massal pos MEMANG boleh menimpa; impor penjualan bulanan TIDAK

**Konteks:** Impor penjualan bulanan (`importer.js`) sengaja tidak pernah menimpa
`dealer_code`/`dealer_name`/`lat`/`lng` hasil kurasi manusia — itu peredam eksplisit
CLAUDE.md terhadap tebakan `resolveGroups()`. Fitur baru "impor massal pos dari
Excel" (sheet "Dealer" AHM) butuh aturan sebaliknya: kalau nama atau alamat pos di
Excel beda dari database, itu memang perubahan yang harus masuk — Excel-nya yang
dianggap benar untuk dua field itu.
**Keputusan:** `backend/core/pos-diff.js` + rute preview/commit MEMANG menimpa
`outlet_name`/`address` kalau beda dari Excel. Pengamannya pratinjau eksplisit (tabel
diff per field) + satu tombol konfirmasi "Terapkan Perubahan", bukan perlindungan
diam-diam seperti impor bulanan.
**Alasan:** Dua impor ini menjawab pertanyaan yang berbeda. Impor bulanan menjawab
"penjualan bulan ini berapa" dan dealer/koordinat cuma tumpangan yang harus dijaga
dari tertimpa tebakan. Impor massal pos MEMANG dipakai untuk menyamakan
`outlet_name`/`address` dengan sumber AHM yang lebih baru — kalau tidak boleh
menimpa, fiturnya tidak berguna sama sekali.
**Alternatif yang ditolak:** Menyatukan ke satu mekanisme impor yang sama dengan flag
"boleh timpa" — ditolak, dua impor ini punya bentuk data, sumber, dan risiko yang
beda jauh (satu menulis `sales` + `outlets`, yang lain cuma `outlets`), menyatukannya
cuma menambah percabangan tanpa mengurangi kode.
**Konsekuensi:** `dealer_code`/koordinat TIDAK ada di cakupan field impor pos massal
ini sama sekali — sheet "Dealer" AHM tidak memuatnya, dan keduanya tetap murni kurasi
manusia lewat editor yang sudah ada. Kode pos di Excel yang belum ada di database
cuma dilaporkan, tidak pernah dibuat otomatis — sheet ini tidak punya dealer induk
untuk dijadikan outlet baru yang valid, dan CLAUDE.md melarang menebak identitas dari
nama.

## [2026-08-30] Filter kota/dealer/pos digeneralisasi jadi tiga slot independen

**Konteks:** Panel ringkasan baru untuk tim channel butuh kota DAN dealer aktif
bersamaan (mis. "penjualan Dealer A di Kota Yogyakarta"). Sebelumnya kota, dealer,
dan pos berbagi SATU slot (`scopeKind`/`scopeCode`) — mutually exclusive by design,
sengaja begitu sejak filter direstrukturisasi (lihat entri 2026-08-29 "Nilai filter
di objek per halaman").
**Keputusan:** Tiga field independen (`cityCode`/`dealerCode`/`outletCode`), semuanya
di-AND-kan — bukan cuma kota+dealer yang diminta, tapi ketiganya. Pola yang sama
dengan `province`, yang sudah independen sejak awal.
**Alasan:** Mengecualikan satu dari tiga field (pos tetap eksklusif, kota+dealer
independen) butuh percabangan khusus di `activeRows()`, `salePointFilter()`, dan
setiap pemanggil manual yang menyaring `scopeKind`/`scopeCode` — sementara
memperlakukan ketiganya seragam justru kodenya LEBIH SEDIKIT (satu pola AND yang
sama untuk tiga field, bukan dua pola berbeda).
**Alternatif yang ditolak:** Menambah field keempat "kombinasi kota+dealer" khusus di
samping slot lama — ditolak, itu state ganda untuk fakta yang sama dan cara pasti
menyimpang begitu satu jalur update lupa menyentuh salah satunya.
**Konsekuensi:** `clearScope()` yang tadinya selalu mengosongkan satu-satunya slot
sekarang menerima `kind` opsional. Empat pemanggil lama diperiksa ulang satu per satu
untuk memastikan maksudnya benar (tiga di antaranya ternyata cuma bermaksud melepas
SATU slot spesifik — menutup info pos, menutup kartu dealer — bukan mereset
semuanya, dan sebelumnya kebetulan benar karena memang cuma ada satu slot untuk
dilepas). `test/filters.test.js` dibalik: yang tadinya menguji SALING MENGOSONGKAN
sekarang menguji KEDUANYA TETAP AKTIF bersamaan.

## [2026-08-30] Business Reference: nilai config sederhana, bukan sistem audit-log

**Konteks:** Panel wilayah baru butuh "acuan bisnis" (Business Reference) — angka
persentase dari Marketing/Head Department untuk dibandingkan dengan Kontribusi
Penjualan tiap kelurahan. Spesifikasi awal (ditulis untuk WebGIS enterprise generik)
minta ini bisa diubah lewat konfigurasi terpusat dengan audit log (waktu perubahan,
siapa yang mengubah, nilai lama/baru), cakupan bertingkat (global/kota/dealer/periode),
dan validasi format.
**Keputusan:** Satu nilai `businessReferencePercent` di `config.js`, dibaca dari env
var `BUSINESS_REFERENCE_PERCENT` (default 1%). Tanpa UI admin, tanpa audit log, tanpa
cakupan bertingkat. Mengubahnya: edit `.env`, restart server.
**Alasan:** CLAUDE.md eksplisit — aplikasi ini untuk tim 5-20 orang non-IT TANPA tim
IT. Sistem audit-log dengan cakupan bertingkat adalah infrastruktur untuk organisasi
yang punya admin console dan proses change-management; membangunnya di sini adalah
kerja besar untuk kebutuhan yang belum pernah diminta secara konkret ("kalau nanti
manajemen benar-benar butuh riwayat perubahan, itu permintaan baru dengan konteks
sungguhan, bukan diasumsikan sekarang").
**Alternatif yang ditolak:** Tabel `business_reference` di database dengan riwayat
perubahan — ditolak untuk rilis ini; disebut eksplisit di rencana sebagai kandidat
kalau kebutuhannya muncul nyata nanti.
**Konsekuensi:** Perubahan acuan butuh akses ke server (edit `.env` + restart) — tidak
bisa diubah tim channel sendiri lewat UI. Tidak ada jejak siapa mengubah kapan. Kalau
kebutuhan itu muncul konkret, migrasinya jadi rencana terpisah (tabel + rute admin +
kolom `changed_by`/`changed_at`), bukan tambal di config.js.

## [2026-08-30] Peta ganti metrik pewarnaan default: Kontribusi Penjualan, bukan unit mentah

**Konteks:** Choropleth peta sejak awal mewarnai kelurahan berdasar persentil UNIT
PENJUALAN MENTAH yang sedang tampil (`percentileBreaks` atas `sumBy(rows,'village')`).
Permintaan panel 4-blok butuh "Sales Contribution" — % kontribusi kelurahan terhadap
total KOTANYA SENDIRI — sebagai metrik utama, dan peta idealnya konsisten dengan
angka yang ditampilkan di panel.
**Keputusan:** `paintChoropleth()` diganti total: sumber nilainya sekarang kontribusi
% per kelurahan (`contributionsForRows()`), bukan unit mentah. Ini metrik DEFAULT
baru untuk semua orang, bukan opsi tersembunyi.
**Alasan:** Dikonfirmasi eksplisit ke pengguna sebelum dikerjakan (bukan diasumsikan)
— lihat rencana `revisi-pra-present-ho-zazzy-grove.md`. Dua metrik yang berbeda
makna (unit mentah = volume, kontribusi % = konsentrasi/dominasi di kotanya sendiri)
menampilkan warna yang beda untuk kelurahan yang sama, dan membiarkan panel bicara
kontribusi % sementara peta tetap bicara unit mentah akan membingungkan — dua sumber
kebenaran untuk "kelurahan mana yang penting" tanpa ada yang tahu yang mana benar.
**Alternatif yang ditolak:** Menjadikan kontribusi % opsi TAMBAHAN dengan unit mentah
tetap jadi default — ditolak secara eksplisit oleh pengguna waktu ditanya langsung,
demi konsistensi peta ↔ panel.
**Konsekuensi:** Tampilan peta yang sudah dipakai tim sehari-hari BERUBAH — kelurahan
kecil yang dominan di kotanya sendiri sekarang bisa terlihat gelap meski unit
mentahnya kecil dibanding kelurahan di kota besar lain. Mode kedua ("Per Nilai
Kontribusi", interval tetap dari spek) ditambahkan sebagai alternatif eksplisit lewat
toggle, bukan pengganti — defaultnya tetap "Per Peringkat Relatif" (persentil, mesin
yang sama dengan sebelumnya, cuma input berbeda).

## [2026-08-31] Filter Provinsi diganti Kares, dibatasi 14 kab/kota tetap

**Konteks:** Permintaan langsung Pakbos: filter Provinsi (34 = DIY, 33 = Jateng)
diganti "Kares" (Karesidenan) — 3 pilihan tetap (Yogyakarta, Banyumas, Kedu), masing-
masing memetakan ke daftar kabupaten/kota tetap. Kota di luar 14 kab/kota gabungan
ketiganya diminta "dihapus" dari sistem.
**Keputusan:** `KARESIDENAN`/`ALLOWED_CITY_CODES` jadi konstanta statis di
`frontend/js/config.js` (bukan diturunkan dari data). Field filter `province` di
`makeFilter()` diganti `kares`. "Dihapus" diartikan SEMPIT: kota di luar daftar cuma
disembunyikan dari pilihan dropdown Kota (`isiComboKota()` di `filter-bar.js`), bukan
dibuang dari `S.villages`/`S.sales`/peta/tabel — dikonfirmasi eksplisit ke pengguna
sebelum dikerjakan, dua opsi (dropdown saja vs seluruh aplikasi) ditawarkan langsung.
**Alasan:** Menghapus kota dari SELURUH aplikasi (peta, tabel, KPI, treemap) berarti
menyaring ulang hampir setiap modul frontend dan mengubah total yang sudah dipercaya
tim — perubahan besar untuk permintaan yang niatnya cuma mempersempit PILIHAN filter,
bukan mendefinisikan ulang cakupan data proyek.
**Alternatif yang ditolak:** Mengecualikan kota di luar daftar dari seluruh
aplikasi — ditolak eksplisit oleh pengguna saat ditanya, demi risiko lebih rendah.
**Konsekuensi:** Data kota di luar 14 kab/kota TETAP ada dan tetap bisa muncul lewat
jalur lain (klik marker/poligon di peta, dsb) — cuma tidak ditawarkan sebagai pilihan
filter. `PROVINCE_NAMES` dan param `province` di `/api/customers/browse` TIDAK
disentuh (tetap provinsi asli, tidak terkait Kares) — keduanya independen sejak awal.

## [2026-08-31] Ring pindah dari kecamatan ke desa/kelurahan, data lama dihapus total

**Konteks:** Ring layanan pos (1/2/3, ditentukan manusia) sejak awal disimpan per
KECAMATAN (`outlet_rings.district_code`) — granularitas dipilih karena kecamatan jauh
lebih sedikit (654) daripada desa (~9.000) dan lebih mudah diklik di peta. Pakbos
minta granularitasnya turun ke DESA/KELURAHAN, dengan alasan kecamatan terlalu kasar
untuk menandai wilayah yang benar-benar tergarap.
**Keputusan:** `outlet_rings.district_code` → `village_code` (FK ke
`villages.village_code`). Data ring versi kecamatan yang sudah ada DIHAPUS TOTAL
(`DROP TABLE outlet_rings CASCADE` dijalankan manual di database yang sudah ada —
proyek ini belum punya migration runner bernomor, lihat `backend/server/db.js`
baris ~22) — bukan diturunkan otomatis (mis. semua desa di kecamatan X ikut ring
kecamatan itu). Poligon desa untuk mode edit ring diekspor ke berkas TERPISAH,
`kelurahan-ring.geojson` (`scripts/export-geo.js`, fungsi `tulisKelurahanRing`) —
BUKAN `kelurahan.geojson` yang sudah ada, karena berkas itu SENGAJA hanya berisi
~4.000 dari ~9.000 desa (yang sudah punya penjualan/jangkauan); memakainya untuk
edit ring akan membuat ~5.000 desa tanpa penjualan (justru yang paling perlu ditandai
manusia) tidak bisa diklik.
**Alasan:** Permintaan eksplisit Pakbos. Opsi "turunkan otomatis" (desa mewarisi ring
kecamatannya) dipertimbangkan tapi TIDAK dipilih pengguna waktu ditanya — dia memilih
mulai dari kosong dan isi ulang manual, kemungkinan karena batas kecamatan/desa tidak
selalu selaras dan warisan otomatis bisa memberi kesan akurasi yang sebenarnya belum
diverifikasi manusia.
**Alternatif yang ditolak:** Migrasi otomatis kecamatan→desa (desa mewarisi ring
kecamatannya) — ditolak eksplisit oleh pengguna, pilih mulai kosong.
**Konsekuensi:** SEMUA ring yang sudah pernah diisi tim hilang; harus diisi ulang
manual per desa lewat mode edit ring yang baru. Ukuran berkas ternyata TIDAK jadi
masalah seperti dikhawatirkan di rencana awal — `kelurahan-ring.geojson` (8.999 desa,
simplify 250 m) keluar ~3,2 MB, sebanding dengan `kecamatan.geojson` (654 kecamatan)
~3,0 MB, karena toleransi simplifikasi mendominasi ukuran berkas jauh lebih besar
daripada jumlah fitur. `S.districtNames`/`districts()` TIDAK dihapus — tetap dipakai
kolom "Kecamatan" di Master Kelurahan, sama sekali lepas dari perubahan ini.

## [2026-08-31] Kota/dealer/pos dibalik jadi eksklusif — membatalkan keputusan 2026-08-30

**Konteks:** Entri 2026-08-30 di atas ("kota/dealer/pos jadi tiga slot independen")
baru saja membuat ketiga filter lingkup bisa aktif bersamaan (di-AND-kan), atas
permintaan tim waktu itu untuk panel ringkasan gabungan kota+dealer. Sehari kemudian,
Pakbos secara eksplisit meminta SEBALIKNYA: dari empat filter (periode, kota, dealer,
pos), cuma periode yang selalu bisa diubah bebas — kota/dealer/pos wajib cuma SATU
yang aktif, dan berpindah di antara ketiganya wajib mereset yang sebelumnya.
**Keputusan:** `setScope(kind, code, force)` di `frontend/js/filters.js` membuang
kedua slot lain begitu satu slot diisi (`value !== 'ALL'`). `clearScope()` TIDAK
berubah (tetap bisa target satu slot atau semuanya). Kares (entri di atas) TIDAK
termasuk kelompok eksklusif ini — Pakbos cuma menyebut kota/dealer/pos sebagai trio
yang eksklusif, Kares tetap mandiri seperti Provinsi sebelumnya.
**Alasan:** Permintaan langsung, eksplisit, dan berulang dari Pakbos — bukan
interpretasi atau asumsi. CLAUDE.md: "Baca ROADMAP... DECISIONS waktu hendak mengubah
keputusan arsitektur" — entri ini SENGAJA menyebut pembalikannya secara eksplisit,
bukan diam-diam menimpa entri 2026-08-30 (yang dibiarkan utuh di atas sebagai jejak
kenapa arahnya sempat berbeda).
**Alternatif yang ditolak:** Tidak ada — permintaan Pakbos tidak memberi ruang
alternatif (bukan pertanyaan desain, tapi aturan bisnis yang diminta tegas).
**Konsekuensi:** Panel ringkasan gabungan kota+dealer yang jadi alasan entri
2026-08-30 (kalau ada UI yang bergantung padanya) TIDAK lagi bisa menampilkan kedua
filter aktif bersamaan. `test/filters.test.js` dibalik LAGI: yang sejak 2026-08-30
menguji KEDUANYA TETAP AKTIF sekarang menguji SALING MENGOSONGKAN.

## [2026-08-31] Blok Performa Pos Dealer: metrik ring gantikan radius, field baru ditambah

**Konteks:** Blok "Analisis Performa Pos Dealer" sejak awal menampilkan %dalam/luar
RADIUS jangkauan per pos (dihitung server dari irisan luas kelurahan dengan lingkaran
radius, `backend/core/coverage.js`). Pakbos minta blok ini dirombak: metrik radius
diganti %ring 1/2/3/luar-ring (dari penetapan manual, lihat entri ring di atas), dan
ditambah %Sales Contribution, Kelompok Relative Position, dan Kelompok Business
Reference per pos.
**Keputusan:** `performanceByOutlet()` di `render.js` diganti total untuk metrik
per-baris (ring, bukan radius) dan ditambah tiga field baru — dihitung lewat fungsi
BARU tapi murni di `sales-stats.js` (`contributionsByOutlet`, `businessReferenceGroup`,
`outletRingSplit`), me-reuse mesin klasifikasi yang SAMA dengan kelurahan
(`percentileBreaks`/`classOf`/`relativePosition`/`referenceGap`) — bukan mesin baru,
cuma input per-outlet. Basis kontribusi: relatif terhadap TOTAL SELURUH POS yang
tampil di filter aktif (dikonfirmasi eksplisit ke pengguna), bukan sesama dealer saja.
`coverageSummary()` (ringkasan "Dalam radius X km" di atas daftar) SENGAJA TIDAK
diubah — radius/`coverage.js` tetap ada dan tetap dipakai di situ; cuma metrik PER
BARIS pos yang berganti ke ring.
**Alasan:** Permintaan eksplisit Pakbos, dengan klarifikasi basis kontribusi
dikonfirmasi langsung (bukan diasumsikan) sebelum dikerjakan.
**Alternatif yang ditolak:** Basis kontribusi relatif terhadap dealer induk saja —
ditawarkan sebagai opsi, ditolak pengguna demi konsistensi dengan treemap "Per Pos".
**Konsekuensi:** `splitByCoverage`/radius TIDAK lagi dipakai di baris performa pos
(tetap dipakai `coverageSummary()` dan kartu rekap dealer, TIDAK dihapus — lihat
CLAUDE.md soal `coverage.js`). Blok dipindah lokasinya di halaman (baris penuh di
bawah Proporsi Penjualan, bukan lagi kartu di sisi treemap) supaya field baru yang
lebih banyak muat tanpa terpotong.

## [2026-08-31] Legenda peta: istilah Inggris HANYA di legenda, mode heatmap otomatis ikut filter Kota

**Konteks:** Legenda heatmap (persentil "Terbawah...Teratas" + interval tetap 6 kelas)
diminta Pakbos berganti istilah ("No Sales", "bottom"..."top", judul "Dynamic/Static
Relative Tiering..."), dan mode "Per Nilai Kontribusi" (kini "Static") diminta
otomatis aktif waktu filter Kota dipilih.
**Keputusan:** Label baru (`MAP_TIER_LABEL` di `render.js`) HANYA dipakai di legenda
peta — TIDAK menimpa `POSISI_LABEL` (Terbawah/Bawah/Tengah/Atas/Teratas) yang dipakai
di badge kelurahan, ringkasan kota, dan blok Performa Pos Dealer (dikonfirmasi
eksplisit: dua istilah berbeda untuk konsep yang sama, disengaja). Mode Static
sekaligus disederhanakan dari 6 jadi 5 kelas (kelas "0,081–1%" dan "Lebih dari 1%"
lama digabung jadi satu "top" di atas 0,08%) supaya jumlah baris legenda (5+no-sales=6)
sama dengan mode Dynamic. Auto-switch mode (`S.heatmapMode`) ditaruh di
`setScope()`/`clearScope()` di `filters.js` — BUKAN di `renderAll()` — supaya toggle
manual pengguna tidak ketiban reset di setiap render biasa, cuma waktu filter KOTA-nya
sendiri yang berubah.
**Alasan:** Permintaan eksplisit Pakbos untuk istilah dan perilaku otomatis; cakupan
istilah baru (cuma legenda, bukan global) dikonfirmasi langsung ke pengguna sebelum
dikerjakan untuk menghindari dua rombakan (istilah lalu dibalik lagi).
**Alternatif yang ditolak:** Mengganti `POSISI_LABEL` di semua tempat jadi istilah
Inggris — ditawarkan, ditolak pengguna. Mode Static dikunci (tidak bisa diganti manual
selagi filter Kota aktif) — ditawarkan, ditolak pengguna, override manual tetap jalan.
**Konsekuensi:** Ada DUA istilah berbeda untuk hal yang sama (persentil kontribusi)
di dashboard yang sama — legenda peta bilang "bottom", panel kelurahan bilang
"Terbawah" — disengaja, bukan inkonsistensi yang terlewat.

## [2026-08-31] Blok baru "Analisis Penjualan Wilayah": basis kontribusi generik atas activeRows()

**Konteks:** Permintaan Pakbos putaran ketiga: blok baru per DESA (nama desa,
kecamatan/kota, total sales, %kontribusi, posisi relatif), auto-looping sendiri,
menggantikan blok Performa Pos Dealer di panel kiri layar penuh peta KHUSUS waktu
filter dealer/pos aktif (default/filter kota tetap Performa Pos Dealer), dan SELALU
tampil sebagai blok tambahan di halaman biasa.
**Keputusan:** `contributionsByOutlet` (Bagian B1) diekstrak jadi pemanggil helper
generik `contributionsByField(rows, field)`, dipakai juga oleh `contributionsByVillage`
yang baru. %Kontribusi dan Posisi Relatif desa dihitung relatif terhadap
`activeRows()` APA ADANYA — BUKAN relatif terhadap kotanya sendiri seperti
`villageStats()` yang sudah ada untuk panel kelurahan. Panel kiri layar penuh peta
(satu slot) dibagi dua grup HTML yang saling toggle `hidden`
(`syncFullscreenPanels()` di `render.js`) berdasar `scopeValue('dealer')`/`scopeValue('pos')`.
Auto-loop dijaga DUA state terpisah (`S.liveWilayah`, `S.liveWilayahPaused`) supaya
render ulang yang sering (`renderAll()`) tidak menyalakan lagi interval yang sengaja
dihentikan orang lewat tombol Pause.
**Alasan:** Basis "relatif terhadap activeRows()" dipilih (bukan per-kota seperti
villageStats) karena `activeRows()` SUDAH otomatis sempit ke dealer/pos yang
difilter waktu itu yang aktif — jadi "kontribusi desa terhadap dealer/pos yang
dipilih" didapat gratis dari satu fungsi generik, tanpa percabangan kota/dealer/pos
yang terpisah. Dikonfirmasi eksplisit ke pengguna sebelum dikerjakan (dua opsi basis
ditawarkan langsung).
**Alternatif yang ditolak:** Basis kontribusi per-kota sendiri (pola `villageStats()`
yang sudah ada) — ditawarkan, ditolak pengguna. Auto-loop manual (pola tombol Live
yang sama seperti blok Performa Pos) — tidak ditawarkan sebagai alternatif karena
permintaan Pakbos eksplisit menyebut "auto looping", tapi arah tombolnya (Pause vs
Live sebagai titik mulai) tetap dikonfirmasi terpisah.
**Konsekuensi:** Blok ini TIDAK punya versi "tampilan besar" (modal) seperti Performa
Pos Dealer — cuma normal (`bodyWide`) dan layar-penuh-peta (`bodyCompact`). Sort-nya
TETAP (terendah→tertinggi, tanpa tombol balik arah) — beda dari blok Performa Pos
yang punya tombol urut, karena tujuannya beda (memantau berjalan, bukan mencari yang
paling bermasalah dulu).

## [2026-08-31] Titik dealer di peta jadi segitiga, bukan lingkaran

**Konteks:** Setelah titik dealer baru (entri Bagian D di atas) dipakai sungguhan,
Pakbos minta bentuknya diubah jadi segitiga supaya lebih mudah dibedakan dari titik
pos sekilas pandang, tanpa perlu membaca ukuran/warnanya dulu.
**Keputusan:** `.marker-outlet.dealer` (frontend/styles/app.css) dipotong `clip-path:
polygon(50% 0%, 0% 100%, 100% 100%)` dan `border-radius:0`, menimpa bentuk bulat dari
`.marker-outlet` dasar. Ikon di dalamnya (`ph-buildings`) dibiarkan, cuma digeser
sedikit (`padding-top`) supaya tidak terlalu mepet ke alas segitiga.
**Alasan:** Permintaan eksplisit Pakbos.
**Konsekuensi:** `npm run css` WAJIB dijalankan ulang tiap kali kelas Tailwind baru
dipakai di template literal JS yang belum pernah muncul di file lain — ini bug KEDUA
sesi ini yang disebabkan lupa langkah ini (yang pertama: `grid-cols-5` di board
performa, Bagian B). Dicatat di sini supaya sesi berikutnya tidak mengulanginya lagi.

## [2026-08-31] Ringkasan "Dalam radius" diganti ringkasan kontekstual per filter

**Konteks:** Permintaan Pakbos putaran keempat: ringkasan di atas daftar Performa Pos
Dealer (sebelumnya selalu "Dalam radius X km", radius-based) diminta berganti isi
menurut filter yang sedang aktif — Kota/Semua (jumlah desa, total sales, AVG
kontribusi, AVG posisi relatif), Dealer (+jumlah pos dealer, +AVG acuan bisnis), Pos
(total penjualan pos + jumlah desa & %kontribusi per ring 1/2/3).
**Keputusan:** `coverageSummary()` (radius-based) DIHAPUS, diganti `scopeSummary()`
yang bercabang tiga (`baseScopeSummary`/`dealerScopeSummary`/`posScopeSummary`) atas
`scopeValue('pos')`/`scopeValue('dealer')`. Kota dan Semua SENGAJA lewat fungsi yang
SAMA (`baseScopeSummary`) — `activeRows()` sudah otomatis mempersempit isi `rows`
tanpa perlu kode bercabang terpisah. `villageSalesRows()` (Bagian H2) diubah
mengembalikan `{list, breaks}` (bukan cuma array) supaya "AVG Posisi Relatif" bisa
diklasifikasikan pakai `breaks` yang PERSIS SAMA dipakai tiap baris di blok
Penjualan Wilayah — dikonfirmasi user: AVG posisi relatif = klasifikasikan RATA-RATA
%kontribusi, bukan rata-rata dari lima label kategorikal (yang tidak bermakna
matematis). AVG Acuan Bisnis = rata-rata SELISIH (`referenceGap`, poin persentase,
bisa plus/minus) — dikonfirmasi user, bukan rata-rata rasio.
**Alasan:** Permintaan eksplisit Pakbos; basis perhitungan (klasifikasi rata-rata,
bentuk AVG Acuan Bisnis) dikonfirmasi langsung sebelum dikerjakan karena "AVG posisi
relatif" atas data kategorikal tidak punya definisi tunggal yang jelas.
**Alternatif yang ditolak:** Ringkasan disembunyikan sama sekali waktu filter
"Semua" — ditawarkan, ditolak pengguna (dipilih tampil dengan bentuk sama seperti
Kota, cuma cakupan datanya seluruh project).
**Konsekuensi:** `splitByCoverage`/`S.radiusM`/`coverage.js` TIDAK dihapus — masih
dipakai `dealerCardHtml()` dan tooltip kelurahan (`outlets.js`), SEKARANG diam-diam
terkunci ke default 5000 m karena pemilih radiusnya sendiri dihapus (lihat entri
berikutnya) — pengguna tidak lagi bisa mengubahnya dari UI. Kalau dua tempat itu
ternyata juga perlu ikut berubah, itu permintaan terpisah, bukan diasumsikan di sini.

## [2026-08-31] Radius jangkauan (3/5/7/10 km) dan Lingkaran Radius dihapus total, diganti Tampilkan Ring

**Konteks:** Permintaan Pakbos: pemilih radius jangkauan di Opsi Peta ("radius full
hilang") diganti pilihan tampilan Ring 1/2/3 — menyorot desa yang termasuk ring itu
milik pos yang sedang dipilih di peta, bukan lagi lingkaran geometris di sekitarnya.
**Keputusan:** Toggle "Lingkaran Radius" (`opt-radius`), blok pemilih "Radius
jangkauan" (`pilihan-radius`/`label-radius`), lapisan `radius-isi`/`radius-garis`,
fungsi `setRadius()`, dan pemanggilan `circle()` di `redrawMap()` DIHAPUS BERSIH dari
`map.js`/`app.js`/`index.html` (bukan cuma disembunyikan) — dikonfirmasi lewat
`test/page.test.js` yang secara eksplisit menegaskan ketiadaannya. Diganti
`setRingView(ring)`/`paintRingView()` (`map.js`) — berbagi lapisan `kel-ring-*` yang
SAMA dengan mode edit ring (Bagian D3), lazy-load sekali dipakai dua mode. Klik ring
yang sudah aktif mematikannya (pola sama seperti `setScope()`).
**Alasan:** Permintaan eksplisit Pakbos, dengan perilaku tampilan (menyorot desa milik
pos terpilih, bukan sekadar mengganti nama tombol) dikonfirmasi langsung.
**Konflik yang harus dijaga:** `paintRingView()` (lihat-saja) dan `setRingPaint(draft)`
(edit, Bagian D3) berbagi layer `kel-ring-isi`/`kel-ring-garis` yang SAMA — kalau
dua-duanya menulis di layer itu dalam satu saat, salah satu bisa menimpa yang lain
tanpa peringatan (draft yang sedang disunting bisa "hilang" secara visual). Dijaga
dua arah: `paintRingView()` diam total selagi `window.ringEditing()` true (dicek di
awal fungsi), dan `startRingEditFor()` mematikan `S.ringView` begitu masuk mode edit.
`redrawMap()` (jalan tiap `renderAll()`) memanggil `paintRingView()` supaya ganti pos
otomatis memperbarui sorotan — INI JUGA berarti kalau proteksi di atas lupa
dipasang, sorotan lihat-saja akan menimpa draft edit berkali-kali per detik, bukan
kejadian langka yang gampang terlewat waktu menguji.
**Konsekuensi:** `S.radiusM`/`S.coverageAll`/`S.radiiM` TETAP ADA di state.js (dipakai
`dealerCardHtml()`/tooltip, lihat entri di atas) tapi TIDAK LAGI ada UI yang
mengubahnya — nilainya diam-diam tetap di default 5000 m selamanya kecuali kode lain
mengubahnya secara terprogram. `circle()` di `geo.js` TIDAK dihapus (fungsi geometri
generik, diuji terpisah di `test/geo.test.js`, dan CLAUDE.md tidak melarang
menyimpan utilitas murni yang sedang tidak dipakai) — cuma pemanggilnya di `map.js`
yang hilang.

## [2026-08-31] Ring pindah ke DEALER+kecamatan, Coverage baru milik POS (1-8)

**Konteks:** Pagi hari yang sama, ring dipindah dari kecamatan ke kelurahan (per
outlet) atas permintaan Pakbos — lihat entri "Ring per pos, per kelurahan"
sebelumnya. Sore harinya datang permintaan lanjutan yang MEMBALIK arah itu lagi,
tapi bukan pembatalan: alasannya satu DEALER menaungi banyak POS sekaligus, jadi
kecamatan (bukan kelurahan yang terlalu detail) pas untuk level dealer, sementara POS
sendiri mendapat konsep baru — coverage, 8 slot bukan 3, karena satu POS bisa
melayani kecamatan lebih beragam daripada satu ring dealer.

**Keputusan:**
- `outlet_rings` (per outlet, per kelurahan, ring 1-3) **DIHAPUS TOTAL** lewat
  `DROP TABLE IF EXISTS` di `schema.sql`. Data ring versi kelurahan yang baru saja
  dipulihkan dari cadangan pagi itu **sengaja tidak diturunkan** ke skema baru.
- `dealer_rings` (dealer_code, district_code, ring 1-3) menggantikannya.
- `pos_coverage_district` (outlet_code, district_code, coverage_num 1-8) — konsep
  BARU, bukan penggantian nama dari tabel `coverage` (radius PostGIS lama, tetap
  dipertahankan terpisah, lihat entri-entri sebelumnya soal itu).
- Backend: `repo.saveDealerRings`/`allDealerRings` dan `repo.savePosCoverage`/
  `allPosCoverage` menggantikan `saveOutletRings`/`allRings`, pola replace-penuh
  yang sama. Rute `PUT /dealers/:code/rings` dan `PUT /outlets/:code/coverage`
  menggantikan `PUT /outlets/:code/rings`.
- Frontend: `frontend/js/rings.js` digeneralisasi jadi satu mesin
  (`createGroupEditor`) dipakai dua instance (dealer-ring 3 slot, pos-coverage 8
  slot) — dijustifikasi karena alur draft/pemilih/simpan ~200 baris identik di
  keduanya, menduplikasi berarti merawat dua salinan yang harus tetap sinkron.
  `map.js`: layer `kel-ring-*` (khusus edit ring versi kelurahan) dihapus total,
  digantikan `kec-isi` — satu layer fill baru di source `kec` yang sudah ada
  (dipakai bersama referensi visual kecamatan `kec-garis`/`kec-nama`). Opsi peta
  "Tampilkan Ring" (3 tombol) diganti dua grup: "Tampilan Ring Dealer" (Lokasi,
  Ring 1-3, aktif hanya waktu scope=dealer) dan "Tampilan Coverage POS" (Lokasi,
  Cov 1-8, aktif hanya waktu scope=pos) — nonaktif/pudar dijaga
  `syncGroupControls()`, dipanggil tiap `setScope()` lewat `window` (pola sama
  seperti `syncHeatmapModeButtons`, menghindari impor melingkar filters.js↔map.js).
- Agregasi: `sales-stats.js` `outletRingSplit()` (3 slot, per-outlet) diganti
  `groupSplit()` (generik N slot, dipakai coverage pos 8-slot) dan `dealerRingSplit()`
  (BARU — Ring 1/2/3 dealer + "Coverage gabungan" yaitu union kecamatan dari seluruh
  coverage POS cabangnya). **Kalau satu kecamatan masuk ring DAN coverage gabungan
  sekaligus, RING MENANG** — dikonfirmasi eksplisit ke pengguna, coverage gabungan
  cuma menampung kecamatan yang tidak masuk ring manapun.
- Master Dealer (`tables.js`) mendapat 3 kolom Ring + tombol "Ring" baru; Master Pos
  Dealer KEHILANGAN 3 kolom Ring lama, mendapat 1 kolom "Coverage" ringkas (8 slot
  tidak muat sebagai kolom terpisah) + tombol "Coverage" menggantikan tombol "Ring".

**Alasan:** Permintaan eksplisit pengguna, dikonfirmasi lewat serangkaian pertanyaan
sebelum implementasi (level ring/coverage, cara mengatasi tumpang tindih, cara
menyelesaikan nama kecamatan yang ambigu di sumber Excel).

**Data seed baru** (`scripts/import-dealer-pos-rings.js`, skrip baru): mengimpor
Master Dealer (78 baris) dan Master Pos (109 baris) dari
`Dealer & POS (dgn koordinat dealer).xlsx` (sheet "Dealer" dan "POS"), ring dealer
dari `Ring dealer.xls` (format BINER LAMA — perlu dependency baru `xlsx`/SheetJS
karena `exceljs` gagal DIAM-DIAM atas format ini, `worksheets.length === 0` tanpa
error), dan coverage POS dari kolom "KEC COVER 1-8" sheet POS yang sama.

**Temuan penting yang mengubah desain skrip di tengah jalan:**
1. `outlets.outlet_code` LAMA (level cabang, ~55-79 kode, dipakai 9.949 baris
   penjualan dari cadangan pagi) TIDAK SEKELUARGA dengan level yang diminta sekarang
   (109 POS fisik, kolom "Kode POS OCEAN"). Dikonfirmasi & diterima pengguna: skrip
   ini **mengosongkan** `sales`/`unmatched`/`coverage`/`outlets` (bukan
   `astra_customers`) sebelum menulis ulang — sama seperti tombol "Reset" di Master
   Pos Dealer. Penjualan sungguhan perlu diimpor ulang lewat halaman Import Data
   sesudahnya, memakai kode pos baru. Sistem input penjualan PER-POS sendiri belum
   ada (dikonfirmasi pengguna) — baru akan dikembangkan setelah format database ini
   dianggap final.
2. Kolom "Nama Dealer System" di sheet Dealer ternyata nama level CABANG
   ("NUSANTARA SAKTI - GEJAYAN"), bukan nama perusahaan induk — sempat salah
   memakai `guessDealerName()` (memotong " - GEJAYAN") sehingga 78 baris cuma
   menghasilkan 51 dealer_code unik. Diperbaiki: dealer_code diturunkan dari NAMA
   UTUH (cuma awalan badan usaha PT/CV/dst. yang dilucuti oleh `coreDealerName()`
   baru di skrip ini).
3. Sheet POS dan sheet RING cuma menyebut nama PERUSAHAAN INDUK ("PT. NUSANTARA
   SAKTI"), bukan cabang spesifik — tidak cukup untuk mencocokkan ke salah satu dari
   78 dealer_code. Diselesaikan lewat kolom "Kode Dealer"/"Kode AHM Dealer" NUMERIK
   yang ternyata identik di ketiga sheet (diverifikasi: seluruh kode di POS dan RING
   ada persis di antara 78 kode Dealer, nol yang hilang) — dealer diselesaikan lewat
   kode itu, bukan menebak nama.
4. `backend/core/region.js` mendapat `coreCityName()` baru: melucuti awalan
   "Kabupaten"/"Kab."/"Kota"/"Kotamadya" dari KEDUA sisi (teks Excel maupun
   `villages.city_name`) supaya "Kab. Sleman" bertemu "Kabupaten Sleman" tanpa tabel
   alias. Satu alias sumber-spesifik ditulis eksplisit di skrip: "KODYA" (singkatan
   lama untuk kotamadya) dipakai sendirian tanpa nama kota di berkas Ring, dan di
   cakupan Jateng+DIY cuma berarti Kota Yogyakarta.
5. `backend/core/excel-coords.js` (baru): `cellText()` dan `parseLongLat()`
   dipindahkan dari `scripts/fill-pos-coordinates.js` ke modul bersama ini —
   dipakai juga oleh skrip baru, sekarang tidak digandakan.

**Alternatif yang ditolak:** Mempertahankan `outlets.outlet_code` level cabang lama
(79 kode) supaya 9.949 baris penjualan cadangan tetap tersambung — ditolak eksplisit
oleh pengguna karena permintaan asli memang 109 POS fisik, dan data penjualan
cadangan itu sendiri levelnya cuma dealer (tidak ada informasi POS), jadi tidak ada
yang hilang secara bermakna.

**Konsekuensi:**
- Dependency baru `xlsx` (SheetJS) di `package.json`. **Catatan keamanan belum
  selesai:** `npm audit` melaporkan kerentanan HIGH (Prototype Pollution, ReDoS) di
  paket ini TANPA PERBAIKAN tersedia dari registry npm. Risikonya kecil selama
  pemakaiannya cuma skrip CLI sekali-jalan yang dijalankan manual terhadap berkas
  lokal tepercaya (bukan bagian server yang menerima input dari luar) — tapi ini
  BELUM diverifikasi ulang secara berkala dan perlu dipantau kalau SheetJS merilis
  versi terbaru di registry sendiri (di luar npm).
- Peta akan KOSONG (tanpa data penjualan) sampai data bulan berjalan diimpor ulang
  lewat Import Data dengan kode pos yang baru.
- 17 nama kecamatan di kolom KEC COVER sheet POS tidak cocok/ambigu (kemungkinan
  salah ketik di sumber, mis. "KALOGONDANG" vs kemungkinan "Kaligondang") —
  dilaporkan skrip, TIDAK ditulis ke `pos_coverage_district`, menunggu perbaikan
  manual di Excel sumber lalu impor ulang.
- **Belum diverifikasi visual di browser** oleh manusia — API dan test suite (26/26
  hijau) sudah dicek, tapi klik-per-klik UI baru (editor ring dealer, editor
  coverage pos, dua grup Opsi Peta, tombol quick-access) belum pernah dicoba di
  browser sungguhan. Ini yang paling perlu dicek berikutnya.
- Tidak ada tes otomatis untuk `scripts/import-dealer-pos-rings.js` sendiri (beda
  dari `scripts/fill-pos-coordinates.js` yang punya `test/fill-pos-coordinates.test.js`)
  — diverifikasi manual terhadap berkas Excel sungguhan sampai hasilnya bersih
  (78/78 dealer, 109/109 pos, 0 dealer tidak dikenal), tapi belum ada jaring
  pengaman otomatis kalau ada yang mengubah skrip ini nanti.

## [2026-08-31] Outlet "proxy dealer": penjualan bulanan tersambung ke dealer, bukan pos fisik

**Konteks:** Begitu Master Pos Dealer pindah ke 109 kode fisik (entri di atas),
pengguna mengimpor ulang Excel penjualan bulanan sungguhan lewat Import Data.
Excel itu ternyata cuma menyebut identitas level DEALER (kolom "Kode Dealer",
dipakai sejak awal proyek ini sebagai `COLUMN.outletCode` di
`backend/core/aggregate.js` — lihat komentarnya sendiri: "Kolom 7 diberi judul
'Kode Dealer', tapi isinya kode OUTLET"). Levelnya tidak sekeluarga dengan 109
kode fisik baru, jadi importer bulanan menebak semuanya sebagai "outlet baru".

**Bug kedua yang ikut ketahuan, DIPERBAIKI:** `readXlsx()` di
`backend/server/importer.js` cuma membuka sel rich-text ExcelJS (`.text`), tidak
pernah membuka sel FORMULA (`{formula, result}`). Kolom nama dealer di Excel
sungguhan berisi rumus `VLOOKUP`, jadi tiap nama yang "baru" tertulis sebagai
teks literal `"[object Object]"` ke `dealers`/`outlets` — itulah asal tulisan
"[object Object]" di kolom "Pos Dealer" pada Data Konsumen (bukan bug tampilan;
`esc()` cuma menampilkan apa adanya string yang memang sudah rusak sejak
ditulis ke database). `backend/core/excel-coords.js` `cellText()` diperluas
menangani DUA bentuk sel (formula DAN rich-text sekaligus, sebelumnya cuma satu
di tiap sisi — `excel-coords.js` cuma formula, `importer.js` inline cuma
rich-text) dan `readXlsx()` sekarang memanggilnya, bukan ternary sendiri.

**Keputusan:** Bukannya mengubah skema `sales`/`customers` (dipakai banyak
tempat — JOIN dealer, coverage, filter scope 'pos'), satu baris `outlets`
"proxy" dibuat PER DEALER, dikunci ke `dealers.legacy_code` (kolom baru — kode
"Kode Dealer" numerik dari sheet Dealer, mis. "11506", beda dari `dealer_code`
turunan nama). `sales.outlet_code`/`customers.outlet_code` yang levelnya
memang dealer langsung cocok ke baris proxy ini TANPA impor ulang — JOIN
dealer, KPI, dan panel yang sudah ada semua tetap jalan apa adanya. Baris
proxy `lat`/`lng` sengaja `NULL` (bukan koordinat dealer) supaya tidak pernah
jadi pin ganda di peta (`drawMarkers()` sudah `if (outlet.lat == null) return;`).
Ditandai kolom baru `outlets.is_dealer_proxy`, disembunyikan dari katalog
Master Pos Dealer (`S.realOutlets` di `frontend/js/app.js`, dipakai
`renderOutletTable()` dan dropdown filter Pos) dan dari hitungan "Jumlah Pos"
(`listDealers()` — `COUNT(...) FILTER (WHERE NOT is_dealer_proxy)`), TAPI
tetap ada di `S.outletByCode`/`S.outlets` penuh supaya nama dealer tetap
resolve benar di kolom "Pos Dealer" dan filter Data Konsumen per dealer.

`scripts/import-dealer-pos-rings.js` mendapat Fase D (upsert 78 baris proxy,
sekaligus MEMPERBAIKI baris `outlet_name='[object Object]'`/
`dealer_code='OBJECTOBJECT'` yang sudah terlanjur tertulis — `ON CONFLICT DO
UPDATE` menimpa in-place, tidak perlu DELETE yang akan gagal kena FK selama
`sales` masih menunjuknya) dan flag baru `--no-reset` (lewati blok RESET
supaya bisa memperbaiki Master Dealer/Pos tanpa membuang sales/customers yang
sudah diimpor). Kolom Kel/Kec (F/G) sheet POS, yang sebelumnya sama sekali
tidak dibaca, sekarang dipakai mencari kabupaten POS ITU SENDIRI — diutamakan
di atas kabupaten dealer induk waktu menyaring kandidat kecamatan KEC COVER
1-8 (satu dealer bisa punya POS di kabupaten tetangga yang berbeda).

**Alasan:** Permintaan eksplisit pengguna ("connect ke dealer, bukan pos,
sebab data import saat ini hanya terkoneksi dengan kode dealer") — sistem
input penjualan PER-POS memang belum ada, direncanakan dikembangkan nanti
setelah format database final. Proxy outlet dipilih daripada mengubah skema
`sales` karena jauh lebih kecil blast radius-nya — nol perubahan di
`aggregate.js`, `dealerBreakdown()`, `coverage-store.js`, filter scope 'pos',
dan seluruh JOIN yang sudah ada.

**Alternatif yang ditolak:** Mengubah `sales`/`customers` menambah kolom
`dealer_code` dan melonggarkan `outlet_code` jadi nullable — ditolak, blast
radius jauh lebih besar (menyentuh PK `sales`, semua JOIN outlets, dan
importer bulanan) untuk manfaat yang sama persis dengan pendekatan proxy yang
jauh lebih kecil perubahannya.

**Konsekuensi:**
- `outlets` sekarang berisi DUA JENIS baris dengan tujuan berbeda: 109 pos
  fisik sungguhan, dan 78 proxy dealer. Kode mana pun yang membaca `S.outlets`/
  `outlets` langsung (bukan lewat `S.realOutlets`) HARUS sadar bisa dapat baris
  proxy — sudah diperiksa satu per satu (peta, performa pos, filter konsumen per
  dealer semuanya SENGAJA tetap memakai daftar penuh; lihat komentar di kode).
- `scripts/export-geo.js` di folder proyek AKTIF (`...\astra-command-center\
  astra-command-center\astra-command-center`) ternyata TERTINGGAL dari
  perbaikan `kota.geojson` 404 sesi sebelumnya (perbaikan itu sempat dilakukan
  di folder LUAR yang salah, sebelum ketahuan proyek sudah pindah ke clone git
  di dalam folder itu sendiri) DAN dari pembersihan `tulisKelurahanRing()`
  (fitur edit-ring-per-kelurahan sudah diganti ring-dealer-per-kecamatan sore
  itu juga). Dua-duanya diperbaiki sekalian di sesi ini: `tulisKota()`
  ditambahkan lagi, `tulisKelurahanRing()`/`kelurahan-ring.geojson` dihapus
  (tidak ada lagi yang memakainya).
- Tes baru: `test/excel-coords.test.js` (cellText dua bentuk sel), kasus
  formula tambahan di `test/xlsx.test.js`, kasus `outlets.is_dealer_proxy` di
  `test/dealers-crud.test.js`. `npm test` 27/27 hijau.
- **Belum diverifikasi visual di browser** — API dicek lewat curl (Data
  Konsumen, Master Dealer, Master Pos semua mengembalikan nilai yang benar),
  tapi belum diklik langsung di browser sungguhan.

## [2026-08-31] Ringkasan atas halaman Insight jadi kontekstual per filter

**Konteks:** Blok ringkasan paling atas halaman Insight selalu menampilkan 4
kartu tetap (Dealer Aktif, Total Penjualan, Kelurahan Terlayani, Kelurahan
Kosong) tidak peduli filter apa yang aktif — tidak berubah walau pengguna
sedang melihat satu kota, satu dealer, atau satu pos tertentu.

**Keputusan:** Blok diganti jadi kontekstual, isinya beda per level filter
aktif (fungsi baru `topScopeSummary()` di `frontend/js/render.js`):
- Filter Kota (atau tanpa filter): Jumlah Desa, Total Penjualan, AVG Kontribusi
  Desa, AVG Posisi Relatif Desa (`baseScopeSummary()`, sudah ada sebelumnya).
- Filter Dealer: field di atas ditambah Jumlah Pos Dealer, AVG Acuan Bisnis
  Desa, lalu pecahan Ring 1/2/3 + Coverage gabungan (fungsi baru
  `dealerScopeBaseCells()` dipakai bareng oleh kartu atas ini DAN panel
  jangkauan yang sudah ada, supaya logika sel dealer tidak dobel ditulis).
- Filter Pos: Total Penjualan Pos + pecahan Coverage 1-8, masing-masing dengan
  jumlah desa dan persen kontribusi (`posScopeSummary()`, sudah ada
  sebelumnya, dipakai apa adanya).

Disusun satu baris (`summaryGridHtml()`, grid CSS bukan flex) supaya jumlah
kartu yang beda-beda per filter tetap rapi tanpa perlu markup terpisah per
skenario.

**Alasan:** Permintaan eksplisit pengguna — kartu KPI tetap tidak relevan
begitu pengguna sudah mempersempit ke satu dealer/pos tertentu (Total Penjualan
se-Indonesia tidak berguna waktu sedang melihat satu pos), dan sebaliknya
field khusus ring/coverage baru tidak pernah muncul di titik masuk paling
utama halaman.

**Konsekuensi:** `renderKpi(rows, perVillage)` (fungsi lama, 4 kartu statis)
dihapus total, diganti `renderTopSummary(rows)`. Markup 4 `.stat-card` di
`frontend/index.html` diganti satu `<div id="ringkas-utama">` kosong yang
diisi lewat JS; kelas CSS `.stat-card`/`.stat-card:hover` yang jadi tidak
dipakai lagi ikut dihapus dari `frontend/styles/app.css` (`npm run css`
dijalankan ulang). `npm test` tetap 27/27 hijau setelah perubahan ini.

## [2026-08-31] Grid ringkasan: `auto-fill` diganti `auto-fit` supaya tidak menyisakan ruang kosong

**Konteks:** Setelah perubahan di atas, blok ringkasan atas (kartu lebih
sedikit di skenario kota/pos dibanding dealer) menyisakan ruang kosong di
ujung kanan baris pada layar lebar — sel-selnya rata kiri, tidak melebar
mengisi baris.

**Keputusan:** `summaryGridHtml()` di `frontend/js/render.js` (dipakai
bersama oleh `#ringkas-utama` dan panel jangkauan `#ringkas-jangkauan` yang
sudah ada) — `grid-template-columns:repeat(auto-fill,minmax(84px,1fr))`
diganti `auto-fit`.

**Alasan:** Beda perilaku dua kata kunci CSS Grid ini: `auto-fill` tetap
mencadangkan track kosong seukuran `minmax()` walau tidak ada sel yang
mengisinya (sel yang ADA jadi rata kiri dengan sisa track kosong di kanan);
`auto-fit` meruntuhkan track kosong itu sehingga sel yang ada melebar lewat
`1fr` mengisi baris penuh. Satu kata kunci, tidak perlu breakpoint atau JS
tambahan, dan otomatis berlaku di kedua tempat pemakainya.

**Konsekuensi:** Tidak ada — perubahan CSS murni lewat atribut `style` inline
(bukan kelas Tailwind), jadi tidak perlu `npm run css` ulang. `npm test`
tetap 27/27 hijau. Sama seperti entri di atas, belum diverifikasi visual di
browser sungguhan.

## [2026-08-31] `API_STUB` di `build-offline.js` disamakan lagi dengan `api.js` asli

**Konteks:** `npm run offline-html` (perkakas "save HTML progres" — merakit
seluruh frontend + data database jadi satu berkas HTML mandiri, tanpa server,
untuk didemokan lewat WhatsApp/email) gagal dengan `Pengganti api.js kurang:
fetchDistricts, saveDealerRings, savePosCoverage, resetOutlets, createDealer,
saveDealer, deleteDealer, previewOutletImport, commitOutletImport`. Kesembilan
fungsi itu ditambahkan ke `api.js` asli oleh fitur-fitur sesi ini (ring
dealer/coverage pos, CRUD Master Dealer, impor Master Pos) tapi `API_STUB`
(salinan `api.js` versi offline, dipakai `build-offline.js` supaya berkas
demo tidak butuh server sungguhan) tidak ikut diperbarui.

**Keputusan:** Sembilan fungsi ditambahkan ke `API_STUB`, mengikuti pola yang
sudah ada: `fetchDistricts` (baca) resolve `{ districts: [] }` langsung
(belum ada pemanggilnya di frontend saat ini, jadi array kosong aman); delapan
sisanya (semuanya aksi tulis — simpan ring/coverage, reset outlets, CRUD
dealer, impor master pos) ditolak lewat `tolak()` yang sudah ada, sama seperti
`saveOutlet`/`uploadImport`/dll: berkas demo memang cuma untuk dilihat, bukan
diedit.

**Alasan:** `build-offline.js` sendiri sudah punya pemeriksa (`kurang =
exportsOf(asli).filter(...)`) yang sengaja GAGAL KERAS kalau ada ekspor
`api.js` asli yang tidak disebut di `API_STUB` — supaya modul lain yang
memanggil fungsi hilang itu tidak diam-diam dapat `undefined` di berkas demo.
Tinggal menyamakan daftarnya.

**Konsekuensi:** `npm run offline-html` berhasil lagi (`prototype/astra-offline.html`,
11,7 MB, 3.326 kelurahan · 187 pos · 18.915 unit). `npm test` tetap 27/27
hijau (build-offline tidak ikut test suite, dicek manual lewat run langsung).
Editor ring dealer/coverage pos, tombol reset outlets, dan CRUD Master Dealer
di berkas demo sekarang akan menampilkan pesan "tidak bisa dilakukan di
berkas demo" alih-alih membuat halaman mati diam-diam.

## [2026-08-31] Bawaan Opsi Peta saat halaman dibuka: Satelit + live dashboard performa ikut auto-mulai

**Konteks:** Permintaan eksplisit pengguna soal tampilan bawaan (default) waktu
halaman pertama dibuka. Sebagian besar (nama toggle "Batas dan Nama
Kelurahan/Desa"/"...Kecamatan"/"...Kota", status On/Off Batas Kelurahan/
Kecamatan/Kota, Titik Dealer terpisah dari Titik Pos, Lingkaran Radius)
ternyata **sudah** sesuai permintaan dari perubahan sesi-sesi sebelumnya —
cuma dua yang belum: basemap bawaan dan status live-scroll panel Performa Pos.

**Keputusan:**
- `S.basemap` bawaan `'lokal'` → `'satelit'` (`frontend/js/state.js`). Gaya
  awal MapLibre (`setupMap()`) tetap menyalakan lapisan 'lokal' — diubah lewat
  `setBasemap(S.basemap)` yang dipanggil di dalam penangan `S.map.on('load', ...)`
  (`frontend/js/app.js`), di belakang `pageLoader` supaya tidak ada kedipan
  basemap salah sebelum berpindah. Kelas tombol statis di `index.html`
  (`bm-lokal`/`bm-satelit`) ikut ditukar supaya konsisten dengan JS-nya.
- **Analisis Performa Pos Dealer** kini auto-mulai gulir otomatis begitu ada
  isinya, sama seperti **Analisis Penjualan Wilayah** yang sudah begitu sejak
  awal — permintaan eksplisit "live dashboard ... dan analisis wilayah: on".
  `toggleLivePerforma()` (`frontend/js/render.js`) dipecah jadi
  `startLivePerforma()`/`stopLivePerforma()`/`autoStartPerforma()` mengikuti
  pola persis `startLiveWilayah()`/`autoStartWilayah()` yang sudah ada:
  `S.livePerformaPaused` (state baru, `state.js`) membedakan "belum pernah
  mulai" (auto-start jalan) dari "pengguna menekan Pause" (jangan auto-mulai
  lagi). `renderPerformance()` memanggil `autoStartPerforma()` tiap render,
  sama seperti `renderWilayah()` sudah memanggil `autoStartWilayah()`.
  `closePerformaFull()` (tombol tutup tampilan besar) sengaja memanggil
  `stopLivePerforma()` langsung — BUKAN `toggleLivePerforma()` — supaya
  `livePerformaPaused` tidak ikut ke-set: begitu modal ditutup, panel normal
  yang jadi terlihat harus tetap auto-mulai lagi sendiri, bukan diam menunggu
  tombol Live diklik manual.

**Alasan:** Kedua panel (Performa Pos, Penjualan Wilayah) sama-sama dipakai
sebagai layar proyeksi/tempel di rapat — permintaan pengguna memperlakukan
keduanya setara: berjalan sendiri begitu halaman dibuka, tidak butuh orang
yang berdiri di depan laptop menekan tombol Live dulu.

**Alternatif yang ditolak:** Menyalakan `livePerforma` langsung di `boot()`
sekali di awal — ditolak, karena panel Performa punya TIGA wadah berbeda
(panel biasa, layar penuh peta `fs-performa`, tampilan besar `fp-performa`)
yang bergantian terlihat; auto-start yang digantung ke tiap `renderPerformance()`
(dipanggil ulang tiap kali salah satu wadah itu aktif) lebih kokoh — sama
seperti alasan `autoStartWilayah()` sudah dirancang begitu sebelumnya.

**Ditanyakan, TIDAK diubah:** Warna garis/nama batas Kecamatan (pink
`#db2777`, permintaan pengguna sempat menyebut "ganti warnanya jadi" tanpa
menyebut warna tujuan) — ditanyakan balik, pengguna memilih tetap pink.
Default toggle "Titik Pos" (Off/On tidak disebutkan di permintaan) dibiarkan
seperti sebelumnya (On), simetris dengan Titik Dealer dan Titik Penjualan
yang sama-sama On.

**Konsekuensi:** `npm test` tetap 27/27 hijau — `test/page.test.js` diperluas
dengan pemeriksaan baru: `closePerformaFull` memanggil `stopLivePerforma()`
dan TIDAK menandai `livePerformaPaused`, `stopLivePerforma`/`autoStartPerforma`
punya isi yang benar. **Belum diverifikasi visual di browser** — termasuk
basemap yang benar-benar tampil Satelit saat halaman dibuka, dan kedua panel
live-scroll benar-benar bergulir sendiri tanpa diklik.

## [2026-08-31] Kartu dealer/pos di peta diganti metrik kontribusi; navbar disederhanakan jadi 4 tombol + flyout Master

**Konteks:** Permintaan pengguna, empat bagian sekaligus (direncanakan lewat
Plan Mode, tiga agen Explore paralel menelusuri kode sebelum menulis
rencana): (1) kartu info dealer/pos di peta (`#kartu-dealer`/`#fs-kartu`)
isinya diganti dari trio lama berbasis radius (Total/%dalam jangkauan/%luar
jangkauan) jadi metrik kontribusi/posisi relatif/acuan bisnis yang sudah
dipakai di panel lain, plus pecahan ring (dealer)/coverage (pos); (2) blok
Analisis Performa Pos Dealer & Analisis Penjualan Wilayah di halaman Insight
disusun sebaris 2 kolom porsi 70/30; (3) judul halaman "Insight Distribusi
Geospasial" dihapus; (4) navbar atas disederhanakan dari 6 tombol datar jadi
4 (Insight & Peta, Import Data, Data Konsumen, Master), dengan Master Dealer/
Master Pos Dealer/Master Kelurahan dipindah ke dalam flyout baru. (Butir
"auto-scroll panel layar penuh" yang sama-sama diminta di pesan ini SUDAH
selesai dari entri di atas, tidak ada kode baru untuknya.)

Dua hal dikonfirmasi lewat pertanyaan sebelum implementasi: field baru "Pos"
di kartu dealer menampilkan nama pos yang aktif (scope pos dipilih) atau
jumlah pos (scope dealer saja) — bukan daftar chip pos yang sudah ada
(chip itu dipertahankan apa adanya, terpisah dari field ini); dan item
flyout "Master Kecamatan" merujuk ke halaman "Master Kelurahan" yang sudah
ada (sudah mencakup hierarki kabupaten→kecamatan→kelurahan) — TIDAK ada
halaman baru, label dipakai apa adanya di flyout.

**Keputusan — kartu dealer/pos** (`dealerCardHtml()`, `frontend/js/render.js`,
dipakai kedua wadah `#kartu-dealer`/`#fs-kartu` lewat `renderDealerCard()`):
`splitByCoverage()` (radius lama, TIDAK dihapus — tetap dipakai tooltip
kelurahan `outlets.js`, di luar cakupan ini) dan teks "Rekap seluruh pos di
bawah dealer ini" dibuang dari kartu ini. `rows` (sales dealer-wide, TIDAK
dipersempit filter pos) tetap seperti sebelumnya — permintaan pengguna
sendiri menyebut "AVG Kontribusi **dealer**", jadi AVG Kontribusi/Posisi
Relatif/Acuan Bisnis tetap level dealer walau sedang melihat satu pos
(diambil dari 3 sel terakhir `dealerScopeBaseCells(rows, code)`, fungsi yang
sudah ada, dipakai bareng `dealerScopeSummary()`/`topScopeSummary()`).
Cabang ring/coverage beda dari AVG di atasnya: pos aktif → `groupSplit()`
dipanggil dengan `rows` yang DISARING ULANG ke `r.outlet === activePos`
(coverage % pos itu sendiri, bukan seluruh dealer disaring lewat batas
kecamatan satu pos — beda arti kalau dipakai `rows` dealer-wide apa adanya,
sempat salah di draf pertama sebelum diperbaiki); tidak ada pos aktif →
`dealerRingSplit()` dengan `rows` dealer-wide, "Luar" = `100 - ring1% -
ring2% - ring3%` (dihitung di sini, bukan field `dealerRingSplit()` — kartu
ini cuma minta 4 angka, beda dari "Coverage Gabungan Pos" terpisah di panel
`ringkas-jangkauan`). Semua dirender lewat `summaryGridHtml()` (grid
`auto-fit`, sudah ada, dipakai bareng panel summary lain) karena jumlah sel
sekarang variabel (8 sel scope dealer, 12 sel scope pos) — trio flex lama
tidak muat lagi. Chip daftar pos, tombol "Rincian per kelurahan"/"Tutup"
dipertahankan apa adanya.

**Keputusan — layout Insight**: kartu "Analisis Performa Pos Dealer"
(`frontend/index.html`) dan "Analisis Penjualan Wilayah" dibungkus satu
`<div class="grid grid-cols-1 xl:grid-cols-10 gap-4">` dengan `xl:col-span-7`/
`xl:col-span-3` — pola yang sama dengan split 66/33 tab Import
(`xl:grid-cols-3` + `xl:col-span-2`), basis 10 kolom di sini supaya rasio
70/30 pas. Stack 1 kolom di bawah breakpoint `xl`. Isi tiap kartu (id,
tombol Live/Sort, dll.) tidak berubah — `renderPerformance()`/`renderWilayah()`
dikonfirmasi cuma mengisi `innerHTML` elemen leaf, tidak pernah menyentuh
wadah luar, jadi perubahan ini murni markup.

**Keputusan — judul dihapus**: wadah `<div>` berisi `<h1>Insight Distribusi
Geospasial</h1>` + `<p>Sebaran penjualan...</p>` di `frontend/index.html`
dihapus utuh (dikonfirmasi HANYA berisi dua elemen itu). `#ringkas-utama`
(kartu ringkasan atas) sibling terpisah, tidak ikut terpengaruh.

**Keputusan — navbar & flyout Master**: `nav-dealer`/`nav-pos`/`nav-kelurahan`
(tombol, id, `onclick="switchTab(...)"` — tidak berubah sama sekali) dipindah
dari level atas navbar ke dalam panel `#master-panel` yang dipicu tombol
`#nav-master`. Gaya visual pakai ulang kelas `.pilih`/`.pilih-panel`/
`.pilih-opsi` yang sudah ada (combobox filter) supaya konsisten, TAPI logika
buka/tutup baru (`toggleMasterMenu()`/`closeMasterMenu()`, `frontend/js/
tables.js`, dekat `switchTab`) — bukan pakai ulang `combobox.js` langsung
karena `terbuka`/`host()`/`_combo` di sana terikat erat ke semantik filter
(pairs, onPick, kotak cari) yang tidak relevan untuk tiga tombol navigasi
biasa. `switchTab()` dapat dua baris tambahan: menutup flyout tiap kali
tab berpindah (`closeMasterMenu()`), dan menyorot `#nav-master` (class
`.active`) waktu `name` salah satu dari `TAB_MASTER = ['dealer','pos',
'kelurahan']` — daftar terpisah dari array tab utama di baris pertama
`switchTab` (yang TIDAK berubah) supaya kedua tempat yang perlu tahu "tab
mana masuk flyout" tidak diam-diam menyimpang. `state.js`, `<section
id="tab-*">`, `TANPA_FILTER`, dan render tabel per halaman tidak disentuh
sama sekali — perubahan ini murni soal bagaimana tiga tombol itu dipicu.

**Alasan:** Permintaan eksplisit pengguna, empat bagian sekaligus dalam satu
pesan — navbar 6 tombol dianggap terlalu ramai, kartu dealer/pos dianggap
kurang informatif (radius lama sudah digantikan ring/coverage di tempat
lain sejak entri "Ring pindah ke DEALER+kecamatan..." tapi kartu ini
ketinggalan), dan dua blok analisis di Insight dianggap lebih enak dibaca
sebaris daripada ditumpuk vertikal.

**Konsekuensi:** `npm run css` dijalankan ulang (kelas grid baru
`xl:grid-cols-10`/`xl:col-span-7`/`xl:col-span-3` dikonfirmasi masuk output).
`npm test` tetap 27/27 hijau — tidak ada assertion lama yang bergantung pada
susunan navbar 6-tombol-datar atau isi persis kartu dealer, jadi tidak ada
tes yang perlu ditulis ulang. Server backend TIDAK disentuh (semua
perubahan sesi ini murni frontend), jadi tidak perlu restart server —
refresh browser (hard refresh supaya cache lama tidak terpakai) cukup.
**Belum diverifikasi visual di browser** — terutama kartu dealer/pos di
kedua scope (dealer-only vs pos dipilih) di kedua mode (`#kartu-dealer`
normal & `#fs-kartu` layar penuh), grid 70/30 di lebar layar sempit vs
`xl`, dan flyout Master (buka/tutup, klik-luar, Escape, highlight saat
salah satu Master aktif).
