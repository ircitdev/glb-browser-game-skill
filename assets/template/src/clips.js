// Обработка клипов анимации. Общая для игры и раскадровки: в обоих местах персонаж должен выглядеть одинаково.
// scale-дорожки выбрасываются; inPlace — убирает ход таза вперёд (перемещение даёт физика игры);
// loop — убирает накопленный дрейф, чтобы цикл не «уезжал».
export function cleanClip(clip, loop, inPlace, root) {
  clip.tracks = clip.tracks.filter(t => !t.name.endsWith('.scale'));
  if (inPlace) for (const t of clip.tracks) { // ход таза вперёд убираем (оси x, y; z — высота остаётся): перемещение даёт физика игры
    if (!t.name.endsWith('.position')) continue;
    const v = t.values, x0 = v[0], y0 = v[1]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 1] = y0; }
  }
  if (!loop) return clip;
  for (const t of clip.tracks) { // Убираем накопленный сдвиг таза, чтобы цикл не «уезжал»
    if (!t.name.endsWith('.position')) continue;
    const v = t.values, n = v.length / 3, dur = t.times[n - 1] || 1;
    for (let a = 0; a < 3; a++) { const d = v[(n - 1) * 3 + a] - v[a]; for (let i = 0; i < n; i++) v[i * 3 + a] -= d * (t.times[i] / dur); }
    // Клипы с движением по миру начинаются со сдвига таза: возвращаем ось к позе покоя.
    // Вертикальный наклон меньше порога и остаётся как есть.
    const bone = root.getObjectByName(t.name.split('.')[0]), rest = bone ? bone.position.toArray() : null, limit = bone ? bone.position.length() * .3 : Infinity;
    for (let a = 0; rest && a < 3; a++) { let mean = 0; for (let i = 0; i < n; i++) mean += v[i * 3 + a] / n; if (Math.abs(mean - rest[a]) > limit) for (let i = 0; i < n; i++) v[i * 3 + a] += rest[a] - mean; }
  }
  return clip;
}
