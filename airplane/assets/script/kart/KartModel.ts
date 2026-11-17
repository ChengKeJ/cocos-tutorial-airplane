/**
 * Procedural kart model for the hall kart game （飞车狂飙）.
 *
 * No art assets: the kart is built from Cocos primitives (boxes,
 * cylinders, a sphere) merged per colour into a few meshes, sharing
 * one wheel mesh + one wheel material across all karts. The kart faces
 * +Z locally; KartGame drives position / yaw / bank / pitch.
 *
 * Layout (metres, origin at the road contact point):
 *   body   1.7 x 0.5 x 2.1 @ y 0.50   nose 1.2 x 0.35 x 0.8 @ y 0.42, z +0.90
 *   seat   0.8 x 0.5 x 0.7 @ y 0.85, z -0.20
 *   driver head r 0.30 @ y 1.35, z -0.20 (white helmet)
 *   spoiler 1.6 x 0.08 x 0.45 @ y 1.05, z -0.95 + 2 struts
 *   wheels r 0.34, w 0.28 @ (±0.85, 0.34, ±0.75); fronts steer, all spin
 *   shadow disc r 1.25 @ y 0.05 (opaque dark disc, no transparency needed)
 */

import { Layers, Material, MeshRenderer, Node, Vec3, primitive, utils } from 'cc';
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
let _shadowMesh: any = null;
let _shadowMat: Material | null = null;

function wheelMesh(): any {
    if (!_wheelMesh) {
        // cylinder is Y-axis; rotate about Z by 90 deg so the axle is X
        const prim = primitive.cylinder(0.34, 0.34, 0.28, { radialSegments: 14 });
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

function shadowMesh(): any {
    if (!_shadowMesh) {
        const prim = primitive.cylinder(1.25, 1.25, 0.04, { radialSegments: 20 });
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
    const r = node.addComponent(MeshRenderer);
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
    b.addBox(colour, new Vec3(0, 0.50, 0), 0, 1.7, 0.5, 2.1);
    b.addBox(colour, new Vec3(0, 0.78, -0.55), 0, 1.1, 0.28, 0.9); // rear deck
    b.addBox(dark, new Vec3(0, 0.42, 0.90), 0, 1.2, 0.35, 0.8); // nose
    b.addBox(dark, new Vec3(0, 1.05, -0.95), 0, 1.6, 0.08, 0.45); // spoiler
    b.addBox(dark, new Vec3(-0.6, 0.88, -0.95), 0, 0.08, 0.3, 0.08); // strut L
    b.addBox(dark, new Vec3(0.6, 0.88, -0.95), 0, 0.08, 0.3, 0.08); // strut R
    b.addBox(0x222226, new Vec3(0, 0.85, -0.20), 0, 0.8, 0.5, 0.7); // seat
    b.addBox(0xf2f2f2, new Vec3(0, 1.35, -0.20), 0, 0.6, 0.55, 0.6); // helmet (box-ish, stylised)
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
