/**
 * Uji modul warna. Meng-import frontend/js/colors.js langsung, jadi tidak ada salinan
 * kedua yang bisa menyimpang dari yang dipakai browser.
 *
 * Kuota 8 warna DIBUANG pada 2026-08-12 atas keputusan meeting: tiap dealer dapat
 * warna sendiri. Yang dijaga sekarang bukan lagi "warnanya bisa dibedakan" — itu tidak
 * mungkin untuk 51 hue dan sudah diakui — tapi: tidak ada dua dealer berbagi warna,
 * warnanya tidak berubah waktu filter mengubah jumlah dealer, dan kelas heatmap
 * mengikuti persentil sebaran yang sedang tampil.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

/** Luminansi relatif kasar, cukup untuk memeriksa ramp makin gelap. */
function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function salesFrom(pairs) {
  return pairs.map(([dealer, units]) => ({ dealer, units }));
}

async function test() {
  const source = pathToFileURL(
    path.join(__dirname, '..', 'frontend', 'js', 'colors.js')).href;
  const {
    RAMP, COLOR_EMPTY, COLOR_UNKNOWN, CLASS_LABELS, mixColor, buildPalette, shadeRamp,
    buildColorRegistry, dealerColor, percentileBreaks, classOf, classRanges,
  } = await import(source);

  // --- palet ---
  for (const n of [8, 51, 120]) {
    const palette = buildPalette(n);
    assert.strictEqual(palette.length, n);
    assert.strictEqual(new Set(palette).size, n,
      `${n} dealer harus dapat ${n} warna berbeda, tidak ada yang kembar`);
    palette.forEach((c) => assert.ok(/^#[0-9a-f]{6}$/.test(c), `warna tidak sah: ${c}`));
  }

  // Warna korporat Astra adalah krom UI; dealer tidak boleh sewarna navbar.
  const palette51 = buildPalette(51);
  for (const corporate of ['#0b2f6b', '#e2231a']) {
    assert.ok(!palette51.includes(corporate), `${corporate} warna krom UI`);
  }

  // Dua warna yang berurutan harus berjauhan di roda warna. Kalau hue-nya dibagi rata
  // berurutan, dealer peringkat 1 dan 2 justru yang paling sering tertukar.
  const hue = (hex) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
  };
  const gap = Math.abs(hue(palette51[0]) - hue(palette51[1]));
  assert.ok(Math.min(gap, 360 - gap) > 60,
    `warna peringkat 1 dan 2 terlalu dekat (${Math.min(gap, 360 - gap).toFixed(0)}°)`);

  // --- registry ---
  const many = [];
  for (let i = 1; i <= 51; i++) many.push(['D' + String(i).padStart(2, '0'), 100 - i]);
  const registry = buildColorRegistry(salesFrom(many));

  assert.strictEqual(registry.order.length, 51);
  assert.strictEqual(new Set(Object.values(registry.colors)).size, 51,
    'ada dua dealer berbagi warna');
  assert.strictEqual(dealerColor(registry, 'TIDAK-ADA'), COLOR_UNKNOWN,
    'dealer tak dikenal tidak boleh dikarang warnanya');

  // Dealer tanpa penjualan tetap perlu warna — mereka muncul di Master Pos Dealer.
  const withIdle = buildColorRegistry(salesFrom([['A', 5]]), { A: 'A', B: 'B' });
  assert.ok(withIdle.colors.B, 'dealer tanpa penjualan tidak dapat warna');
  assert.notStrictEqual(withIdle.colors.A, withIdle.colors.B);

  // --- warna mengikuti dealer, bukan peringkat ---
  const withNewcomer = buildColorRegistry(salesFrom(many.concat([['D99', 1]])));
  for (const code of registry.order.slice(0, 20)) {
    assert.strictEqual(withNewcomer.colors[code], registry.colors[code],
      `dealer baru bervolume kecil mengecat ulang ${code}`);
  }

  // --- deterministik saat volume seri ---
  const tieA = buildColorRegistry(salesFrom([['DB', 5], ['DA', 5], ['DC', 5]]));
  const tieB = buildColorRegistry(salesFrom([['DC', 5], ['DA', 5], ['DB', 5]]));
  assert.strictEqual(tieA.order.join(','), tieB.order.join(','),
    'volume seri harus diputus kode dealer supaya hasilnya sama tiap kali');
  assert.strictEqual(tieA.order.join(','), 'DA,DB,DC');

  // --- persentil ---
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const breaks = percentileBreaks(values);
  assert.strictEqual(breaks.length, 4);
  for (let i = 1; i < breaks.length; i++) {
    assert.ok(breaks[i] >= breaks[i - 1], 'batas persentil harus menaik');
  }

  // Nol TIDAK ikut menarik batas ke bawah.
  const withZeros = percentileBreaks([0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepStrictEqual(withZeros, breaks,
    'kelurahan tanpa penjualan ikut dihitung persentilnya');

  assert.strictEqual(classOf(0, breaks), -1, 'nol harus punya kelasnya sendiri');
  assert.strictEqual(classOf(1, breaks), 0);
  assert.strictEqual(classOf(10, breaks), RAMP.length - 1);

  // Batasnya IKUT filter: sebaran yang berbeda menghasilkan batas yang berbeda.
  const narrow = percentileBreaks([1, 1, 1, 2]);
  assert.notDeepStrictEqual(narrow, breaks,
    'batas kelas tidak ikut berubah waktu sebarannya berubah — heatmap tidak relatif');

  // --- rentang legenda ---
  const ranges = classRanges(values, breaks);
  assert.strictEqual(ranges.length, RAMP.length);
  assert.strictEqual(ranges.reduce((s, r) => s + r.count, 0), values.length,
    'ada nilai yang tidak masuk kelas mana pun');

  // Sebaran sempit: kelas yang kosong ditandai, bukan diberi rentang mustahil.
  const tight = classRanges([1, 1, 1, 2], narrow);
  assert.ok(tight.some((r) => r.empty), 'kelas kosong tidak ditandai');
  tight.forEach((r) => {
    assert.ok(!/^\d+–\d+$/.test(r.label) || Number(r.label.split('–')[0]) <= Number(r.label.split('–')[1]),
      `rentang terbalik di legenda: ${r.label}`);
  });

  // Formatter opsional (dipakai panel wilayah untuk kontribusi %, bukan unit mentah):
  // label dibentuk dari HASIL formatter, bukan angka mentahnya.
  const berpersen = classRanges(values, breaks, (n) => `${n}%`);
  assert.ok(berpersen.some((r) => !r.empty && r.label.includes('%')),
    'classRanges() dengan formatter tidak memakai hasilnya di label');
  assert.strictEqual(classRanges(values, breaks).length, berpersen.length,
    'formatter mengubah jumlah kelas — seharusnya cuma mengubah tampilan labelnya');

  // --- ramp ---
  for (const ramp of [RAMP, shadeRamp('#2a78d6')]) {
    for (let i = 1; i < ramp.length; i++) {
      assert.ok(luminance(ramp[i]) < luminance(ramp[i - 1]),
        `ramp harus monoton makin gelap: ${ramp[i]} tidak lebih gelap dari ${ramp[i - 1]}`);
    }
  }
  assert.strictEqual(CLASS_LABELS.length, RAMP.length,
    'jumlah label legenda harus sama dengan jumlah kelas');
  assert.notStrictEqual(COLOR_EMPTY, RAMP[0],
    '"nol" dan "paling sedikit" harus bisa dibedakan');

  assert.strictEqual(mixColor('#000000', '#ffffff', 0.5), '#808080');
  assert.strictEqual(mixColor('#123456', '#ffffff', 0), '#123456');

  console.log('OK colors — 51 warna tanpa kembar, stabil terhadap filter, ' +
    'kelas persentil ikut sebaran, legenda tidak pernah terbalik');
}

test().catch((error) => { console.error(error); process.exit(1); });
