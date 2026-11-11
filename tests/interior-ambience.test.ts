import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Level } from '../src/model/types';
import { HouseViewer } from '../src/scene/viewer';
import { createWalkCamera } from '../src/scene/walkCamera';
import {
  bounceFaces,
  bouncePolynomial,
  configureInteriorBloom,
  createInteriorBloom,
  createOrbitBloom,
  createInteriorEnvironment,
  createInteriorOcclusion,
  faceDirection,
  interiorRadiance,
  toHalfFloat,
  INTERIOR_BLOOM_THRESHOLD,
  INTERIOR_BLOOM_WEIGHT,
  ORBIT_BLOOM_THRESHOLD,
  INTERIOR_GROUND_COLOR,
  type BloomPipeline,
  type BounceFace,
} from '../src/scene/interiorAmbience';

/** Mirrors `computeEnvironmentIrradiance` from Babylon's harmonics shader. */
function irradiance(polynomial: ReturnType<typeof bouncePolynomial>, normal: number[]) {
  const [nx, ny, nz] = normal;
  const channel = (vector: { asArray(): number[] }, index: number) => vector.asArray()[index];
  return [0, 1, 2].map((index) => {
    const x = channel(polynomial.x, index),
      y = channel(polynomial.y, index),
      z = channel(polynomial.z, index),
      xx = channel(polynomial.xx, index),
      yy = channel(polynomial.yy, index),
      zz = channel(polynomial.zz, index),
      xy = channel(polynomial.xy, index),
      yz = channel(polynomial.yz, index),
      zx = channel(polynomial.zx, index);
    return (
      (xx - zz) * nx * nx +
      (yy - zz) * ny * ny +
      zz +
      xy * nx * ny +
      zx * nx * nz +
      yz * ny * nz +
      x * nx +
      y * ny +
      z * nz
    );
  });
}

function fixture() {
  const engine = new NullEngine({
    renderWidth: 800,
    renderHeight: 600,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('walk', 0, 1, 5, Vector3.Zero(), scene);
  return { engine, scene, camera };
}

test('the generated environment lights every wall, not only the ceiling and floor', () => {
  const polynomial = bouncePolynomial(bounceFaces());
  const normals = {
    right: [1, 0, 0],
    left: [-1, 0, 0],
    up: [0, 1, 0],
    down: [0, -1, 0],
    front: [0, 0, 1],
    back: [0, 0, -1],
  };
  for (const [name, normal] of Object.entries(normals)) {
    const value = irradiance(polynomial, normal);
    assert.ok(
      value.every((channel) => channel > 0),
      `${name} must receive positive irradiance, got ${value.join(', ')}`,
    );
  }
  const up = irradiance(polynomial, normals.up);
  const down = irradiance(polynomial, normals.down);
  assert.ok(
    up[0] > down[0],
    'the ceiling bounce must stay brighter than the floor bounce so the room reads top-to-bottom',
  );
});

test('the environment carries values above white, so reflections have a hot spot', () => {
  // The window is what the glass and the steel reflect; a clamped environment
  // would only ever give them a grey patch.
  const window = interiorRadiance(0, 0.1, 1);
  assert.ok(
    Math.max(...window) > 1,
    `the window must exceed white in linear light, got ${window.join(', ')}`,
  );
  const wall = interiorRadiance(-1, 0, 0);
  assert.ok(Math.max(...wall) < 1, `a plain wall must stay below white, got ${wall.join(', ')}`);
  assert.ok(
    Math.max(...window) > Math.max(...wall) * 3,
    'the window must read as a light source, not as a slightly brighter wall',
  );
});

test('each cube face points along its own axis', () => {
  const centres: [BounceFace, [number, number, number]][] = [
    ['right', [1, 0, 0]],
    ['left', [-1, 0, 0]],
    ['up', [0, 1, 0]],
    ['down', [0, -1, 0]],
    ['front', [0, 0, 1]],
    ['back', [0, 0, -1]],
  ];
  for (const [face, expected] of centres) {
    const [x, y, z] = faceDirection(face, 0.5, 0.5);
    const sign = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v));
    assert.deepEqual(
      [sign(x), sign(y), sign(z)],
      expected.map(sign),
      `${face} must look along ${expected.join(',')}`,
    );
  }
});

test('half floats encode the range the environment needs', () => {
  assert.equal(toHalfFloat(0), 0x0000);
  assert.equal(toHalfFloat(1), 0x3c00, 'one is the half-float unit');
  assert.equal(toHalfFloat(0.5), 0x3800);
  assert.equal(toHalfFloat(2), 0x4000);
  assert.equal(toHalfFloat(-1), 0xbc00);
  assert.equal(toHalfFloat(65504), 0x7bff, 'the largest finite half float');
  assert.equal(toHalfFloat(1e9), 0x7bff, 'overflow saturates on the largest finite value');
  assert.equal(toHalfFloat(Number.NaN), 0x7e00);
  // Round trip through the decoder, which is what the GPU will do.
  for (const value of [0.001, 0.18, 0.55, 1, 3.5, 7, 12.25]) {
    const bits = toHalfFloat(value);
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const mantissa = bits & 0x3ff;
    const decoded =
      exponent === 0
        ? sign * mantissa * 2 ** -24
        : sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
    assert.ok(
      Math.abs(decoded - value) <= Math.abs(value) * 0.001,
      `${value} must survive the encoding, got ${decoded}`,
    );
  }
});

test('the visit ground bounce is darker than the editor one', () => {
  const editor = [0.7137, 0.7059, 0.6353];
  assert.ok(INTERIOR_GROUND_COLOR.r < editor[0]);
  assert.ok(INTERIOR_GROUND_COLOR.g < editor[1]);
  assert.ok(INTERIOR_GROUND_COLOR.b < editor[2]);
});

test('an engine without raw textures or a pre-pass degrades to no ambience', () => {
  const { engine, scene, camera } = fixture();
  try {
    assert.equal(
      createInteriorEnvironment(scene),
      undefined,
      'NullEngine cannot upload a raw cube texture, so the visit keeps its previous lighting',
    );
    assert.equal(
      createInteriorOcclusion(scene, camera),
      undefined,
      'no pre-pass means no ambient occlusion',
    );
    assert.ok(
      !scene.prePassRenderer,
      'a refused occlusion must not leave the pre-pass rendering every frame',
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

/** A pipeline that records what is set on it, and nulls `imageProcessing` like Babylon. */
function recordingPipeline(): { pipeline: BloomPipeline; order: string[] } {
  const order: string[] = [];
  let enabled = true;
  const pipeline: BloomPipeline = {
    imageProcessing: {
      get toneMappingEnabled() {
        return true;
      },
      set toneMappingEnabled(value: boolean) {
        order.push(`toneMapping=${value}`);
      },
      get vignetteEnabled() {
        return true;
      },
      set vignetteEnabled(value: boolean) {
        order.push(`vignette=${value}`);
      },
    },
    get imageProcessingEnabled() {
      return enabled;
    },
    set imageProcessingEnabled(value: boolean) {
      order.push(`imageProcessingEnabled=${value}`);
      // Switching the pass off disposes the post-process and nulls the reference.
      if (!value) pipeline.imageProcessing = null;
    },
    bloomEnabled: false,
    bloomThreshold: 0,
    bloomWeight: 0,
  };
  return { pipeline, order };
}

test('the bloom sub-effects are configured before the pass is switched off', () => {
  const { pipeline, order } = recordingPipeline();
  configureInteriorBloom(pipeline);
  assert.deepEqual(
    order,
    ['toneMapping=false', 'vignette=false', 'imageProcessingEnabled=false'],
    'disabling the pass nulls `imageProcessing`, so the sub-effects must be set first',
  );
  assert.equal(pipeline.imageProcessing, null, 'the pass is gone, not merely disabled');
  assert.equal(pipeline.bloomEnabled, true);
  assert.equal(pipeline.bloomThreshold, INTERIOR_BLOOM_THRESHOLD);
  assert.equal(pipeline.bloomWeight, INTERIOR_BLOOM_WEIGHT);
});

test('the visit bloom and FXAA are applied on the walk camera', () => {
  const { engine, scene, camera } = fixture();
  try {
    const pipeline = createInteriorBloom(scene, camera);
    assert.ok(pipeline, 'a backend that builds post-processes gets the bloom');
    assert.equal(pipeline.bloomEnabled, true);
    assert.equal(pipeline.fxaaEnabled, true);
    assert.equal(
      pipeline.bloomThreshold,
      0.9,
      'à 0,6 les murs blancs (0,6-0,9 affiché) fleurissaient tous',
    );
    assert.equal(pipeline.bloomWeight, 0.2, 'the weight validated on the test house');
    assert.equal(
      pipeline.imageProcessingEnabled,
      false,
      'the app tone-maps in the material shaders, a second pass would double it',
    );
    const chain = (camera as unknown as { _postProcesses: ({ name: string } | null)[] })
      ._postProcesses;
    const names = chain.filter((pass) => pass !== null).map((pass) => pass.name);
    assert.ok(names.includes('bloomMerge'), `the glow must reach the camera, got ${names}`);
    assert.ok(names.indexOf('fxaa') > names.indexOf('bloomMerge'));
    assert.ok(
      !names.includes('imageProcessing'),
      'no image-processing pass may be added to the visit chain',
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('the orbit bloom shares the visit weight, above the flat sky, for the 3D and exterior views', () => {
  const { engine, scene, camera } = fixture();
  try {
    const pipeline = createOrbitBloom(scene, camera);
    assert.ok(pipeline, 'a backend that builds post-processes gets the bloom');
    assert.equal(pipeline.bloomEnabled, true);
    assert.equal(pipeline.samples, 4);
    pipeline.bloomEnabled = false;
    pipeline.bloomEnabled = true;
    assert.equal(pipeline.samples, 4);
    assert.equal(pipeline.bloomWeight, INTERIOR_BLOOM_WEIGHT);
    assert.equal(
      pipeline.bloomThreshold,
      ORBIT_BLOOM_THRESHOLD,
      'le ciel de la Vue 3D est plat à ~0,92 : au seuil de la visite, tout le ciel fleurerait',
    );
    assert.equal(pipeline.imageProcessingEnabled, false, 'le tone mapping reste dans les shaders');
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('a backend without multiple render targets loses occlusion, not the visit', () => {
  const { engine, scene, camera } = fixture();
  try {
    // A context without multiple render targets makes Babylon throw instead of
    // returning null, and the throw used to escape `setMode` before the mode
    // change completed.
    (scene as unknown as { enablePrePassRenderer: () => never }).enablePrePassRenderer = () => {
      throw new TypeError('this._getEngine().createMultipleRenderTarget is not a function');
    };
    assert.equal(
      createInteriorOcclusion(scene, camera),
      undefined,
      'an unsupported backend must degrade to no occlusion',
    );
    assert.ok(!scene.prePassRenderer, 'the failed attempt must not leave a pre-pass behind');
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

const visitLevel: Level = {
  id: 'level',
  name: 'Test',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
  walls: [],
  rooms: [
    {
      id: 'room',
      name: 'Pièce',
      kind: 'living',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      label: [2, 2],
      viewpoint: [2, 2],
    },
  ],
  lights: [],
  spawn: { position: [2, 2], yaw: 0 },
};

test('a failing ambience never leaves the visit half-applied', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const orbit = new ArcRotateCamera('orbit', 0, 0.7, 8, Vector3.Zero(), scene);
  const walk = createWalkCamera(scene, visitLevel);
  const calls: string[] = [];
  const canvas = { classList: { toggle() {} }, style: {} } as unknown as HTMLCanvasElement;
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    scene,
    level: visitLevel,
    orbit,
    walk,
    canvas,
    currentMode: 'plan',
    eyeHeight: 1.65,
    dimensions: [],
    measureMeshes: [],
    measureMode: false,
    goToMode: false,
    currentExteriorView: false,
    sectionHeight: undefined,
    clearKeys() {},
    updateLighting() {
      throw new Error('ambience down');
    },
    updateInteriorAmbience() {
      throw new Error('ambience down');
    },
    updateSection() {
      calls.push('section');
    },
    updateCutaway() {
      calls.push('cutaway');
    },
    onViewChange: (mode: string) => calls.push(`mode:${mode}`),
  }) as HouseViewer;
  const camera = walk as unknown as { attachControl: () => void; detachControl: () => void };
  camera.attachControl = () => {};
  camera.detachControl = () => {};
  const previousDocument = globalThis.document;
  globalThis.document = { pointerLockElement: null } as unknown as Document;
  try {
    viewer.setMode('walk');
  } finally {
    globalThis.document = previousDocument;
    scene.dispose();
    engine.dispose();
  }
  assert.equal(viewer.mode, 'walk', 'the mode change itself must complete');
  assert.deepEqual(
    calls,
    ['section', 'cutaway', 'mode:walk'],
    'the section plane, the cutaways and the chrome all depend on reaching the end',
  );
});

test('a backend that refuses occlusion is not asked again on every visit', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const orbit = new ArcRotateCamera('orbit', 0, 0.7, 8, Vector3.Zero(), scene);
  const walk = createWalkCamera(scene, visitLevel);
  let attempts = 0;
  // The occlusion reads the PrePass; a backend that refuses it must be remembered.
  // The temporal pass asks for the same renderer, so the count is compared between
  // two visit entries rather than against an absolute number.
  scene.enablePrePassRenderer = () => {
    attempts++;
    return null;
  };
  const canvas = {
    classList: { toggle() {} },
    style: {},
    clientWidth: 1280,
    clientHeight: 720,
  } as unknown as HTMLCanvasElement;
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    scene,
    level: visitLevel,
    orbit,
    walk,
    canvas,
    currentMode: 'plan',
    eyeHeight: 1.65,
    dimensions: [],
    measureMeshes: [],
    measureMode: false,
    goToMode: false,
    currentExteriorView: false,
    sectionHeight: undefined,
    clearKeys() {},
    updateLighting() {},
    updateSection() {},
    updateCutaway() {},
  }) as HouseViewer;
  for (const camera of [orbit, walk] as unknown as {
    attachControl: () => void;
    detachControl: () => void;
  }[]) {
    camera.attachControl = () => {};
    camera.detachControl = () => {};
  }
  const previousDocument = globalThis.document;
  globalThis.document = { pointerLockElement: null } as unknown as Document;
  try {
    viewer.setMode('walk');
    const afterFirstVisit = attempts;
    viewer.setMode('plan');
    viewer.setMode('walk');
    assert.equal(
      attempts,
      afterFirstVisit,
      'a refused pre-pass must be remembered, not retried on every visit entry',
    );
  } finally {
    globalThis.document = previousDocument;
    scene.dispose();
    engine.dispose();
  }
});
