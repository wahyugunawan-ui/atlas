/**
 * Seksi "Persentase Keberhasilan Target Penjualan" (frontend/js/targets.js), tanpa browser.
 *
 * DOM-nya diganti objek polos: yang diuji adalah apa yang DITULIS ke `innerHTML`/`textContent`
 * dan apa yang dikirim ke server, bukan tampilan. Modul yang sama persis dengan yang dikirim
 * ke browser (pola test/filters.test.js).
 *
 * Yang dijaga:
 * 1. Warna bar mengikuti capaian dengan batas yang tepat (50 dan 100 inklusif).
 * 2. Nama dealer (sumbernya Excel) lolos ke HTML hanya dalam bentuk ter-escape.
 * 3. Kotak target hanya bisa diedit waktu rentang periode TEPAT satu bulan; selain itu
 *    `disabled` dan tanpa penangan simpan.
 * 4. Filter Pos tidak mengecilkan pembilang (target milik dealer), tapi tetap disebut di
 *    keterangan supaya orang tahu mengapa angkanya tidak ikut berubah.
 * 5. Simpan: sukses menulis ke S.targets lalu menggambar ulang; ditolak server -> S.targets
 *    TIDAK berubah, kotak kembali ke nilai lama, dan alasan server ditampilkan apa adanya.
 *    Bulan yang dikirim = bulan filter, bukan bulan lain.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const url = (name) => pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', name)).href;

// DOM tiruan: getElementById mengembalikan objek polos yang menampung tulisan.
const els = {};
['target-isi', 'target-total', 'target-info', 'toast'].forEach((id) => {
  els[id] = { innerHTML: '', textContent: '', value: '', style: {},
    classList: { add() {}, remove() {} } };
});
globalThis.document = { getElementById: (id) => els[id] || null };

async function main() {
  const { S } = await import(url('state.js'));
  const targets = await import(url('targets.js'));
  const { warnaCapaian, renderTargets, saveTargetInput } = targets;

  /* 1. warna bar */
  const MERAH = warnaCapaian(0);
  const KUNING = warnaCapaian(50);
  const HIJAU = warnaCapaian(100);
  assert.strictEqual(warnaCapaian(49.9), MERAH);
  assert.strictEqual(warnaCapaian(99.9), KUNING, '99,9% belum tercapai');
  assert.strictEqual(warnaCapaian(100), HIJAU, 'tepat 100% sudah tercapai');
  assert.strictEqual(warnaCapaian(250), HIJAU);
  assert.notStrictEqual(warnaCapaian(null), MERAH, 'belum punya target tidak boleh tampak merah');
  assert.strictEqual(new Set([MERAH, KUNING, HIJAU, warnaCapaian(null)]).size, 4,
    'empat keadaan harus empat warna berbeda');

  /* data */
  const NAMA_JAHAT = 'Dealer <img src=x onerror=alert(1)> "&"';
  S.dealers = [{ code: 'D1', name: 'Dealer Satu' }, { code: 'D2', name: NAMA_JAHAT }, { code: 'D3', name: 'Dealer Tiga' }];
  S.dealerNames = { D1: 'Dealer Satu', D2: NAMA_JAHAT, D3: 'Dealer Tiga' };
  S.districtByCode = { K1: { code: 'K1' } };
  S.periods = ['2026-07', '2026-08'];
  S.sales = [
    { period: '2026-08', district: 'K1', dealer: 'D1', outlet: 'P1', units: 30 },
    { period: '2026-08', district: 'K1', dealer: 'D1', outlet: 'P2', units: 20 },
    { period: '2026-08', district: 'K1', dealer: 'D2', outlet: 'P3', units: 120 },
    { period: '2026-08', district: 'K1', dealer: 'D3', outlet: 'P4', units: 7 },
    { period: '2026-07', district: 'K1', dealer: 'D1', outlet: 'P1', units: 40 },
  ];
  S.targets = { '2026-08': { D1: 100, D2: 100 } };
  const f = S.filters.peta;
  Object.assign(f, { from: '2026-08', to: '2026-08', kares: 'ALL', cityCode: 'ALL',
    districtCode: 'ALL', dealerCode: 'ALL', outletCode: 'ALL' });

  /* 2 & 3. satu bulan: bisa diedit, nama ter-escape */
  renderTargets();
  const isi = els['target-isi'].innerHTML;
  const total = els['target-total'].innerHTML;
  assert.ok(!isi.includes('<img'), 'nama dealer lolos ke HTML tanpa escape');
  assert.ok(isi.includes('&lt;img src=x onerror=alert(1)&gt;'), 'nama dealer ter-escape tidak tampil');
  assert.ok(isi.includes('onchange="saveTargetInput(\'D1\')"'), 'satu bulan harus bisa diedit');
  assert.ok(!/ disabled /.test(isi), 'satu bulan: kotak tidak boleh terkunci');
  assert.ok(isi.includes('value="100"'), 'target tersimpan tidak tampil di kotak');
  // Urutan: D1 50% (50/100), D2 120% (120/100), lalu D3 tanpa target.
  assert.ok(isi.indexOf('Dealer Satu') < isi.indexOf('&lt;img'), 'persentase terendah harus di atas');
  assert.ok(isi.indexOf('&lt;img') < isi.indexOf('Dealer Tiga'), 'dealer tanpa target harus di bawah');
  assert.ok(isi.includes('50,0%') && isi.includes('120,0%'), 'persentase per dealer salah');
  assert.ok(isi.includes('belum punya target'), 'dealer tanpa target tidak dinyatakan');
  // Total hanya dari dealer bertarget: (50+120)/(100+100) = 85%; 7 unit D3 tidak ikut.
  assert.ok(total.includes('85,0%'), `total salah: ${total.replace(/<[^>]+>/g, ' ')}`);
  assert.ok(total.includes('1 dealer belum punya') || total.includes('dealer belum punya'),
    'dealer yang dikecualikan dari total tidak dinyatakan');
  assert.ok(els['target-info'].textContent.includes('Agustus 2026'));
  assert.ok(!els['target-info'].textContent.includes('mengubahnya'));

  /* 3. dua bulan: terkunci */
  f.from = '2026-07';
  renderTargets();
  const kunci = els['target-isi'].innerHTML;
  assert.ok(!kunci.includes('onchange='), 'rentang dua bulan masih bisa diedit');
  assert.ok(/ disabled /.test(kunci), 'rentang dua bulan: kotak harus terkunci');
  assert.ok(els['target-info'].textContent.includes('pilih satu bulan'), 'alasan penguncian tidak dijelaskan');
  assert.ok(els['target-info'].textContent.includes('2 bulan'));
  f.from = '2026-08';

  /* 4. filter Pos: pembilang tetap milik dealer utuh */
  f.dealerCode = 'D1';
  f.outletCode = 'P1';
  renderTargets();
  assert.ok(els['target-isi'].innerHTML.includes('50 dari 100 unit'),
    'filter Pos mengecilkan penjualan (30 saja) padahal target milik dealer');
  assert.ok(els['target-info'].textContent.includes('filter Pos tidak dipakai'));
  assert.ok(!els['target-isi'].innerHTML.includes('Dealer Tiga'), 'filter Dealer tidak menyempitkan daftar');
  f.dealerCode = 'ALL';
  f.outletCode = 'ALL';

  /* 5. simpan */
  const kirim = [];
  let balasan;
  globalThis.fetch = async (u, opsi) => {
    kirim.push({ u, opsi });
    return balasan;
  };
  const ok = (json) => ({ ok: true, status: 200, json: async () => json });
  const tolak = (status, json) => ({ ok: false, status, json: async () => json });

  els['tgt-D1'] = { value: '80' };
  balasan = ok({ period: '2026-08', dealerCode: 'D1', units: 80 });
  await saveTargetInput('D1');
  assert.strictEqual(kirim.length, 1);
  assert.strictEqual(kirim[0].opsi.method, 'PUT');
  assert.deepStrictEqual(JSON.parse(kirim[0].opsi.body), { period: '2026-08', dealerCode: 'D1', units: 80 },
    'bulan/dealer/unit yang dikirim salah');
  assert.strictEqual(S.targets['2026-08'].D1, 80, 'S.targets tidak diperbarui');
  assert.ok(els['target-isi'].innerHTML.includes('62,5%'), '50/80 = 62,5% tidak tergambar ulang');
  assert.strictEqual(els.toast.textContent, 'Target disimpan');

  // kosong -> units null dikirim, targetnya hilang dari S.targets
  els['tgt-D1'] = { value: '  ' };
  balasan = ok({ period: '2026-08', dealerCode: 'D1', units: null });
  await saveTargetInput('D1');
  assert.strictEqual(JSON.parse(kirim[1].opsi.body).units, null, 'kotak kosong harus mengirim null');
  assert.strictEqual(S.targets['2026-08'].D1, undefined, 'target yang dihapus masih ada di S.targets');
  assert.strictEqual(els.toast.textContent, 'Target dihapus');

  // nol dikirim sebagai 0, bukan null
  els['tgt-D1'] = { value: '0' };
  balasan = ok({ period: '2026-08', dealerCode: 'D1', units: 0 });
  await saveTargetInput('D1');
  assert.strictEqual(JSON.parse(kirim[2].opsi.body).units, 0, 'nol dikirim sebagai null (target terhapus)');
  assert.strictEqual(S.targets['2026-08'].D1, 0);

  // ditolak server: S.targets tidak berubah, alasan server tampil
  els['tgt-D2'] = { value: '1.5' };
  balasan = tolak(400, { error: 'Target harus bilangan bulat 0 sampai 1.000.000.' });
  await saveTargetInput('D2');
  assert.strictEqual(S.targets['2026-08'].D2, 100, 'target berubah padahal server menolak');
  assert.strictEqual(els.toast.textContent, 'Target harus bilangan bulat 0 sampai 1.000.000.',
    'alasan penolakan server tidak ditampilkan apa adanya');
  assert.ok(els['target-isi'].innerHTML.includes('value="100"'), 'kotak tidak kembali ke nilai lama');

  // server mati: pesan bisa dimengerti, S.targets utuh
  els['tgt-D2'] = { value: '55' };
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await saveTargetInput('D2');
  assert.strictEqual(S.targets['2026-08'].D2, 100);
  assert.ok(/server/i.test(els.toast.textContent), `pesan gagal tidak informatif: ${els.toast.textContent}`);

  // rentang dua bulan: tidak mengirim apa pun
  f.from = '2026-07';
  const sebelum = kirim.length;
  els['tgt-D2'] = { value: '55' };
  globalThis.fetch = async (u, opsi) => { kirim.push({ u, opsi }); return ok({ units: 55 }); };
  await saveTargetInput('D2');
  assert.strictEqual(kirim.length, sebelum, 'rentang beberapa bulan tetap mengirim simpan');

  console.log('OK targets-ui — warna bar (batas 50/100), nama dealer ter-escape, edit hanya ' +
    'pada satu bulan, total hanya dari dealer bertarget, filter Pos tidak mengecilkan pembilang, ' +
    'simpan/hapus/nol, penolakan server tidak mengubah apa pun');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
