import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HouseViewer } from '../src/scene/viewer';
import { buildExterior } from '../src/scene/buildExterior';
import { createWalkCamera } from '../src/scene/walkCamera';
import { usePlanCoordinates } from '../src/scene/coordinates';
import { validateProject } from '../src/model/validate';
import { siteOverviewLevel } from '../src/scene/framing';

const project = validateProject(
  JSON.parse(await readFile(new URL('../public/projects/private-project.json', import.meta.url), 'utf8')),
);

function assertSectionAt(scene: Scene, height: number) {
  const plane = scene.clipPlane;
  assert.ok(plane);
  assert.ok(Math.abs(plane.d + height) < 0.001);
}

/** Exercise public viewer state methods without constructing a DOM or WebGL engine. */
function stateFixture(width: number, height: number) {
  const engine = new NullEngine({
    renderWidth: width,
    renderHeight: height,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  usePlanCoordinates(scene);
  const level = project.levels[0];
  const exterior = buildExterior(project, level, scene);
  const orbit = new ArcRotateCamera('overview', Math.PI * 0.66, 0.66, 20, Vector3.Zero(), scene);
  orbit.fov = 0.66;
  const walk = createWalkCamera(scene, level);
  orbit.attachControl = () => {};
  orbit.detachControl = () => {};
  walk.attachControl = () => {};
  walk.detachControl = () => {};
  const ceiling = new Mesh('test-ceiling', scene);
  const viewer = Object.create(HouseViewer.prototype) as HouseViewer;
  Object.assign(viewer, {
    scene,
    engine,
    level,
    exterior,
    orbit,
    walk,
    mode: 'overview',
    canvas: { clientWidth: width, clientHeight: height, classList: { toggle() {} }, style: {} },
    exteriorFrame: siteOverviewLevel(level, project.site!, exterior.height),
    exteriorView: false,
    exteriorMeshes: level.walls
      .filter((wall) => wall.exterior)
      .map((wall) => ({
        wall,
        meshes: exterior.facadeMeshes
          .filter((mesh) => mesh.metadata.wallId === wall.id)
          .map((mesh) => ({ mesh, visibility: mesh.visibility, pickable: mesh.isPickable })),
      })),
    measureMeshes: [],
    dimensions: [],
    sectionHeight: 1.2,
    cutaway: true,
    lightOn: true,
    ceilingOn: false,
    eyeHeight: 1.65,
    house: { ceiling, fixtures: [], pointLights: [], highlights: new Map() },
    hemispheric: { intensity: 0 },
    sun: { intensity: 0 },
    clearKeys: () => {},
  });
  return { viewer, scene, engine, exterior };
}

test('exterior mode restores complete facades and roof, then restores editor cutaway and section', () => {
  const { viewer, scene, engine, exterior } = stateFixture(1000, 700);
  viewer.orbit.getViewMatrix(true);
  viewer.setSectionHeight(undefined);
  viewer.setCutaway(true);
  assert.equal(scene.clipPlane, null);
  assert.ok(
    exterior.facadeMeshes.some((mesh) => mesh.material?.clipPlane),
    'automatic display locally lowers the near facades in the editor',
  );
  viewer.setExteriorView(true);
  assert.equal(scene.clipPlane, null);
  assert.ok(
    exterior.roofMeshes.length > 0 && exterior.roofMeshes.every((mesh) => mesh.isEnabled()),
  );
  assert.ok(
    exterior.facadeMeshes.every((mesh) => mesh.visibility === 1 && !mesh.material?.clipPlane),
    'the exterior presents complete facades',
  );
  viewer.setExteriorView(false);
  assert.ok(exterior.roofMeshes.every((mesh) => !mesh.isEnabled()));
  assert.equal(scene.clipPlane, null);
  assert.ok(
    exterior.facadeMeshes.some((mesh) => mesh.material?.clipPlane),
    'the previous automatic facade cut returns in the editor',
  );
  viewer.setSectionHeight(1.2);
  assertSectionAt(scene, 1.2);
  assert.ok(
    exterior.facadeMeshes.every((mesh) => !mesh.material?.clipPlane),
    'the explicit cut takes priority',
  );
  viewer.setExteriorView(true);
  assert.equal(scene.clipPlane, null);
  viewer.setExteriorView(false);
  assertSectionAt(scene, 1.2);
  scene.dispose();
  engine.dispose();
});

test('leaving exterior for the plan hides the roof and restores the selected cut height', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { pointerLockElement: null },
  });
  const { viewer, scene, engine, exterior } = stateFixture(1000, 700);
  try {
    viewer.setExteriorView(true);
    viewer.setMode('plan');
    assert.equal(exterior.root.isEnabled(), false);
    assert.ok(exterior.roofMeshes.every((mesh) => !mesh.isEnabled()));
    assertSectionAt(scene, 1.2);
    viewer.setMode('overview');
    assert.equal(exterior.root.isEnabled(), true);
    assert.ok(
      exterior.roofMeshes.every((mesh) => !mesh.isEnabled()),
      'the editor overview must not re-enable the roof',
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
    scene.dispose();
    engine.dispose();
  }
});
