/**
 * Bandingkan baris pos dari Excel (sheet "Dealer" AHM: outlet_code, outlet_name,
 * address) dengan outlets yang sudah ada di database.
 *
 * Beda dari impor penjualan bulanan (backend/core/grouping.js), yang sengaja TIDAK
 * menimpa kurasi manusia untuk dealer/koordinat: impor pos ini MEMANG dimaksudkan
 * menimpa outlet_name/address kalau beda. Pengamannya bukan perlindungan diam-diam di
 * sini, tapi pratinjau eksplisit + satu tombol konfirmasi di pemanggil.
 *
 * Murni: tidak menyentuh berkas maupun database. Pemanggilnya yang membaca Excel dan
 * tabel outlets, dan yang menyimpan hasilnya.
 */

/**
 * Kelompokkan baris Excel per outlet_code, dan pisahkan yang tidak bisa dipakai sama
 * sekali (tanpa kode atau nama). Diekspor terpisah dari diffOutletImport(): pemanggil
 * yang sudah punya token pratinjau memakainya lagi waktu commit, untuk tahu PERSIS
 * nilai apa yang tadi dipratinjaukan — tanpa mengulang logika pengelompokannya.
 *
 * @param {Array<{outletCode, outletName, address}>} rows  dari Excel, mentah
 * @return {{byCode: Map<string, Array>, invalid: Array}} byCode -> array kandidat
 *   urut kemunculan di Excel; kandidat PERTAMA yang dipakai di tempat lain.
 */
function groupByCode(rows) {
  const invalid = [];
  const byCode = new Map();

  (rows || []).forEach((r, index) => {
    const outletCode = String((r && r.outletCode) || '').trim();
    const outletName = String((r && r.outletName) || '').trim();
    const address = r && r.address != null ? String(r.address).trim() : '';
    if (!outletCode || !outletName) {
      invalid.push({ index, outletCode, outletName });
      return;
    }
    if (!byCode.has(outletCode)) byCode.set(outletCode, []);
    byCode.get(outletCode).push({ outletCode, outletName, address: address || null });
  });

  return { byCode, invalid };
}

/**
 * @param {Array<{outletCode, outletName, address}>} rows   dari Excel, mentah
 * @param {Array<{outletCode, outletName, address}>} known  dari tabel outlets
 * @return {{added: Array, changed: Array, unchanged: number, invalid: Array,
 *   multiCandidate: Array}}
 *   added:      outlet_code di Excel yang tidak ada di database — dilaporkan saja,
 *               tidak pernah dibuat di sini (butuh dealer_code, tidak ada di sheet ini)
 *   changed:    [{outletCode, field, oldValue, newValue}] — hanya field yang beda
 *   unchanged:  jumlah outlet_code yang persis sama dengan database
 *   invalid:    baris tanpa outletCode atau outletName
 *   multiCandidate: [{outletCode, count}] — kandidat PERTAMA (urutan baris di Excel)
 *                   yang dipakai untuk changed/added, sisanya cuma dilaporkan di sini
 */
function diffOutletImport(rows, known) {
  const knownByCode = new Map();
  (known || []).forEach((o) => knownByCode.set(o.outletCode, o));

  const { byCode, invalid } = groupByCode(rows);

  const multiCandidate = [];
  const added = [];
  const changed = [];
  let unchanged = 0;

  byCode.forEach((candidates, outletCode) => {
    if (candidates.length > 1) multiCandidate.push({ outletCode, count: candidates.length });

    const pilihan = candidates[0];
    const ada = knownByCode.get(outletCode);
    if (!ada) {
      added.push(pilihan);
      return;
    }

    let berubah = false;
    if ((ada.outletName || '') !== pilihan.outletName) {
      changed.push({
        outletCode, field: 'outletName', oldValue: ada.outletName, newValue: pilihan.outletName,
      });
      berubah = true;
    }
    if ((ada.address || null) !== pilihan.address) {
      changed.push({
        outletCode, field: 'address', oldValue: ada.address || null, newValue: pilihan.address,
      });
      berubah = true;
    }
    if (!berubah) unchanged++;
  });

  return { added, changed, unchanged, invalid, multiCandidate };
}

module.exports = { diffOutletImport, groupByCode };
