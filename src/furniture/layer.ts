import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { floorElevationAt } from '../model/geometry';
import type { Level, Point2 } from '../model/types';
import type { FurnitureItem } from './model';
import { furnitureDistances } from './checks';
import { constrainFurnitureDrag } from './placement';

export interface FurnitureOverlays {
  distances: boolean;
  clearances: boolean;
  openings: boolean;
}
interface Visual {
  root: TransformNode;
  signature: string;
  materials: StandardMaterial[];
}
interface Drag {
  id: string;
  offset: Point2;
  start: Point2;
  moved: boolean;
  floor: number;
}

/** Metres throughout. Furniture front is local +Z; yaw follows Babylon rotation.y. */
export class FurnitureLayer {
  onSelect?: (id: string) => void;
  onChange?: (items: FurnitureItem[], final: boolean) => void;
  onDragState?: (dragging: boolean) => void;
  private items: FurnitureItem[] = [];
  private visuals = new Map<string, Visual>();
  private selected?: string;
  private mode: 'overview' | 'plan' | 'walk' = 'overview';
  private overlays: FurnitureOverlays = { distances: false, clearances: false, openings: false };
  private overlayRoot?: TransformNode;
  private overlayMaterials: StandardMaterial[] = [];
  private observer: Observer<PointerInfo>;
  private drag?: Drag;
  private disposed = false;
  private readonly release = () => this.finishDrag();

  constructor(
    private scene: Scene,
    private level: Level,
  ) {
    this.observer = scene.onPointerObservable.add((event) => this.pointer(event));
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', this.release);
      window.addEventListener('pointercancel', this.release);
      window.addEventListener('blur', this.release);
    }
  }

  setItems(items: FurnitureItem[]): void {
    this.items = structuredClone(items);
    const ids = new Set(items.map((item) => item.id));
    for (const [id, visual] of this.visuals) {
      if (!ids.has(id)) {
        this.destroyVisual(visual);
        this.visuals.delete(id);
      }
    }
    for (const item of this.items) {
      const signature = JSON.stringify([
        item.kind,
        item.width,
        item.depth,
        item.height,
        item.color,
      ]);
      let visual = this.visuals.get(item.id);
      if (visual?.signature !== signature) {
        if (visual) this.destroyVisual(visual);
        visual = this.build(item, signature);
        this.visuals.set(item.id, visual);
      }
      visual.root.position.set(
        item.position[0],
        floorElevationAt(this.level, item.position),
        item.position[1],
      );
      visual.root.rotation.y = item.rotation;
      visual.root.computeWorldMatrix(true);
    }
    if (
      this.drag &&
      (!ids.has(this.drag.id) || this.items.find((item) => item.id === this.drag?.id)?.locked)
    )
      this.finishDrag();
    if (this.selected && !ids.has(this.selected)) this.selected = undefined;
    this.drawOverlays();
  }

  select(id: string | undefined): void {
    this.selected = this.items.some((item) => item.id === id) ? id : undefined;
    this.drawOverlays();
  }

  setMode(mode: 'overview' | 'plan' | 'walk'): void {
    this.finishDrag();
    this.mode = mode;
    this.drawOverlays();
  }

  setOverlays(overlays: FurnitureOverlays): void {
    this.overlays = { ...overlays };
    this.drawOverlays();
  }

  private build(item: FurnitureItem, signature: string): Visual {
    const root = new TransformNode(`furniture:${item.id}`, this.scene);
    root.metadata = { kind: 'furniture', id: item.id };
    const materials: StandardMaterial[] = [];
    const material = (name: string, color: Color3) => {
      const mat = new StandardMaterial(`furniture:${item.id}:${name}`, this.scene);
      mat.diffuseColor = color;
      mat.specularColor = new Color3(0.08, 0.08, 0.08);
      materials.push(mat);
      return mat;
    };
    const main = material(
      'finish',
      Color3.FromHexString(/^#[\da-f]{6}$/i.test(item.color) ? item.color : '#c4b39f'),
    );
    const soft = material('fabric', main.diffuseColor.scale(1.13));
    const wood = material('feet', new Color3(0.37, 0.28, 0.21));
    const pale = material('linen', new Color3(0.91, 0.9, 0.85));
    const metal = material('handles', new Color3(0.25, 0.27, 0.28));
    const w = item.width,
      d = item.depth,
      h = item.height;
    let part = 0;
    const box = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
      mat = main,
    ) => {
      const mesh = MeshBuilder.CreateBox(
        `furniture:${item.id}:part:${part++}`,
        {
          width: Math.max(0.005, width),
          height: Math.max(0.005, height),
          depth: Math.max(0.005, depth),
        },
        this.scene,
      );
      mesh.parent = root;
      mesh.position.set(x, y, z);
      mesh.material = mat;
      mesh.checkCollisions = true;
      mesh.receiveShadows = true;
      mesh.metadata = { kind: 'furniture', id: item.id };
      return mesh;
    };
    const legs = (top: number, thickness = Math.min(w, d) * 0.08) => {
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(
            thickness,
            top,
            thickness,
            x * (w / 2 - thickness),
            top / 2,
            z * (d / 2 - thickness),
            wood,
          );
    };
    if (item.kind === 'sofa') {
      legs(h * 0.12);
      box(w, h * 0.28, d, 0, h * 0.26, 0);
      box(w * 0.84, h * 0.16, d * 0.77, 0, h * 0.48, d * 0.06, soft);
      box(w, h * 0.6, d * 0.18, 0, h * 0.7, -d * 0.41);
      for (const side of [-1, 1])
        box(w * 0.08, h * 0.37, d * 0.83, side * w * 0.46, h * 0.585, d * 0.085);
      // A discreet seam makes the seating direction legible from above.
      box(w * 0.012, h * 0.004, d * 0.7, 0, h * 0.563, d * 0.07);
    } else if (item.kind === 'bed') {
      legs(h * 0.12);
      box(w, h * 0.28, d, 0, h * 0.26, 0);
      box(w * 0.96, h * 0.27, d * 0.95, 0, h * 0.535, 0, pale);
      box(w, h, d * 0.05, 0, h / 2, -d * 0.475);
      box(w * 0.94, h * 0.035, d * 0.58, 0, h * 0.6875, d * 0.17, soft);
      for (const side of [-1, 1])
        box(w * 0.38, h * 0.12, d * 0.17, side * w * 0.23, h * 0.73, -d * 0.3, pale);
    } else if (item.kind === 'table' || item.kind === 'desk') {
      const top = Math.min(h * 0.1, 0.07);
      legs(h - top);
      box(w, top, d, 0, h - top / 2, 0);
      if (item.kind === 'desk') box(w * 0.3, h * 0.27, d * 0.8, w * 0.32, h * 0.78, 0);
    } else if (item.kind === 'chair') {
      legs(h * 0.44);
      box(w, h * 0.09, d, 0, h * 0.485, 0);
      box(w, h * 0.47, d * 0.1, 0, h * 0.765, -d * 0.45);
    } else if (item.kind === 'wardrobe' || item.kind === 'cabinet') {
      box(w, h, d * 0.95, 0, h / 2, -d * 0.025);
      for (const side of [-1, 1]) {
        box(w * 0.492, h * 0.97, d * 0.015, side * w * 0.25, h * 0.5, d * 0.46);
        box(
          Math.min(0.025, w * 0.03),
          Math.min(0.2, h * 0.2),
          Math.min(0.025, d * 0.05),
          side * w * 0.055,
          h * 0.56,
          d * 0.485,
          metal,
        );
      }
    } else box(w, h, d, 0, h / 2, 0);
    return { root, signature, materials };
  }

  private pointer(event: PointerInfo): void {
    if (this.mode === 'walk' || this.disposed) return;
    if (event.type === PointerEventTypes.POINTERUP) {
      this.finishDrag();
      return;
    }
    if (event.type === PointerEventTypes.POINTERDOWN && event.event.button === 0) {
      const picked = event.pickInfo?.pickedMesh;
      const id =
        picked?.metadata?.kind === 'furniture' ? (picked.metadata.id as string) : undefined;
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item) return;
      this.select(item.id);
      this.onSelect?.(item.id);
      if (item.locked) return;
      const floor = floorElevationAt(this.level, item.position);
      const point = this.groundPoint(floor);
      if (!point) return;
      this.drag = {
        id: item.id,
        offset: [item.position[0] - point.x, item.position[1] - point.z],
        start: [item.position[0], item.position[1]],
        moved: false,
        floor,
      };
      this.onDragState?.(true);
    } else if (event.type === PointerEventTypes.POINTERMOVE && this.drag) {
      const item = this.items.find((candidate) => candidate.id === this.drag!.id);
      const point = this.groundPoint(this.drag.floor);
      if (!item || !point) return;
      const position: Point2 = [point.x + this.drag.offset[0], point.z + this.drag.offset[1]];
      if (
        !this.drag.moved &&
        Math.hypot(position[0] - this.drag.start[0], position[1] - this.drag.start[1]) < 0.015
      )
        return;
      const constrained = constrainFurnitureDrag(item, { ...item, position }, this.level);
      if (
        Math.hypot(
          constrained.position[0] - item.position[0],
          constrained.position[1] - item.position[1],
        ) < 0.00001
      )
        return;
      this.drag.moved = true;
      item.position = constrained.position;
      const visual = this.visuals.get(item.id);
      visual?.root.position.set(
        item.position[0],
        floorElevationAt(this.level, item.position),
        item.position[1],
      );
      this.drawOverlays();
      this.onChange?.(structuredClone(this.items), false);
    }
  }

  private groundPoint(y: number): Vector3 | undefined {
    if (!this.scene.activeCamera) return undefined;
    // The horizontal plane avoids jumps to the top of the dragged object or an intervening wall.
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      null,
      this.scene.activeCamera,
    );
    if (Math.abs(ray.direction.y) < 1e-7) return undefined;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t < 0) return undefined;
    return ray.origin.add(ray.direction.scale(t));
  }

  private finishDrag(): void {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = undefined;
    this.onDragState?.(false);
    if (moved) this.onChange?.(structuredClone(this.items), true);
  }

  private drawOverlays(): void {
    this.clearOverlays();
    const item = this.items.find((candidate) => candidate.id === this.selected);
    if (!item || this.mode === 'walk') return;
    this.overlayRoot = new TransformNode('furniture:overlays', this.scene);
    const root = this.overlayRoot;
    const y = floorElevationAt(this.level, item.position) + 0.035;
    const c = Math.cos(item.rotation),
      s = Math.sin(item.rotation);
    const point = (x: number, z: number) =>
      new Vector3(item.position[0] + x * c + z * s, y, item.position[1] - x * s + z * c);
    const line = (
      name: string,
      points: Vector3[],
      color = new Color3(0.12, 0.58, 0.45),
      label?: string,
    ) => {
      const mesh = MeshBuilder.CreateLines(name, { points }, this.scene);
      mesh.parent = root;
      mesh.color = color;
      mesh.isPickable = false;
      mesh.metadata = { kind: 'furniture-overlay', label };
      if (label) this.label(label, points[0].add(points[points.length - 1]).scale(0.5), root);
    };
    const rectangle = (
      name: string,
      left: number,
      right: number,
      back: number,
      front: number,
      color?: Color3,
    ) =>
      line(
        name,
        [
          point(left, back),
          point(right, back),
          point(right, front),
          point(left, front),
          point(left, back),
        ],
        color,
      );
    const hw = item.width / 2,
      hd = item.depth / 2;
    rectangle('furniture:selection', -hw, hw, -hd, hd);
    if (this.overlays.clearances && item.clearances) {
      const gap = item.clearances;
      rectangle(
        'furniture:clearance',
        -hw - gap.left,
        hw + gap.right,
        -hd - gap.back,
        hd + gap.front,
        new Color3(0.2, 0.6, 0.82),
      );
    }
    if (this.overlays.openings && item.opening) {
      const reach = item.opening.reach;
      const color = new Color3(0.91, 0.56, 0.15);
      // A conservative envelope covers the whole frontage, matching placement warnings.
      rectangle('furniture:opening', -hw, hw, hd, hd + reach, color);
    }
    if (!this.overlays.distances) return;
    line(
      'furniture:width',
      [point(-hw, -hd - 0.13), point(hw, -hd - 0.13)],
      undefined,
      `${item.width.toFixed(2)} m`,
    );
    line(
      'furniture:depth',
      [point(hw + 0.13, -hd), point(hw + 0.13, hd)],
      undefined,
      `${item.depth.toFixed(2)} m`,
    );
    for (const distance of furnitureDistances(item, this.level, this.items)) {
      if (distance.distance <= 0.02) continue;
      line(
        'furniture:wall-distance',
        [
          new Vector3(distance.from[0], y, distance.from[1]),
          new Vector3(distance.to[0], y, distance.to[1]),
        ],
        undefined,
        `${distance.distance.toFixed(2)} m`,
      );
    }
  }

  private label(text: string, position: Vector3, root: TransformNode): void {
    // NullEngine tests and server-side validation have no canvas implementation.
    if (typeof document === 'undefined') return;
    const texture = new DynamicTexture(
      'furniture:dimension-label',
      { width: 256, height: 64 },
      this.scene,
      false,
    );
    texture.hasAlpha = true;
    texture.drawText(text, null, 44, 'bold 32px sans-serif', '#ffffff', '#165347', true);
    const material = new StandardMaterial('furniture:dimension-label', this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    this.overlayMaterials.push(material);
    const label = MeshBuilder.CreatePlane(
      'furniture:dimension-label',
      { width: 0.72, height: 0.18 },
      this.scene,
    );
    label.parent = root;
    label.position.copyFrom(position);
    label.position.y += 0.16;
    label.material = material;
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.isPickable = false;
  }

  private clearOverlays(): void {
    this.overlayRoot?.dispose();
    this.overlayRoot = undefined;
    for (const material of this.overlayMaterials) material.dispose(false, true);
    this.overlayMaterials = [];
  }

  private destroyVisual(visual: Visual): void {
    visual.root.dispose();
    for (const material of visual.materials) material.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.finishDrag();
    this.disposed = true;
    this.scene.onPointerObservable.remove(this.observer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', this.release);
      window.removeEventListener('pointercancel', this.release);
      window.removeEventListener('blur', this.release);
    }
    this.clearOverlays();
    for (const visual of this.visuals.values()) this.destroyVisual(visual);
    this.visuals.clear();
  }
}
