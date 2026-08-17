/**
 * Pengelompokan outlet ke dealer.
 *
 * Satu dealer bisa punya beberapa outlet: NUSANTARA SAKTI punya 8, KOMPO MOTOR 6,
 * ARMADA TUNAS JAYA 4. Excel tidak memberi kode dealer sama sekali — yang ada cuma
 * kode outlet dan namanya, dan nama dealernya kebetulan ada di depan tanda " - ".
 *
 * Menurunkan identitas dari nama itu tebakan, dan CLAUDE.md melarangnya. Karena itu
 * tebakan di sini HANYA dipakai untuk mengisi awal tabel `outlets` yang bisa disunting
 * manusia. Begitu barisnya ada, isi tabel yang menang — tebakannya tidak pernah
 * menimpa apa pun.
 *
 * Murni: tidak menyentuh berkas maupun database. Pemanggilnya yang membaca tabel dan
 * menyimpan hasilnya.
 */

/** 'NUSANTARA SAKTI' -> 'NUSANTARASAKTI'. Kode dealer yang deterministik. */
function toDealerCode(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Tebakan awal: bagian nama sebelum " - " adalah dealernya.
 *
 * Nama tanpa " - " berdiri sendiri — termasuk 19 outlet "ASTRA MOTOR ..." yang atas
 * keputusan pemilik proyek memang dihitung sebagai dealer masing-masing.
 */
function guessDealerName(outletName) {
  const name = String(outletName || '').trim();
  const at = name.indexOf(' - ');
  return at > 0 ? name.slice(0, at).trim() : name;
}

/**
 * Gabungkan outlet yang sudah terdaftar dengan yang baru muncul di Excel bulan ini.
 *
 * @param {Array<Object>} known   baris tabel outlets: {outletCode, outletName,
 *                                dealerCode, dealerName, lat, lng}
 * @param {Array<Object>} seen    outlet dari hasil aggregate(): {outletCode,
 *                                outletName, address}
 * @return {{outlets: Object, added: Array<Object>}}
 *   outlets: outletCode -> baris lengkap, siap disimpan
 *   added:   outlet yang BARU ditebak — jumlahnya harus dilaporkan ke pengguna,
 *            karena tiap satu berarti ada tebakan yang belum diperiksa manusia
 */
function resolveGroups(known, seen) {
  const outlets = {};
  known.forEach((row) => { outlets[row.outletCode] = Object.assign({}, row); });

  const added = [];
  seen.forEach((outlet) => {
    const existing = outlets[outlet.outletCode];
    if (existing) {
      // Nama dari Excel hanya mengisi yang masih kosong. Suntingan manusia menang.
      if (!existing.outletName) existing.outletName = outlet.outletName;
      return;
    }
    const dealerName = guessDealerName(outlet.outletName);
    const row = {
      outletCode: outlet.outletCode,
      outletName: outlet.outletName,
      dealerCode: toDealerCode(dealerName),
      dealerName: dealerName,
      lat: null,
      lng: null,
    };
    outlets[outlet.outletCode] = row;
    added.push(row);
  });

  return { outlets: outlets, added: added };
}

module.exports = { toDealerCode, guessDealerName, resolveGroups };
