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

  // 2b. KEBALIKANNYA: nama yang DIPAKAI tapi tidak pernah di-import.
  //
  // Langkah 2 memeriksa "import menunjuk ekspor yang ada". Yang TIDAK diperiksa
  // siapa pun sampai 2026-09-18 adalah arah sebaliknya, dan justru itu yang menggigit:
  // switchTab() di tables.js memanggil hentikanLiveFusion() tanpa pernah mengimpornya
  // dari fusion.js. Akibatnya SETIAP pindah ke halaman non-Fusion melempar
  // ReferenceError tepat sebelum tiga baris terakhir fungsinya — dan tiga baris itulah
  // yang mengisi halaman Lokasi Service dan Lokasi Delivery. Kedua halaman itu kosong
  // BERBULAN-BULAN: judulnya tetap digambar (loop di awal switchTab), datanya tidak
  // pernah diminta, dan tidak ada satu pun tes yang merah.
  //
  // Yang diperiksa sengaja SEMPIT supaya tidak perlu parser JavaScript sungguhan:
  // hanya nama yang DIEKSPOR modul lain. Nama itu pasti bukan variabel lokal yang
  // kebetulan sama, dan kalau dipanggil tanpa di-import, satu-satunya kemungkinan
  // adalah ReferenceError saat dijalankan.
  const lupaImport = [];
  for (const name of files) {
    // KOMENTAR DIBUANG DULU. Proyek ini komentarnya padat dan sering menyebut fungsi
    // modul lain sebagai rujukan ("lihat renderAll() di app.js"). Tanpa langkah ini
    // penjaganya menuduh 20-an rujukan semacam itu sebagai panggilan sungguhan, dan
    // penjaga yang berisik selalu berakhir dimatikan orang.
    //
    // Atribut markup (`onclick="namaFungsi(...)"`) juga dibuang. Itu BUKAN panggilan
    // JavaScript dari modul ini — namanya diselesaikan lewat window saat diklik, dan
    // pendaftarannya sudah dijaga terpisah oleh pemeriksaan HANDLERS di bawah.
    // Menuntutnya di-import justru salah: render.js memang tidak boleh meng-import
    // tables.js (lingkaran modul), dan itulah alasan pola window dipakai.
    const code = source[name]
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/\bon[a-z]+="[^"]*"/g, ' ');

    // Milik modul ini sendiri: DEKLARASI saja, di tingkat mana pun.
    //
    // Versi pertama penjaga ini juga menambahkan `/([A-Za-z_$][\w$]*)\s*(?:=>|\()/`
    // dengan maksud menangkap parameter fungsi — dan itu membuat penjaganya SIA-SIA
    // total: pola `nama(` ikut mencocoki setiap PEMANGGILAN, jadi tiap nama yang
    // dipanggil otomatis dianggap milik sendiri lalu dilewati. Ketahuan waktu uji
    // mutasi: mengembalikan bug aslinya (hentikanLiveFusion dihapus dari import)
    // tetap hijau. Penjaga yang tidak bisa merah tidak menjaga apa pun.
    const milikSendiri = new Set(
      [...code.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)]
        .map((m) => m[1]));
    for (const imported of importsOf(code)) {
      for (const symbol of imported.names) milikSendiri.add(symbol);
    }

    // Nama yang diekspor modul LAIN.
    const dariModulLain = new Map();
    for (const lain of files) {
      if (lain === name) continue;
      for (const ekspor of exported[lain]) {
        if (!dariModulLain.has(ekspor)) dariModulLain.set(ekspor, lain);
      }
    }

    // Dipanggil sebagai fungsi: `nama(`. Yang didahului titik (`obj.nama(`) dilewati —
    // itu properti, bukan pengenal bebas.
    for (const m of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const dipakai = m[2];
      if (milikSendiri.has(dipakai)) continue;
      if (!dariModulLain.has(dipakai)) continue;
      lupaImport.push(`${name}: memanggil '${dipakai}()' tapi tidak meng-import-nya ` +
        `(diekspor ${dariModulLain.get(dipakai)})`);
    }
  }
  assert.deepStrictEqual([...new Set(lupaImport)], [],
    `nama dipakai tapi tidak di-import — ReferenceError saat dijalankan:\n  ` +
    `${[...new Set(lupaImport)].join('\n  ')}`);

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

  // Halaman Import dan Master Dealer tidak punya filter (periode/kelurahan tidak
  // berlaku), jadi bilahnya disembunyikan di situ. Kalau baris ini hilang, bilah yang
  // tidak mengendalikan apa pun tetap tampil dan menyaring di situ terasa seperti
  // aplikasinya rusak.
  const switchBody = source['tables.js'].slice(
    source['tables.js'].indexOf('export function switchTab'));
  const switchBodyFn = switchBody.slice(0, switchBody.indexOf('\n}'));
  assert.match(switchBodyFn, /filter-bar'\)\.classList\.toggle\('hidden',/,
    'switchTab tidak lagi menyembunyikan bilah filter');
  const daftarTanpaFilter = /const TANPA_FILTER = (\[[^\]]*\]);/.exec(switchBodyFn);
  assert.ok(daftarTanpaFilter, 'daftar halaman tanpa bilah filter tidak ditemukan di switchTab');
  assert.match(daftarTanpaFilter[1], /'import'/, 'halaman Import tidak dikecualikan dari bilah filter');
  assert.match(daftarTanpaFilter[1], /'dealer'/, 'halaman Master Dealer tidak dikecualikan dari bilah filter');
  assert.match(switchBodyFn, /S\.filterPage = name/,
    'switchTab tidak menyetel halaman filter yang aktif — tabelnya akan digambar ' +
    'dengan filter halaman sebelumnya');

  // Dua kendali milik halaman Confidence Fusion (LIVE dan "Cakupan Sumber") pindah ke
  // bilah filter GLOBAL pada 2026-09-17 atas permintaan tim, di sebelah ikon Proporsi
  // Penjualan. Bilah itu dipakai HAMPIR SEMUA halaman, jadi keduanya wajib
  // disembunyikan di luar halaman Fusion. Kalau tidak: tombol LIVE tampil di Master
  // Pos Dealer, dan menekannya memutar filter Kota tiap 3,5 detik di halaman yang
  // bahkan tidak memegang petanya — persis kelas bug "interval tertinggal di halaman
  // tak terlihat" yang sudah pernah terjadi pada panel Performa.
  // SEMUA pencarian di blok ini memakai htmlTanpaKomentar, bukan html mentah — alasan
  // yang sama persis dengan yang ditulis di atas: komentar di sebelah bilah filter
  // menyebut <main> sebagai prosa, dan pencarian polos akan menemukan kalimat itu,
  // bukan tagnya. Saya sendiri baru terjebak di situ waktu menulis penjaga ini.
  assert.ok(htmlTanpaKomentar.includes('id="fx-kendali"'),
    'blok kendali Fusion (#fx-kendali) hilang dari markup');
  assert.ok(htmlTanpaKomentar.indexOf('id="fx-kendali"')
    > htmlTanpaKomentar.indexOf('id="filter-bar"'),
    '#fx-kendali tidak berada di dalam bilah filter');
  assert.ok(htmlTanpaKomentar.indexOf('id="fx-kendali"')
    < htmlTanpaKomentar.indexOf('<main'),
    '#fx-kendali jatuh ke dalam <main> — bilah filter ada di LUAR area yang menggulir');

  // Kurung tutup pertama sesudahnya memang milik pembungkusnya: isinya cuma <button>,
  // tidak ada <div> bersarang yang bisa menyesatkan pencarian non-greedy ini.
  const blokKendali = /<div id="fx-kendali"[\s\S]*?<\/div>/.exec(htmlTanpaKomentar);
  assert.ok(blokKendali, 'pembungkus #fx-kendali tidak utuh');
  assert.ok(blokKendali[0].includes('id="fx-live"'),
    'tombol LIVE tidak ada di dalam #fx-kendali');
  assert.ok(blokKendali[0].includes('toggleCakupanPanel()'),
    'tombol Cakupan Sumber tidak ada di dalam #fx-kendali');

  // Id ganda = tombol lama belum dibuang dari kepala halaman Fusion. Gejalanya jahat:
  // syncTombolLive() cuma menemukan yang pertama, jadi salah satu tombol berhenti
  // menunjukkan keadaan menyala/mati sementara keduanya tetap bisa ditekan.
  assert.strictEqual((htmlTanpaKomentar.match(/id="fx-live"/g) || []).length, 1,
    'id fx-live muncul lebih dari sekali di markup');

  assert.match(switchBodyFn,
    /fx-kendali'\)[\s\S]*?classList\.toggle\('hidden', name !== 'fusion'\)/,
    'switchTab tidak menyembunyikan kendali Fusion (#fx-kendali) di halaman lain');

  /* --------------------------------------------------------------------
     TATA LETAK 12x12 HALAMAN CONFIDENCE FUSION — REVISI 2026-09-18
     --------------------------------------------------------------------
     Letak tiap blok DIMINTA tim secara spesifik, kolom dan baris disebut satu per
     satu. Penjaga lain di berkas ini cuma memastikan id-nya ada dan handlernya
     terdaftar — semuanya tetap hijau walaupun seluruh tata letaknya bergeser.

     Letaknya ditulis eksplisit (col-start/row-start) justru supaya bisa dijaga:
     dengan penempatan otomatis CSS grid, blok bertinggi beda-beda bisa terselip ke
     celah yang kebetulan kosong, dan tidak ada string apa pun yang bisa diperiksa.

     Pita kiri (kolom 1-5) menyempit dari kolom 1-7 sebelumnya — dikorbankan supaya
     Matriks/Dealer di pita kanan bisa diperlebar (permintaan tim). Peta juga
     kehilangan tinggi (7 baris -> 4 baris) supaya Golongan Final dan Venn — yang
     sekarang DUA BLOK TERPISAH, bukan satu blok bermode-dua seperti sebelumnya —
     sama-sama dapat ruang tanpa gulir.
     -------------------------------------------------------------------- */
  const gridFusion = /<div id="fusion-isi"([^>]*)>/.exec(htmlTanpaKomentar);
  assert.ok(gridFusion, 'kerangka grid #fusion-isi hilang dari markup');
  assert.match(gridFusion[1], /grid-cols-12/, '#fusion-isi bukan lagi 12 kolom');
  assert.match(gridFusion[1], /grid-rows-12/, '#fusion-isi bukan lagi 12 baris');

  // kolom & baris persis seperti yang diminta, satu baris per blok.
  //
  // DIREVISI LAGI 2026-09-18 sore setelah tim melihat hasilnya di layar:
  //   - Golongan Final dan Venn BERDAMPINGAN (3+3 kolom), bukan bertumpuk. Gabungan
  //     lebarnya persis selebar satu blok pita kiri, dan keduanya jadi lebih tinggi
  //     (5 baris) — pie dan Venn sama-sama bulat, tingginya yang menentukan ukuran.
  //   - Pita kiri 5 -> 6 kolom dan Matriks 4 -> 3 kolom: kolom nama kota di Matriks
  //     dirampingkan (130px -> 96px), jadi ruang yang tadinya terbuang di sana
  //     dikembalikan ke peta.
  const letakDiminta = [
    ['Wadah 2x2 empat KPI', 'col-start-1 col-span-6 row-start-1 row-span-2'],
    ['Tampilan Peta', 'col-start-1 col-span-6 row-start-3 row-span-5'],
    ['Golongan Final', 'col-start-1 col-span-3 row-start-8 row-span-5'],
    ['Venn', 'col-start-4 col-span-3 row-start-8 row-span-5'],
    ['Matriks / Peringkat Kota', 'col-start-7 col-span-3 row-start-1 row-span-12'],
    ['Peringkat Dealer', 'col-start-10 col-span-3 row-start-1 row-span-12'],
  ];
  for (const [blok, kelas] of letakDiminta) {
    assert.ok(htmlTanpaKomentar.includes(kelas),
      `blok "${blok}" tidak lagi di posisi yang diminta tim (${kelas})`);
  }

  // Isi tiap blok harus benar-benar DI DALAM bloknya, bukan sekadar kebetulan ada
  // kelas itu di suatu tempat. Diperiksa lewat urutan kemunculan berturut-turut.
  const posKpi = htmlTanpaKomentar.indexOf('col-start-1 col-span-6 row-start-1');
  const posPeta = htmlTanpaKomentar.indexOf('col-start-1 col-span-6 row-start-3');
  const posHost = htmlTanpaKomentar.indexOf('id="fx-peta-host"');
  const posFinal = htmlTanpaKomentar.indexOf('col-start-1 col-span-3 row-start-8');
  const posGolonganFinal = htmlTanpaKomentar.indexOf('id="fx-golongan-final"');
  const posVennBlok = htmlTanpaKomentar.indexOf('col-start-4 col-span-3 row-start-8');
  const posVenn = htmlTanpaKomentar.indexOf('id="fx-venn"');
  assert.ok(posKpi < posPeta && posPeta < posHost && posHost < posFinal,
    '#fx-peta-host tidak berada di dalam blok Tampilan Peta (kolom 1-6, baris 3-7)');
  assert.ok(posFinal < posGolonganFinal && posGolonganFinal < posVennBlok,
    '#fx-golongan-final tidak berada di dalam bloknya sendiri (kolom 1-3, baris 8-12)');
  assert.ok(posVennBlok < posVenn,
    '#fx-venn tidak berada di dalam bloknya sendiri (kolom 4-6, baris 8-12)');

  // BERDAMPINGAN, bukan bertumpuk: keduanya mulai di BARIS yang sama dan di KOLOM
  // yang berbeda. Ini inti permintaannya, jadi dijaga sebagai sifat — bukan cuma
  // lewat dua string kelas di daftar atas yang bisa saja ikut diganti sekaligus.
  assert.ok(/col-start-1 col-span-3 row-start-8 row-span-5/.test(htmlTanpaKomentar)
    && /col-start-4 col-span-3 row-start-8 row-span-5/.test(htmlTanpaKomentar),
    'Golongan Final dan Venn harus mulai di baris yang SAMA (8) pada kolom berbeda ' +
    '(1 dan 4) — kalau salah satunya pindah baris, keduanya bertumpuk lagi');

  // Gabungan lebar keduanya harus SAMA dengan lebar satu blok pita kiri (6 kolom).
  // Kalau tidak, salah satunya menggantung dan pita kirinya jadi tidak rata.
  assert.strictEqual(3 + 3, 6,
    'Golongan Final (3) + Venn (3) harus sama dengan lebar pita kiri (6 kolom)');

  // EMPAT KPI jadi EMPAT sel terpisah (Cakupan Sumber ditambahkan 2026-09-18). Dulu
  // tiga sel menumpuk di satu #fx-summary sebelum itu pun — kalau id lama itu hidup
  // lagi, tata letak barunya diam-diam tidak terpakai.
  for (const id of ['fx-catatan', 'fx-kpi-pelanggan', 'fx-kpi-cw', 'fx-kpi-ratio', 'fx-kpi-cakupan']) {
    assert.ok(htmlTanpaKomentar.includes(`id="${id}"`), `slot #${id} hilang dari markup`);
  }
  assert.ok(!htmlTanpaKomentar.includes('id="fx-summary"'),
    '#fx-summary hidup lagi — KPI kembali menumpuk di satu sel');
  assert.ok(!source['fusion.js'].includes("'fx-summary'"),
    "fusion.js masih mengisi 'fx-summary' yang sudah tidak ada di markup");
  assert.ok(!source['fusion.js'].includes("'fx-kota'"),
    "fusion.js masih mengisi 'fx-kota'; blok itu sudah jadi mode di dalam #fx-matriks");

  // Golongan Final dan Venn BUKAN LAGI satu blok bermode-dua — dulu #fx-golongan
  // (bare) dengan tombol fx-mode-golongan/fx-mode-venn. Kalau salah satu hidup lagi,
  // tata letak dua-blok-terpisah yang baru diam-diam tidak terpakai.
  assert.ok(!htmlTanpaKomentar.includes('id="fx-golongan"'),
    '#fx-golongan (bare, satu blok bermode) hidup lagi — seharusnya sudah jadi ' +
    'dua blok terpisah #fx-golongan-final dan #fx-venn');
  for (const idLama of ['fx-mode-golongan', 'fx-mode-venn']) {
    assert.ok(!htmlTanpaKomentar.includes(`id="${idLama}"`),
      `#${idLama} hidup lagi — Golongan Final/Venn sudah tidak bermode lagi`);
  }
  // Dicocokkan sebagai DEKLARASI/EKSPOR, bukan substring bebas — komentar penjelas di
  // fusion.js sengaja menyebut nama lama ini untuk riwayat, dan itu bukan pelanggaran.
  assert.ok(!/function setModeGolongan\s*\(/.test(source['fusion.js']),
    'setModeGolongan masih jadi fungsi di fusion.js — seharusnya sudah diganti ' +
    'gambarGolonganFinal()/gambarVenn()');

  // Matriks dan Peringkat Kota SATU blok dua mode, polanya sama dengan Golongan/Venn
  // yang dulu ada di sini.
  for (const mode of ['matriks', 'kota']) {
    assert.ok(htmlTanpaKomentar.includes(`id="fx-mode-${mode}"`),
      `tombol mode "${mode}" hilang dari blok gabungan`);
    assert.ok(htmlTanpaKomentar.includes(`setModeMatriks('${mode}')`),
      `tombol mode "${mode}" tidak memanggil setModeMatriks('${mode}')`);
  }

  /* --------------------------------------------------------------------
     URUTKAN CONFIDENCE RATIO — Matriks/Peringkat Kota dan Peringkat Dealer
     --------------------------------------------------------------------
     Permintaan tim: kedua blok bisa diurutkan berdasarkan Confidence Ratio, bawaan
     dari yang paling RENDAH (paling perlu perhatian) dulu. Dua tombol terpisah —
     dua daftar berbeda bisa punya urutan berbeda pula.
     -------------------------------------------------------------------- */
  for (const [id, fungsi] of [['fx-sort-matriks', 'toggleSortMatriks'],
    ['fx-sort-dealer', 'toggleSortDealer']]) {
    assert.ok(htmlTanpaKomentar.includes(`id="${id}"`), `tombol urutkan #${id} hilang`);
    assert.ok(htmlTanpaKomentar.includes(`onclick="${fungsi}()"`),
      `tombol #${id} tidak memanggil ${fungsi}()`);
  }
  assert.ok(source['fusion.js'].includes('let arahSortMatriks = ') &&
    /arahSortMatriks\s*=\s*['"]asc['"]/.test(source['fusion.js']),
    "arahSortMatriks harus berawal 'asc' (confidence terendah dulu, bawaan)");
  assert.ok(source['fusion.js'].includes('let arahSortDealer = ') &&
    /arahSortDealer\s*=\s*['"]asc['"]/.test(source['fusion.js']),
    "arahSortDealer harus berawal 'asc' (confidence terendah dulu, bawaan)");

  /* --------------------------------------------------------------------
     KETIGA FLYOUT NAVBAR HARUS BISA DIBUKA DENGAN KLIK
     --------------------------------------------------------------------
     Bukan cuma Import. Yang dijaga di sini SIFATNYA: menu yang hanya terbuka lewat
     mouseenter tidak ada sama sekali di perangkat sentuh — tidak ada galat, tidak ada
     yang terlihat rusak, menunya cuma tidak pernah muncul.

     Sudah kejadian pada Import sampai 2026-09-17: tombolnya langsung switchTab, dan
     ketiga bagiannya (Periode Tersimpan, Proses Impor, Riwayat Impor) hanya bisa
     dicapai dengan menggulir halamannya sendiri. Master dan Data kebetulan sudah benar;
     dimasukkan ke daftar yang sama supaya tidak ada yang diam-diam turun jadi
     hover-only lagi.
     -------------------------------------------------------------------- */
  const flyoutNav = [
    ['nav-master', 'toggleMasterMenu'],
    ['nav-data', 'toggleDataMenu'],
    ['nav-import', 'toggleImportMenu'],
  ];
  for (const [idTombol, fungsi] of flyoutNav) {
    // Tombolnya dan onclick-nya harus ada di ELEMEN YANG SAMA, jadi yang diambil
    // tag <button>-nya utuh lalu diperiksa isinya. Mencari id dan onclick secara
    // terpisah di seluruh berkas akan tetap lolos walaupun onclick-nya menempel di
    // tombol lain — penjaga yang terasa aman padahal tidak memeriksa apa-apa.
    const cocok = new RegExp(`<button[^>]*\\bid="${idTombol}"[^>]*>`).exec(htmlTanpaKomentar);
    assert.ok(cocok, `tombol #${idTombol} hilang dari navbar`);
    assert.ok(cocok[0].includes(`onclick="${fungsi}()"`),
      `#${idTombol} tidak membuka menunya lewat KLIK (${fungsi}()). Menu yang cuma ` +
      'terbuka lewat hover tidak bisa dipakai sama sekali di layar sentuh');
  }

  assert.ok(source['tables.js'].includes('export function toggleImportMenu'),
    'toggleImportMenu tidak lagi diekspor tables.js');

  /* --------------------------------------------------------------------
     IMPOR ULANG PER JENIS DATA
     --------------------------------------------------------------------
     Hapus sudah bisa per jenis sejak 2026-09-17 (hapusSumber), tapi impor ulang TIDAK:
     reimportPeriod() cuma menyetel bulan lalu menggiring orang ke wizard PENJUALAN.
     "Perbaiki Data Servis bulan ini saja" karena itu tidak punya jalan sama sekali.

     Tombolnya dibangun sebagai STRING di dalam template literal import.js, bukan
     ditulis di index.html. Yang TIDAK perlu dijaga di sini: pendaftaran ke window —
     pemindai handler di bagian 3 berkas ini membaca `onclick=` dari markup statis DAN
     dari SELURUH sumber modul (lihat loop `for (const name of files)` di atas), jadi
     nama yang lupa didaftarkan sudah merah di sana. Saya sempat mengira sebaliknya dan
     menulis asersi HANDLERS kembar di sini; uji mutasi yang menunjukkannya — mutasinya
     merah di penjaga lama, bukan di asersi saya.

     Yang benar-benar tidak dijaga siapa pun, dan karena itu diperiksa di bawah:
     tombolnya ADA, dan urutan pemanggilan di dalam reimportSumber() benar.
     -------------------------------------------------------------------- */
  assert.ok(source['import.js'].includes('export function reimportSumber'),
    'import.js tidak lagi mengekspor reimportSumber()');
  // `onclick="` ikut dicocokkan, bukan cuma nama fungsinya: deklarasinya sendiri
  // (`export function reimportSumber(`) memuat nama itu juga, jadi memeriksa namanya
  // saja adalah asersi yang TIDAK PERNAH bisa merah selama fungsinya ada — penjaga
  // yang terlihat bekerja padahal tidak memeriksa apa pun.
  assert.ok(source['import.js'].includes('onclick="reimportSumber('),
    'daftar jenis data di Periode Tersimpan tidak lagi punya tombol impor ulang');

  // Urutannya bagian dari kebenarannya, bukan gaya penulisan: pilihSumber() MENOLAK
  // kalau bulannya belum dipilih, jadi memanggilnya sebelum periodenya disetel akan
  // memunculkan "pilih bulan dulu" untuk bulan yang jelas-jelas sudah ditunjuk orangnya.
  const badanReimport = source['import.js'].slice(
    source['import.js'].indexOf('export function reimportSumber'));
  const badanReimportFn = badanReimport.slice(0, badanReimport.indexOf('\n}'));
  assert.ok(badanReimportFn.includes('pilihSumber('),
    'reimportSumber() tidak membuka pemilih berkas; tombolnya cuma memindahkan bulan');
  assert.ok(badanReimportFn.indexOf('imp-bulan') < badanReimportFn.indexOf('pilihSumber('),
    'reimportSumber() memanggil pilihSumber() SEBELUM menyetel periodenya — ' +
    'pemilih berkasnya akan menolak dengan "pilih bulan dulu"');

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

  // Sejak 2026-08-31 sore, ring pindah ke DEALER (kecamatan) dan pos mendapat
  // coverage baru (kecamatan) — Master Pos Dealer sekarang punya SATU kolom ringkas,
  // bernama "Kec. Tercover" dan hanya DUA jenis sejak 2026-10-11 (dulu "Coverage", 8
  // jenis). Master Dealer yang punya tiga kolom Ring 1/2/3. Lihat docs/DECISIONS.md.
  assert.ok(html.includes('>Kec. Tercover</th>'), 'kolom "Kec. Tercover" hilang dari tabel pos');
  assert.ok(!html.includes('>Coverage</th>'), 'kolom lama "Coverage" masih ada — sudah diganti nama');
  ['Ring 1', 'Ring 2', 'Ring 3'].forEach((judul) => {
    assert.ok(html.includes(`>${judul}</th>`), `kolom "${judul}" hilang dari tabel dealer`);
  });

  const groupCellBody = source['tables.js'].slice(source['tables.js'].indexOf('function groupCell'));
  const groupCellPotong = groupCellBody.slice(0, groupCellBody.indexOf('\n}'));
  assert.match(groupCellPotong, /punya\[c\] === group/,
    'groupCell tidak lagi memilih kecamatan menurut ring/coverage-nya');

  // Namanya ditulis, bukan cuma jumlahnya — diminta tim. Tapi daftarnya DIBATASI:
  // satu ring/coverage bisa memuat belasan kecamatan, dan tanpa batas itu satu baris
  // tabel bisa setinggi sepuluh baris lain sampai tabelnya berhenti bisa dipindai.
  assert.match(groupCellPotong, /S\.districtNames\[c\] \|\| c/,
    'sel ring/coverage tidak lagi menyebut nama kecamatannya');
  assert.match(groupCellPotong, /slice\(0, RING_NAMA_TAMPIL\)/,
    'daftar nama kecamatan tidak lagi dibatasi — barisnya bisa jadi sangat tinggi');
  assert.match(groupCellPotong, /title="\$\{esc\(nama\.join\(', '\)\)\}"/,
    'nama lengkapnya tidak lagi tersedia di tooltip, padahal daftarnya dipotong');

  // Coverage ringkas (8 grup tidak muat sebagai kolom terpisah): jumlah kecamatan +
  // berapa grup terisi, rincian lengkap di tooltip.
  const coverageCellBody = source['tables.js'].slice(
    source['tables.js'].indexOf('function coverageCellRingkas'));
  const coverageCellPotong = coverageCellBody.slice(0, coverageCellBody.indexOf('\n}'));
  assert.match(coverageCellPotong, /S\.posCoverage\[outletCode\]/,
    'coverageCellRingkas tidak lagi membaca S.posCoverage');
  assert.match(coverageCellPotong, /jenis terisi/,
    'coverageCellRingkas tidak lagi melaporkan jumlah jenis terisi');

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
     EDIT RING DEALER (1-3) & COVERAGE POS (1-8) — per KECAMATAN sejak 2026-08-31
     sore, menggantikan ring per pos+kelurahan (KF-POS-18, KF-POS-19 versi lama)
     -------------------------------------------------------------------- */
  const ringSource = source['rings.js'];
  const mapSource = source['map.js'];

  // kelurahan-ring.geojson DIHAPUS TOTAL — ring/coverage sekarang di kecamatan,
  // memakai source `kec` yang sudah ada untuk referensi visual. Tidak ada lagi
  // berkas per-desa terpisah untuk fitur ini.
  assert.ok(!/kelurahan-ring\.geojson/.test(mapSource) && !/kelurahan-ring\.geojson/.test(ringSource),
    'kelurahan-ring.geojson masih dirujuk — ring/coverage seharusnya sudah pindah ke kecamatan');
  assert.ok(!/addRingVillageLayers|ringVillagesLoaded/.test(mapSource),
    'layer batas desa untuk edit ring (kel-ring-*) masih ada — seharusnya digantikan kec-isi');

  // KEBALIKAN dari keputusan 2026-08-31 (dulu: dimuat saat diminta). Sejak 2026-10-10
  // KECAMATAN satuan analisis peta — yang diwarnai, diklik, dan disorot — jadi
  // berkasnya WAJIB dimuat di boot, dan yang diwarnai harus source `kec`, bukan `kel`.
  // Berkasnya 0,6 MB sejak lubang sliver ditutup (bukan 3 MB lagi).
  assert.match(source['app.js'], /fetchGeo\('kecamatan\.geojson'\)/,
    'batas kecamatan tidak dimuat di boot — padahal itu yang diwarnai heatmap');
  assert.match(mapSource, /id: 'kec-warna', type: 'fill', source: 'kec'/,
    'isian heatmap kecamatan (kec-warna) hilang');
  assert.match(mapSource, /setFeatureState\(\{ source: 'kec', id: f\.properties\.kode \}/,
    'paintChoropleth tidak mewarnai source kecamatan');
  assert.ok(!/id: 'kel-isi'/.test(mapSource),
    'isian per DESA (kel-isi) muncul lagi — analisis berhenti di kecamatan, desa ' +
    'tinggal garis referensi');
  // Kecamatan KOSONG (nol penjualan): TANPA isian dan garisnya ABU-ABU (2026-10-11),
  // lewat lapisan tersendiri di atas kec-garis supaya putih milik tetangga yang berisi
  // tidak menimpa abu-abu di tepi yang dipakai bersama. paintChoropleth() yang menandai
  // `kosong` di feature-state; tanpa tanda itu lapisan abu-abu tidak pernah terlihat.
  const mapTanpaKomentarBaru = mapSource
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(mapTanpaKomentarBaru, /id: 'kec-garis-kosong', type: 'line', source: 'kec'/,
    'lapisan garis kecamatan kosong (kec-garis-kosong) hilang');
  assert.match(mapTanpaKomentarBaru, /'line-color': '#94a3b8'/,
    'garis kecamatan kosong tidak lagi abu-abu');
  assert.match(mapTanpaKomentarBaru, /id: 'kec-garis', type: 'line', source: 'kec',\s*paint: \{ 'line-color': '#ffffff'/,
    'garis kecamatan berisi tidak lagi putih');
  assert.match(mapTanpaKomentarBaru, /\{ warna, kosong: cls < 0 \}/,
    'paintChoropleth tidak lagi menandai kecamatan kosong di feature-state');
  assert.match(mapTanpaKomentarBaru, /\['kec-garis', 'kec-garis-kosong', 'kec-nama'\]/,
    'garis abu-abu tidak ikut sakelar "Batas dan Nama Kecamatan"');

  // Fitur yang DIHAPUS 2026-10-11 tidak boleh hidup lagi di map.js: titik penjualan
  // (lapisan + pembangkitnya), lingkaran radius KPI Jarak di peta, mode heatmap tetap.
  ['jual-titik', "getSource('jual')", 'buildSalePoints', 'invalidateSalePoints', 'salePointFilter',
    'kpi-jarak', 'bangunRadiusKpi', 'fetchKpiJarak', 'fixedContributionClass', 'heatmapMode',
    'setHeatmapMode'].forEach((kata) => {
    assert.ok(!mapTanpaKomentarBaru.includes(kata), `"${kata}" muncul lagi di map.js`);
  });
  ['toggleOpsiPeta', 'setStatusRelatif'].forEach((nama) => {
    assert.match(mapSource, new RegExp(`export function ${nama}`), `${nama} hilang dari map.js`);
    assert.match(source['app.js'], new RegExp(`\\b${nama}\\b`), `${nama} tidak didaftarkan app.js`);
  });
  assert.ok(!/addDistrictLayers\(\)/.test(ringSource),
    'editor ring masih memuat kecamatan sendiri — lapisannya sudah dipasang di boot');
  // Lapisan desa disimpan (permintaan user: jangan dihapus), tapi MATI bawaan.
  assert.match(html, /id="opt-kelurahan" onchange=/,
    'sakelar Batas Desa harus ada dan TIDAK tercentang bawaan');
  assert.match(mapSource, /id: 'kel-garis', type: 'line', source: 'kel',\s*layout: \{ visibility: 'none' \}/,
    'garis desa tidak mati bawaan');

  // kec-isi: satu layer fill dipakai BERGANTIAN oleh editor ring dealer dan editor
  // coverage pos (tidak pernah aktif bersamaan) — beda dari kel-ring-isi lama yang
  // eksklusif milik satu pos yang sedang disunting.
  assert.match(mapSource, /id: 'kec-isi', type: 'fill'/,
    'layer kec-isi (target klik + sorotan ring/coverage) hilang dari addDistrictLayers()');

  // setGroupPaint (pengganti setRingPaint): satu fungsi dipakai KEDUA editor, tabel
  // warna dioper sebagai parameter — bukan lagi RING_WARNA hardcode di dalamnya.
  const paintBody = mapSource.slice(mapSource.indexOf('export function setGroupPaint'));
  const paintPotong = paintBody.slice(0, paintBody.indexOf('\n}'));
  assert.match(paintPotong, /setLayoutProperty\('kec-isi', 'visibility', draft \? 'visible' : 'none'\)/,
    'setGroupPaint tidak lagi menyalakan/mematikan lapisan kec-isi sendiri');
  assert.ok(!/redrawMap\(\)/.test(paintPotong),
    'setGroupPaint memanggil redrawMap() lagi — lapisan ring/coverage sudah independen, ' +
    'tidak perlu lagi menitipkan keputusan tampil/tidak ke fungsi lain');

  // Satu kecamatan tidak boleh berada di dua kelompok (ring ATAU coverage) sekaligus.
  // Di database dijaga primary key; di halaman dijaga bentuk datanya — satu kunci,
  // satu nilai. Logika assign()-nya ada di dalam createGroupEditor (dipakai dua
  // instance, dealer & pos), dicari lewat closure-nya, bukan fungsi top-level.
  const factoryBody = ringSource.slice(ringSource.indexOf('function createGroupEditor'));
  assert.match(factoryBody.slice(0, factoryBody.indexOf('return { editing, startFor')),
    /draft\[dipilih\] = nomor/,
    'kecamatan tidak lagi disimpan sebagai satu nilai per kode — dua kelompok bisa ' +
    'memiliki kecamatan yang sama, dan penjualannya terhitung dua kali');

  // Klik kecamatan membuka pemilih dengan nama dari properti FITUR kecamatan.geojson
  // (semua 654 kecamatan, termasuk yang belum ada penjualannya), bukan cuma
  // S.districtNames — konsisten dengan alasan yang sama seperti versi kelurahan dulu.
  assert.match(mapSource,
    /window\.openRingChooser\(f\.properties\.kode, f\.properties\.nama, e\.originalEvent\)/,
    'klik kecamatan tidak lagi membuka pemilih dengan nama dari fitur');
  assert.match(ringSource, /function openChooser\(code, name, event\)/,
    'openChooser tidak lagi menerima nama sebagai argumen terpisah dari S.districtNames');
  assert.ok(html.includes('id="ring-pilih"'), 'pemilih ring/coverage hilang dari markup');

  // Tombol kelompok (1..groupCount) DIRENDER DINAMIS ke #rp-tombol-ring — bukan lagi
  // 3 tombol statis di HTML, karena coverage pos butuh 8 slot bukan 3.
  assert.ok(html.includes('id="rp-tombol-ring"'),
    'kontainer tombol kelompok dinamis hilang dari pemilih kecamatan');
  assert.match(ringSource, /Array\.from\(\{ length: groupCount \}/,
    'tombol kelompok tidak lagi dirender dinamis sesuai groupCount (3 untuk ring, 8 untuk coverage)');
  assert.ok(html.includes('onclick="assignRing(0)"'),
    'tombol melepas kecamatan dari kelompok hilang — sekali salah pilih, tidak ada jalan ' +
    'membatalkannya selain menyimpan yang salah');

  // Tombol quick-access (pojok peta, #map-top-buttons) muncul waktu scope DEALER
  // (buka editor ring) ATAU scope POS (buka editor coverage) — labelnya ikut scope.
  // Sejak 2026-09-14: kembarannya di bilah "Heatmap dihitung terhadap:" (scope-bar)
  // dihapus bersama blok itu — btn-ring-peta sudah cukup, dua tombol untuk aksi
  // yang sama cuma duplikasi.
  assert.match(source['app.js'],
    /const bisaEditGroup = dealerScope \|\| posScope;/,
    'tombol edit ring/coverage tidak lagi dibatasi ke lingkup satu dealer ATAU satu pos');
  ['btn-ring-peta'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `tombol ${id} hilang dari markup`);
    assert.ok(new RegExp(`\\$\\('${id}'\\)\\.classList\\.toggle\\('hidden', !bisaEditGroup\\)`)
      .test(source['app.js']),
      `tombol ${id} tidak ikut aturan "hanya waktu dealer atau pos dipilih"`);
  });
  assert.ok(html.includes('onclick="startGroupEdit()"'),
    'tombol edit ring/coverage tidak lagi memanggil dispatcher startGroupEdit()');

  /* --------------------------------------------------------------------
     PANEL ANALISIS PERFORMA POS
     -------------------------------------------------------------------- */
  const renderSource = source['render.js'];

  // Satu sumber data (performanceByOutlet, dipanggil SEKALI). panel-performa dan
  // fp-performa (tampilan besar) berbagi `bodyWide` yang SATU; fs-performa (layar
  // penuh peta, w-80) pakai `bodyCompact` — field yang SAMA dari `list` yang SAMA,
  // cuma kemasannya lebih ringkas. Kalau salah satu menghitung ulang sendiri, angka
  // berbeda bisa tampil bersamaan dan tidak ada yang tahu mana yang benar.
  const perfBody = renderSource.slice(renderSource.indexOf('export function renderPerformance'));
  const perfPotong = perfBody.slice(0, perfBody.indexOf('\n}'));
  assert.match(perfPotong, /const \{ list, counts \} = performanceByOutlet\(rows\);/,
    'daftar performa tidak lagi dihitung sekali dari performanceByOutlet');
  assert.match(perfPotong, /\$\('fp-performa'\)[^=]*= bodyWide/,
    'fp-performa tidak lagi digambar dari daftar wide yang sama');
  // Sejak 2026-09-14 malam: panel-performa (mode biasa) dipisah dari bodyWide —
  // ringkasan+sort-by+papan kelompok pindah ke ringkas-jangkauan (tetap diam),
  // panel-performa cuma dapat baris pos (rowsHtml) supaya bisa gulir sendiri.
  assert.match(perfPotong, /const rowsHtml = list\.length \? list\.map\(performanceRowWide\)/,
    'panel-performa (mode biasa) tidak lagi memakai baris performanceRowWide yang sama dengan bodyWide');
  assert.match(perfPotong, /\$\('panel-performa'\)[^=]*= rowsHtml/,
    'panel-performa tidak lagi digambar dari rowsHtml (baris saja, tanpa controls/groupBoard)');
  assert.match(perfPotong, /\$\('ringkas-jangkauan'\)[^=]*= summary \+ controls \+ performanceGroupBoard\(counts\)/,
    'ringkas-jangkauan tidak lagi menggabung summary+controls+groupBoard (mode biasa)');
  assert.match(perfPotong, /\$\('fs-performa'\)[^=]*= bodyCompact/,
    'fs-performa tidak lagi digambar dari daftar compact yang sama');

  // Gulir otomatis WAJIB dihentikan waktu tampilan besarnya ditutup. Interval yang
  // tertinggal terus berjalan di panel yang tidak terlihat, dan tombolnya tetap
  // menyala tanpa ada yang bergerak. Lewat stopLivePerforma() — BUKAN
  // toggleLivePerforma() — supaya livePerformaPaused tidak ikut ke-set: panel normal
  // yang jadi terlihat sesudah modal ditutup harus tetap auto-mulai lagi sendiri.
  const tutupBody = renderSource.slice(renderSource.indexOf('export function closePerformaFull'));
  const tutupPotong = tutupBody.slice(0, tutupBody.indexOf('\n}'));
  assert.match(tutupPotong, /stopLivePerforma\(\)/,
    'menutup tampilan besar tidak menghentikan gulir otomatis — intervalnya bocor');
  assert.doesNotMatch(tutupPotong, /livePerformaPaused\s*=/,
    'menutup tampilan besar ikut menandai livePerformaPaused — panel normal jadi tidak auto-mulai lagi');
  const stopBody = renderSource.slice(renderSource.indexOf('function stopLivePerforma'));
  assert.match(stopBody.slice(0, stopBody.indexOf('\n}')), /clearInterval\(S\.livePerforma\)/,
    'gulir otomatis tidak pernah dihentikan dengan clearInterval');

  // Gulir performa default JALAN begitu ada isinya (sama seperti gulir wilayah),
  // bukan menunggu tombol Live diklik dulu — permintaan eksplisit "live dashboard
  // ... on" untuk panel ini.
  assert.match(perfPotong, /autoStartPerforma\(\);/,
    'renderPerformance tidak lagi memanggil autoStartPerforma — gulir tidak auto-mulai');
  const autoStartBody = renderSource.slice(renderSource.indexOf('function autoStartPerforma'));
  assert.match(autoStartBody.slice(0, autoStartBody.indexOf('\n}')),
    /S\.livePerforma \|\| S\.livePerformaPaused/,
    'autoStartPerforma tidak lagi menghormati livePerformaPaused — Pause manual akan diabaikan');

  /* --------------------------------------------------------------------
     BLOK ANALISIS PENJUALAN WILAYAH (putaran ketiga, 2026-08-31)
     -------------------------------------------------------------------- */
  ['panel-wilayah', 'fs-wilayah', 'fs-performa-grup', 'fs-wilayah-grup',
    'btn-live-wilayah', 'btn-live-wilayah-fs'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `elemen ${id} hilang dari markup`);
  });

  // Auto-loop SENDIRI — beda dari blok Performa Pos yang manual (Live). Dijaga oleh
  // DUA state: liveWilayah (sedang jalan atau tidak) dan liveWilayahPaused (user
  // pernah menekan Pause) — tanpa yang kedua, render ulang akan menyalakan lagi
  // interval yang sengaja dihentikan orang.
  assert.match(renderSource, /if \(S\.liveWilayah \|\| S\.liveWilayahPaused\) return;/,
    'auto-start Wilayah tidak lagi menghormati Pause yang sudah ditekan orang');
  assert.match(renderSource, /S\.liveWilayahPaused = true;/,
    'toggleLiveWilayah tidak lagi mencatat bahwa orang menekan Pause');

  // Panel kiri layar penuh peta: satu slot, dua grup — Wilayah tampil waktu dealer
  // ATAU pos difilter, Performa tampil sisanya. Kalau tidak pernah ditoggle
  // bersyarat, dua-duanya bisa tampil sekaligus dan menumpuk di satu slot sempit.
  const fsPanelBody = renderSource.slice(renderSource.indexOf('export function syncFullscreenPanels'));
  const syncPotong = fsPanelBody.slice(0, fsPanelBody.indexOf('\n}'));
  assert.match(syncPotong, /scopeValue\('dealer'\) !== 'ALL' \|\| scopeValue\('pos'\) !== 'ALL'/,
    'syncFullscreenPanels tidak lagi menimbang scope dealer ATAU pos');
  assert.match(syncPotong, /fs-performa-grup[^;]*hidden['"], wilayah\)/,
    'grup Performa tidak lagi disembunyikan waktu Wilayah tampil');
  assert.match(syncPotong, /fs-wilayah-grup[^;]*hidden['"], !wilayah\)/,
    'grup Wilayah tidak lagi disembunyikan waktu Performa tampil');

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

  // Nama kecamatan bisa dinyalakan/dimatikan lewat Opsi Peta (KF-PETA-17) — toggle
  // garis + label (kec-garis/kec-nama), NYALA bawaan sejak kecamatan jadi satuan
  // analisis (2026-10-10), independen dari kec-isi (target klik + sorotan ring
  // dealer/coverage pos, dikendalikan setGroupPaint()/paintGroupView()).
  assert.ok(html.includes('id="opt-kecamatan" checked'),
    'sakelar Nama Kecamatan hilang dari Opsi Peta, atau tidak nyala bawaan');
  const redrawBody = mapSource.slice(mapSource.indexOf('export function redrawMap'));
  const redrawPotong = redrawBody.slice(0, redrawBody.indexOf('\nexport '));
  assert.match(redrawPotong, /on\('opt-kecamatan'\)/,
    'lapisan kecamatan tidak lagi menimbang sakelar Opsi Peta-nya sendiri');

  // Tombol Coverage di tabel Master Pos dan tombol Ring di tabel Master Dealer
  // mengantar ke peta, tidak membuka pemilih sendiri — kelompoknya memang dipilih
  // dengan mengklik kecamatan di peta.
  assert.ok(/editPosCoverageFromTable\('\$\{esc\(o\.code\)\}'\)/.test(source['tables.js']),
    'tombol Coverage hilang dari kolom Aksi tabel Master Pos');
  assert.ok(/editDealerRingFromTable\('\$\{esc\(d\.code\)\}'\)/.test(source['tables.js']),
    'tombol Ring hilang dari kolom Aksi tabel Master Dealer');
  const dariTabelPos = source['tables.js'].slice(
    source['tables.js'].indexOf('export function editPosCoverageFromTable'));
  assert.match(dariTabelPos.slice(0, dariTabelPos.indexOf('\n}')), /switchTab\('peta'\)/,
    'tombol Coverage di tabel pos tidak lagi mengantar ke peta');
  const dariTabelDealer = source['tables.js'].slice(
    source['tables.js'].indexOf('export function editDealerRingFromTable'));
  assert.match(dariTabelDealer.slice(0, dariTabelDealer.indexOf('\n}')), /switchTab\('peta'\)/,
    'tombol Ring di tabel dealer tidak lagi mengantar ke peta');

  // Tiap dropdown lingkup punya rumahnya sendiri di bilah; isinya dibangun combobox.js.
  // Urutan skala: Kares > Kota > Kec > Dealer > Pos (Kec ditambahkan 2026-10-11).
  const urutanDropdown = ['kares', 'kota', 'kec', 'dealer', 'pos'];
  urutanDropdown.forEach((nama) => {
    assert.ok(html.includes(`id="pilih-${nama}"`), `dropdown ${nama} hilang dari bilah`);
  });
  const posisiDropdown = urutanDropdown.map((nama) => html.indexOf(`id="pilih-${nama}"`));
  assert.deepStrictEqual([...posisiDropdown].sort((a, b) => a - b), posisiDropdown,
    'urutan dropdown di bilah bukan Kares > Kota > Kec > Dealer > Pos');

  // Panel rincian kelurahan tidak boleh menempati sudut yang sama dengan tombol peta.
  // Keduanya `absolute` di dalam #map-shell; waktu top-nya sama, panelnya menutupi
  // tombol Layar penuh dan Fit sampai tidak bisa ditekan sama sekali.
  const tombolPeta = html.match(/<div id="map-top-buttons" class="absolute (top-\d+) left-6 z-20/);
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

  // Panel Opsi Peta TERSEMBUNYI bawaan dan dibuka tombol "Set Tampilan Peta" di pojok
  // kanan atas (2026-10-11). Legenda pindah ke kartunya sendiri supaya warna peta tetap
  // terbaca walau panel opsi tertutup; bagian "Dealer" di dasar panel dihapus.
  assert.match(html, /<div id="opsi-peta-panel" class="hidden /,
    'panel Opsi Peta tidak lagi tersembunyi bawaan');
  assert.match(html, /<button onclick="toggleOpsiPeta\(\)" id="btn-opsi-peta"[\s\S]*?Set Tampilan Peta/,
    'tombol "Set Tampilan Peta" hilang');
  assert.match(html, /id="btn-opsi-peta"[^>]*\n?[^>]*class="[^"]*\btop-6 right-6\b/,
    'tombol Set Tampilan Peta tidak lagi di pojok kanan atas');
  const opsiBlok = html.slice(html.indexOf('>Opsi Peta<') - 400,
    html.indexOf('id="legend-card"'));
  assert.ok(!/id="legend-dealer"/.test(html), 'bagian Dealer (legend-dealer) muncul lagi');
  assert.ok(!/<summary[^>]*>Dealer<\/summary>/.test(html),
    'bagian "Dealer" di dasar Opsi Peta muncul lagi');
  assert.match(html, /<details id="legend-card"[^>]*>\s*<summary[^>]*><span id="legend-title">/,
    'legenda tidak lagi dilipat di kartunya sendiri');
  assert.ok(!/<details id="legend-card"[^>]*open/.test(html),
    'lipatan legenda terbuka secara bawaan');
  assert.ok(!/id="legend"/.test(opsiBlok), 'legenda masih tertinggal di dalam panel Opsi Peta');
  // Isi Opsi Peta: titik penjualan, radius KPI, dan mode heatmap "Per Nilai Kontribusi"
  // dihapus; tiga titik sumber NYALA bawaan; saklar status kelompok relatif nyala bawaan.
  ['opt-jual', 'opt-kpi-jarak', 'setHeatmapMode', 'hm-fixed', 'Per Nilai Kontribusi',
    'Titik Penjualan', 'Radius KPI'].forEach((kata) => {
    assert.ok(!html.includes(kata), `"${kata}" muncul lagi di index.html`);
  });
  ['opt-titik-ktp', 'opt-titik-servis', 'opt-titik-kirim', 'opt-status-relatif'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}" checked `),
      `${id} tidak lagi NYALA bawaan`);
  });
  assert.match(html, /<summary[^>]*>Status Kelompok Relatif<\/summary>/,
    'bagian "Status Kelompok Relatif" hilang dari Opsi Peta');

  // Ring Dealer / Kec. Tercover: blok KONTEKSTUAL di tengah atas peta, bukan bagian
  // Opsi Peta. Tersembunyi bawaan; syncGroupControls() yang menampilkannya.
  assert.match(html, /id="blok-ring-dealer" class="hidden /, 'blok Ring Dealer tidak tersembunyi bawaan');
  assert.match(html, /id="blok-kec-tercover" class="hidden /, 'blok Kec. Tercover tidak tersembunyi bawaan');
  assert.ok(!/id="grup-ring-dealer"|id="grup-coverage-pos"/.test(html),
    'grup Ring Dealer/Coverage POS masih ada di dalam Opsi Peta');
  assert.ok(!/id="cv-[3-8]"/.test(html), 'tombol Kec. Tercover jenis 3..8 masih ada');
  assert.ok(html.indexOf('id="blok-ring-dealer"') > html.indexOf('id="konteks-peta"'),
    'blok Ring Dealer tidak berada di dalam #konteks-peta (tengah atas peta)');
  // Rumah bilah filter di layar penuh TIDAK boleh jadi wadah yang menggulir.
  //
  // Aturan `#map-shell.penuh .map-panel { overflow-y: auto }` memberi tiap panel
  // melayang gulirannya sendiri — masuk akal untuk panel berisi daftar, dan salah
  // untuk rumah bilah filter: dia cuma wadah, dan overflow di situ MEMOTONG dropdown
  // yang membuka ke bawah keluar kotaknya. Itu penyebab "dropdown-nya kepotong" yang
  // sempat dikira masalah z-index dan dikejar dua kali ke arah yang salah.
  //
  // Sejak 2026-09-14 malam: gaya biru #fs-filter-host DIPINDAH jadi gaya dasar
  // #filter-bar sendiri (dipakai juga di mode biasa) — #fs-filter-host jadi
  // wadah polos tanpa kelas `.map-panel` sama sekali, jadi pengecualian `:not()`
  // tidak perlu lagi: aturan overflow generiknya otomatis TIDAK PERNAH menyentuh
  // elemen yang bahkan tidak punya kelasnya.
  assert.match(html, /#map-shell\.penuh \.map-panel \{[^}]*overflow-y: auto/,
    'aturan overflow panel melayang (layar penuh) tidak ditemukan');
  assert.doesNotMatch(html, /id="fs-filter-host" class="[^"]*\bmap-panel\b/,
    'rumah bilah filter layar penuh ikut diberi kelas map-panel lagi — aturan ' +
    'overflow-y:auto generik akan memotong dropdown yang membuka ke bawah di dalamnya');

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
  // Daftar konsumen di panel kecamatan DIHAPUS 2026-10-11, jadi fetchCustomers() tidak
  // punya pemanggil lagi (rutenya sengaja dibiarkan, lihat CLAUDE.md). Yang dijaga: kalau
  // ada yang memanggilnya kembali, kode kecamatan WAJIB ikut — definisinya sendiri tidak
  // dihitung sebagai pemanggilan.
  const clientCalls = files.flatMap((name) =>
    [...source[name].matchAll(/(?<!function )fetchCustomers\(([^)]*)\)/g)].map((m) => m[1].trim()));
  clientCalls.forEach((args) => {
    assert.ok(args && !args.startsWith(','),
      `fetchCustomers dipanggil tanpa kode kecamatan: fetchCustomers(${args})`);
  });
  // fetchCustomers harus SELALU menyertakan kode kecamatan di query-nya (sejak
  // 2026-10-10; sebelumnya kelurahan). Rutenya menolak `village`.
  const fetchBody = source['api.js'].slice(
    source['api.js'].indexOf('export function fetchCustomers'));
  const bodyEnd = fetchBody.indexOf('\n}');
  assert.ok(/district['"]?\s*[:,]\s*districtCode/.test(fetchBody.slice(0, bodyEnd)),
    'fetchCustomers tidak menyertakan kode kecamatan di permintaannya');

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
     11. Lingkaran Radius (3/5/7/10 km) BENAR-BENAR hilang — diganti "Tampilkan
         Ring" (Bagian I, 2026-08-31, permintaan Pakbos). Kalau salah satu sisa ini
         nongol lagi, berarti pengganti dan yang lama sama-sama aktif dan
         membingungkan, bukan sekadar dua fitur berdampingan.
     ------------------------------------------------------------------------ */
  ['id="opt-radius"', 'id="pilihan-radius"', 'id="label-radius"'].forEach((needle) => {
    assert.ok(!html.includes(needle), `${needle} masih ada di markup — Lingkaran ` +
      'Radius/pilihan radius seharusnya sudah diganti total oleh Tampilkan Ring');
  });
  assert.ok(!/radius-isi|radius-garis/.test(mapSource),
    'lapisan lingkaran radius (radius-isi/radius-garis) masih ada di map.js — ' +
    'seharusnya sudah dihapus bersih, bukan cuma tombolnya yang disembunyikan');

  // Penggantinya sejak 2026-08-31 sore: DUA kontrol terpisah — "Ring Dealer" (Lokasi +
  // Ring 1-3) dan "Kec. Tercover" (Lokasi + jenis 1-2) — menyorot KECAMATAN, bukan
  // lingkaran geometris maupun desa. Sejak 2026-10-11 keduanya BLOK KONTEKSTUAL di tengah
  // atas peta (bukan bagian Opsi Peta): Ring Dealer hanya waktu tepat satu dealer dipilih,
  // Kec. Tercover hanya waktu tepat satu pos dipilih. Ikut redrawMap() lewat
  // syncGroupControls() supaya ganti dealer/pos otomatis memperbarui blok dan sorotannya.
  ['id="blok-ring-dealer"', 'id="pilihan-ring-dealer"', 'id="rv-lokasi"', 'id="rv-1"', 'id="rv-2"',
    'id="rv-3"', 'id="blok-kec-tercover"', 'id="pilihan-coverage-pos"', 'id="cv-lokasi"',
    'id="cv-1"', 'id="cv-2"'].forEach((needle) => {
    assert.ok(html.includes(needle), `${needle} hilang dari markup Ring Dealer/Kec. Tercover`);
  });
  assert.match(source['app.js'], /setRingViewDealer/,
    'setRingViewDealer tidak lagi diimpor/didaftarkan app.js');
  assert.match(source['app.js'], /setCoverageViewPos/,
    'setCoverageViewPos tidak lagi diimpor/didaftarkan app.js');
  assert.match(mapSource, /export function paintGroupView/, 'paintGroupView hilang dari map.js');
  assert.match(mapSource, /export function syncGroupControls/, 'syncGroupControls hilang dari map.js');
  assert.match(mapSource, /syncGroupControls\(\);/, 'redrawMap tidak lagi memanggil syncGroupControls()');
  assert.match(source['filters.js'], /window\.syncGroupControls/,
    'setScope tidak lagi memanggil syncGroupControls lewat window setiap scope berubah');
  // Konflik dengan mode edit: paintGroupView() WAJIB diam waktu sedang menyunting —
  // kalau tidak, draft yang sedang dikerjakan bisa tertimpa oleh sorotan lihat-saja.
  const groupViewBody = mapSource.slice(mapSource.indexOf('export function paintGroupView'));
  assert.match(groupViewBody.slice(0, groupViewBody.indexOf('\n}')),
    /window\.anyGroupEditing && window\.anyGroupEditing\(\)/,
    'paintGroupView tidak lagi mengalah ke mode edit ring/coverage yang sedang aktif');
  // Blok tampil/hilang (kelas `hidden`) mengikuti scope: Ring Dealer perlu dealer terpilih
  // TANPA pos, Kec. Tercover perlu pos terpilih. Pos menang karena memilih pos ikut
  // mengisi dealernya (filter berjenjang).
  assert.match(source['map.js'], /classList\.toggle\('hidden', !dealerAktif\)/,
    'blok Ring Dealer tidak lagi tampil/hilang mengikuti scope dealer');
  assert.match(source['map.js'], /classList\.toggle\('hidden', !posAktif\)/,
    'blok Kec. Tercover tidak lagi tampil/hilang mengikuti scope pos');
  assert.match(source['map.js'], /dealerAktif = scopeValue\('dealer'\) !== 'ALL' && !posAktif/,
    'Ring Dealer tidak lagi mengalah pada pos — memilih pos akan memunculkan DUA blok');
  assert.ok(!/classList\.toggle\('nonaktif'/.test(source['map.js']),
    'kontrol ring/coverage kembali hanya diredupkan (nonaktif), bukan disembunyikan');
  /* ------------------------------------------------------------------------
     12. tooltip peta menghitung dari sumber yang SAMA dengan petanya
     ------------------------------------------------------------------------
     Tooltip menampilkan angka di atas poligon yang sedang diwarnai choropleth. Kalau
     dia membaca S.sales langsung alih-alih activeRows(), angkanya berhenti mengikuti
     filter — poligon gelap karena satu dealer, tapi tooltipnya menyebut total semua
     dealer. Dua angka yang bertentangan di layar yang sama, tanpa satu pun error.
     ------------------------------------------------------------------------ */

  assert.ok(/districtTooltipData/.test(source['outlets.js']),
    'fungsi data tooltip kecamatan hilang dari outlets.js');
  assert.ok(!/S\.sales/.test(source['outlets.js']),
    'outlets.js membaca S.sales langsung. Tooltip harus lewat activeRows() supaya ' +
    'angkanya mengikuti filter yang sama dengan warna poligon di bawahnya');
  assert.ok(source['outlets.js'].includes('const rows = activeRows();'),
    'tooltip kecamatan tidak memakai activeRows()');

  // Dan tooltipnya harus benar-benar terpasang ke gerakan kursor, bukan cuma ada.
  assert.ok(source['app.js'].includes("S.map.on('mousemove', 'kec-warna'"),
    'tooltip kecamatan tidak terpasang ke mousemove — fungsinya ada tapi tidak pernah ' +
    'dipanggil, dan itu tidak membuat apa pun gagal');
  assert.ok(/showDistrictTooltip/.test(source['app.js']),
    'app.js tidak memanggil showDistrictTooltip');

  /* ------------------------------------------------------------------------
     2026-10-11 (putaran terakhir): hover ikon pos/dealer, legenda kiri-bawah, target
     ------------------------------------------------------------------------ */

  // 1. Marker DOM ada DI DALAM wadah kanvas, jadi kejadian mouse-nya naik ke peta dan
  //    handler layer menimpa #tooltip dengan kartu kecamatan/orang. Nama pos/dealer hanya
  //    tampil kalau KETIGA handler layer mundur waktu kursor di atas marker.
  assert.ok(/export function diAtasMarker/.test(source['dom.js']), 'diAtasMarker hilang dari dom.js');
  assert.strictEqual((source['app.js'].match(/diAtasMarker\(/g) || []).length >= 2, true,
    'handler mousemove/mouseleave kec-warna tidak lagi mundur di atas marker — hover ikon ' +
    'menampilkan ringkasan kecamatan, bukan nama pos/dealer');
  assert.ok(/diAtasMarker\(e\.originalEvent\)/.test(source['map.js']),
    'handler titik Fusion di map.js tidak mundur di atas marker');
  assert.strictEqual((source['outlets.js'].match(/classList\.remove\('kartu-orang'\)/g) || []).length >= 3,
    true, 'tooltip pos/dealer/kecamatan tidak lagi membuang kelas kartu-orang — kartu putih ' +
    'titik orang bisa menempel di tooltip nama');

  // 2. Legenda ("jumlah unit per kecamatan") di kiri-bawah, ringkas, dan bergeser ke kanan
  //    panel rincian waktu panel itu terbuka (kalau tidak, panelnya menutup legenda).
  assert.match(html, /<details id="legend-card"[^>]*style="[^"]*left:7\.75rem;[^"]*bottom:1\.25rem/,
    'legenda tidak lagi di kiri-bawah peta');
  assert.match(html, /<details id="legend-card"[^>]*style="[^"]*width:max-content;[^"]*max-width:13rem/,
    'legenda kembali melebar — harus selebar isinya dengan batas 13rem');
  assert.match(html, /#map-shell\.panel-terbuka #legend-card \{ left: 26\.5rem !important; \}/,
    'legenda tidak bergeser dari bawah panel rincian yang terbuka');
  assert.ok(/classList\.add\('panel-terbuka'\)/.test(source['tables.js']) &&
    /classList\.remove\('panel-terbuka'\)/.test(source['tables.js']),
    'tables.js tidak lagi menyalakan/mematikan panel-terbuka di #map-shell');

  // 3. Seksi Persentase Keberhasilan Target Penjualan: markup, gambar ulang tiap filter,
  //    sumber data, dan penangan simpan terpasang.
  ['seksi-target', 'target-info', 'target-total', 'target-isi'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `#${id} hilang dari index.html`);
  });
  assert.ok(/PERSENTASE KEBERHASILAN TARGET PENJUALAN/.test(html), 'judul seksi target hilang');
  assert.ok(/renderTargets\(\)/.test(source['app.js']),
    'renderAll() tidak menggambar ulang seksi target — barnya tidak ikut filter');
  assert.ok(/S\.targets = data\.targets/.test(source['app.js']),
    'buildIndexes tidak mengisi S.targets dari /api/summary');
  assert.ok(/saveTargetInput/.test(source['app.js']) && /onchange="saveTargetInput\(/.test(source['targets.js']),
    'kotak target tidak terhubung ke saveTargetInput');
  assert.ok(/activeRows\(undefined, \{ tanpaPos: true \}\)/.test(source['targets.js']),
    'seksi target memakai penjualan yang sudah disaring sampai POS, padahal target milik dealer');
  assert.ok(/tanpaPos/.test(source['filters.js']), 'activeRows kehilangan opsi tanpaPos');
  // Aturan escape umum (nomor 6) hanya melihat S.dealerNames[...] di baris yang sama, jadi
  // tidak melihat nama dealer yang sudah ditaruh di variabel. Seksi target menyusun HTML dari
  // nama/kode dealer (sumbernya Excel), jadi di sini dijaga satu per satu.
  assert.ok(!/\$\{(nama|keterangan|nilai|judulInput)\}/.test(source['targets.js']) &&
    !/\$\{d\.code\}/.test(source['targets.js']),
  'targets.js memasukkan nama/kode dealer ke HTML tanpa esc()');
  assert.ok(/title="\$\{esc\(nama\)\}">\$\{esc\(nama\)\}</.test(source['targets.js']),
    'nama dealer di seksi target tidak lagi lewat esc()');
  // Kotak target hanya boleh diedit saat TEPAT satu bulan terpilih; selain itu terkunci.
  assert.ok(/dapatDiedit = months\.length === 1/.test(source['targets.js']) &&
    /if \(months\.length !== 1\) return;/.test(source['targets.js']),
    'penguncian edit target pada rentang beberapa bulan hilang');

  const totalLines = files.reduce((sum, f) => sum + source[f].split('\n').length, 0);
  console.log(`OK page — ${files.length} modul (${totalLines} baris), ` +
    `${new Set(handlers).size} handler terdaftar, ${new Set(usedIds).size} id, ` +
    'tanpa aset internet, semua ter-escape, PII terkurung');
}

test();
