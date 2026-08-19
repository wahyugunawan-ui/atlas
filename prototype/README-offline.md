# Salinan offline: `npm run offline-html`

Satu berkas HTML mandiri untuk dikirim ke rekan — dipakai kalau link Tailscale mati
atau tidak ada jaringan sama sekali. Dobel-klik, langsung jalan. Tidak ada server,
tidak ada database, tidak ada login.

```
npm run offline-html
```

Menulis `prototype/astra-offline.html` (~10 MB). **Berkas itu di luar git** — dia
memuat angka penjualan asli, dan git bukan tempat untuk itu berkeliaran.

## Bedanya dengan `prototype/build.js` yang lama

Yang lama dibuat untuk proposal 13 Agustus dan ditujukan ke Netlify: menarik library
dari CDN, dan memakai implementasi terpisah di `prototype/src/` dengan angka karangan.
Dua-duanya salah untuk keperluan ini — CDN mati tanpa internet, dan implementasi
paralel sudah menyimpang dari aplikasi sungguhan.

`build-offline.js` memakai **modul frontend yang sungguhan** (`frontend/js/*.js`)
digabung jadi satu skrip biasa. Mirip bukan karena ditiru — memang kode yang sama.

## Tiga hal yang berbeda dari aplikasi, dan semuanya disengaja

1. **Nama dan alamat konsumen dikarang**, dibangkitkan saat halaman dibuka dari baris
   penjualan yang sudah ditanam — bukan disimpan sebagai daftar terpisah, supaya
   jumlah konsumen per kelurahan otomatis sama dengan angka penjualannya. Angka
   penjualannya sendiri **asli**. Berkas ini berpindah tangan lewat WhatsApp/email
   tanpa login dan tanpa pembatas laju; 18 ribu nama asli di dalamnya risiko yang
   tidak sebanding dengan manfaat demonya.
2. **Basemap peta jalan tidak ikut** — `cakupan.pmtiles` 27 MB dan butuh range
   request yang tidak ada di `file://`. Latarnya polos; poligon kelurahan berwarna
   yang jadi isi peta tetap utuh.
3. **Tombol yang menulis** (impor, simpan pos, hapus periode, cocokkan nama) menolak
   dengan pesan yang jelas di UI, bukan diam atau melempar error konsol. Prototipe
   tidak punya tempat menyimpan.

## Dua bug yang ketemu waktu membangun ini, dicatat supaya tidak terulang

**Modul digabung jadi satu lingkup datar di percobaan pertama**, dan `dom.js` serta
`select-search.js` sama-sama mengekspor `fillSelect` — yang belakangan menimpa yang
duluan. Gejalanya `TypeError: Cannot set properties of undefined`, menunjuk ke dalam
`select-search.js` padahal yang salah cara menggabungnya. Diperbaiki: tiap modul
dibungkus IIFE dengan lingkupnya sendiri (`wrapModule()`), persis seperti bundler
sungguhan.

**Kejadian `load` MapLibre tidak pernah tertembak.** Tambalan basemap offline pertama
menimpa `window.setBasemap` SESUDAH peta dibuat — terlambat, karena style AWAL sudah
memuat sumber vektor `pmtiles://...`, dan MapLibre menunggu sumber itu selesai sebelum
menembakkan `load`. `pmtiles.js` mencoba mengambilnya, gagal karena tidak ada server,
dan `boot()` diam-diam berhenti sebelum sempat memanggil `renderAll()` — KPI tetap 0
tanpa satu pun error di konsol. Diperbaiki dengan menukar sumbernya di teks `map.js`
SEBELUM digabung, jadi peta tidak pernah mencoba jaringan sama sekali.

## Membangun ulang

Perlu server dan PostgreSQL jalan (dia membaca dari database, sama seperti aplikasi).
Data berubah setiap ada impor baru — bangun ulang kalau ingin salinannya mengikuti.

```
npm run offline-html
```

**Jangan sunting `astra-offline.html` langsung** — hasil build, suntingannya hilang di
build berikutnya.
