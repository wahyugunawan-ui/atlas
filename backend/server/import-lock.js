/**
 * Kunci sekali-jalan bersama antara impor bulanan (importer.js) dan impor massal pos
 * (pos-import.js) — keduanya menulis ke `outlets`, dan tidak boleh tabrakan.
 *
 * ponytail: hanya berlaku dalam satu proses. Yang menjaga integritas data adalah
 * transaksi database, bukan kunci ini — kunci ini soal pesan error yang bisa
 * dimengerti orang non-IT, bukan menunggu sampai database timeout.
 */
let running = false;

const isRunning = () => running;

function begin() {
  if (running) {
    const error = new Error(
      'Sedang ada impor yang berjalan. Tunggu sampai selesai, lalu coba lagi.');
    error.code = 'SEDANG_BERJALAN';
    throw error;
  }
  running = true;
}

function end() {
  running = false;
}

module.exports = { isRunning, begin, end };
