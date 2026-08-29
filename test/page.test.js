/**
 * Pemeriksaan statis halaman dashboard.
 *
 * Halaman versi rekan mati justru karena kelas bug yang diperiksa di sini: markup
 * memanggil sesuatu yang tidak pernah ada, dan tidak ada yang menyadarinya sampai
 * halamannya dibuka. Setelah dipecah jadi modul, ada satu kelas bug baru dengan
 * gejala yang sama: import yang menunjuk nama yang tidak diekspor.
 *
 * Yang dijaga:
 *   1. tiap berkas modul bisa di-parse
 *   2. tiap import menunjuk berkas yang ada dan nama yang benar-benar diekspor
 *   3. tiap handler on*="..." di markup terdaftar di window
 *   4. tiap $('id') yang dirujuk modul ada di markup
 *   5. tidak ada aset dari internet, tidak ada Google Maps
 *   6. nilai dari Excel selalu lewat esc() sebelum masuk innerHTML
 *   7. PII tetap bisa dicabut tanpa menyunting kode
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'frontend', 'js');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');

const files = fs.readdirSync(JS_DIR).filter((name) => name.endsWith('.js'));
const source = {};
files.forEach((name) => {
  source[name] = fs.readFileSync(path.join(JS_DIR, name), 'utf8');
});

/**
 * Buang sintaks import/export supaya isinya bisa diperiksa vm.Script.
 *
 * Berbasis baris, bukan regex multi-baris. Versi regexnya diam-diam melewatkan import
 * yang memanjang beberapa baris dan menyisakan '}' menggantung, lalu melaporkan
 * kesalahan sintaks yang sebenarnya tidak ada — kegagalan yang menyesatkan justru di
 * dalam alat yang gunanya menemukan kegagalan.
 */
function stripModuleSyntax(code) {
  const out = [];
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) {
      // Import berakhir di baris yang memuat ';' penutupnya.
      while (i < lines.length && !/;\s*$/.test(lines[i])) i++;
      out.push('');
      continue;
    }
    out.push(lines[i].replace(/^export\s+/, ''));
  }
  return out.join('\n');
}

/** Nama yang diekspor satu modul. */
function exportsOf(code) {
  const names = [];
  for (const m of code.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.push(m[1]);
  }
  return names;
}

/** Nama yang di-import satu modul, per berkas asal. */
function importsOf(code) {
  const found = [];
  // [\s\S] bukan . — daftar import boleh memanjang beberapa baris.
  for (const m of code.matchAll(/^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([^']+)'/gm)) {
    found.push({
      from: m[2],
      names: m[1].split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  return found;
}

function test() {
  // 1. tiap modul bisa di-parse.
  //
  // vm.Script tidak menerima sintaks import/export, jadi dipakai SourceTextModule
  // kalau tersedia; kalau tidak, importnya dilucuti dulu supaya yang diperiksa tetap
  // isi modulnya. Yang dicari di sini kesalahan sintaks, bukan resolusi modul —
  // resolusi diperiksa di langkah 2.
  for (const name of files) {
    const stripped = stripModuleSyntax(source[name]);
    try {
      new vm.Script(stripped, { filename: name });
    } catch (error) {
      throw new Error(`${name} tidak bisa di-parse: ${error.message}`);
    }
  }

  // 2. import menunjuk berkas dan nama yang ada
  const exported = {};
  files.forEach((name) => { exported[name] = exportsOf(source[name]); });

  const broken = [];
  for (const name of files) {
    for (const imported of importsOf(source[name])) {
      if (!source[imported.from]) {
        broken.push(`${name}: berkas './${imported.from}' tidak ada`);
        continue;
      }
      for (const symbol of imported.names) {
        if (!exported[imported.from].includes(symbol)) {
          broken.push(`${name}: '${symbol}' tidak diekspor oleh ${imported.from}`);
        }
      }
    }
  }
  assert.deepStrictEqual(broken, [],
    `import menunjuk nama yang tidak ada:\n  ${broken.join('\n  ')}`);

  // Sebuah modul tidak boleh mendeklarasikan nama yang juga di-import. Ini mematikan
  // SELURUH halaman, bukan satu fungsi — modulnya gagal dievaluasi dan semua yang
  // bergantung padanya ikut tidak jalan. Gejalanya cuma satu baris di konsol.
  const clashes = [];
  for (const name of files) {
    const declared = new Set([
      ...exportsOf(source[name]),
      ...[...source[name].matchAll(
        /^(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    ]);
    for (const imported of importsOf(source[name])) {
      for (const symbol of imported.names) {
        if (declared.has(symbol)) {
          clashes.push(`${name}: '${symbol}' di-import dari ${imported.from} ` +
            'sekaligus dideklarasikan lagi di sini');
        }
      }
    }
  }
  assert.deepStrictEqual(clashes, [],
    `nama bentrok antara import dan deklarasi:\n  ${clashes.join('\n  ')}`);

  // 3. handler harus terdaftar di window lewat HANDLERS di app.js.
  //
  // Dicari di DUA tempat, dan yang kedua justru yang lebih sering salah: markup
  // statis di index.html, DAN markup yang dibangun JavaScript di dalam template
  // literal. Versi awal tes ini cuma memindai index.html, dan tiga handler yang
  // namanya berubah waktu modularisasi lolos begitu saja — klik kelurahan di peta,
  // klik treemap, dan tombol Detail konsumen mati tanpa satu pun tes merah.
  const handlerPattern =
    /\bon(?:click|change|input|mouseenter|mouseleave|mousemove)=\\?["']\s*(?:if\s*\([^)]*\)\s*)?([A-Za-z_$][\w$]*)\s*\(/g;

  const called = [...html.matchAll(handlerPattern)].map((m) => m[1]);
  for (const name of files) {
    for (const m of source[name].matchAll(handlerPattern)) called.push(m[1]);
  }
  const ignored = new Set(['if', 'event', 'namaFungsi']);   // contoh di komentar
  const handlers = called.filter((name) => !ignored.has(name));

  const block = source['app.js'].match(/const HANDLERS = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'app.js harus punya blok HANDLERS');
  // Komentar dibuang dulu: blok HANDLERS dikelompokkan dengan komentar `//`, dan
  // memecah begitu saja pada spasi akan menganggap tiap kata di komentar sebagai nama
  // handler.
  const registered = new Set(block[1]
    .replace(/\/\/[^\n]*/g, '')
    .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));

  const unregistered = [...new Set(handlers)].filter((name) => !registered.has(name));
  assert.deepStrictEqual(unregistered, [],
    `markup memanggil fungsi yang tidak didaftarkan ke window: ${unregistered.join(', ')}`);

  // Setiap yang didaftarkan harus benar-benar ada — kalau tidak, app.js gagal muat
  // dan SELURUH halaman mati, bukan cuma satu tombol.
  const allExports = new Set(Object.values(exported).flat());
  const phantom = [...registered].filter((name) => !allExports.has(name));
  assert.deepStrictEqual(phantom, [],
    `HANDLERS mendaftarkan nama yang tidak ada di modul mana pun: ${phantom.join(', ')}`);

  // 4. id yang dirujuk modul harus ada di markup
  const usedIds = [];
  files.forEach((name) => {
    for (const m of source[name].matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) usedIds.push(m[1]);
  });
  // Id dikumpulkan dari markup statis DAN dari markup yang dibangun JavaScript —
  // panel rincian kelurahan membuat elemennya sendiri saat dibuka, dan id di situ
  // sama sahnya dengan yang ditulis di index.html.
  const presentIds = new Set([
    ...[...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]),
    ...files.flatMap((name) =>
      [...source[name].matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1])),
  ]);
  const missingIds = [...new Set(usedIds)].filter((id) => !presentIds.has(id));
  assert.deepStrictEqual(missingIds, [],
    `modul merujuk id yang tidak ada di markup: ${missingIds.join(', ')}`);

  /* --------------------------------------------------------------------
     BILAH FILTER (KF-FILTER-1, -2, -10)
     --------------------------------------------------------------------
     Bilahnya selalu terlihat karena letaknya DI LUAR satu-satunya elemen yang
     menggulir, bukan karena CSS. Itu berarti letaknya sendiri yang jadi jaminan —
     dan letak tidak punya tes sampai ada yang menuliskannya.
     -------------------------------------------------------------------- */
  // Komentar dibuang dulu. Komentar di sebelah bilahnya menyebut <main> untuk
  // menjelaskan kenapa bilahnya ada di luar — dan pencarian tag yang polos akan
  // menemukan kalimat itu, bukan tagnya. Sudah kejadian: penjaga ini merah terhadap
  // markup yang justru benar.
  const htmlTanpaKomentar = html.replace(/<!--[\s\S]*?-->/g, '');
  const mainStart = htmlTanpaKomentar.indexOf('<main');
  const mainEnd = htmlTanpaKomentar.indexOf('</main>');
  assert.ok(mainStart > 0 && mainEnd > mainStart, 'markup tidak punya <main>');
  assert.ok(html.includes('id="filter-bar"'), 'bilah filter hilang dari markup');
  assert.ok(!htmlTanpaKomentar.slice(mainStart, mainEnd).includes('id="filter-bar"'),
    'bilah filter pindah ke DALAM <main>. <main> satu-satunya area yang menggulir, ' +
    'jadi begitu bilahnya di dalam, dia ikut menggulir pergi — dan tidak ada CSS yang ' +
    'menahannya, karena memang tidak pernah dipasang position:sticky');

  // Halaman Import tidak punya filter, jadi bilahnya disembunyikan di sana. Kalau
  // baris ini hilang, bilah yang tidak mengendalikan apa pun tetap tampil dan
  // menyaring di situ terasa seperti aplikasinya rusak.
  const switchBody = source['tables.js'].slice(
    source['tables.js'].indexOf('export function switchTab'));
  assert.match(switchBody.slice(0, switchBody.indexOf('\n}')),
    /filter-bar'\)\.classList\.toggle\('hidden', name === 'import'\)/,
    'switchTab tidak lagi menyembunyikan bilah filter di halaman Import');
  assert.match(switchBody.slice(0, switchBody.indexOf('\n}')), /S\.filterPage = name/,
    'switchTab tidak menyetel halaman filter yang aktif — tabelnya akan digambar ' +
    'dengan filter halaman sebelumnya');

  // Tiap ujung rentang punya DUA dropdown: bulan dan tahun (KF-FILTER-4). Versi
  // sebelumnya memakai <input type="month">, dan di situ tahunnya cuma bisa diketik —
  // tidak ada daftarnya. Tim memintanya bisa dipilih juga.
  ['dari', 'sampai'].forEach((ujung) => {
    ['bulan', 'tahun'].forEach((bagian) => {
      assert.ok(html.includes(`id="${ujung}-${bagian}"`),
        `dropdown ${bagian} untuk ujung "${ujung}" hilang dari bilah periode`);
    });
  });

  // Daftar tahunnya daftar biasa, TIDAK diturunkan dari periode yang sudah diimpor.
  // Kalau diturunkan, tahun yang dicari orang bisa diam-diam tidak ada di daftarnya —
  // dan dropdown yang tidak memuat pilihannya terlihat seperti aplikasinya rusak.
  const barSource = source['filter-bar.js'];
  const blokTahun = barSource.slice(barSource.indexOf('const tahunTersedia'),
    barSource.indexOf('const TANPA_BATAS'));
  assert.ok(!/S\.periods/.test(blokTahun),
    'daftar tahun diturunkan dari periode yang sudah diimpor — tim minta daftarnya ' +
    'biasa saja, tidak mengikuti apa yang sudah diunggah');

  // "Tanpa batas" harus datang dari orang MEMILIH tanda hubung, bukan dari salah satu
  // dropdown yang kebetulan belum terisi.
  //
  // Bedanya pernah salah dan bikin kendalinya buntu: waktu sisi yang belum terisi
  // dianggap "tanpa batas", memilih bulan dari keadaan kosong langsung dihapus lagi
  // oleh syncFilterBar() — dari kosong, nilainya tidak pernah bisa dibangun.
  assert.match(barSource, /if \(el && el\.value === ''\) return 'ALL';/,
    '"tanpa batas" tidak lagi ditentukan dari dropdown mana yang disentuh — kalau ' +
    'sisi yang belum terisi ikut berarti "tanpa batas", memilih bulan dari keadaan ' +
    'kosong akan terhapus lagi dan periodenya mustahil diisi');
  assert.match(barSource, /bulanEl\.value \|\|/,
    'sisi yang belum terisi tidak lagi dilengkapi — pilihan orang dibuang');
  assert.match(barSource, /tahunEl\.value \|\| tahunAcuan\(\)/,
    'tahun yang belum terisi tidak lagi dilengkapi');

  // Yang dilengkapi WAJIB ditulis balik ke dropdown-nya. Itu yang membedakan melengkapi
  // dari menebak diam-diam: hasilnya terlihat, dan orangnya bisa langsung menggantinya.
  const syncBody = barSource.slice(barSource.indexOf('export function syncFilterBar'));
  assert.match(syncBody.slice(0, syncBody.indexOf('\n}')),
    /setValue\(ujung \+ '-bulan'[\s\S]*setValue\(ujung \+ '-tahun'/,
    'syncFilterBar tidak lagi menulis balik kedua dropdown periode — nilai yang ' +
    'dilengkapi jadi tidak terlihat, dan itu berubah jadi tebakan diam-diam');

  // Id yang DIRANGKAI tidak ikut terjaring pemeriksaan id di atas — yang itu cuma
  // melihat $('literal'). Di sini state memakai from/to sementara markup memakai
  // dari/sampai, dan salah menyambungnya menghasilkan $('from-bulan'): elemen yang
  // tidak ada, tanpa error, dan periodenya diam-diam jadi "tanpa batas". Sudah kejadian
  // sekali; yang menangkapnya waktu itu pemeriksaan dengan mata, bukan tes.
  const kotakBlok = barSource.match(/const KOTAK = \{([^}]*)\}/);
  assert.ok(kotakBlok, 'peta nama ujung rentang (KOTAK) hilang dari filter-bar.js');
  [...kotakBlok[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).forEach((ujung) => {
    ['bulan', 'tahun'].forEach((bagian) => {
      assert.ok(html.includes(`id="${ujung}-${bagian}"`),
        `KOTAK menunjuk "${ujung}", tapi tidak ada elemen id="${ujung}-${bagian}" di ` +
        'markup — periode ujung itu akan diam-diam jadi "tanpa batas"');
    });
  });

  // Tiga kolom ring di Master Pos Dealer (KF-POS-17). Yang ditampilkan JUMLAH, bukan
  // nama kecamatannya — satu ring bisa memuat belasan, dan daftar sepanjang itu membuat
  // tiap baris tabel tingginya berbeda-beda.
  ['Ring 1', 'Ring 2', 'Ring 3'].forEach((judul) => {
    assert.ok(html.includes(`>${judul}</th>`), `kolom "${judul}" hilang dari tabel pos`);
  });
  const ringBody = source['tables.js'].slice(source['tables.js'].indexOf('function ringCell'));
  const ringPotong = ringBody.slice(0, ringBody.indexOf('\n}'));
  assert.match(ringPotong, /punya\[c\] === ring/,
    'sel ring tidak lagi memilih kecamatan menurut ringnya');

  // Namanya ditulis, bukan cuma jumlahnya — diminta tim. Tapi daftarnya DIBATASI:
  // satu ring bisa memuat belasan kecamatan, dan tanpa batas itu satu baris tabel bisa
  // setinggi sepuluh baris lain sampai tabelnya berhenti bisa dipindai.
  assert.match(ringPotong, /S\.districtNames\[c\] \|\| c/,
    'sel ring tidak lagi menyebut nama kecamatannya');
  assert.match(ringPotong, /slice\(0, RING_NAMA_TAMPIL\)/,
    'daftar nama kecamatan tidak lagi dibatasi — barisnya bisa jadi sangat tinggi');
  assert.match(ringPotong, /title="\$\{esc\(nama\.join\(', '\)\)\}"/,
    'nama lengkapnya tidak lagi tersedia di tooltip, padahal daftarnya dipotong');

  // Jumlah kolom <th> harus sama dengan colspan baris kosongnya. Kalau tidak, tabel
  // yang kosong akan melebar atau menyempit sendiri — kecil, tapi terlihat rusak, dan
  // gampang terlewat waktu menambah kolom.
  const kepalaPos = (html.slice(html.indexOf('id="table-pos-body"') - 2000,
    html.indexOf('id="table-pos-body"')).match(/<th\b/g) || []).length;
  assert.ok(kepalaPos > 0, 'kepala tabel pos tidak ketemu');
  const colspanPos = source['tables.js'].match(/colspan="(\d+)"[^>]*>Tidak ada pos yang cocok/);
  assert.ok(colspanPos, 'baris "tidak ada pos" hilang');
  assert.strictEqual(Number(colspanPos[1]), kepalaPos,
    `colspan baris kosong (${colspanPos[1]}) tidak sama dengan jumlah kolom (${kepalaPos})`);

  /* --------------------------------------------------------------------
     EDIT RING (KF-POS-18, KF-POS-19)
     -------------------------------------------------------------------- */
  const ringSource = source['rings.js'];
  const mapSource = source['map.js'];

  // Batas kecamatan dimuat SAAT MODE EDIT, bukan saat halaman dibuka. Berkasnya 3 MB
  // dan sebagian besar sesi tidak pernah menyunting ring; memuatnya di awal berarti
  // semua orang membayar untuk yang dipakai sedikit. Gagalnya diam: halaman tetap
  // jalan, cuma lebih lambat 3 MB tiap kali dibuka, dan tidak ada yang error.
  assert.ok(!/kecamatan\.geojson/.test(source['app.js']),
    'batas kecamatan ikut dimuat saat halaman dibuka — tempatnya di mode edit ring');
  assert.match(ringSource, /addDistrictLayers\(\)/,
    'mode edit ring tidak lagi memuat batas kecamatannya sendiri');
  assert.match(mapSource, /fetchGeo\('kecamatan\.geojson'\)/,
    'batas kecamatan tidak lagi diambil dari berkas geo');

  /* --------------------------------------------------------------------
     PANEL ANALISIS PERFORMA POS
     -------------------------------------------------------------------- */
  const renderSource = source['render.js'];

  // Tiga salinan daftar yang sama (panel biasa, layar penuh peta, tampilan besar)
  // digambar dari SATU variabel. Kalau masing-masing menghitung sendiri, tiga angka
  // berbeda bisa tampil bersamaan dan tidak ada yang tahu mana yang benar.
  const perfBody = renderSource.slice(renderSource.indexOf('export function renderPerformance'));
  const perfPotong = perfBody.slice(0, perfBody.indexOf('\n}'));
  ['panel-performa', 'fs-performa', 'fp-performa'].forEach((id) => {
    assert.match(perfPotong, new RegExp(`\\$\\('${id}'\\)[^=]*= body`),
      `${id} tidak lagi digambar dari daftar yang sama — tiga angka berbeda bisa tampil`);
  });

  // Gulir otomatis WAJIB dihentikan waktu tampilan besarnya ditutup. Interval yang
  // tertinggal terus berjalan di panel yang tidak terlihat, dan tombolnya tetap
  // menyala tanpa ada yang bergerak.
  const tutupBody = renderSource.slice(renderSource.indexOf('export function closePerformaFull'));
  assert.match(tutupBody.slice(0, tutupBody.indexOf('\n}')), /S\.livePerforma/,
    'menutup tampilan besar tidak menghentikan gulir otomatis — intervalnya bocor');
  assert.match(renderSource, /clearInterval\(S\.livePerforma\)/,
    'gulir otomatis tidak pernah dihentikan dengan clearInterval');

  // Tombol urut membalik urutan, tidak cuma mengganti tulisannya.
  assert.ok(html.includes('id="btn-urut-performa"'), 'tombol urut hilang dari panel performa');
  assert.match(renderSource, /S\.performanceSort === 'asc' \? 'desc' : 'asc'/,
    'tombol urut tidak lagi membalik urutan');
  assert.match(renderSource, /S\.performanceSort === 'desc'/,
    'urutan daftar tidak lagi menimbang S.performanceSort');

  // Tabel mengisi tinggi yang tersisa lewat flexbox, bukan angka ajaib. Tiap kali ada
  // yang ditambah di atas tabel, angka seperti calc(100vh-320px) meleset dan
  // menyisakan ruang kosong di bawahnya — persis yang dikeluhkan tim.
  assert.ok(!/100vh-\d+px/.test(html),
    'tinggi tabel kembali dipatok angka ajaib (calc(100vh-...)) — sekali ada yang ' +
    'ditambah di atasnya, akan ada sisa ruang kosong di bawah tabel lagi');

  // Nama kecamatan bisa dinyalakan sendiri lewat Opsi Peta (KF-PETA-17), tidak cuma
  // ikut mode edit ring — orang perlu tahu nama kecamatan waktu MEMBACA peta juga.
  assert.ok(html.includes('id="opt-kecamatan"'), 'sakelar Nama Kecamatan hilang dari Opsi Peta');

  // Satu tempat yang memutuskan lapisan kecamatan tampil atau tidak, dari DUA sebab
  // sekaligus. Kalau mode edit menyetel visibility sendiri, keluar dari mode edit akan
  // mematikan lapisan yang sengaja dinyalakan orang lewat sakelar — dan sakelarnya
  // terlihat menyala sementara petanya kosong.
  assert.match(mapSource, /on\('opt-kecamatan'\) \|\| sedangEdit/,
    'lapisan kecamatan tidak lagi menimbang sakelar dan mode edit di satu tempat');
  const paintBody = mapSource.slice(mapSource.indexOf('export function setRingPaint'));
  const paintPotong = paintBody.slice(0, paintBody.indexOf('\n}'));
  assert.match(paintPotong, /redrawMap\(\)/,
    'setRingPaint tidak lagi menyerahkan urusan tampil-tidaknya ke redrawMap');
  // Sengaja mencari kata 'visibility' apa adanya, bukan nama lapisannya: mutasi yang
  // memakai variabel untuk id lolos dari penjaga yang mencocokkan 'kec-'. Sudah dicoba.
  assert.ok(!/visibility/.test(paintPotong),
    'setRingPaint menyetel sendiri visibility lapisan kecamatan — keluar dari mode ' +
    'edit akan mematikan lapisan yang dinyalakan lewat sakelar Opsi Peta');

  // Satu kecamatan tidak boleh berada di dua ring. Di database dijaga primary key; di
  // halaman dijaga bentuk datanya — satu kunci, satu nilai. Kalau draft-nya berubah
  // jadi daftar per ring, dua ring bisa memilikinya dan penjualannya terhitung dua kali.
  const assignBody = ringSource.slice(ringSource.indexOf('export function assignRing'));
  assert.match(assignBody.slice(0, assignBody.indexOf('\n}')),
    /draft\[dipilih\] = nomor/,
    'kecamatan tidak lagi disimpan sebagai satu nilai per kode — dua ring bisa ' +
    'memiliki kecamatan yang sama, dan penjualannya terhitung dua kali');

  // Urutannya SATU KECAMATAN DULU, baru ringnya — diminta tim. Versi pertama
  // kebalikannya (pilih ring sebagai kuas, lalu sapu banyak kecamatan). Klik di peta
  // karena itu harus membuka pemilih, bukan langsung menetapkan ring.
  assert.match(mapSource, /window\.openRingChooser\(f\.properties\.kode, e\.originalEvent\)/,
    'klik kecamatan tidak lagi membuka pemilih ring — kalau dia langsung menetapkan ' +
    'ring, urutannya kembali jadi "pilih ring dulu" yang sudah ditolak tim');
  assert.ok(html.includes('id="ring-pilih"'), 'pemilih ring hilang dari markup');
  [1, 2, 3].forEach((ring) => {
    assert.ok(html.includes(`onclick="assignRing(${ring})"`),
      `tombol Ring ${ring} hilang dari pemilih kecamatan`);
  });
  assert.ok(html.includes('onclick="assignRing(0)"'),
    'tombol melepas kecamatan dari ring hilang — sekali salah pilih, tidak ada jalan ' +
    'membatalkannya selain menyimpan yang salah');

  // Tombolnya cuma muncul waktu lingkupnya SATU POS. Ring melekat pada pos; tombol
  // yang muncul untuk dealer akan menyimpan sesuatu yang bukan ring dealer.
  assert.match(source['app.js'], /const adaPos = scopeValue\('pos'\) !== 'ALL';/,
    'tombol edit ring tidak lagi dibatasi ke lingkup satu pos');

  // Ada DUA tombol dan dua-duanya harus ikut aturan itu. Yang di bilah ruang lingkup
  // saja tidak cukup: orang yang baru mengklik marker sedang melihat peta, dan bilah
  // ruang lingkup ada jauh di atas halaman — di luar layar sama dengan tidak ada.
  ['btn-edit-ring', 'btn-ring-peta'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `tombol ${id} hilang dari markup`);
    assert.ok(new RegExp(`\\$\\('${id}'\\)\\.classList\\.toggle\\('hidden', !adaPos\\)`)
      .test(source['app.js']), `tombol ${id} tidak ikut aturan "hanya waktu pos dipilih"`);
  });

  // Tombol Ring di tabel Master Pos mengantar ke peta, tidak membuka pemilih sendiri —
  // ringnya memang dipilih dengan mengklik kecamatan di peta.
  assert.ok(/editRingFromTable\('\$\{esc\(o\.code\)\}'\)/.test(source['tables.js']),
    'tombol Ring hilang dari kolom Aksi tabel Master Pos');
  const dariTabel = source['tables.js'].slice(
    source['tables.js'].indexOf('export function editRingFromTable'));
  assert.match(dariTabel.slice(0, dariTabel.indexOf('\n}')), /switchTab\('peta'\)/,
    'tombol Ring di tabel tidak lagi mengantar ke peta');

  // Tiap dropdown lingkup punya rumahnya sendiri di bilah; isinya dibangun combobox.js.
  ['provinsi', 'kota', 'dealer', 'pos'].forEach((nama) => {
    assert.ok(html.includes(`id="pilih-${nama}"`), `dropdown ${nama} hilang dari bilah`);
  });

  // Panel rincian kelurahan tidak boleh menempati sudut yang sama dengan tombol peta.
  // Keduanya `absolute` di dalam #map-shell; waktu top-nya sama, panelnya menutupi
  // tombol Layar penuh dan Fit sampai tidak bisa ditekan sama sekali.
  const tombolPeta = html.match(/<div class="absolute (top-\d+) left-6 z-20/);
  const panelKel = html.match(/id="kelurahanDetailPanel"[^>]*absolute (top-\d+) left-6/);
  assert.ok(tombolPeta && panelKel, 'tombol peta atau panel kelurahan hilang dari markup');
  assert.notStrictEqual(panelKel[1], tombolPeta[1],
    `panel rincian kelurahan mulai di ${panelKel[1]}, sama dengan tombol peta — ` +
    'panelnya menutupi tombol Layar penuh dan Fit');

  // Kotak pencarian ada DI DALAM panel dropdown, bukan di sebelahnya. Versi sebelumnya
  // menaruhnya sebagai <input> terpisah di bilah — dua kendali untuk satu pilihan, dan
  // yang kedua tidak terlihat seperti bagian dari yang pertama.
  const comboSource = source['combobox.js'];
  const panelBlok = comboSource.slice(comboSource.indexOf('<div class="pilih-panel"'),
    comboSource.indexOf('drawOptions(name, \'\');'));
  assert.match(panelBlok, /class="pilih-cari"/,
    'kotak pencarian tidak lagi dibangun di dalam panel dropdown');

  // Panel dropdown menghitung ruang yang benar-benar ada, tidak memakai tinggi tetap.
  //
  // Versi sebelumnya selalu membuka ke bawah setinggi 268 px. Begitu ruang di bawah
  // tombolnya sempit — jendela pendek, atau bilah filter melipat dua baris sehingga
  // tombolnya turun — daftarnya keluar layar dan yang terlihat cuma kotak
  // pencariannya. Tidak ada error dan tidak ada gejala; dropdown-nya cuma terlihat
  // kosong. Diukur ulang di browser: pada jendela 300 px, panel lamanya 324 px.
  assert.match(comboSource, /window\.innerHeight/,
    'panel dropdown tidak lagi menimbang tinggi jendela — di layar pendek daftarnya ' +
    'keluar layar dan dropdown-nya terlihat kosong tanpa satu pun error');
  assert.match(comboSource, /daftar\.style\.maxHeight/,
    'tinggi daftar tidak lagi dipotong ke ruang yang tersedia');
  assert.match(comboSource, /window\.innerWidth/,
    'panel dropdown tidak lagi menimbang lebar jendela — tombol di ujung kanan bilah ' +
    'akan membuka panel yang separuh keluar layar');

  // Panel dropdown TIDAK boleh memakai backdrop-filter.
  //
  // backdrop-filter harus mengambil sampel dari apa yang ada di belakangnya. Waktu yang
  // di belakang itu kanvas WebGL peta — lapisan tersendiri yang dikompositkan GPU —
  // sebagian driver menggambarnya jadi kosong, dan panelnya "hilang" tanpa satu pun
  // error di konsol. Tidak bisa direproduksi di Chromium tanpa GPU, jadi yang menjaga
  // di sini bentuk gayanya, bukan hasil gambarnya.
  const gayaPanel = html.match(/\.pilih-panel \{[^}]*\}/);
  assert.ok(gayaPanel, 'gaya .pilih-panel hilang dari markup');
  assert.ok(!/backdrop-filter/.test(gayaPanel[0]),
    'panel dropdown memakai backdrop-filter lagi — di atas kanvas peta sebagian ' +
    'driver menggambarnya jadi kosong, dan dropdown-nya terlihat hilang tanpa error');

  // Legenda di panel opsi peta dilipat, kalau tidak panelnya tidak muat dan harus
  // digulir. Diukur: dengan keduanya terbuka isinya 845 px, sementara yang muat 466 px.
  const opsiBlok = html.slice(html.indexOf('>Opsi Peta<') - 400,
    html.indexOf('id="legend-dealer"') + 200);
  ['Legenda', 'Dealer'].forEach((judul) => {
    assert.match(opsiBlok, new RegExp(`<details[^>]*>\\s*<summary[^>]*>${judul}</summary>`),
      `bagian ${judul} tidak lagi dilipat — panel opsi peta jadi tidak muat dan ` +
      'harus digulir untuk melihat sisanya');
  });
  assert.ok(!/<details open/.test(opsiBlok),
    'lipatan legenda terbuka secara bawaan — panelnya kembali tidak muat');

  // Rumah bilah filter di layar penuh TIDAK boleh jadi wadah yang menggulir.
  //
  // Aturan `#map-shell.penuh .map-panel { overflow-y: auto }` memberi tiap panel
  // melayang gulirannya sendiri — masuk akal untuk panel berisi daftar, dan salah
  // untuk rumah bilah filter: dia cuma wadah, dan overflow di situ MEMOTONG dropdown
  // yang membuka ke bawah keluar kotaknya. Itu penyebab "dropdown-nya kepotong" yang
  // sempat dikira masalah z-index dan dikejar dua kali ke arah yang salah.
  assert.match(html, /#map-shell\.penuh \.map-panel:not\(#fs-filter-host\)/,
    'rumah bilah filter layar penuh ikut kena aturan overflow panel — dropdown-nya ' +
    'akan terpotong sebatas kotak bilahnya');

  // Bilahnya selebar isinya, bukan selebar ruang yang kebetulan tersisa. Karena
  // rumahnya diletakkan di tengah, lebar "tersedia" cuma separuh layar — dan bilahnya
  // melipat jadi dua baris padahal layarnya luas.
  assert.match(html, /#fs-filter-host \{[^}]*width: max-content/,
    'rumah bilah filter layar penuh tidak lagi selebar isinya — bilahnya melipat ' +
    'jadi dua baris walau layarnya luas');

  // Bilah filter harus tetap muat satu baris di layar ~980 px.
  //
  // Diukur di browser: dengan pil setinggi 32 px dan jarak yang lama, seluruh bilah
  // 990 px — meleset tipis dari lebar layar tim, dan melipat jadi dua baris. Setelah
  // dipadatkan jadi 865 px, dan tetap satu baris sampai lebar 880 px.
  //
  // Yang dijaga di sini ukurannya, bukan hasil ukurnya: menaikkan tinggi pil kembali
  // ke 32 px atau melebarkan jaraknya akan mengembalikan lipatan itu, dan gejalanya
  // baru terlihat di layar yang lebih sempit dari layar yang dipakai mengetes.
  assert.match(html, /\.pilih-tombol \{[^}]*height: 28px/,
    'tinggi pil filter dinaikkan lagi — bilahnya akan melipat dua baris di layar ~980 px');
  assert.match(html, /\.kotak-bulan \{[^}]*height: 28px/,
    'tinggi kotak bulan dinaikkan lagi — tingginya harus sama dengan pil di sebelahnya');
  assert.match(html, /id="filter-bar" class="[^"]*gap-x-2\b/,
    'jarak antar kendali di bilah filter dilebarkan lagi');
  assert.ok(!/id="cari-/.test(html),
    'kotak pencarian kembali ditulis langsung di markup bilah — tempatnya di dalam ' +
    'panel dropdown, dibangun combobox.js bersama daftarnya');

  // 5. tidak ada aset dari internet
  //
  // Bukan soal selera: jaringan kantor bisa memblokir CDN, dan halaman yang separuh
  // jadi tidak akan memberi tahu siapa pun bahwa penyebabnya di luar aplikasi.
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(external, [],
    `markup masih memuat aset dari internet:\n  ${external.join('\n  ')}`);

  for (const banned of ['maps.googleapis.com', 'google.maps', 'markerclusterer',
    'HeatmapLayer', 'google.script.run', 'cdn.tailwindcss.com']) {
    assert.ok(!html.includes(banned), `index.html masih memuat "${banned}"`);
  }
  for (const name of files) {
    assert.ok(!/https?:\/\/(?!www\.openstreetmap\.org)/.test(
      source[name].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')),
    `${name} memuat URL keluar; hanya tautan atribusi OpenStreetMap yang boleh`);
  }

  // 6. nilai dari Excel harus lewat esc() sebelum masuk innerHTML.
  //
  // Pemeriksaannya per baris, jadi penugasan textContent yang dipecah dua baris akan
  // dilaporkan sebagai pelanggaran. Itu disengaja: alarm palsu cuma bikin kamu
  // melihat, sedangkan pemeriksa yang lebih pintar bisa melewatkan yang asli.
  const fromExcel =
    /(dealerNames\[[^\]]*\]|S\.villageName\[[^\]]*\]|S\.cityName\[[^\]]*\]|p\.nama[A-Za-z_]*|f\.nama[A-Za-z_]*)/g;
  const leaks = [];
  for (const name of files) {
    source[name].split('\n').forEach((line, i) => {
      if (!/innerHTML|setHTML|`</.test(line) && !/^\s*`/.test(line)) return;
      if (/textContent/.test(line)) return;
      for (const m of line.matchAll(fromExcel)) {
        const before = line.slice(Math.max(0, m.index - 40), m.index);
        if (!/esc\(/.test(before)) leaks.push(`${name}:${i + 1}: ${line.trim().slice(0, 60)}`);
      }
    });
  }
  assert.deepStrictEqual(leaks, [],
    `nilai dari Excel masuk innerHTML tanpa escape:\n  ${leaks.join('\n  ')}`);

  // 7. PII tidak boleh bisa diambil borongan dari halaman.
  //
  // Yang dijaga bukan "tidak ada PII" — nama dan alamat konsumen memang ditampilkan
  // atas permintaan pemilik proyek. Yang dijaga: satu akun dipakai bersama, jadi
  // tidak boleh ada satu permintaan pun yang mengembalikan seluruh basis data
  // konsumen sekaligus.
  //
  // Ini pengganti penjaga lama yang memeriksa keberadaan berkas konsumen.json.
  // Arsitekturnya berubah — konsumen sekarang datang dari API per kelurahan — tapi
  // sifat yang dijaga persis sama.
  const clientCalls = files.flatMap((name) =>
    [...source[name].matchAll(/fetchCustomers\(([^)]*)\)/g)].map((m) => m[1].trim()));
  assert.ok(clientCalls.length, 'tidak ada satu pun pemanggilan fetchCustomers');
  clientCalls.forEach((args) => {
    assert.ok(args && !args.startsWith(','),
      `fetchCustomers dipanggil tanpa kode kelurahan: fetchCustomers(${args})`);
  });
  // fetchCustomers harus SELALU menyertakan kode kelurahan di query-nya.
  const fetchBody = source['api.js'].slice(
    source['api.js'].indexOf('export function fetchCustomers'));
  const bodyEnd = fetchBody.indexOf('\n}');
  assert.ok(/village['"]?\s*[:,]\s*villageCode/.test(fetchBody.slice(0, bodyEnd)),
    'fetchCustomers tidak menyertakan kode kelurahan di permintaannya');

  // Pintu KEDUA: halaman Data Konsumen. Penyaringnya bebas — tidak wajib menyebut
  // kelurahan — jadi yang menjaganya bukan bentuk permintaan tapi batas di server.
  //
  // Di sini cuma dipastikan batasnya masih dipasang dan halaman tidak memanggil jalur
  // lain. Bahwa batasnya benar-benar memotong diuji sungguhan di import.test.js
  // terhadap database berisi lebih dari BROWSE_LIMIT baris — pemeriksaan teks saja
  // tidak pernah bisa membuktikan itu.
  const repoSource = fs.readFileSync(
    path.join(ROOT, 'backend', 'server', 'repository.js'), 'utf8');
  const browseBody = repoSource.slice(repoSource.indexOf('async function browseCustomers'));
  assert.ok(/LIMIT \?/.test(browseBody.slice(0, browseBody.indexOf('\n}'))),
    'browseCustomers harus membatasi jumlah baris yang dikembalikan');
  assert.ok(/const BROWSE_LIMIT = \d+;/.test(repoSource),
    'BROWSE_LIMIT harus konstanta yang terlihat, bukan angka yang tersebar');

  // Halaman harus tetap utuh kalau server tidak punya data konsumen sama sekali.
  assert.ok(/S\.hasCustomers/.test(source['tables.js']),
    'panel kelurahan harus memeriksa S.hasCustomers sebelum meminta data konsumen');
  assert.ok(/if \(!S\.hasCustomers\)/.test(source['tables.js']),
    'halaman Data Konsumen harus memeriksa S.hasCustomers sebelum meminta data');

  // Daftar opsi menempel di elemen hostnya, bukan di objek global berkunci id.
  //
  // Objek global itu pernah ada (`S.allOptions`), tidak pernah dibuat siapa pun, dan
  // membuat pencarian di dalam dropdown melempar TypeError sejak hari pertama tanpa
  // satu pun tes merah. Yang menjaganya sekarang bukan disiplin tapi tempat: daftarnya
  // dibuat dan dibaca berkas yang sama, di elemen yang sama.
  assert.match(comboSource, /el\._combo = \{ label, pairs, allLabel, onPick \}/,
    'fillCombo harus menitipkan daftar opsi di elemen hostnya (el._combo)');
  assert.ok(!/from '\.\/state\.js'/.test(comboSource),
    'combobox.js mengambil daftar opsi dari state global lagi — versi sebelumnya ' +
    'membaca S.allOptions yang tidak pernah dibuat, dan pencarian dropdown mati diam');

  // Yang tersimpan tetap KODE, tidak pernah teks yang diketik. Kotak pencarian cuma
  // menyaring apa yang tampil; memilih harus menekan salah satu barisnya. Kalau isi
  // kotak cari sampai dipakai sebagai nilai filter, salah ketik akan diam-diam
  // mengubah filter — dan tabel yang kosong tidak memberi tahu kenapa.
  assert.ok(/onPick\(value\)/.test(comboSource),
    'chooseCombo tidak lagi meneruskan kode baris yang ditekan');
  assert.ok(!/onPick\([^)]*(?:cari|kunci|q)\b/.test(comboSource),
    'isi kotak pencarian dipakai sebagai nilai filter — yang tersimpan harus KODE ' +
    'dari baris yang ditekan, bukan teks yang diketik');

  // Filter yang sedang menyempitkan tampilan HARUS terlihat berbeda dari yang tidak
  // (KF-FILTER-12). Karena kabupaten, dealer, dan pos berbagi satu slot, penanda ini
  // yang membuat "kok kabupaten saya hilang waktu saya pilih dealer" menjawab dirinya
  // sendiri. Kalau penandanya hilang, aturannya tetap berlaku tapi jadi tidak terlihat
  // — dan itu persis keluhan yang bikin bilah ini dirombak.
  assert.match(comboSource, /classList\.toggle\('nyala', value !== 'ALL'\)/,
    'pil filter tidak lagi ditandai waktu filternya benar-benar menyempitkan tampilan');
  assert.match(html, /\.pilih\.nyala[^{]*\{/,
    'markup tidak punya gaya untuk pil yang menyala — penandanya dipasang di kelas ' +
    'yang tidak menggambar apa pun');

  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(/^data\/$/m.test(ignore),
    'folder data WAJIB ada di .gitignore — sekali ter-commit, PII ada di riwayat selamanya');
  // Salinan offline memuat angka penjualan ASLI (prototype/build-offline.js). Kalau
  // baris ini hilang dari .gitignore, satu 'git add -A' yang tidak hati-hati membuat
  // angka penjualan Astra masuk riwayat git selamanya — dan git tidak lupa.
  assert.ok(/^prototype\/astra-offline\.html$/m.test(ignore),
    'prototype/astra-offline.html WAJIB ada di .gitignore — berkas itu memuat angka ' +
    'penjualan asli');


  // 8. sumber data terpusat, supaya gampang dipindah waktu hosting berubah
  assert.ok(/export const API = '[^']*';/.test(source['config.js']),
    'alamat API harus satu konstanta di config.js');
  assert.ok(/export const GEO_BASE = '[^']*';/.test(source['config.js']),
    'alamat berkas geo harus satu konstanta di config.js');

  // Hanya api.js yang boleh tahu bentuk URL server. Kalau modul lain memanggil fetch
  // sendiri, penanganan sesi habis dan pesan errornya akan berbeda-beda.
  const rogueFetch = files.filter((name) => name !== 'api.js' &&
    /(?:^|[^\w.])fetch\s*\(/.test(
      source[name].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
  assert.deepStrictEqual(rogueFetch, [],
    `modul ini memanggil fetch() sendiri, bukan lewat api.js: ${rogueFetch.join(', ')}`);

  /* ------------------------------------------------------------------------
     9. basemap: daftar lapisannya DITANGKAP, bukan ditebak dari `source`
     ------------------------------------------------------------------------
     Bug yang sungguhan terjadi. setBasemap() dulu mencari lapisan basemap dengan
     menyaring `layer.source === 'protomaps'`, dan penyaring itu melewatkan lapisan
     pertama tema: sebuah lapisan bertipe `background`, yang di MapLibre memang TIDAK
     punya `source`.

     Lapisan itu jadi tidak pernah ikut dimatikan. Warnanya #a3a3a3 pekat dan duduk
     DI ATAS lapisan citra satelit, jadi menekan tombol Satelit menghasilkan layar
     abu-abu rata: ubinnya diminta, dijawab 200 OK, lalu tertutup rapat. Tidak ada
     error, tidak ada ubin gagal, dan tidak ada satu pun tes yang merah.
     ------------------------------------------------------------------------ */

  const ctxTema = {};
  vm.createContext(ctxTema);
  vm.runInContext(fs.readFileSync(
    path.join(ROOT, 'frontend', 'vendor', 'protomaps-themes-base.js'), 'utf8'), ctxTema);
  const themeLayers = ctxTema.protomaps_themes_base.noLabels('protomaps', 'grayscale');

  // Premis bugnya, diperiksa ke tema yang sungguhan dipakai. Kalau protomaps suatu
  // saat memberi `source` ke semua lapisannya, tes ini merah — dan yang membacanya
  // boleh membuang blok ini, karena jebakannya memang sudah tidak ada lagi.
  const tanpaSource = themeLayers.filter((l) => !l.source);
  assert.ok(tanpaSource.some((l) => l.type === 'background'),
    'tema protomaps tidak lagi punya lapisan background tanpa source — premis penjaga ' +
    'ini hilang, periksa apakah blok ini masih perlu');

  // Dan penyaring yang melewatkannya tidak boleh dipasang lagi.
  //
  // Komentar dibuang dulu: catatan di map.js MENGUTIP penyaring lama supaya orang
  // berikutnya tahu kenapa dia salah, dan penjaga yang menembak kutipan itu akan
  // menghukum dokumentasi yang justru mencegah bugnya terulang.
  const mapTanpaKomentar = source['map.js']
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/source\s*===\s*'protomaps'/.test(mapTanpaKomentar),
    "map.js menyaring lapisan basemap dengan source === 'protomaps' lagi. Penyaring itu " +
    'melewatkan lapisan background tema, dan citra satelit akan tertutup rata tanpa ' +
    'satu pun error');

  // Daftarnya harus datang dari tema itu sendiri — dia yang membuat lapisannya, jadi
  // dia yang tahu daftar lengkapnya.
  assert.ok(/basemapLayerIds\s*=\s*basemapLayers\.map/.test(source['map.js']),
    'id lapisan basemap harus ditangkap dari tema waktu peta dibuat, bukan dicari ulang');
  assert.ok(/basemapLayerIds\.forEach/.test(source['map.js']),
    'setBasemap harus memakai daftar id yang ditangkap itu');

  // `polos` latar terakhir milik kita sendiri dan TIDAK boleh ikut dimatikan.
  assert.ok(!themeLayers.some((l) => l.id === 'polos'),
    'tema punya lapisan bernama `polos` juga — namanya bertabrakan dengan latar kita');

  /* ------------------------------------------------------------------------
     10. simpan data konsumen tidak lagi bisa dimatikan dari halaman
     ------------------------------------------------------------------------
     Centangnya dibuang 2026-08-18 atas keputusan pemilik proyek: tim selalu memerlukan
     nama dan alamat, jadi pilihannya cuma menyediakan peluang lupa.

     Yang dijaga di sini BUKAN hilangnya centang — itu perubahan yang terlihat. Yang
     dijaga dua hal yang gagalnya diam:

     1. Halaman tidak boleh diam-diam mengirim withCustomers=0. Kalau ada yang
        menambahkannya kembali, impor berjalan mulus dan tab Data Konsumen kosong
        selamanya tanpa satu pun error.
     2. Pemberitahuannya harus tetap ada. Orang yang mengunggah tidak lagi bisa menolak
        di sini, jadi setidaknya dia berhak TAHU bahwa data pribadi ikut tersimpan.
        Menghapus pilihan boleh; menghapus pemberitahuannya tidak.
     ------------------------------------------------------------------------ */

  assert.ok(!/imp-konsumen/.test(html),
    'centang imp-konsumen muncul lagi di markup — pilihannya sudah dibuang, dan ' +
    'menghidupkannya setengah jalan membuat halaman dan server tidak sepakat');

  assert.ok(!/withCustomers/.test(source['api.js']),
    'api.js mengirim withCustomers lagi. Server memperlakukan absennya field sebagai ' +
    '"simpan"; mengirimnya kembali membuka jalan mengirim 0 dan mematikan penyimpanan ' +
    'data konsumen tanpa ada yang menyadarinya');

  assert.match(html, /Nama dan alamat konsumen ikut tersimpan/i,
    'pemberitahuan bahwa data pribadi ikut tersimpan hilang dari halaman impor. ' +
    'Pilihannya memang dibuang, tapi pengunggah tetap berhak tahu apa yang terjadi');

  /* ------------------------------------------------------------------------
     11. lingkaran radius mengikuti radius yang DIPILIH
     ------------------------------------------------------------------------
     Pernah salah: lingkarannya digambar dengan konstanta RADIUS_METERS yang selalu
     5.000, sementara tombol 3/5/7/10 km mengubah S.radiusM dan seluruh persentase di
     layar. Tidak ada error — peta dan angka cuma menceritakan dua hal berbeda, dan
     lingkaran itu justru yang dipakai orang untuk mempercayai angkanya.
     ------------------------------------------------------------------------ */

  // Dicocokkan sebagai teks biasa, bukan regex: polanya penuh tanda kurung dan titik,
  // dan regex yang escape-nya meleset akan cocok dengan apa saja — penjaga yang tidak
  // pernah bisa merah.
  assert.ok(source['map.js'].includes('circle(outlet.lng, outlet.lat, S.radiusM)'),
    'lingkaran radius tidak digambar dari S.radiusM. Kalau memakai konstanta, ' +
    'menekan 3 km atau 10 km mengubah angkanya tapi lingkarannya diam di 5 km');

  /* ------------------------------------------------------------------------
     12. tooltip peta menghitung dari sumber yang SAMA dengan petanya
     ------------------------------------------------------------------------
     Tooltip menampilkan angka di atas poligon yang sedang diwarnai choropleth. Kalau
     dia membaca S.sales langsung alih-alih activeRows(), angkanya berhenti mengikuti
     filter — poligon gelap karena satu dealer, tapi tooltipnya menyebut total semua
     dealer. Dua angka yang bertentangan di layar yang sama, tanpa satu pun error.
     ------------------------------------------------------------------------ */

  assert.ok(/villageTooltipData/.test(source['outlets.js']),
    'fungsi data tooltip kelurahan hilang dari outlets.js');
  assert.ok(!/S\.sales/.test(source['outlets.js']),
    'outlets.js membaca S.sales langsung. Tooltip harus lewat activeRows() supaya ' +
    'angkanya mengikuti filter yang sama dengan warna poligon di bawahnya');
  assert.ok(source['outlets.js'].includes('const rows = activeRows();'),
    'tooltip kelurahan tidak memakai activeRows()');

  // Dan tooltipnya harus benar-benar terpasang ke gerakan kursor, bukan cuma ada.
  assert.ok(source['app.js'].includes("S.map.on('mousemove', 'kel-isi'"),
    'tooltip kelurahan tidak terpasang ke mousemove — fungsinya ada tapi tidak pernah ' +
    'dipanggil, dan itu tidak membuat apa pun gagal');
  assert.ok(/showVillageTooltip/.test(source['app.js']),
    'app.js tidak memanggil showVillageTooltip');

  const totalLines = files.reduce((sum, f) => sum + source[f].split('\n').length, 0);
  console.log(`OK page — ${files.length} modul (${totalLines} baris), ` +
    `${new Set(handlers).size} handler terdaftar, ${new Set(usedIds).size} id, ` +
    'tanpa aset internet, semua ter-escape, PII terkurung');
}

test();
