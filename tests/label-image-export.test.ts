import assert from 'node:assert/strict';
import test from 'node:test';
import { LABEL_SCALES, layoutLabels, rectanglesOverlap } from '../src/ui/labelLayout';
import { exportImageSize, imageExportFilename } from '../src/ui/imageExport';
import { HouseViewer } from '../src/scene/viewer';

test('plan labels avoid furniture, distance tags and one another without leaving viewport', () => {
  const obstacle = { x: 100, y: 100, width: 100, height: 80 };
  const boxes = [
    { id: 'selected', x: 150, y: 130, width: 100, height: 26, priority: 10 },
    { id: 'other', x: 150, y: 130, width: 100, height: 26 },
    { id: 'edge', x: 5, y: 5, width: 100, height: 26 },
  ];
  const placed = layoutLabels(boxes, [obstacle], { width: 500, height: 400 });
  const visible = placed
    .filter((p) => p.visible)
    .map((p) => ({ x: p.x - 50, y: p.y - 13, width: 100, height: 26 }));
  assert.equal(placed[0].visible, true);
  assert.equal(placed[2].visible, false);
  for (const rect of visible) assert.equal(rectanglesOverlap(rect, obstacle), false);
  for (let i = 0; i < visible.length; i++)
    for (let j = i + 1; j < visible.length; j++)
      assert.equal(rectanglesOverlap(visible[i], visible[j]), false);
  assert.deepEqual(
    layoutLabels(boxes, [obstacle], { width: 500, height: 400 }),
    placed,
    'stable frames',
  );
});

test('a zoomed-out plan label is hidden rather than nudged into the next room', () => {
  // Zoomed out, the room is a 40 px strip: the next room starts right under it.
  const room: [number, number][] = [
    [100, 100],
    [160, 100],
    [160, 140],
    [100, 140],
  ];
  const obstacle = { x: 100, y: 110, width: 60, height: 20 };
  const box = { id: 'strip', x: 130, y: 120, width: 40, height: 20, room };
  const view = { width: 500, height: 400 };
  const [free] = layoutLabels([{ ...box, room: undefined }], [obstacle], view);
  assert.equal(free.visible, true);
  assert.ok(free.y < 100 || free.y > 140, 'unconfined, the nudge leaves the room');
  const [confined] = layoutLabels([box], [obstacle], view);
  assert.equal(confined.visible, false);
  const [clear] = layoutLabels([box], [], view);
  assert.deepEqual([clear.visible, clear.x, clear.y], [true, 130, 120]);
});

test('a label whose box would cross the wall slides back inside, or is hidden when too wide', () => {
  const room: [number, number][] = [
    [100, 100],
    [160, 100],
    [160, 140],
    [100, 140],
  ];
  const view = { width: 500, height: 400 };
  // Centre 5 px from the bottom wall: a 20 px tall label would hang over the next room.
  const box = { id: 'edge', x: 130, y: 135, width: 40, height: 20, room };
  const [slid] = layoutLabels([box], [], view);
  assert.equal(slid.visible, true);
  assert.ok(slid.y + 10 <= 140 && slid.y - 10 >= 100, 'the whole label is inside the room');
  // Wider than the room: it can never fit, wherever it is slid.
  assert.equal(layoutLabels([{ ...box, y: 120, width: 80 }], [], view)[0].visible, false);
});

test('PNG sizing bounds memory and keeps scene aspect ratio; filenames remain portable', () => {
  assert.deepEqual(exportImageSize(1200, 800), { width: 1200, sceneHeight: 800, header: 64 });
  const size = exportImageSize(8000, 4000);
  assert.equal(size.width, 2400);
  assert.equal(size.sceneHeight, 1200);
  assert.throws(() => exportImageSize(0, 800));
  assert.throws(() => exportImageSize(NaN, 800));
  assert.equal(
    imageExportFilename({
      projectName: 'Séjour / été',
      levelName: 'RDC',
      variantName: 'A: canapé',
    }),
    'Sejour-ete-RDC-A-canape.png',
  );
});

test('capture restores dimensions, furniture overlays and animation guard after success or failure', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let copied = 0;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => copied++ }),
      }),
    },
  });
  const mesh = (name: string, enabled: boolean, label?: string) => ({
    name,
    metadata: { kind: 'furniture-overlay', label },
    isEnabled: () => enabled,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    isDisposed: () => false,
  });
  const dimension = mesh('width-dimension', false),
    selection = mesh('furniture:selection', true),
    distance = mesh('furniture:dimension-label', true, '1 m');
  let fail = false;
  let historyResets = 0,
    requestedFrames = 0;
  const camera = { resetViewHistory: () => historyResets++ };
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    canvas: {},
    engine: { getRenderWidth: () => 1200, getRenderHeight: () => 800 },
    dimensions: [dimension],
    measureMeshes: [],
    pinnedMeasurements: [],
    requestRender: () => requestedFrames++,
    paused: false,
    capturing: false,
    currentMode: 'plan',
    scene: {
      activeCamera: camera,
      meshes: [selection, distance],
      render: (update: boolean, ignore: boolean) => {
        assert.equal(update, false);
        assert.equal(ignore, true);
        assert.equal(dimension.isEnabled(), true);
        assert.equal(selection.isEnabled(), false);
        assert.equal(distance.isEnabled(), true);
        if (fail) throw new Error('WebGL capture failed');
      },
    },
  }) as HouseViewer;
  try {
    assert.equal(viewer.captureCanvas(true).width, 1200);
    assert.equal(copied, 1);
    fail = true;
    assert.throws(() => viewer.captureCanvas(true), /WebGL capture failed/);
    assert.equal(dimension.isEnabled(), false);
    assert.equal(selection.isEnabled(), true);
    assert.equal(distance.isEnabled(), true);
    assert.equal((viewer as unknown as { capturing: boolean }).capturing, false);
    assert.equal(viewer.scene.activeCamera, camera);
    assert.equal(historyResets, 2, 'both success and failure discard capture history');
    assert.equal(requestedFrames, 2, 'restored overlays settle again on screen');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('a confined label slides to a free spot inside an L-shaped room instead of disappearing', () => {
  // The anchor sits against the notch: the fixed nudges all leave the room.
  const room: [number, number][] = [
    [100, 100],
    [160, 100],
    [160, 300],
    [60, 300],
    [60, 200],
    [100, 200],
  ];
  const box = { id: 'l', x: 110, y: 160, width: 70, height: 40, room };
  const [placed] = layoutLabels([box], [], { width: 500, height: 400 });
  assert.equal(placed.visible, true);
  const rect = [placed.x - 35, placed.y - 20, placed.x + 35, placed.y + 20];
  assert.ok(rect[0] >= 60 && rect[2] <= 160 && rect[1] >= 100 && rect[3] <= 300);
  assert.ok(!(rect[0] < 100 && rect[1] < 200), 'the notch corner stays clear');
  assert.equal(
    layoutLabels([{ ...box, width: 200 }], [], { width: 500, height: 400 })[0].visible,
    false,
  );
});

test('a label slightly too big for its room is drawn smaller, but never below the minimum', () => {
  const room: [number, number][] = [
    [100, 100],
    [160, 100],
    [160, 140],
    [100, 140],
  ];
  const view = { width: 500, height: 400 };
  const at = (width: number) =>
    layoutLabels([{ id: 'r', x: 130, y: 120, width, height: 24, room }], [], view)[0];
  assert.equal(at(50).scale, 1);
  const shrunk = at(64);
  assert.equal(shrunk.visible, true);
  assert.ok(shrunk.scale < 1 && shrunk.scale >= LABEL_SCALES.at(-1)!);
  assert.ok(
    Math.abs(shrunk.x - 130) <= 30 && 64 * shrunk.scale <= 60,
    'the scaled box fits the room',
  );
  // Still too wide at the smallest scale: hidden, not shrunk further.
  const tooWide = at(60 / LABEL_SCALES.at(-1)! + 2);
  assert.equal(tooWide.visible, false);
  // Without a room (furniture tags, PNG export) the size is never changed.
  const free = layoutLabels([{ id: 'f', x: 130, y: 120, width: 400, height: 24 }], [], view)[0];
  assert.equal(free.scale, 1);
});
