import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { GreasedLineMesh } from '@babylonjs/core/Meshes/GreasedLine/greasedLineMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, Point2 } from '../model/types';
import { floorElevationAt } from '../model/geometry';
import { measurementEndpoint } from './measurement';
import { createScreenLines } from './screenLines';

export interface Measurement {
  a: Point2;
  b?: Point2;
  distance?: number;
  preview?: boolean;
  aligned?: boolean;
}

/** What the tool reads from the viewer, at call time: the scene and level change on load. */
export interface MeasureHost {
  scene(): Scene;
  level(): Level;
  /** Material of the floor dots; the room highlight's, so they read as the same family. */
  markerMaterial(): Material | null;
  changed(measurement?: Measurement): void;
}

const PREVIEW_COLOR = '#5e9377';
const PINNED_COLOR = '#27634e';

/**
 * « Mesurer »: a first floor click starts a measurement that follows the pointer (snapped to
 * the plan axes by `measurementEndpoint`), a second click pins it. Pinned measurements stay
 * on the floor until `clearPinned`.
 */
export class MeasureTool {
  measurement?: Measurement;
  /** The pointer's floor position while a measurement follows it, to re-snap on Shift/Alt. */
  cursor?: Point2;
  private current: AbstractMesh[] = [];
  private pinned: AbstractMesh[] = [];
  private line?: GreasedLineMesh;

  constructor(private readonly host: MeasureHost) {}

  /** The meshes of the measurement in progress, then the pinned ones (image export hides them). */
  get meshes(): readonly AbstractMesh[] {
    return [...this.current, ...this.pinned];
  }

  preview(point: Point2, forceAxis = false, free = false) {
    if (!this.measurement?.preview) return;
    this.cursor = point;
    const level = this.host.level();
    const snapped = measurementEndpoint(this.measurement.a, point, forceAxis, free);
    this.measurement.b = snapped.point;
    this.measurement.aligned = snapped.aligned;
    this.measurement.distance = Math.hypot(
      snapped.point[0] - this.measurement.a[0],
      snapped.point[1] - this.measurement.a[1],
    );
    const points = [this.measurement.a, snapped.point].map(
      (p) => new Vector3(p[0], floorElevationAt(level, p) + 0.04, p[1]),
    );
    if (this.line) this.line.setPoints([points]);
    else {
      this.line = createScreenLines(
        'measurement',
        [points],
        this.host.scene(),
        Color3.FromHexString(PREVIEW_COLOR),
      );
      this.current.push(this.line);
    }
    this.line.greasedLineMaterial!.color = Color3.FromHexString(PREVIEW_COLOR);
    this.host.changed(this.measurement);
  }

  add(point: Point2, forceAxis = false, free = false) {
    if (!this.measurement?.preview) {
      this.discardCurrent();
      this.measurement = { a: point, preview: true };
    } else {
      this.preview(point, forceAxis, free);
      point = this.measurement.b!;
      this.measurement.preview = false;
      if (this.line) this.line.greasedLineMaterial!.color = Color3.FromHexString(PINNED_COLOR);
      this.cursor = undefined;
    }
    const scene = this.host.scene();
    const dot = CreateSphere('measure-point', { diameter: 0.07, segments: 12 }, scene);
    dot.position.set(point[0], floorElevationAt(this.host.level(), point) + 0.045, point[1]);
    dot.material = this.host.markerMaterial();
    dot.isPickable = false;
    this.current.push(dot);
    if (!this.measurement.preview) {
      this.pinned.push(...this.current);
      this.current = [];
      this.line = undefined;
    }
    this.host.changed(this.measurement);
  }

  /** Leaves the tool: the measurement in progress goes, pinned ones stay. */
  cancel() {
    this.measurement = undefined;
    this.discardCurrent();
    this.host.changed();
  }

  /** Validated measurements stay on the floor until explicitly cleared. */
  clearPinned(): boolean {
    const had = this.pinned.length > 0;
    this.pinned.forEach((mesh) => mesh.dispose());
    this.pinned = [];
    return had;
  }

  /** The scene that owned every mesh is being disposed: forget them without disposing. */
  forget() {
    this.measurement = undefined;
    this.current = [];
    this.pinned = [];
    this.line = undefined;
    this.cursor = undefined;
  }

  private discardCurrent() {
    this.current.forEach((mesh) => mesh.dispose());
    this.current = [];
    this.line = undefined;
    this.cursor = undefined;
  }
}
