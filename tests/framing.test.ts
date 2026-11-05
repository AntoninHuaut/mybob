import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { fitOverview, frameInsets, siteOverviewLevel } from '../src/scene/framing';
import { buildExterior } from '../src/scene/buildExterior';
import { usePlanCoordinates } from '../src/scene/coordinates';
import { validateProject } from '../src/model/validate';

const project = validateProject(
  JSON.parse(await readFile(new URL('../public/projects/private-project.json', import.meta.url), 'utf8')),
);

test('the full living-room facade and house envelope stay inside the usable overview', () => {
  for (const [width, height] of [
    [1200, 750],
    [900, 700],
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
    const camera = new ArcRotateCamera('overview', Math.PI * 0.66, 0.66, 20, Vector3.Zero(), scene);
    camera.fov = 0.66;
    const level = project.levels[0];
    fitOverview(camera, level, width, height);
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    const inset = frameInsets(width, height);
    for (const [x, z] of level.outline)
      for (const y of [level.elevation - 0.18, level.elevation + level.ceilingHeight]) {
        const p = Vector3.Project(
          new Vector3(x, y, z),
          Matrix.IdentityReadOnly,
          transform,
          new Viewport(0, 0, width, height),
        );
        assert.ok(p.z > 0 && p.z < 1);
        assert.ok(
          p.x >= inset.left - 1 && p.x <= width - inset.right + 1,
          `horizontal clipping at ${width}x${height}: ${p.x}`,
        );
        assert.ok(
          p.y >= inset.top - 1 && p.y <= height - inset.bottom + 1,
          `vertical clipping at ${width}x${height}: ${p.y}`,
        );
      }
    scene.dispose();
    engine.dispose();
  }
});

test('the exterior overview fits the full parcel, facade and roof apex on desktop and small screens', () => {
  for (const [width, height] of [
    [1200, 750],
    [900, 700],
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
    const camera = new ArcRotateCamera('overview', Math.PI * 0.66, 0.66, 20, Vector3.Zero(), scene);
    camera.fov = 0.66;
    const level = project.levels[0];
    const exterior = buildExterior(project, level, scene);
    fitOverview(camera, siteOverviewLevel(level, project.site!, exterior.height), width, height);
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    const inset = frameInsets(width, height);
    for (const mesh of exterior.meshes) {
      mesh.computeWorldMatrix(true);
      for (const vertex of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
        const p = Vector3.Project(
          vertex,
          Matrix.IdentityReadOnly,
          transform,
          new Viewport(0, 0, width, height),
        );
        assert.ok(p.z > 0 && p.z < 1);
        assert.ok(
          p.x >= inset.left - 1 && p.x <= width - inset.right + 1,
          `${mesh.name}: horizontal clipping ${width}x${height}`,
        );
        assert.ok(
          p.y >= inset.top - 1 && p.y <= height - inset.bottom + 1,
          `${mesh.name}: vertical clipping ${width}x${height}`,
        );
      }
    }
    scene.dispose();
    engine.dispose();
  }
});
