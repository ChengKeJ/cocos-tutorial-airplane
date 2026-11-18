/**
 * Kart model for the hall kart game （飞车狂飙） — AAA rework.
 *
 * The karts are no longer procedural boxes. Each of the 8 karts is a real
 * 3D model baked from a licensed GLB asset (see KartModelsData.ts header
 * + LICENSES-karts.md for every source URL and license) into compact
 * per-bucket geometry (Int16 mm positions, Int8 normals, Uint16 indices,
 * base64). At runtime we decode the buckets, build one mesh per bucket,
 * and shade them with PBR (builtin-standard): glossy metallic paint,
 * matte rubber tires, chrome-ish rims.
 *
 * Roles (see the converter): "paint" = recolourable body (kart colour /
 * paint scheme); "detail" = fixed colours; "tire" / "rim" = wheel parts;
 * "driver" = built-in driver figure (kart 2 only), recoloured to accent.
 *
 * The kart faces +Z locally; KartGame drives position / yaw / bank /
 * pitch. Wheels keep the old structure — steer pivots in front (rotate
 * Y), spin nodes (rotate X) — so steering / spin / collision footprint
 * are unchanged. The driver (7 karts; kart 2 has a built-in one) is a
 * procedural seated figure: dark suit torso + arms to the steering
 * wheel, gloves, and a glossy helmet in the kart accent colour.
 *
 * Layout (metres, origin at the road contact point): the baked bodies
 * are normalised to ~2.1 m long, ground at y 0, forward +Z. Wheel
 * centres, seat and steering-wheel positions are per-kart baked data.
 * Shadow: two nested opaque discs (lighter outer + dark core) as a
 * cheap soft blob — no transparency, so it works on every backend.
 */

import { Color, Layers, Material, ModelComponent, Node, Vec3, primitives, utils } from 'cc';
import { MeshBuilder } from './KartTrack';
import { DriverStats, PaintScheme, ROSTER } from './KartConstants';
import { KART_MODELS, KartModelBucket } from './KartModelsData';

export interface KartModel {
    root: Node;
    /** front steer pivots (rotate Y to steer) */
    steerFL: Node;
    steerFR: Node;
    /** wheel spinners (rotate X to spin) */
    wheelFL: Node;
    wheelFR: Node;
    wheelRL: Node;
    wheelRR: Node;
    /** body node (tilts with drift / bumps) */
    body: Node;
}

// ---- base64 (pure TS: no atob in the mini-program JS runtime) ----
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Map<string, number>();
for (let i = 0; i < B64_ALPHABET.length; i++) { B64_LOOKUP.set(B64_ALPHABET[i], i); }

function b64ToBytes(s: string): Uint8Array {
    const clean = s.replace(/=+$/, '');
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let o = 0;
    for (let i = 0; i < clean.length; i += 4) {
        const a = B64_LOOKUP.get(clean[i]) || 0;
        const b = B64_LOOKUP.get(clean[i + 1]) || 0;
        const c = i + 2 < clean.length ? (B64_LOOKUP.get(clean[i + 2]) || 0) : 0;
        const d = i + 3 < clean.length ? (B64_LOOKUP.get(clean[i + 3]) || 0) : 0;
        out[o++] = (a << 2) | (b >> 4);
        if (i + 2 < clean.length) { out[o++] = ((b & 15) << 4) | (c >> 2); }
        if (i + 3 < clean.length) { out[o++] = ((c & 3) << 6) | d; }
    }
    return out.subarray(0, o);
}

// ---- PBR materials (builtin-standard), cached by colour + finish ----
const _stdMats = new Map<string, Material>();

function standardMaterial(hex: number, metallic: number, roughness: number): Material {
    const key = hex.toString(16) + '_' + metallic + '_' + roughness;
    let mat = _stdMats.get(key);
    if (!mat) {
        mat = new Material();
        mat.initialize({ effectName: 'builtin-standard' });
        const r = (hex >> 16) & 0xff;
        const g = (hex >> 8) & 0xff;
        const b = hex & 0xff;
        mat.setProperty('mainColor', new Color(r, g, b, 255));
        mat.setProperty('metallic', metallic);
        mat.setProperty('roughness', roughness);
        _stdMats.set(key, mat);
    }
    return mat;
}

/** Finish per bucket role. Paint is glossy metallic (clear-coat feel);
 * tires matte rubber; rims chrome-ish; detail semi-gloss. */
function materialForRole(role: string, hex: number): Material {
    if (role === 'paint') { return standardMaterial(hex, 0.55, 0.25); }
    if (role === 'driver') { return standardMaterial(hex, 0.4, 0.4); }
    if (role === 'tire') { return standardMaterial(hex, 0.0, 0.95); }
    if (role === 'rim') { return standardMaterial(hex, 0.9, 0.25); }
    return standardMaterial(hex, 0.3, 0.5); // detail
}

function parseHex(s: string): number {
    const v = parseInt(s.replace('#', ''), 16);
    return isNaN(v) ? 0x808080 : v;
}

/** Relative luminance (0..1) — a near-black accent is invisible as a
 * helmet on a dark frame, so the driver falls back to white. */
function luminance(hex: number): number {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---- baked bucket -> mesh (positions Int16 mm, normals Int8 x127) ----
const _bucketMeshes = new Map<string, any>();

function bucketMesh(b: KartModelBucket): any {
    const key = b.role + b.hex + b.pos.length + b.idx.length;
    let mesh = _bucketMeshes.get(key);
    if (mesh) { return mesh; }
    const posB = b64ToBytes(b.pos);
    const norB = b64ToBytes(b.nor);
    const idxB = b64ToBytes(b.idx);
    const n = Math.floor(posB.length / 6);
    const positions: number[] = new Array(n * 3);
    const normals: number[] = new Array(n * 3);
    const uvs: number[] = new Array(n * 2);
    let minX = 1e9, minY = 1e9, minZ = 1e9;
    let maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    for (let i = 0; i < n; i++) {
        let x = posB[i * 6] | (posB[i * 6 + 1] << 8);
        if (x >= 32768) { x -= 65536; }
        let y = posB[i * 6 + 2] | (posB[i * 6 + 3] << 8);
        if (y >= 32768) { y -= 65536; }
        let z = posB[i * 6 + 4] | (posB[i * 6 + 5] << 8);
        if (z >= 32768) { z -= 65536; }
        positions[i * 3] = x / 1000;
        positions[i * 3 + 1] = y / 1000;
        positions[i * 3 + 2] = z / 1000;
        if (positions[i * 3] < minX) { minX = positions[i * 3]; }
        if (positions[i * 3] > maxX) { maxX = positions[i * 3]; }
        if (positions[i * 3 + 1] < minY) { minY = positions[i * 3 + 1]; }
        if (positions[i * 3 + 1] > maxY) { maxY = positions[i * 3 + 1]; }
        if (positions[i * 3 + 2] < minZ) { minZ = positions[i * 3 + 2]; }
        if (positions[i * 3 + 2] > maxZ) { maxZ = positions[i * 3 + 2]; }
        let nx = norB[i * 3];
        if (nx >= 128) { nx -= 256; }
        let ny = norB[i * 3 + 1];
        if (ny >= 128) { ny -= 256; }
        let nz = norB[i * 3 + 2];
        if (nz >= 128) { nz -= 256; }
        normals[i * 3] = nx / 127;
        normals[i * 3 + 1] = ny / 127;
        normals[i * 3 + 2] = nz / 127;
        uvs[i * 2] = 0;
        uvs[i * 2 + 1] = 0;
    }
    const idxCount = Math.floor(idxB.length / 2);
    const indices: number[] = new Array(idxCount);
    for (let i = 0; i < idxCount; i++) {
        indices[i] = idxB[i * 2] | (idxB[i * 2 + 1] << 8);
    }
    mesh = utils.MeshUtils.createMesh({
        positions, normals, uvs, indices,
        minPos: new Vec3(minX, minY, minZ),
        maxPos: new Vec3(maxX, maxY, maxZ),
    });
    _bucketMeshes.set(key, mesh);
    return mesh;
}

function addMeshNode(parent: Node, name: string, mesh: any, mat: Material): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.DEFAULT;
    node.setParent(parent);
    // NOTE: cc.MeshRenderer is not exported by this build's engine module;
    // ModelComponent (its base class) renders identically (verified live).
    const r = node.addComponent(ModelComponent);
    r.mesh = mesh;
    r.setMaterial(mat, 0);
    return node;
}

// ---- soft blob shadow: two nested opaque discs (no transparency) ----
const _shadowMeshes = new Map<number, any>();

function shadowMesh(radius: number): any {
    let m = _shadowMeshes.get(radius);
    if (!m) {
        const prim = primitives.cylinder(radius, radius, 0.04, { radialSegments: 20 });
        m = utils.MeshUtils.createMesh({
            positions: prim.positions, normals: prim.normals, uvs: prim.uvs,
            indices: prim.indices,
            minPos: new Vec3(-radius, -0.02, -radius),
            maxPos: new Vec3(radius, 0.02, radius),
        });
        _shadowMeshes.set(radius, m);
    }
    return m;
}

// ---- procedural driver (7 karts; kart 2 has a built-in driver) ----
function buildDriver(body: Node, seat: number[], steer: number[], accent: number): void {
    const sx = seat[0], sy = seat[1], sz = seat[2];
    const tx = steer[0], ty = steer[1], tz = steer[2];
    const suitHex = 0x1a1a20;
    const suitMat = MeshBuilder.unlitMaterial(suitHex);
    // torso + visor + gloves: one merged unlit mesh (dark suit reads
    // fine flat; the glossy part is the helmet, built separately)
    const db = new MeshBuilder();
    db.addCylinder(suitHex, new Vec3(sx, sy + 0.15, sz), 0, 0.13, 0.16, 0.30); // torso
    db.addBox(suitHex, new Vec3(sx, sy + 0.41, sz + 0.12), 0, 0.15, 0.06, 0.05); // visor
    db.addSphere(suitHex, new Vec3(tx - 0.12, ty, tz), 0, 0.05, 0.05, 0.05); // glove L
    db.addSphere(suitHex, new Vec3(tx + 0.12, ty, tz), 0, 0.05, 0.05, 0.05); // glove R
    db.build(body);
    // glossy helmet in the kart accent colour (white when the accent is
    // too dark to read — kart 3's accent is near-black)
    const helmetHex = luminance(accent) < 0.08 ? 0xf5f5f5 : accent;
    const helmPrim = primitives.sphere(0.13, { segments: 12 });
    const helmMesh = utils.MeshUtils.createMesh({
        positions: helmPrim.positions, normals: helmPrim.normals,
        uvs: helmPrim.uvs, indices: helmPrim.indices,
        minPos: new Vec3(-0.13, -0.13, -0.13),
        maxPos: new Vec3(0.13, 0.13, 0.13),
    });
    const helm = addMeshNode(body, 'helmet', helmMesh, standardMaterial(helmetHex, 0.55, 0.25));
    helm.setPosition(sx, sy + 0.40, sz + 0.02);
    // arms: thin cylinders aimed shoulder -> glove (Euler YXZ: pitch =
    // acos(dy/len), yaw = atan2(dx, dz); see Quat.fromEuler order)
    for (const side of [-1, 1]) {
        const gx = tx + side * 0.12;
        const shx = sx + side * 0.14, shy = sy + 0.28, shz = sz;
        const dx = gx - shx, dy = ty - shy, dz = tz - shz;
        const len = Math.max(0.05, Math.sqrt(dx * dx + dy * dy + dz * dz));
        const armPrim = primitives.cylinder(0.035, 0.035, len, { radialSegments: 8 });
        const armMesh = utils.MeshUtils.createMesh({
            positions: armPrim.positions, normals: armPrim.normals,
            uvs: armPrim.uvs, indices: armPrim.indices,
            minPos: new Vec3(-0.035, -len / 2, -0.035),
            maxPos: new Vec3(0.035, len / 2, 0.035),
        });
        const arm = addMeshNode(body, 'arm' + (side < 0 ? 'L' : 'R'), armMesh, suitMat);
        arm.setPosition((shx + gx) / 2, (shy + ty) / 2, (shz + tz) / 2);
        arm.setRotationFromEuler(Math.acos(dy / len) * 180 / Math.PI, Math.atan2(dx, dz) * 180 / Math.PI, 0);
    }
}

/** Build one kart from its roster entry + baked licensed model.
 * `paint` (when given) overrides the body colour with an unlocked
 * paint scheme — same model, new look. */
export function buildKartModel(stats: DriverStats, paint?: PaintScheme | null): KartModel {
    const colour = paint ? paint.color : stats.color;
    const accent = paint ? paint.accent : stats.accent;
    const ki = Math.max(0, ROSTER.findIndex((d) => d.name === stats.name));
    const data = KART_MODELS[ki] || KART_MODELS[0];
    const root = new Node('kart');
    root.layer = Layers.Enum.DEFAULT;

    const body = new Node('body');
    body.layer = Layers.Enum.DEFAULT;
    body.setParent(root);

    // baked body: one mesh per bucket; paint buckets take the kart /
    // paint colour, the built-in driver takes the accent colour
    for (const b of data.body) {
        const hex = b.role === 'paint' ? colour : b.role === 'driver' ? accent : parseHex(b.hex);
        addMeshNode(body, 'body_' + b.role, bucketMesh(b), materialForRole(b.role, hex));
    }

    // driver (kart 2 闪电 has a built-in driver figure in the model)
    const hasBuiltInDriver = data.body.some((b) => b.role === 'driver');
    if (!hasBuiltInDriver) {
        buildDriver(body, data.seat, data.steer, accent);
    }

    // soft blob shadow: lighter outer disc + dark core (opaque, so no
    // blend-state risk on the mini-program backends)
    const shadowOuter = addMeshNode(root, 'shadowOuter', shadowMesh(1.25), MeshBuilder.unlitMaterial(0x1e1e24));
    shadowOuter.setPosition(0, 0.04, 0);
    const shadowInner = addMeshNode(root, 'shadowInner', shadowMesh(0.85), MeshBuilder.unlitMaterial(0x101014));
    shadowInner.setPosition(0, 0.05, 0);

    // wheels: steer pivots in front, plain spinners behind. The baked
    // wheel geometry is centred on its own axle, so the mesh sits at
    // (0,0,0) inside the spin node and the pivot sits at the baked centre.
    const mkWheel = (parent: Node, name: string, center: number[], buckets: KartModelBucket[]): Node => {
        const pivot = new Node(name);
        pivot.layer = Layers.Enum.DEFAULT;
        pivot.setPosition(center[0], center[1], center[2]);
        pivot.setParent(parent);
        const spin = new Node(name + '_spin');
        spin.layer = Layers.Enum.DEFAULT;
        spin.setParent(pivot);
        for (const b of buckets) {
            addMeshNode(spin, 'tyre_' + b.role, bucketMesh(b), materialForRole(b.role, parseHex(b.hex)));
        }
        return pivot;
    };
    const steerFL = mkWheel(root, 'wheelFL', data.wheels.fl, data.wheelF);
    const steerFR = mkWheel(root, 'wheelFR', data.wheels.fr, data.wheelF);
    const wheelRL = mkWheel(root, 'wheelRL', data.wheels.rl, data.wheelR);
    const wheelRR = mkWheel(root, 'wheelRR', data.wheels.rr, data.wheelR);
    const wheelFL = steerFL.children[0];
    const wheelFR = steerFR.children[0];

    return {
        root, steerFL, steerFR,
        wheelFL, wheelFR, wheelRL: wheelRL.children[0], wheelRR: wheelRR.children[0],
        body,
    };
}
