import type { HouseViewer } from '../scene/viewer';
import { bounds, polygonArea } from '../model/geometry';
import { layoutLabels, type LabelBox, type LabelRect } from './labelLayout';

export interface SceneImageOptions {
  labels: boolean;
  dimensions: boolean;
  projectName: string;
  levelName: string;
  variantName?: string;
  transparent?: boolean;
  header?: boolean;
}

export function exportImageSize(width: number, height: number) {
  if (![width, height].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('La vue doit être visible pour exporter une image.');
  const scale = Math.min(1, 2400 / width, 1800 / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    sceneHeight: Math.max(1, Math.round(height * scale)),
    header: 64,
  };
}

export function imageExportFilename(
  options: Pick<SceneImageOptions, 'projectName' | 'levelName' | 'variantName'>,
) {
  const name = [options.projectName, options.levelName, options.variantName]
    .filter(Boolean)
    .join('-')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${name.slice(0, 140) || 'maison'}.png`;
}

/** Local PNG of the current camera, with annotations drawn independently of the UI panels. */
export async function exportSceneImage(
  viewer: HouseViewer,
  options: SceneImageOptions,
): Promise<Blob> {
  const captured = viewer.captureCanvas(options.dimensions, !options.transparent);
  const size = exportImageSize(captured.width, captured.height);
  const header = options.header === false ? 0 : size.header;
  const output = document.createElement('canvas');
  output.width = size.width;
  output.height = size.sceneHeight + header;
  const context = output.getContext('2d');
  if (!context) throw new Error('Export image indisponible dans ce navigateur.');
  if (!options.transparent) {
    context.fillStyle = '#edf0e9';
    context.fillRect(0, 0, output.width, output.height);
  }
  context.drawImage(captured, 0, header, size.width, size.sceneHeight);
  if (header > 0) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, header);
    context.fillStyle = '#244c40';
    context.font = '600 18px sans-serif';
    context.fillText(options.projectName, 18, 26, size.width - 36);
    context.font = '13px sans-serif';
    context.fillText(
      [
        options.levelName,
        options.variantName,
        viewer.mode === 'plan' ? 'Plan' : viewer.mode === 'walk' ? 'Visite' : 'Vue 3D',
      ]
        .filter(Boolean)
        .join(' · '),
      18,
      48,
      size.width - 36,
    );
  }
  const sx = size.width / viewer.canvas.clientWidth,
    sy = size.sceneHeight / viewer.canvas.clientHeight;
  const project = (point: [number, number], height?: number) => {
    const p = viewer.project(point, height);
    return { ...p, x: p.x * sx, y: p.y * sy };
  };
  const obstacles: LabelRect[] = [];
  if (options.dimensions) {
    for (const mesh of viewer.scene.meshes) {
      if (mesh.name !== 'furniture:dimension-label' || !mesh.isEnabled() || !mesh.isVisible)
        continue;
      const world = mesh.getAbsolutePosition();
      const p = project([world.x, world.z], world.y - viewer.level.elevation);
      if (p.visible)
        obstacles.push({ x: p.x - 48 * sx, y: p.y - 12 * sy, width: 96 * sx, height: 24 * sy });
    }
  }
  const tag = (text: string, x: number, y: number) => {
    context.font = '600 13px sans-serif';
    const width = context.measureText(text).width + 16;
    context.fillStyle = '#ffffff';
    context.fillRect(x - width / 2, y - 12 + header, width, 24);
    context.fillStyle = '#174c3d';
    context.fillText(text, x - width / 2 + 8, y + 5 + header);
    return { x: x - width / 2, y: y - 12, width, height: 24 };
  };
  if (options.dimensions && viewer.mode !== 'walk') {
    const b = bounds(viewer.level.outline);
    for (const [point, value] of [
      [[b.center[0], b.maxZ + 0.6], b.width],
      [[b.maxX + 0.6, b.center[1]], b.depth],
    ] as [[number, number], number][]) {
      const p = project(point);
      if (p.visible)
        obstacles.push(
          tag(`${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} m`, p.x, p.y),
        );
    }
    if (viewer.measurement?.b && viewer.measurement.distance !== undefined) {
      const { a, b, distance } = viewer.measurement;
      const p = project([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      if (p.visible)
        obstacles.push(
          tag(`${distance.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} m`, p.x, p.y),
        );
    }
  }
  if (options.labels && viewer.mode !== 'walk') {
    context.font = '600 13px sans-serif';
    const texts = new Map<string, string>();
    const boxes: LabelBox[] = viewer.level.rooms.flatMap((room) => {
      const p = project(room.label, (room.floorOffset ?? 0) + 0.04);
      if (!p.visible) return [];
      const area = polygonArea(room.polygon).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
      const text = `${room.name} · ${area} m²`;
      texts.set(room.id, text);
      return [
        { id: room.id, x: p.x, y: p.y, width: context.measureText(text).width + 16, height: 24 },
      ];
    });
    for (const label of layoutLabels(boxes, obstacles, {
      width: size.width,
      height: size.sceneHeight,
    }))
      if (label.visible) tag(texts.get(label.id)!, label.x, label.y);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    output.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('Impossible de générer le PNG.'))),
      'image/png',
    ),
  );
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = imageExportFilename(options);
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return blob;
}
