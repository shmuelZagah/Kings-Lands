export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  clone() { return new Vector2(this.x, this.y); }
}
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s) { if (s) { this.x /= s; this.y /= s; this.z /= s; } return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx*dx + dy*dy + dz*dz; }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x)*t; this.y = a.y + (b.y - a.y)*t; this.z = a.z + (b.z - a.z)*t; return this; }
  applyMatrix4(m) {
    const e = m.elements;
    const x = this.x, y = this.y, z = this.z;
    this.x = e[0]*x + e[4]*y + e[8]*z + e[12];
    this.y = e[1]*x + e[5]*y + e[9]*z + e[13];
    this.z = e[2]*x + e[6]*y + e[10]*z + e[14];
    return this;
  }
  fromBufferAttribute(attr, i) { this.x = attr.getX(i); this.y = attr.getY(i); this.z = attr.getZ(i); return this; }
  transformDirection() { return this; }
  applyMatrix3() { return this; }
  project() { return this; }
  unproject() { return this; }
}
export class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this.x = x; this.y = y; this.z = z; this.order = order; }
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this; }
  copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; this.order = e.order; return this; }
}
export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  setFromEuler(e) { this.x = e.x; this.y = e.y; this.z = e.z; this.w = 1; return this; }
  setFromUnitVectors() { return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
}
export class Matrix4 {
  constructor() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  identity() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; return this; }
  copy(m) { for (let i=0;i<16;i++) this.elements[i] = m.elements[i]; return this; }
  clone() { return new Matrix4().copy(this); }
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return this;
  }
  multiply(m) { return this.multiplyMatrices(this, m); }
  invert() { return this; }
  determinant() { return 1; }
  makeScale(x, y, z) { this.identity(); this.elements[0]=x; this.elements[5]=y; this.elements[10]=z; return this; }
  makeRotationX() { return this; }
  makeRotationY() { return this; }
  makeRotationZ() { return this; }
  setPosition(x, y, z) { this.elements[12]=x; this.elements[13]=y; this.elements[14]=z; return this; }
  compose(pos, quat, scale) {
    this.identity();
    this.elements[0] = scale.x; this.elements[5] = scale.y; this.elements[10] = scale.z;
    this.elements[12] = pos.x; this.elements[13] = pos.y; this.elements[14] = pos.z;
    return this;
  }
}
let _uuid = 1;
export class Color {
  constructor(c = 0xffffff) { this.r = 1; this.g = 1; this.b = 1; this.set(c); }
  set(c) {
    if (typeof c === 'number') {
      this.r = ((c >> 16) & 255) / 255;
      this.g = ((c >> 8) & 255) / 255;
      this.b = (c & 255) / 255;
    } else if (typeof c === 'string' && c.startsWith('#')) {
      const n = parseInt(c.slice(1), 16) || 0;
      this.r = ((n >> 16) & 255) / 255;
      this.g = ((n >> 8) & 255) / 255;
      this.b = (n & 255) / 255;
    } else if (c && typeof c === 'object') {
      this.r = c.r ?? 1; this.g = c.g ?? 1; this.b = c.b ?? 1;
    }
    return this;
  }
  setHex(h) { return this.set(h); }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  clone() { return new Color().setRGB(this.r, this.g, this.b); }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  lerp() { return this; }
  multiplyScalar() { return this; }
  getHex() { return ((Math.round(this.r*255)<<16)|(Math.round(this.g*255)<<8)|Math.round(this.b*255)); }
}
export class Object3D {
  constructor() {
    this.uuid = 'obj_' + (_uuid++);
    this.name = '';
    this.position = new Vector3();
    this.rotation = new Euler();
    this.quaternion = new Quaternion();
    this.scale = new Vector3(1, 1, 1);
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.visible = true;
  }
  add(...objs) {
    for (const o of objs) {
      if (!o) continue;
      if (o.parent) o.parent.remove(o);
      o.parent = this;
      this.children.push(o);
    }
    return this;
  }
  clear() { this.children.length = 0; return this; }
  remove(...objs) {
    for (const o of objs) {
      const idx = this.children.indexOf(o);
      if (idx !== -1) { this.children.splice(idx, 1); o.parent = null; }
    }
    return this;
  }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  worldToLocal(v) { return v; }
  getWorldPosition(v) { return v.copy(this.position); }
  getObjectByName(n) {
    if (this.name === n) return this;
    for (const c of this.children) { const f = c.getObjectByName(n); if (f) return f; }
    return null;
  }
  updateMatrix() {
    this.quaternion.setFromEuler(this.rotation);
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }
  updateMatrixWorld(force) {
    this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    else this.matrixWorld.copy(this.matrix);
    for (const c of this.children) c.updateMatrixWorld(force);
  }
  clone(recursive = true) {
    const cl = new this.constructor();
    cl.name = this.name;
    cl.position.copy(this.position);
    cl.rotation.copy(this.rotation);
    cl.scale.copy(this.scale);
    cl.visible = this.visible;
    cl.userData = { ...(this.userData || {}) };
    if (this.isMesh) { cl.geometry = this.geometry; cl.material = this.material; cl.isMesh = true; }
    if (recursive) { for (const c of this.children) cl.add(c.clone(true)); }
    return cl;
  }
}
export class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
export class Scene extends Object3D { constructor() { super(); this.isScene = true; } }
export class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array ? array.length / itemSize : 0; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setXYZ(i, x, y, z) { this.array[i*this.itemSize]=x; this.array[i*this.itemSize+1]=y; this.array[i*this.itemSize+2]=z; return this; }
}
export class Float32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize) { super(array instanceof Float32Array ? array : new Float32Array(array), itemSize); }
}
export class BufferGeometry {
  constructor() {
    this.uuid = 'geom_' + (_uuid++);
    this.attributes = {
      position: new Float32BufferAttribute(new Float32Array(36), 3),
      normal: new Float32BufferAttribute(new Float32Array(36), 3)
    };
    this.index = null;
  }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(idx) { this.index = Array.isArray(idx) ? new BufferAttribute(new Uint16Array(idx), 1) : idx; return this; }
  getIndex() { return this.index; }
  translate() { return this; }
  rotateX() { return this; }
  rotateY() { return this; }
  rotateZ() { return this; }
  scale() { return this; }
  applyMatrix4() { return this; }
  computeVertexNormals() { return this; }
  computeBoundingSphere() { this.boundingSphere = new Sphere(new Vector3(), 5); }
  computeBoundingBox() { this.boundingBox = new Box3(); }
  toNonIndexed() { return this.clone(); }
  clone() {
    const g = new BufferGeometry();
    for (const [k, v] of Object.entries(this.attributes)) {
      g.attributes[k] = new Float32BufferAttribute(new Float32Array(v.array), v.itemSize);
    }
    return g;
  }
  dispose() {}
}
export class BoxGeometry extends BufferGeometry {}
export class SphereGeometry extends BufferGeometry {}
export class CylinderGeometry extends BufferGeometry {}
export class ConeGeometry extends BufferGeometry {}
export class PlaneGeometry extends BufferGeometry {}
export class RingGeometry extends BufferGeometry {}
export class TorusGeometry extends BufferGeometry {}
export class OctahedronGeometry extends BufferGeometry {}
export class DodecahedronGeometry extends BufferGeometry {}
export class IcosahedronGeometry extends BufferGeometry {}
export class ExtrudeGeometry extends BufferGeometry {}
export class LatheGeometry extends BufferGeometry {}
export class TubeGeometry extends BufferGeometry {}
export class Shape {
  moveTo() { return this; } lineTo() { return this; } quadraticCurveTo() { return this; } bezierCurveTo() { return this; } closePath() { return this; }
}
export class CatmullRomCurve3 { constructor(pts = []) { this.points = pts; } }
export class QuadraticBezierCurve3 { constructor() {} }
export class Material {
  constructor(opts = {}) {
    this.uuid = 'mat_' + (_uuid++);
    this.color = new Color(opts.color ?? 0xffffff);
    this.emissive = new Color(opts.emissive ?? 0x000000);
    this.roughness = opts.roughness ?? 0.5;
    this.metalness = opts.metalness ?? 0.1;
    this.opacity = opts.opacity ?? 1;
    this.transparent = Boolean(opts.transparent);
    this.side = opts.side ?? 0;
    this.depthWrite = opts.depthWrite ?? true;
    this.polygonOffset = Boolean(opts.polygonOffset);
    this.polygonOffsetFactor = opts.polygonOffsetFactor ?? 0;
    this.polygonOffsetUnits = opts.polygonOffsetUnits ?? 0;
    this.map = opts.map || null;
    this.userData = {};
  }
  clone() { const c = new this.constructor(this); c.userData = { ...(this.userData || {}) }; return c; }
  dispose() {}
}
export class MeshStandardMaterial extends Material {}
export class MeshBasicMaterial extends Material {}
export class MeshLambertMaterial extends Material {}
export class MeshPhongMaterial extends Material {}
export class ShaderMaterial extends Material {}
export class LineBasicMaterial extends Material {}
export class PointsMaterial extends Material {}
export class SpriteMaterial extends Material {}
export class Mesh extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new Material()) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
}
export class InstancedMesh extends Mesh {
  constructor(geometry, material, count) {
    super(geometry, material);
    this.count = count;
    this.instanceMatrix = { array: new Float32Array(count * 16), needsUpdate: false, setUsage() {} };
  }
  dispose() {}
}
export class Line extends Object3D {}
export class LineSegments extends Object3D {}
export class LineLoop extends Object3D {}
export class Points extends Object3D {}
export class Sprite extends Object3D {}
export class PerspectiveCamera extends Object3D {
  constructor() { super(); this.projectionMatrix = new Matrix4(); this.matrixWorldInverse = new Matrix4(); }
  updateProjectionMatrix() {}
}
export class OrthographicCamera extends Object3D {
  constructor() { super(); this.projectionMatrix = new Matrix4(); this.matrixWorldInverse = new Matrix4(); }
  updateProjectionMatrix() {}
}
export class Frustum {
  setFromProjectionMatrix() { return this; }
  intersectsSphere() { return true; }
}
export class Sphere {
  constructor(center = new Vector3(), radius = 1) { this.center = center; this.radius = radius; }
}
export class Box3 {
  constructor() { this.min = new Vector3(-1,-1,-1); this.max = new Vector3(1,1,1); }
  setFromObject() { return this; }
  getCenter(v) { return v.set(0,0,0); }
  getSize(v) { return v.set(2,2,2); }
}
export class Ray {
  constructor(origin = new Vector3(), direction = new Vector3(0, -1, 0)) { this.origin = origin; this.direction = direction; }
  distanceToPoint(p) { return this.origin.distanceTo(p); }
  intersectPlane() { return new Vector3(); }
  intersectBox() { return new Vector3(); }
}
export class Raycaster {
  constructor() { this.ray = new Ray(); }
  setFromCamera() {}
  intersectObjects() { return []; }
  intersectObject() { return []; }
}
export class Plane { constructor() {} }
export class Light extends Object3D {}
export class DirectionalLight extends Light { constructor() { super(); this.shadow = { mapSize: new Vector2(), camera: {} }; } }
export class HemisphereLight extends Light {}
export class AmbientLight extends Light {}
export class PointLight extends Light {}
export class FogExp2 {}
export class Fog {}
export class CanvasTexture { constructor(canvas) { this.image = canvas; this.needsUpdate = false; this.repeat = new Vector2(1, 1); this.offset = new Vector2(0, 0); } dispose() {} }
export class DataTexture { constructor() { this.needsUpdate = false; } dispose() {} }
export class Texture { dispose() {} }
export class WebGLRenderer {
  constructor() { this.domElement = { style: {}, remove() {} }; this.shadowMap = {}; }
  setSize() {} setPixelRatio() {} render() {} dispose() {} forceContextLoss() {}
}
export const DoubleSide = 2, FrontSide = 0, BackSide = 1, AdditiveBlending = 2, NormalBlending = 1;
export const DynamicDrawUsage = 35048, RepeatWrapping = 1000, ClampToEdgeWrapping = 1001;
export const LinearFilter = 1006, NearestFilter = 1003, RGBAFormat = 1023, SRGBColorSpace = 'srgb';
export const PCFSoftShadowMap = 2;
export class Matrix3 {
  constructor() { this.elements = [1,0,0, 0,1,0, 0,0,1]; }
  getNormalMatrix() { return this; }
}
