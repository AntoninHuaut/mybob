import {
  dressingBounds,
  dressingStrips,
  type DressingRun,
  type FurnitureItem,
  type ShowerType,
} from './model';

/** Reads the run rows of a dressing form, whatever the field source. */
export function readDressingRuns(read: (name: string) => string | null): DressingRun[] {
  const runs: DressingRun[] = [];
  for (let index = 0; read(`dressingRunLength${index}`) !== null; index++) {
    const length = Number(read(`dressingRunLength${index}`)) / 100;
    const turn = read(`dressingRunTurn${index}`) ?? 'end';
    runs.push({
      length: Number.isFinite(length) && length > 0 ? length : 0.6,
      ...(turn === 'left' || turn === 'right' ? { turn } : {}),
    });
  }
  return runs.length ? runs : [{ length: 1.8 }];
}

/** UI measurements use centimetres; the model stores metres and overall depth. */
export function measurementsFromForm(
  data: FormData,
  kind: FurnitureItem['kind'],
): Pick<
  FurnitureItem,
  | 'width'
  | 'depth'
  | 'height'
  | 'elevation'
  | 'sofa'
  | 'dressing'
  | 'showerType'
  | 'tvDiagonalInches'
> {
  const height = Number(data.get('height')) / 100;
  const elevation = Number(data.get('elevation') ?? 0) / 100;
  if (kind === 'dressing') {
    // Overall width and depth are derived from the runs, never typed directly.
    const runDepth = Number(data.get('dressingRunDepth')) / 100;
    const runs = readDressingRuns((name) => (data.has(name) ? String(data.get(name)) : null));
    const bounds = dressingBounds(Number.isFinite(runDepth) && runDepth > 0 ? runDepth : 0.6, runs);
    return {
      width: bounds.width,
      depth: bounds.depth,
      height,
      elevation,
      dressing: { runDepth: Number.isFinite(runDepth) && runDepth > 0 ? runDepth : 0.6, runs },
      sofa: undefined,
      showerType: undefined,
      tvDiagonalInches: undefined,
    };
  }
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
    height,
    elevation,
    sofa: shaped
      ? {
          shape,
          side: data.get('sofaSide') === 'right' ? ('right' as const) : ('left' as const),
          seatDepth: bodyDepth,
          returnWidth: Number(data.get('returnWidth')) / 100,
        }
      : undefined,
    dressing: undefined,
    showerType: kind === 'shower' ? (String(data.get('showerType')) as ShowerType) : undefined,
  };
}

interface CornerDiagramLabels {
  /** Name of the select holding the return side. */
  sideKey: string;
  /** Names of the two return measurements. */
  depthKey: string;
  widthKey: string;
  body: string;
  total: string;
  arm: string;
}

/** A local, live diagram. No product images or external requests are used. */
export function cornerDiagram(data: FormData, labels: CornerDiagramLabels) {
  const n = (key: string, fallback: number) => {
    const value = Number(data.get(key));
    return Number.isFinite(value) && value > 0 ? Math.min(value, 2000) : fallback;
  };
  const width = n('width', 210),
    body = n('depth', 90),
    total = Math.max(body, n(labels.depthKey, 180));
  const arm = Math.min(width, n(labels.widthKey, 90));
  const scale = Math.min(220 / width, 145 / total);
  const x = 70,
    y = 36,
    w = width * scale,
    b = body * scale,
    d = total * scale,
    a = arm * scale;
  const left = data.get(labels.sideKey) !== 'right';
  const path = left
    ? `M${x},${y}h${w}v${b}h${a - w}v${d - b}h${-a}Z`
    : `M${x},${y}h${w}v${d}h${-a}v${b - d}h${a - w}Z`;
  const ax = left ? x : x + w - a;
  return `<svg viewBox="0 0 380 235" role="img" aria-label="Vue de dessus : largeur ${width} cm, ${labels.body} ${body} cm, ${labels.total} ${total} cm, ${labels.arm} ${arm} cm"><path d="${path}" fill="#dfe9d8" stroke="#3d6c50" stroke-width="2"/><g fill="none" stroke="#82917d" stroke-width="1"><path d="M${x},${y - 8}v-7h${w}v7M${x - 9},${y}h-7v${b}h7M${x + w + 9},${y}h7v${d}h-7M${ax},${y + d + 9}v7h${a}v-7"/></g><g font-size="12" fill="#314c3c" font-family="system-ui,sans-serif"><text x="${x + w / 2}" y="14" text-anchor="middle">${width} cm de large</text><text x="8" y="${y + b / 2 + 4}">${body} cm</text><text x="${x + w + 22}" y="${y + d / 2 + 4}">${total} cm</text><text x="${ax + a / 2}" y="${y + d + 33}" text-anchor="middle">${arm} cm</text></g></svg>`;
}

export const sofaDiagram = (data: FormData) =>
  cornerDiagram(data, {
    sideKey: 'sofaSide',
    depthKey: 'returnDepth',
    widthKey: 'returnWidth',
    body: 'profondeur du corps',
    total: 'profondeur totale',
    arm: 'largeur du retour',
  });

/** Draws the run chain from above, one rectangle per run. */
export function dressingDiagram(runDepth: number, runs: DressingRun[]) {
  const strips = dressingStrips(runDepth, runs);
  const points = strips.flat();
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minZ = Math.min(...points.map((point) => point[1]));
  const maxZ = Math.max(...points.map((point) => point[1]));
  const width = Math.max(maxX - minX, 0.01);
  const depth = Math.max(maxZ - minZ, 0.01);
  const scale = Math.min(300 / width, 150 / depth);
  const ox = 40,
    oy = 30;
  const rects = strips.map((strip) => {
    const xs = strip.map((point) => point[0]);
    const zs = strip.map((point) => point[1]);
    const x = ox + (Math.min(...xs) - minX) * scale;
    const y = oy + (Math.min(...zs) - minZ) * scale;
    const w = (Math.max(...xs) - Math.min(...xs)) * scale;
    const h = (Math.max(...zs) - Math.min(...zs)) * scale;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#dfe9d8" stroke="#3d6c50" stroke-width="1.5"/>`;
  });
  const label = `${Math.round(width * 100)} × ${Math.round(depth * 100)} cm hors tout`;
  return `<svg viewBox="0 0 380 235" role="img" aria-label="Vue de dessus du dressing : ${runs.length} tronçon${runs.length > 1 ? 's' : ''}, ${label}">${rects.join('')}<text x="${ox}" y="${(oy + depth * scale + 24).toFixed(1)}" font-size="12" fill="#314c3c" font-family="system-ui,sans-serif">${label}</text></svg>`;
}
