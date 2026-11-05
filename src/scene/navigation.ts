import { Plane } from '@babylonjs/core/Maths/math.plane';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Level, Point2, Wall } from '../model/types';
import { floorElevationAt, pointInPolygon } from '../model/geometry';
import { ELLIPSOID_HALF_HEIGHT, VISITOR_RADIUS } from './walkCamera';
import type { Scene } from '@babylonjs/core/scene';

/** The viewpoint changes, while the visitor's collision body stays on the floor. */
export function applyEyeHeight(camera: UniversalCamera, level: Level, requested: number) {
  const height = Math.max(
    0.85,
    Math.min(level.ceilingHeight - 0.1, Number.isFinite(requested) ? requested : 1.65),
  );
  camera.metadata = { ...camera.metadata, eyeHeight: height };
  camera.position.y = floorElevationAt(level, [camera.position.x, camera.position.z]) + height;
  camera.ellipsoidOffset.y = 2 * ELLIPSOID_HALF_HEIGHT - height;
  camera.cameraDirection.setAll(0);
  return height;
}

function distanceToWall(point: Point2, wall: Wall) {
  const dx = wall.end[0] - wall.start[0],
    dz = wall.end[1] - wall.start[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared
    ? Math.max(
        0,
        Math.min(
          1,
          ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz) / lengthSquared,
        ),
      )
    : 0;
  return Math.hypot(point[0] - wall.start[0] - t * dx, point[1] - wall.start[1] - t * dz);
}

/** Pick a clear floor location, never the footprint of a wall or a doorway. */
export function isVisitDestination(level: Level, point: Point2) {
  return (
    point.every(Number.isFinite) &&
    pointInPolygon(point, level.outline) &&
    level.rooms.some((room) => pointInPolygon(point, room.polygon)) &&
    level.walls.every(
      (wall) => distanceToWall(point, wall) > wall.thickness / 2 + VISITOR_RADIUS + 0.025,
    )
  );
}

export function isSceneVisitDestination(scene: Scene, level: Level, point: Point2) {
  if (!isVisitDestination(level, point)) return false;
  const floor = floorElevationAt(level, point);
  return !scene.meshes.some((mesh) => {
    if (mesh.metadata?.kind !== 'furniture' || !mesh.checkCollisions || !mesh.isEnabled())
      return false;
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    if (box.maximumWorld.y < floor + 0.01 || box.minimumWorld.y > floor + 1.6) return false;
    const dx = point[0] - Math.max(box.minimumWorld.x, Math.min(point[0], box.maximumWorld.x));
    const dz = point[1] - Math.max(box.minimumWorld.z, Math.min(point[1], box.maximumWorld.z));
    return dx * dx + dz * dz < (VISITOR_RADIUS + 0.025) ** 2;
  });
}

export function findVisitDestination(
  scene: Scene,
  level: Level,
  preferred: Point2,
): Point2 | undefined {
  if (isSceneVisitDestination(scene, level, preferred)) return preferred;
  for (let radius = 0.35; radius < 3; radius += 0.35)
    for (let i = 0; i < 16; i++) {
      const point: Point2 = [
        preferred[0] + Math.cos((i * Math.PI) / 8) * radius,
        preferred[1] + Math.sin((i * Math.PI) / 8) * radius,
      ];
      if (isSceneVisitDestination(scene, level, point)) return point;
    }
}

/** Positive half-space is clipped by Babylon: keep everything below this local height. */
export function sectionPlane(level: Level, height: number | undefined): Plane | null {
  return height !== undefined && Number.isFinite(height)
    ? new Plane(0, 1, 0, -(level.elevation + Math.max(0.1, Math.min(level.ceilingHeight, height))))
    : null;
}

/** Determine the exterior side from the outline, including concave house footprints. */
export function wallFacesCamera(level: Level, wall: Wall, camera: Point2) {
  const dx = wall.end[0] - wall.start[0],
    dz = wall.end[1] - wall.start[1];
  const length = Math.hypot(dx, dz);
  if (!length) return false;
  const midpoint: Point2 = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2];
  let nx = -dz / length,
    nz = dx / length;
  const offset = wall.thickness / 2 + 0.05;
  if (pointInPolygon([midpoint[0] + nx * offset, midpoint[1] + nz * offset], level.outline)) {
    nx = -nx;
    nz = -nz;
  }
  return nx * (camera[0] - midpoint[0]) + nz * (camera[1] - midpoint[1]) > 0;
}
