import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, describe } from 'node:test';
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
import type { ImmersiveWalk } from '../src/scene/xrWalk';

const project = validateProject(
  JSON.parse(
    await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
  ),
);

describe('viewer state transitions', () => {
  let previousDocument: Document;
  beforeEach(() => {
    previousDocument = globalThis.document;
    globalThis.document = {
      pointerLockElement: null,
      removeEventListener() {},
    } as unknown as Document;
  });
  afterEach(() => {
    globalThis.document = previousDocument;
  });

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
      currentMode: 'overview',
      canvas: { clientWidth: width, clientHeight: height, classList: { toggle() {} }, style: {} },
      exteriorFrame: siteOverviewLevel(level, project.site!, exterior.height),
      currentExteriorView: false,
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
      // These tests isolate transitions and geometry; ambience has its own scene tests.
      updateLighting() {},
      updateInteriorAmbience() {},
      updateOrbitBloom() {},
    });
    return { viewer, scene, engine, exterior };
  }

  test('accepted transitions notify with the committed camera, exterior and roof state', () => {
    const { viewer, scene, engine, exterior } = stateFixture(1000, 700);
    const states: string[] = [];
    viewer.onViewChange = () => {
      assert.equal(scene.activeCamera, viewer.mode === 'walk' ? viewer.walk : viewer.orbit);
      assert.ok(exterior.roofMeshes.every((mesh) => mesh.isEnabled() === viewer.exteriorView));
      states.push(`${viewer.mode}:${viewer.exteriorView}`);
    };
    try {
      assert.equal(viewer.setExteriorView(true), true);
      assert.equal(viewer.setMode('plan'), true);
      assert.equal(viewer.setMode('overview'), true);
      assert.deepEqual(states, ['overview:true', 'plan:false', 'overview:false']);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  test('host refusal preserves exterior and blocks destination and room entry before moving', () => {
    const { viewer, scene, engine, exterior } = stateFixture(1000, 700);
    try {
      viewer.setExteriorView(true);
      viewer.setGoToMode(true);
      const position = viewer.walk.position.clone();
      const camera = scene.activeCamera;
      let notifications = 0;
      viewer.onViewChange = () => notifications++;
      viewer.canChangeMode = (mode) => mode !== 'walk';
      assert.equal(viewer.setMode('walk'), false);
      assert.equal(viewer.goTo(viewer.level.spawn.position), false);
      viewer.focusRoom(viewer.level.rooms[0].id, true);
      assert.equal(viewer.mode, 'overview');
      assert.equal(viewer.exteriorView, true);
      assert.equal(viewer.goToMode, true);
      assert.equal(scene.activeCamera, camera);
      assert.ok(viewer.walk.position.equals(position));
      assert.ok(exterior.roofMeshes.every((mesh) => mesh.isEnabled()));
      assert.equal(notifications, 0);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  test('a refused walk destination keeps the accepted exterior state and camera', () => {
    const { viewer, scene, engine } = stateFixture(1000, 700);
    try {
      viewer.setExteriorView(true);
      viewer.walk.position.set(-1000, 1.65, -1000);
      // No candidate within the local destination search can be entered.
      viewer.level = { ...viewer.level, rooms: [], spawn: { position: [-1000, -1000], yaw: 0 } };
      let rejected = 0;
      let notifications = 0;
      viewer.onDestinationRejected = () => rejected++;
      viewer.onViewChange = () => notifications++;
      assert.equal(viewer.setMode('walk'), false);
      assert.equal(viewer.mode, 'overview');
      assert.equal(viewer.exteriorView, true);
      assert.equal(scene.activeCamera, viewer.orbit);
      assert.equal(rejected, 1);
      assert.equal(notifications, 0);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  test('destination entry and asynchronous headset exit keep the accepted camera and view', async () => {
    const { viewer, scene, engine, exterior } = stateFixture(1000, 700);
    try {
      viewer.setExteriorView(true);
      let notifications = 0;
      viewer.onViewChange = () => {
        notifications++;
        assert.equal(scene.activeCamera, viewer.mode === 'walk' ? viewer.walk : viewer.orbit);
      };
      viewer.canvas.focus = () => {};
      assert.equal(viewer.goTo(viewer.level.spawn.position), true);
      assert.equal(viewer.mode, 'walk');
      assert.equal(viewer.exteriorView, false);
      assert.ok(exterior.roofMeshes.every((mesh) => mesh.isEnabled()));
      const lifecycle = viewer as unknown as {
        leaveImmersive(walk: ImmersiveWalk): void;
      };
      let ended = false;
      const headset = {
        position: viewer.level.spawn.position,
        camera: viewer.walk,
        dispose() {},
        async exit() {
          await Promise.resolve();
          lifecycle.leaveImmersive(headset as unknown as ImmersiveWalk);
        },
      };
      Object.assign(viewer, { immersive: headset, rebuildWalkPipelines() {} });
      viewer.onImmersiveChange = (active) => {
        ended = !active;
        assert.equal(viewer.mode, 'plan');
        assert.equal(scene.activeCamera, viewer.orbit);
      };
      assert.equal(viewer.setMode('walk'), true);
      assert.equal(notifications, 1, 'remaining in the headset does not emit a new transition');
      assert.equal(viewer.setMode('plan'), true);
      await Promise.resolve();
      assert.equal(ended, true);
      assert.equal(notifications, 2);
      assert.equal(viewer.mode, 'plan');
      assert.equal(viewer.exteriorView, false);
      assert.equal(scene.activeCamera, viewer.orbit);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

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
});
