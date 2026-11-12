import { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';

/**
 * Babylon keys each program by its define string, written in the order the
 * defines were first set on that sub-mesh. A light index seen for the first time
 * is appended after `LIGHTCOUNT`, so a mesh first drawn in the plan (two lights)
 * and later in the overview (four) asks for the overview's program again with its
 * defines reordered, and the browser links a duplicate, after the view was
 * declared ready. The preprocessor gives `#define` lines no meaning by position,
 * so sorting them makes one set of defines one program, whatever the history.
 */
let installed = false;

export function installCanonicalDefineOrder(): void {
  if (installed) return;
  installed = true;
  const rebuild = MaterialDefines.prototype.rebuild;
  MaterialDefines.prototype.rebuild = function (this: MaterialDefines) {
    rebuild.call(this);
    (this as unknown as { _keys: string[] })._keys.sort();
  };
}
