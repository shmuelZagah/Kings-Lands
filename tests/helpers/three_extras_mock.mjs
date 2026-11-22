import { Object3D } from './three_mock.mjs';
export class OrbitControls {
  constructor() { this.target = { set() {}, copy() {} }; }
  update() {} dispose() {}
}
export class TransformControls extends Object3D {
  constructor() { super(); }
  attach() {} detach() {} setMode() {} setSize() {} dispose() {}
}
export class GLTFLoader {
  load() {} parse() {}
}
