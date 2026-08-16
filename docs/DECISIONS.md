# Keputusan

Entri baru ditambahkan di bawah. Jangan hapus atau tulis ulang entri lama; kalau
sebuah keputusan dibatalkan, tulis entri baru yang menyebut entri mana yang diganti.

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
