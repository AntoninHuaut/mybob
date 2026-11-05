import type { FurnitureItem } from './model';

/** UI measurements use centimetres; the model stores metres and overall depth. */
export function measurementsFromForm(
  data: FormData,
  kind: FurnitureItem['kind'],
): Pick<FurnitureItem, 'width' | 'depth' | 'height' | 'elevation' | 'sofa' | 'tvDiagonalInches'> {
  const width = Number(data.get('width')) / 100;
  const bodyDepth = Number(data.get('depth')) / 100;
  const shape = data.get('sofaShape');
  const shaped = kind === 'sofa' && (shape === 'corner' || shape === 'chaise');
  return {
    width,
    tvDiagonalInches:
      kind === 'tv' && Number(data.get('tvDiagonal')) > 0
        ? Number(data.get('tvDiagonal'))
        : undefined,
    depth: shaped ? Number(data.get('returnDepth')) / 100 : bodyDepth,
    height: Number(data.get('height')) / 100,
    elevation: Number(data.get('elevation') ?? 0) / 100,
    sofa: shaped
      ? {
          shape,
          side: data.get('sofaSide') === 'right' ? ('right' as const) : ('left' as const),
          seatDepth: bodyDepth,
          returnWidth: Number(data.get('returnWidth')) / 100,
        }
      : undefined,
  };
}

/** A local, live diagram. No product images or external requests are used. */
export function sofaDiagram(data: FormData) {
  const n = (key: string, fallback: number) => {
    const value = Number(data.get(key));
    return Number.isFinite(value) && value > 0 ? Math.min(value, 2000) : fallback;
  };
  const width = n('width', 210),
    body = n('depth', 90),
    total = Math.max(body, n('returnDepth', 180));
  const arm = Math.min(width, n('returnWidth', 90));
  const scale = Math.min(220 / width, 145 / total);
  const x = 70,
    y = 36,
    w = width * scale,
    b = body * scale,
    d = total * scale,
    a = arm * scale;
  const left = data.get('sofaSide') !== 'right';
  const path = left
    ? `M${x},${y}h${w}v${b}h${a - w}v${d - b}h${-a}Z`
    : `M${x},${y}h${w}v${d}h${-a}v${b - d}h${a - w}Z`;
  const ax = left ? x : x + w - a;
  return `<svg viewBox="0 0 380 235" role="img" aria-label="Vue de dessus : largeur ${width} cm, profondeur du corps ${body} cm, profondeur totale ${total} cm, largeur du retour ${arm} cm"><path d="${path}" fill="#dfe9d8" stroke="#3d6c50" stroke-width="2"/><g fill="none" stroke="#82917d" stroke-width="1"><path d="M${x},${y - 8}v-7h${w}v7M${x - 9},${y}h-7v${b}h7M${x + w + 9},${y}h7v${d}h-7M${ax},${y + d + 9}v7h${a}v-7"/></g><g font-size="12" fill="#314c3c" font-family="system-ui,sans-serif"><text x="${x + w / 2}" y="14" text-anchor="middle">${width} cm de large</text><text x="8" y="${y + b / 2 + 4}">${body} cm</text><text x="${x + w + 22}" y="${y + d / 2 + 4}">${total} cm</text><text x="${ax + a / 2}" y="${y + d + 33}" text-anchor="middle">${arm} cm</text></g></svg>`;
}
