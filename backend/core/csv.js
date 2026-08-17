/**
 * Parser CSV yang sadar tanda kutip.
 *
 * Bukan kemewahan. Berkas dari Astra memuat alamat seperti
 *   "Jl. Magelang Km. 7, Sleman"
 * dan `split(',')` polos memecahnya jadi dua kolom, menggeser seluruh baris, lalu
 * menghasilkan kode outlet palsu seperti "3400" dan "55584". Itu pernah terjadi dan
 * salah menyimpulkan bahwa data tidak punya outlet sama sekali.
 *
 * Pemisahnya dideteksi dari baris judul: berkas ekspor Excel Indonesia sering pakai
 * titik koma karena koma sudah jadi pemisah desimal.
 */
function parseCsv(text) {
  const header = text.split('\n')[0];
  const separator =
    (header.match(/;/g) || []).length > (header.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // "" di dalam kutip = satu "
        else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((value) => value !== ''));
}

/** Buang BOM UTF-8 yang selalu ditinggalkan Excel di awal berkas. */
function stripBom(text) {
  return text.replace(/^﻿/, '');
}

module.exports = { parseCsv, stripBom };
