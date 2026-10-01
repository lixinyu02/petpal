// PetPal's explicit API surface, bundled from the pinned official Framework.
export { CubismFramework } from './src/live2dcubismframework';
export { CubismModelSettingJson } from './src/cubismmodelsettingjson';
export { CubismMoc } from './src/model/cubismmoc';
export { CubismUserModel } from './src/model/cubismusermodel';
export { CubismMatrix44 } from './src/math/cubismmatrix44';
export { CubismShaderManager_WebGL } from './src/rendering/cubismshader_webgl';
import { CubismShaderManager_WebGL } from './src/rendering/cubismshader_webgl';

/** 5-r.5 has no public per-context delete. This narrowly pinned compatibility
 * shim frees only an exclusively owned canvas, leaving other contexts intact.
 * Upstream files are unchanged; review this shim whenever the pin changes. */
export function releaseCubismContext(gl: WebGLRenderingContext): void {
  const manager = CubismShaderManager_WebGL.getInstance();
  const shader = manager.getShader(gl);
  if (shader) shader.release();
  const registry = (manager as unknown as { _shaderMap: Map<WebGLRenderingContext, unknown> })._shaderMap;
  if (!(registry instanceof Map)) throw new Error('Cubism shader registry changed from pinned API.');
  registry.delete(gl);
}
