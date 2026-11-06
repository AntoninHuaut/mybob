import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import {
  usePlanCoordinates,
  setPlanView,
  walkMovement,
  planHeading,
} from '../src/scene/coordinates';
import { createWalkCamera } from '../src/scene/walkCamera';
import { fitPlan } from '../src/scene/framing';
import { alongWall } from '../src/model/geometry';
import { validateProject } from '../src/model/validate';

const project = validateProject(
  JSON.parse(
    await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
  ),
);
const level = project.levels[0];
const near = (actual: number, expected: number, tolerance = 0.001) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('the plan projection keeps x to the right, z downward and the garage above the living room', () => {
  const box = level.outline.reduce(
    (acc, [x, z]) => ({
      minX: Math.min(acc.minX, x),
      maxX: Math.max(acc.maxX, x),
      minZ: Math.min(acc.minZ, z),
      maxZ: Math.max(acc.maxZ, z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  for (const [width, height] of [
    [1200, 750],
    [390, 670],
    [780, 325],
  ]) {
    const engine = new NullEngine({
      renderWidth: width,
      renderHeight: height,
      textureSize: 512,
      deterministicLockstep: false,
      lockstepMaxSteps: 4,
    });
    const scene = new Scene(engine);
    usePlanCoordinates(scene);
    const camera = new ArcRotateCamera('plan', 0, 0.5, 24, Vector3.Zero(), scene);
    setPlanView(camera, level);
    fitPlan(camera, level, width, height);
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    const projectPoint = (x: number, z: number) =>
      Vector3.Project(
        new Vector3(x, 0, z),
        Matrix.IdentityReadOnly,
        transform,
        new Viewport(0, 0, width, height),
      );
    const topLeft = projectPoint(box.minX, box.minZ),
      topRight = projectPoint(box.maxX, box.minZ),
      bottomLeft = projectPoint(box.minX, box.maxZ);
    assert.ok(topLeft.x < topRight.x, 'x increases to the right, without reflection');
    assert.ok(topLeft.y < bottomLeft.y, 'z increases down the plan');
    const garage = projectPoint(...level.rooms.find((r) => r.id === 'garage')!.label);
    const living = projectPoint(...level.rooms.find((r) => r.id === 'sejour')!.label);
    assert.ok(garage.y < living.y, 'the garage sits above the living room on the minimap');
    for (const [x, z] of level.outline) {
      const p = projectPoint(x, z);
      assert.ok(p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height);
    }
    scene.dispose();
    engine.dispose();
  }
});

test('walking and the map arrow share the real camera direction after the coordinate correction', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  usePlanCoordinates(scene);
  const camera = createWalkCamera(scene, level);
  camera.getViewMatrix(true);
  const ahead = walkMovement(camera, 1, 0),
    right = walkMovement(camera, 0, 1);
  near(ahead.x, 0);
  near(ahead.z, -1);
  near(right.x, 1);
  near(right.z, 0);
  near(planHeading(camera), 0);
  camera.rotation.y = -Math.PI / 2;
  camera.getViewMatrix(true);
  const east = walkMovement(camera, 1, 0);
  near(east.x, 1);
  near(east.z, 0);
  near(planHeading(camera), 90);
  const diagonal = walkMovement(camera, 1, 1).normalize();
  near(diagonal.length(), 1);
  scene.dispose();
  engine.dispose();
});

test('every declared opening sits at a consistent position along its own wall', () => {
  const seen = new Set<string>();
  for (const wall of level.walls)
    for (const opening of wall.openings ?? []) {
      assert.ok(!seen.has(opening.id), `identifiant d'ouverture dupliqué : ${opening.id}`);
      seen.add(opening.id);
      const start = alongWall(wall, opening.offset);
      const end = alongWall(wall, opening.offset + opening.width);
      near(Math.hypot(end[0] - start[0], end[1] - start[1]), opening.width);
    }
});
