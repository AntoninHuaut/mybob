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
  JSON.parse(await readFile(new URL('../public/projects/private-project.json', import.meta.url), 'utf8')),
);
const level = project.levels[0];
const near = (actual: number, expected: number, tolerance = 0.001) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('the plan matches the PDF and minimap: garage left, living room right and below', () => {
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
    const topLeft = projectPoint(0, 0),
      topRight = projectPoint(12.55, 0),
      bottomLeft = projectPoint(0, 12.54);
    assert.ok(topLeft.x < topRight.x, 'x increases to the right, without reflection');
    assert.ok(topLeft.y < bottomLeft.y, 'z increases down the plan');
    const garage = projectPoint(...level.rooms.find((r) => r.id === 'garage')!.label);
    const living = projectPoint(...level.rooms.find((r) => r.id === 'sejour')!.label);
    assert.ok(garage.x < living.x && garage.y < living.y);
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

test('window and door positions follow the exterior dimension chains of the original plan', () => {
  const starts: Record<string, number> = {
    'fen-ch3': 1.32,
    'fen-sdb': 1.32 + 1.2 + 0.77,
    'fen-cuisine': 1.32 + 1.2 + 0.77 + 0.6 + 1.07,
    'baie-ouest': 7 + 0.55 + 0.9 + 1.25,
    'porte-entree': 7 + 0.55,
    'fen-ch1': 0.43 + 2.4 + 1.53,
  };
  for (const [id, expected] of Object.entries(starts)) {
    const wall = level.walls.find((w) => w.openings?.some((o) => o.id === id))!;
    const opening = wall.openings!.find((o) => o.id === id)!;
    near(alongWall(wall, opening.offset)[1], expected);
  }
  const opening = level.walls.flatMap((w) => w.openings ?? []).find((o) => o.id === 'fen-ch3')!;
  near(opening.height, 2.15);
  near(opening.sill!, 0);
});
