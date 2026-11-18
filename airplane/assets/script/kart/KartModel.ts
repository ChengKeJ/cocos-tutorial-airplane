/**
 * Procedural kart model for the hall kart game （飞车狂飙）.
 *
 * No art assets: the kart is built from Cocos primitives (boxes,
 * cylinders, a sphere) merged per colour into a few meshes, sharing
 * one wheel mesh + one wheel material across all karts. The kart faces
 * +Z locally; KartGame drives position / yaw / bank / pitch.
 *
 * Layout (metres, origin at the road contact point):
 *   body   1.7 x 0.5 x 2.1 @ y 0.50   sloped nose (tipped box) @ y 0.45, z +0.90
 *   front wing 1.9 x 0.08 x 0.5 @ y 0.28, z +1.15   side pods @ (±0.85, 0.45, -0.10)
 *   seat   0.8 x 0.5 x 0.7 @ y 0.85, z -0.20
 *   driver torso (driver colour) @ y 0.98 + helmet SPHERE r 0.32 @ y 1.42 (driver colour) + dark visor
 *   rear wing 1.9 x 0.08 x 0.5 @ y 1.12, z -1.00 + 2 struts + 2 exhaust pipes
 *   wheels r 0.34, w 0.28 @ (±0.85, 0.34, ±0.75) + light hubcaps; fronts steer, all spin
 *   shadow disc r 1.25 @ y 0.05 (opaque dark disc, no transparency needed)
 */

import { Layers, Material, ModelComponent, Node, Vec3, primitives, utils } from 'cc';
import { MeshBuilder } from './KartTrack';

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

let _wheelMesh: any = null;
let _wheelMat: Material | null = null;
let _hubMesh: any = null;
let _hubMat: Material | null = null;
let _shadowMesh: any = null;
let _shadowMat: Material | null = null;

function wheelMesh(): any {
    if (!_wheelMesh) {
        // cylinder is Y-axis; rotate about Z by 90 deg so the axle is X
        const prim = primitives.cylinder(0.34, 0.34, 0.28, { radialSegments: 14 });
        const pos = prim.positions as number[];
        const nor = prim.normals as number[];
        for (let i = 0; i < pos.length; i += 3) {
            const x = pos[i], y = pos[i + 1], z = pos[i + 2];
            pos[i] = -y;
            pos[i + 1] = x;
            pos[i + 2] = z;
            const nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
            nor[i] = -ny;
            nor[i + 1] = nx;
            nor[i + 2] = nz;
        }
        const minPos = new Vec3(-0.14, -0.34, -0.34);
        const maxPos = new Vec3(0.14, 0.34, 0.34);
        _wheelMesh = utils.MeshUtils.createMesh({
            positions: pos, normals: nor, uvs: prim.uvs, indices: prim.indices, minPos, maxPos,
        });
    }
    return _wheelMesh;
}

function wheelMaterial(): Material {
    if (!_wheelMat) { _wheelMat = MeshBuilder.unlitMaterial(0x1e1e22); }
    return _wheelMat;
}

/** Hubcap: a sphere squashed flat in X (a disc facing out from the wheel). */
function hubcapMesh(): any {
    if (!_hubMesh) {
        const prim = primitives.sphere(1, { segments: 10 });
        const raw = prim.positions as number[];
        const pos: number[] = [];
        for (let i = 0; i < raw.length; i += 3) {
            pos.push(raw[i] * 0.06, raw[i + 1] * 0.2, raw[i + 2] * 0.2);
        }
        const minPos = new Vec3(-0.06, -0.2, -0.2);
        const maxPos = new Vec3(0.06, 0.2, 0.2);
        _hubMesh = utils.MeshUtils.createMesh({
            positions: pos, normals: prim.normals, uvs: prim.uvs, indices: prim.indices, minPos, maxPos,
        });
    }
    return _hubMesh;
}

function hubcapMaterial(): Material {
    if (!_hubMat) { _hubMat = MeshBuilder.unlitMaterial(0x9aa0a6); }
    return _hubMat;
}

function shadowMesh(): any {
    if (!_shadowMesh) {
        const prim = primitives.cylinder(1.25, 1.25, 0.04, { radialSegments: 20 });
        const minPos = new Vec3(-1.25, -0.02, -1.25);
        const maxPos = new Vec3(1.25, 0.02, 1.25);
        _shadowMesh = utils.MeshUtils.createMesh({
            positions: prim.positions, normals: prim.normals, uvs: prim.uvs,
            indices: prim.indices, minPos, maxPos,
        });
    }
    return _shadowMesh;
}

function shadowMaterial(): Material {
    if (!_shadowMat) { _shadowMat = MeshBuilder.unlitMaterial(0x14141a); }
    return _shadowMat;
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

/** Build one kart. colour = body colour (0xRRGGBB), dark = nose/spoiler shade. */
export function buildKartModel(colour: number, dark: number): KartModel {
    const root = new Node('kart');
    root.layer = Layers.Enum.DEFAULT;

    const body = new Node('body');
    body.layer = Layers.Enum.DEFAULT;
    body.setParent(root);

    // body shell: one merged mesh per colour
    const b = new MeshBuilder();
    b.addBox(colour, new Vec3(0, 0.50, 0), 0, 1.7, 0.5, 2.1); // main tub
    b.addBox(colour, new Vec3(0, 0.78, -0.55), 0, 1.1, 0.28, 0.9); // rear deck
    b.addBox(0xf2f2f2, new Vec3(0, 0.93, -0.55), 0, 0.4, 0.02, 0.9); // deck stripe
    // sloped nose: a box tipped about X so the front dips (rotX via addPrimitive)
    b.addPrimitive(dark, primitives.box({ width: 1.2, height: 0.3, length: 0.9 }),
        new Vec3(0, 0.45, 0.90), 0, new Vec3(1, 1, 1), -0.28);
    b.addBox(dark, new Vec3(0, 0.28, 1.15), 0, 1.9, 0.08, 0.5); // front wing
    b.addBox(colour, new Vec3(-0.85, 0.45, -0.10), 0, 0.35, 0.3, 1.2); // side pod L
    b.addBox(colour, new Vec3(0.85, 0.45, -0.10), 0, 0.35, 0.3, 1.2); // side pod R
    b.addBox(dark, new Vec3(0, 1.12, -1.00), 0, 1.9, 0.08, 0.5); // rear wing
    b.addBox(dark, new Vec3(-0.6, 0.95, -1.00), 0, 0.08, 0.35, 0.08); // strut L
    b.addBox(dark, new Vec3(0.6, 0.95, -1.00), 0, 0.08, 0.35, 0.08); // strut R
    // exhausts: cylinders tipped onto their side (axis Y -> Z)
    b.addPrimitive(0x555560, primitives.cylinder(0.09, 0.09, 0.3, { radialSegments: 8 }),
        new Vec3(-0.3, 0.55, -1.12), 0, new Vec3(1, 1, 1), Math.PI / 2);
    b.addPrimitive(0x555560, primitives.cylinder(0.09, 0.09, 0.3, { radialSegments: 8 }),
        new Vec3(0.3, 0.55, -1.12), 0, new Vec3(1, 1, 1), Math.PI / 2);
    b.addBox(0x222226, new Vec3(0, 0.85, -0.20), 0, 0.8, 0.5, 0.7); // seat
    b.addBox(colour, new Vec3(0, 0.98, -0.20), 0, 0.7, 0.45, 0.5); // driver torso
    b.addSphere(colour, new Vec3(0, 1.42, -0.20), 0, 0.32, 0.32, 0.32); // helmet (driver colour)
    b.addBox(0x1a1a20, new Vec3(0, 1.42, 0.10), 0, 0.5, 0.18, 0.1); // visor
    b.build(body);

    // shadow disc (opaque dark, sits just above the road)
    const shadow = addMeshNode(root, 'shadow', shadowMesh(), shadowMaterial());
    shadow.setPosition(0, 0.05, 0);

    // wheels: steer pivots in front, plain spinners behind
    const mkWheel = (parent: Node, name: string, x: number, z: number): Node => {
        const pivot = new Node(name);
        pivot.layer = Layers.Enum.DEFAULT;
        pivot.setPosition(x, 0.34, z);
        pivot.setParent(parent);
        const spin = new Node(name + '_spin');
        spin.layer = Layers.Enum.DEFAULT;
        spin.setParent(pivot);
        addMeshNode(spin, 'tyre', wheelMesh(), wheelMaterial());
        // hubcap disc on the outer face (spins with the wheel)
        const hub = addMeshNode(spin, 'hub', hubcapMesh(), hubcapMaterial());
        hub.setPosition(x < 0 ? -0.15 : 0.15, 0, 0);
        return pivot;
    };
    const steerFL = mkWheel(root, 'wheelFL', -0.85, 0.75);
    const steerFR = mkWheel(root, 'wheelFR', 0.85, 0.75);
    const wheelRL = mkWheel(root, 'wheelRL', -0.85, -0.75);
    const wheelRR = mkWheel(root, 'wheelRR', 0.85, -0.75);
    const wheelFL = steerFL.children[0];
    const wheelFR = steerFR.children[0];

    return {
        root, steerFL, steerFR,
        wheelFL, wheelFR, wheelRL: wheelRL.children[0], wheelRR: wheelRR.children[0],
        body,
    };
}
