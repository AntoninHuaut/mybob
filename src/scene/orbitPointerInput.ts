import { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput';
import { Camera } from '@babylonjs/core/Cameras/camera';

/** Keep Babylon orbit gestures in 3D; a flat plan pans with one finger and zooms its projection. */
export class HouseOrbitPointersInput extends ArcRotateCameraPointersInput {
  constructor(private readonly zoomPlan: (factor: number) => void) {
    super();
  }

  override onTouch(
    point: Parameters<ArcRotateCameraPointersInput['onTouch']>[0],
    x: number,
    y: number,
  ) {
    if (this.camera.mode !== Camera.ORTHOGRAPHIC_CAMERA) {
      super.onTouch(point, x, y);
      return;
    }
    if (!this.panningSensibility) return;
    this.camera.movement.activeInput = true;
    this.camera.movement.panAccumulatedPixels.x -= x / this.panningSensibility;
    this.camera.movement.panAccumulatedPixels.y += y / this.panningSensibility;
  }

  protected override _computePinchZoom(previous: number, current: number) {
    if (this.camera.mode !== Camera.ORTHOGRAPHIC_CAMERA) {
      super._computePinchZoom(previous, current);
      return;
    }
    if (previous > 0 && current > 0 && Number.isFinite(previous) && Number.isFinite(current))
      this.zoomPlan(Math.sqrt(previous / current));
  }
}
