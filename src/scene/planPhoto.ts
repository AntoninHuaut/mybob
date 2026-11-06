import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import type { Level } from '../model/types';
import { bounds } from '../model/geometry';

/** Réglages du calque photo : opacités et placement relatifs au niveau. */
export interface PlanPhotoAdjustments {
  /** 0 (invisible) à 1 (opaque). */
  opacity: number;
  /** 1 couvre la largeur du niveau. */
  scale: number;
  /** Degrés autour de l'axe vertical. */
  rotation: number;
  /** Décalages en mètres depuis le centre du niveau. */
  offsetX: number;
  offsetZ: number;
}
export const defaultPlanPhotoAdjustments: PlanPhotoAdjustments = {
  opacity: 0.55,
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetZ: 0,
};

/** Placement pur du plan image : largeur/profondeur du plan selon l'aspect de l'image. */
export function planPhotoPlacement(
  extent: { width: number; depth: number },
  /** Largeur ÷ hauteur de l'image ; positive. */
  imageAspect: number,
  adjustments: PlanPhotoAdjustments,
): { width: number; depth: number; position: [number, number]; rotationY: number } {
  const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  const width = Math.max(0.1, extent.width * adjustments.scale);
  return {
    width,
    depth: width / aspect,
    position: [adjustments.offsetX, adjustments.offsetZ],
    rotationY: (adjustments.rotation * Math.PI) / 180,
  };
}

interface PlanPhotoState {
  adjustments: PlanPhotoAdjustments;
  visible: boolean;
  interactive: boolean;
}

/**
 * Photo de plan posée sous la vue orthographique, au-dessus du sol du niveau.
 * Aucun envoi réseau : l'image vit dans le navigateur (IndexedDB, cf. planPhotoStore).
 * Le glisser sur la scène (hors meuble) déplace les décalages quand `setInteractive`.
 */
export class PlanPhotoLayer {
  onDragState?: (dragging: boolean) => void;
  onAdjust?: (adjustments: PlanPhotoAdjustments) => void;
  private mesh?: import('@babylonjs/core/Meshes/mesh').Mesh;
  private material?: StandardMaterial;
  private url?: string;
  private aspect = 1;
  private state: PlanPhotoState = {
    adjustments: { ...defaultPlanPhotoAdjustments },
    visible: false,
    interactive: false,
  };
  private drag?: { offsetX: number; offsetZ: number; x: number; z: number; moved: boolean };
  private readonly observer: Observer<PointerInfo>;
  private readonly release = () => this.finishDrag();

  constructor(
    private scene: Scene,
    private level: Level,
  ) {
    this.observer = scene.onPointerObservable.add((event) => this.pointer(event))!;
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', this.release);
      window.addEventListener('pointercancel', this.release);
      window.addEventListener('blur', this.release);
    }
  }

  get loaded(): boolean {
    return Boolean(this.mesh);
  }

  /** Blob d'image locale ; résout une fois la texture prête. */
  private blob?: Blob;

  get photoBlob(): Blob | undefined {
    return this.blob;
  }

  async setBlob(blob: Blob): Promise<void> {
    this.blob = blob;
    const { width, height } = await imageDimensions(blob);
    this.aspect = width / height;
    if (this.url?.startsWith('blob:')) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    if (this.mesh) {
      this.disposeMesh();
    }
    this.material = new StandardMaterial('plan-photo:material', this.scene);
    this.material.diffuseTexture = new Texture(this.url, this.scene, false, true);
    this.material.emissiveColor.set(1, 1, 1);
    this.material.disableLighting = true;
    this.material.alpha = clamp01(this.state.adjustments.opacity);
    this.mesh = MeshBuilder.CreatePlane('plan-photo:image', { size: 1 }, this.scene);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.rotation.x = Math.PI / 2;
    this.apply(this.state.adjustments);
    this.mesh.setEnabled(this.state.visible);
  }

  apply(patch: Partial<PlanPhotoAdjustments>): void {
    this.state.adjustments = { ...this.state.adjustments, ...patch };
    const { opacity } = this.state.adjustments;
    if (this.material) this.material.alpha = clamp01(opacity);
    if (this.mesh) {
      const extent = bounds(this.level.outline);
      const placement = planPhotoPlacement(extent, this.aspect, this.state.adjustments);
      // Décalages relatifs au centre du niveau ; la position suit le sol réel.
      this.mesh.scaling.set(placement.width, placement.depth, 1);
      this.mesh.position.set(
        extent.center[0] + placement.position[0],
        this.level.elevation + 0.015,
        extent.center[1] + placement.position[1],
      );
      this.mesh.rotation.z = 0;
      this.mesh.rotation.y = 0;
      // rotation.x = +PI/2 couche le plan ; la rotation image se fait autour de Y monde.
      this.mesh.rotation.y = -placement.rotationY;
    }
    this.onAdjust?.(this.state.adjustments);
  }

  setVisible(visible: boolean): void {
    this.state.visible = visible;
    this.mesh?.setEnabled(visible && this.loaded);
  }

  setInteractive(interactive: boolean): void {
    this.state.interactive = interactive;
    if (!interactive) this.finishDrag();
  }

  dispose(): void {
    this.finishDrag();
    this.scene.onPointerObservable.remove(this.observer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', this.release);
      window.removeEventListener('pointercancel', this.release);
      window.removeEventListener('blur', this.release);
    }
    this.disposeMesh();
    if (this.url?.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(this.url!);
    this.url = undefined;
  }

  private disposeMesh(): void {
    this.mesh?.dispose();
    this.mesh = undefined;
    this.material?.dispose(false, true);
    this.material = undefined;
  }

  private pointer(event: PointerInfo): void {
    if (!this.state.interactive || !this.state.visible || !this.mesh) return;
    if (event.type === PointerEventTypes.POINTERDOWN && event.event.button === 0) {
      if (event.pickInfo?.pickedMesh?.metadata?.kind === 'furniture') return;
      const point = this.groundPoint();
      if (!point) return;
      this.drag = {
        offsetX: this.state.adjustments.offsetX,
        offsetZ: this.state.adjustments.offsetZ,
        x: point.x,
        z: point.z,
        moved: false,
      };
      this.onDragState?.(true);
    } else if (event.type === PointerEventTypes.POINTERMOVE && this.drag) {
      const point = this.groundPoint();
      if (!point) return;
      if (!this.drag.moved && Math.hypot(point.x - this.drag.x, point.z - this.drag.z) < 0.015)
        return;
      this.drag.moved = true;
      this.apply({
        offsetX: this.drag.offsetX + (point.x - this.drag.x),
        offsetZ: this.drag.offsetZ + (point.z - this.drag.z),
      });
    } else if (event.type === PointerEventTypes.POINTERUP) {
      this.finishDrag();
    }
  }

  private finishDrag(): void {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = undefined;
    this.onDragState?.(false);
    void moved;
  }

  private groundPoint(): { x: number; z: number } | undefined {
    const camera = this.scene.activeCamera;
    if (!camera) return undefined;
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, null, camera);
    if (Math.abs(ray.direction.y) < 1e-7) return undefined;
    const t = (this.level.elevation + 0.015 - ray.origin.y) / ray.direction.y;
    if (t < 0) return undefined;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }
}

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  // Repli : la texture Babylon ajuste l'aspect à la première exécution.
  return { width: 1, height: 1 };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
