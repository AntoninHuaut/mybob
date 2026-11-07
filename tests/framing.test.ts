import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import {
  EXTERIOR_STANDOFF,
  builtOutline,
  exteriorOverview,
  fitOverview,
  frameInsets,
  siteOverviewLevel,
} from '../src/scene/framing';
import { buildExterior } from '../src/scene/buildExterior';
import { usePlanCoordinates } from '../src/scene/coordinates';
import { validateProject } from '../src/model/validate';
import type { Level, ProjectSite } from '../src/model/types';

const project = validateProject(
  JSON.parse(
    await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
  ),
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

test('the exterior overview frames the built and its roof, the parcel stays whole on screen', () => {
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
    const frame = siteOverviewLevel(level, project.site!, exterior.height);
    const parcel = project.site!.boundary.map(
      ([x, z]) => new Vector3(x, project.site!.elevation, z),
    );
    fitOverview(camera, frame, width, height, parcel);
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    const viewport = new Viewport(0, 0, width, height);
    const inset = frameInsets(width, height);
    for (const mesh of exterior.meshes) {
      mesh.computeWorldMatrix(true);
      const background =
        mesh.metadata?.exteriorKind === 'ground' || mesh.name === 'parcel-boundary';
      for (const vertex of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
        const p = Vector3.Project(vertex, Matrix.IdentityReadOnly, transform, viewport);
        assert.ok(p.z > 0 && p.z < 1);
        // The subject keeps its UI margins; the parcel only needs to stay on screen.
        const left = background ? 0 : inset.left - 1;
        const right = background ? width : width - inset.right + 1;
        const top = background ? 0 : inset.top - 1;
        const bottom = background ? height : height - inset.bottom + 1;
        assert.ok(
          p.x >= left - (background ? 1 : 0) && p.x <= right + (background ? 1 : 0),
          `${mesh.name}: horizontal clipping ${width}x${height}: ${p.x.toFixed(1)}`,
        );
        assert.ok(
          p.y >= top - (background ? 1 : 0) && p.y <= bottom + (background ? 1 : 0),
          `${mesh.name}: vertical clipping ${width}x${height}: ${p.y.toFixed(1)}`,
        );
      }
    }
    scene.dispose();
    engine.dispose();
  }
});

test('the built, not the parcel, dictates the exterior radius', () => {
  const level = project.levels[0];
  const site = project.site!;
  const roofHeight = Math.max(
    level.ceilingHeight,
    ...site.roofs!.flatMap((r) => r.vertices.map((v) => v[1])),
  );
  for (const azimuth of [Math.PI * 0.66, Math.PI / 2]) {
    // The previous framing used the parcel outline as the subject.
    const parcelFrame: Level = {
      ...level,
      outline: site.boundary,
      elevation: level.elevation + Math.min(site.elevation, 0),
      ceilingHeight: roofHeight - Math.min(site.elevation, 0) + 0.15,
    };
    const parcel = site.boundary.map(([x, z]) => new Vector3(x, site.elevation, z));
    const results: number[] = [];
    for (const frame of [parcelFrame, siteOverviewLevel(level, site, roofHeight)]) {
      const engine = new NullEngine({
        renderWidth: 1200,
        renderHeight: 750,
        textureSize: 512,
        deterministicLockstep: false,
        lockstepMaxSteps: 4,
      });
      const scene = new Scene(engine);
      usePlanCoordinates(scene);
      const camera = new ArcRotateCamera('overview', azimuth, 0.66, 20, Vector3.Zero(), scene);
      camera.fov = 0.66;
      fitOverview(camera, frame, 1200, 750, frame === parcelFrame ? undefined : parcel);
      results.push(camera.radius);
      scene.dispose();
      engine.dispose();
    }
    assert.ok(
      results[1] <= results[0] + 1e-6,
      `the new framing zooms out further than the parcel did at azimuth ${azimuth}`,
    );
  }
});

test('the house keeps at least a wide share of the exterior image', () => {
  const level = project.levels[0];
  const site = project.site!;
  for (const [width, height] of [
    [1600, 1000],
    [1200, 750],
    [900, 700],
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
    const exterior = buildExterior(project, level, scene);
    const frame = siteOverviewLevel(level, site, exterior.height);
    const parcel = site.boundary.map(([x, z]) => new Vector3(x, site.elevation, z));
    const subject = builtOutline(level, site).flatMap(([x, z]) => [
      new Vector3(x, site.elevation, z),
      new Vector3(x, exterior.height, z),
    ]);
    exteriorOverview(camera, frame, subject, parcel, width, height);
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    const viewport = new Viewport(0, 0, width, height);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      parcelMinX = Infinity,
      parcelMaxX = -Infinity,
      parcelMinY = Infinity,
      parcelMaxY = -Infinity;
    for (const point of subject) {
      const p = Vector3.Project(point, Matrix.IdentityReadOnly, transform, viewport);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    for (const point of parcel) {
      const p = Vector3.Project(point, Matrix.IdentityReadOnly, transform, viewport);
      parcelMinX = Math.min(parcelMinX, p.x);
      parcelMaxX = Math.max(parcelMaxX, p.x);
      parcelMinY = Math.min(parcelMinY, p.y);
      parcelMaxY = Math.max(parcelMaxY, p.y);
    }
    assert.ok(
      (maxX - minX) / width >= 0.35,
      `the built is too small at ${width}x${height}: ${((maxX - minX) / width).toFixed(3)}`,
    );
    assert.ok(
      parcelMinX >= -1 && parcelMaxX <= width + 1 && parcelMinY >= -1 && parcelMaxY <= height + 1,
      `the parcel leaves the screen at ${width}x${height}`,
    );
    assert.ok(minY > 0 && maxY < height, 'the built leaves the screen vertically');
    scene.dispose();
    engine.dispose();
  }
});

test('the built outline merges the ground contour and the roof print with a proportional stand-off', () => {
  const site = {
    boundary: [
      [0, 0],
      [40, 0],
      [40, 20],
      [0, 20],
    ],
    elevation: 0,
    notes: [],
    roofs: [
      {
        id: 'roof',
        vertices: [
          [1, 5, 4],
          [13, 7, 4],
          [13, 7, 12],
          [1, 5, 12],
        ],
        faces: [[0, 1, 2, 3]],
      },
    ],
  } as unknown as ProjectSite;
  const level: Level = {
    ...project.levels[0],
    outline: [
      [1, 1],
      [12, 1],
      [12, 11],
      [1, 11],
    ],
  };
  const outline = builtOutline(level, site);
  const expected = [
    [1 - 1.2, 1 - 1.2],
    [13 + 1.2, 1 - 1.2],
    [13 + 1.2, 12 + 1.2],
    [1 - 1.2, 12 + 1.2],
  ];
  assert.ok(
    outline.every(
      ([x, z], i) => Math.abs(x - expected[i][0]) < 1e-9 && Math.abs(z - expected[i][1]) < 1e-9,
    ),
  );
  assert.equal(EXTERIOR_STANDOFF, 0.1);
});
