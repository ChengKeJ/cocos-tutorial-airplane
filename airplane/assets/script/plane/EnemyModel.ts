/**
 * Procedural enemy-plane models for 星空战机 (Star Fighter).
 *
 * v1.0.8 fix A: the 2021 tutorial art set gave 4 enemy types + elite +
 * Boss only 2 FBX sprites (Boss = enemy x3, elite = x1.5). Every type
 * now gets its own original model, built here from Cocos primitives —
 * distinct silhouette + colour per type, so the player can tell them
 * apart at a glance. No art assets, nothing copied from any game.
 *
 * All models face +Z (their direction of travel, toward the player)
 * and fit the enemy BoxCollider footprint (3.5 wide x 6 long at
 * scale 1, centre z +0.7). EnemyPlane hides the prefab's FBX 'body'
 * child and shows one of these instead; the node scale set by
 * show() (tanky 1.6x, dart 0.7x, boss 3.0x) still applies.
 *
 * MeshBuilder is the same small mesh-merging helper the kart game
 * uses (KartTrack.ts) — copied here so the plane stays self-contained
 * instead of importing the whole kart track module.
 */

import { Color, Layers, Material, ModelComponent, Node, Quat, Vec3, primitives, utils } from 'cc';
import { Constant } from '../framework/Constant';

// ---------------------------------------------------------------------------
// MeshBuilder (copied from KartTrack.ts — same behaviour, plane-local copy)
// ---------------------------------------------------------------------------

interface Bucket {
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
}

const _q = new Quat();
const _sv = new Vec3();
const _pv = new Vec3();
const _nv = new Vec3();

class MeshBuilder {
    private _buckets = new Map<number, Bucket>();
    private _materials = new Map<number, Material>();

    public static unlitMaterial(hex: number): Material {
        const mat = new Material();
        mat.initialize({ effectName: 'builtin-unlit' });
        const r = ((hex >> 16) & 0xff) / 255;
        const g = ((hex >> 8) & 0xff) / 255;
        const b = (hex & 0xff) / 255;
        mat.setProperty('mainColor', new Color(r * 255, g * 255, b * 255, 255));
        return mat;
    }

    private _bucket(hex: number): Bucket {
        let bk = this._buckets.get(hex);
        if (!bk) {
            bk = { positions: [], normals: [], uvs: [], indices: [] };
            this._buckets.set(hex, bk);
        }
        return bk;
    }

    /** Transform a primitive into a colour bucket (scale -> rotate -> translate). */
    public addPrimitive(hex: number, prim: any, pos: Vec3, rotY: number, scale: Vec3, rotX: number = 0): void {
        Quat.fromEuler(_q, rotX * 180 / Math.PI, rotY * 180 / Math.PI, 0);
        const bk = this._bucket(hex);
        const base = bk.positions.length / 3;
        const p = prim.positions as number[];
        const n = prim.normals as number[];
        const uv = prim.uvs as number[];
        const idx = prim.indices as number[];
        for (let i = 0; i < p.length; i += 3) {
            _pv.set(p[i] * scale.x, p[i + 1] * scale.y, p[i + 2] * scale.z);
            Vec3.transformQuat(_pv, _pv, _q);
            bk.positions.push(_pv.x + pos.x, _pv.y + pos.y, _pv.z + pos.z);
        }
        for (let i = 0; i < n.length; i += 3) {
            _nv.set(n[i], n[i + 1], n[i + 2]);
            Vec3.transformQuat(_nv, _nv, _q);
            bk.normals.push(_nv.x, _nv.y, _nv.z);
        }
        for (let i = 0; i < uv.length; i++) { bk.uvs.push(uv[i]); }
        for (let i = 0; i < idx.length; i++) { bk.indices.push(idx[i] + base); }
    }

    /** Axis-aligned box centred at pos, rotated rotY radians about Y. */
    public addBox(hex: number, pos: Vec3, rotY: number, w: number, h: number, d: number): void {
        this.addPrimitive(hex, primitives.box({ width: w, height: h, length: d }), pos, rotY, _sv.set(1, 1, 1));
    }

    /** Y-axis cylinder (radiusTop 0 = cone tip) centred at pos. */
    public addCylinder(hex: number, pos: Vec3, rotY: number, rTop: number, rBottom: number, h: number): void {
        this.addPrimitive(hex, primitives.cylinder(rTop, rBottom, h, { radialSegments: 12 }), pos, rotY, _sv.set(1, 1, 1));
    }

    /** Cone centred at pos; rotX = +PI/2 tips it toward +Z (the nose). */
    public addCone(hex: number, pos: Vec3, rotY: number, radius: number, h: number, segments: number = 10, rotX: number = 0): void {
        this.addPrimitive(hex, primitives.cylinder(0, radius, h, { radialSegments: segments }), pos, rotY, _sv.set(1, 1, 1), rotX);
    }

    /** Sphere scaled (rx, ry, rz) centred at pos. */
    public addSphere(hex: number, pos: Vec3, rotY: number, rx: number, ry: number, rz: number): void {
        this.addPrimitive(hex, primitives.sphere(1, { segments: 10 }), pos, rotY, _sv.set(rx, ry, rz));
    }

    /** Emit one Node per colour bucket under parent. Returns the root node. */
    public build(parent: Node): Node {
        const root = new Node('meshRoot');
        root.layer = Layers.Enum.DEFAULT;
        root.setParent(parent);
        for (const [hex, bk] of this._buckets) {
            if (bk.positions.length === 0 || bk.indices.length === 0) { continue; }
            const minPos = new Vec3(1e9, 1e9, 1e9);
            const maxPos = new Vec3(-1e9, -1e9, -1e9);
            for (let i = 0; i < bk.positions.length; i += 3) {
                const x = bk.positions[i], y = bk.positions[i + 1], z = bk.positions[i + 2];
                if (x < minPos.x) { minPos.x = x; }
                if (y < minPos.y) { minPos.y = y; }
                if (z < minPos.z) { minPos.z = z; }
                if (x > maxPos.x) { maxPos.x = x; }
                if (y > maxPos.y) { maxPos.y = y; }
                if (z > maxPos.z) { maxPos.z = z; }
            }
            const mesh = utils.MeshUtils.createMesh({
                positions: bk.positions,
                normals: bk.normals,
                uvs: bk.uvs,
                indices: bk.indices,
                minPos, maxPos,
            });
            let mat = this._materials.get(hex);
            if (!mat) {
                mat = MeshBuilder.unlitMaterial(hex);
                this._materials.set(hex, mat);
            }
            const node = new Node('mesh_' + hex.toString(16));
            node.layer = Layers.Enum.DEFAULT;
            node.setParent(root);
            const renderer = node.addComponent(ModelComponent);
            renderer.mesh = mesh;
            renderer.setMaterial(mat, 0);
        }
        return root;
    }
}

// ---------------------------------------------------------------------------
// Per-type looks. body = main colour, dark = shadow/trim, accent = highlights.
// bodyW = fuselage width (elite gold band is sized from it), topY = the
// height of the fuselage top (elite gold fin sits on it).
// ---------------------------------------------------------------------------

interface EnemyLook {
    body: number;
    dark: number;
    accent: number;
    bodyW: number;
    topY: number;
}

const LOOKS: { [type: number]: EnemyLook } = {};
LOOKS[Constant.EnemyType.TYPE1] = { body: 0x5a7fb5, dark: 0x2c3e55, accent: 0xdfe8f2, bodyW: 0.9, topY: 0.18 };
LOOKS[Constant.EnemyType.TYPE2] = { body: 0x2fae7d, dark: 0x14532f, accent: 0xbff5dd, bodyW: 0.7, topY: 0.15 };
LOOKS[Constant.EnemyType.TYPE3] = { body: 0x6b6f78, dark: 0x2e3138, accent: 0xe07b2a, bodyW: 1.5, topY: 0.30 };
LOOKS[Constant.EnemyType.TYPE4] = { body: 0xd43d3d, dark: 0x4a1010, accent: 0xffd23d, bodyW: 0.5, topY: 0.13 };
LOOKS[Constant.EnemyType.BOSS] = { body: 0x6a3fb5, dark: 0x2a1745, accent: 0xd9a441, bodyW: 2.2, topY: 0.25 };

const GOLD = 0xd9a441;

/** Elite trim: a gold band across the fuselage + a gold top fin, so an
 * elite reads as "the gold one" at a glance instead of just "bigger". */
function addEliteTrim(b: MeshBuilder, look: EnemyLook): void {
    b.addBox(GOLD, new Vec3(0, look.topY, 0.9), 0, look.bodyW + 0.18, 0.10, 0.28);
    b.addBox(GOLD, new Vec3(0, look.topY + 0.28, -1.1), 0, 0.08, 0.5, 0.6);
    b.addSphere(GOLD, new Vec3(0, look.topY + 0.1, 1.55), 0, 0.22, 0.22, 0.22);
}

/** TYPE1 "striker": classic swept-wing jet, steel blue. */
function buildType1(b: MeshBuilder, look: EnemyLook): void {
    b.addBox(look.body, new Vec3(0, 0, 0), 0, 0.9, 0.35, 3.2); // fuselage
    b.addCone(look.dark, new Vec3(0, 0, 2.0), 0, 0.45, 1.0, 10, Math.PI / 2); // nose
    b.addBox(look.body, new Vec3(-1.05, 0, -0.3), -0.45, 1.6, 0.08, 0.7); // swept wing L
    b.addBox(look.body, new Vec3(1.05, 0, -0.3), 0.45, 1.6, 0.08, 0.7); // swept wing R
    b.addBox(look.dark, new Vec3(0, 0.38, -1.4), 0, 0.08, 0.7, 0.8); // tail fin
    b.addBox(look.dark, new Vec3(-0.55, 0, -1.55), 0, 0.7, 0.08, 0.5); // tailplane L
    b.addBox(look.dark, new Vec3(0.55, 0, -1.55), 0, 0.7, 0.08, 0.5); // tailplane R
    b.addSphere(look.dark, new Vec3(0, 0.26, 0.5), 0, 0.3, 0.2, 0.45); // cockpit
    b.addBox(look.accent, new Vec3(0, 0, -1.75), 0, 0.5, 0.12, 0.25); // engine glow
}

/** TYPE2 "weaver": wide delta wing, teal — reads as a flat triangle. */
function buildType2(b: MeshBuilder, look: EnemyLook): void {
    b.addBox(look.body, new Vec3(0, 0, 0.2), 0, 0.7, 0.3, 2.6); // slim fuselage
    b.addCone(look.dark, new Vec3(0, 0.05, 1.75), 0, 0.35, 0.8, 10, Math.PI / 2); // nose
    b.addBox(look.body, new Vec3(0, 0, -0.6), 0, 3.2, 0.08, 1.6); // delta wing slab
    b.addBox(look.body, new Vec3(-0.85, 0, 0.6), 0.6, 1.4, 0.08, 1.2); // delta point L
    b.addBox(look.body, new Vec3(0.85, 0, 0.6), -0.6, 1.4, 0.08, 1.2); // delta point R
    b.addBox(look.dark, new Vec3(-0.5, 0.32, -1.3), 0, 0.08, 0.6, 0.7); // twin fin L
    b.addBox(look.dark, new Vec3(0.5, 0.32, -1.3), 0, 0.08, 0.6, 0.7); // twin fin R
    b.addSphere(look.accent, new Vec3(-1.55, 0, -0.9), 0, 0.14, 0.14, 0.14); // wingtip L
    b.addSphere(look.accent, new Vec3(1.55, 0, -0.9), 0, 0.14, 0.14, 0.14); // wingtip R
    b.addSphere(look.dark, new Vec3(0, 0.22, 0.4), 0, 0.24, 0.16, 0.4); // cockpit
}

/** TYPE3 "bulwark": bulky armoured gunship, gunmetal + orange stripes. */
function buildType3(b: MeshBuilder, look: EnemyLook): void {
    b.addBox(look.body, new Vec3(0, 0, 0), 0, 1.5, 0.6, 3.0); // fat fuselage
    b.addBox(look.dark, new Vec3(0, 0, 1.7), 0, 1.3, 0.5, 1.0); // armoured nose
    b.addSphere(look.dark, new Vec3(0, 0, 2.2), 0, 0.55, 0.35, 0.4); // nose cap
    b.addBox(look.body, new Vec3(-1.15, 0, -0.2), 0, 1.5, 0.18, 1.0); // thick wing L
    b.addBox(look.body, new Vec3(1.15, 0, -0.2), 0, 1.5, 0.18, 1.0); // thick wing R
    b.addBox(look.accent, new Vec3(0, 0.32, 0.6), 0, 1.52, 0.08, 0.3); // orange stripe
    b.addBox(look.accent, new Vec3(0, 0.32, -0.8), 0, 1.52, 0.08, 0.3); // orange stripe
    b.addSphere(look.dark, new Vec3(0, 0.48, -0.6), 0, 0.3, 0.25, 0.3); // top turret
    // twin engines (cylinders laid along Z)
    b.addPrimitive(look.dark, primitives.cylinder(0.22, 0.22, 0.6, { radialSegments: 10 }),
        new Vec3(-0.5, 0, -1.7), 0, new Vec3(1, 1, 1), Math.PI / 2);
    b.addPrimitive(look.dark, primitives.cylinder(0.22, 0.22, 0.6, { radialSegments: 10 }),
        new Vec3(0.5, 0, -1.7), 0, new Vec3(1, 1, 1), Math.PI / 2);
}

/** TYPE4 "dart": long needle, crimson — the smallest, fastest silhouette. */
function buildType4(b: MeshBuilder, look: EnemyLook): void {
    b.addBox(look.body, new Vec3(0, 0, 0), 0, 0.5, 0.25, 3.4); // needle fuselage
    b.addCone(look.body, new Vec3(0, 0, 2.3), 0, 0.25, 1.4, 8, Math.PI / 2); // needle nose
    b.addBox(look.body, new Vec3(-0.55, 0, -0.9), -0.7, 0.9, 0.06, 0.5); // tiny wing L
    b.addBox(look.body, new Vec3(0.55, 0, -0.9), 0.7, 0.9, 0.06, 0.5); // tiny wing R
    b.addBox(look.dark, new Vec3(0, 0.26, -1.6), 0, 0.06, 0.5, 0.6); // tail fin
    b.addBox(look.accent, new Vec3(0, 0.15, 0.3), 0, 0.52, 0.05, 1.2); // gold spine stripe
    b.addSphere(look.dark, new Vec3(0, 0.12, 0.9), 0, 0.16, 0.12, 0.3); // cockpit
}

/** BOSS "钢铁巨兽": double-deck carrier, dark purple + gold — nothing
 * like the small enemies (wide twin-deck body, 4 wings, crown spikes). */
function buildBoss(b: MeshBuilder, look: EnemyLook): void {
    b.addBox(look.body, new Vec3(0, 0, 0), 0, 2.2, 0.5, 3.4); // main deck
    b.addBox(look.body, new Vec3(0, 0.45, -0.2), 0, 1.4, 0.4, 2.4); // upper deck
    b.addBox(look.dark, new Vec3(0, 0, 1.9), 0, 1.8, 0.4, 0.8); // front jaw
    b.addBox(look.dark, new Vec3(-0.55, 0, 2.2), 0, 0.5, 0.3, 0.5); // jaw tooth L
    b.addBox(look.dark, new Vec3(0.55, 0, 2.2), 0, 0.5, 0.3, 0.5); // jaw tooth R
    b.addBox(look.body, new Vec3(-1.15, 0, -0.3), 0, 1.2, 0.12, 1.2); // wing L
    b.addBox(look.body, new Vec3(1.15, 0, -0.3), 0, 1.2, 0.12, 1.2); // wing R
    b.addBox(look.accent, new Vec3(-1.78, 0, -0.3), 0, 0.12, 0.14, 1.2); // gold wingtip L
    b.addBox(look.accent, new Vec3(1.78, 0, -0.3), 0, 0.12, 0.14, 1.2); // gold wingtip R
    b.addSphere(look.dark, new Vec3(0, 0.72, 0.6), 0, 0.4, 0.3, 0.45); // bridge dome
    // crown spikes on the upper deck
    b.addCone(look.accent, new Vec3(-0.5, 0.85, -0.5), 0, 0.16, 0.6, 6);
    b.addCone(look.accent, new Vec3(0, 0.9, -0.9), 0, 0.16, 0.7, 6);
    b.addCone(look.accent, new Vec3(0.5, 0.85, -0.5), 0, 0.16, 0.6, 6);
    // twin engines
    b.addPrimitive(look.dark, primitives.cylinder(0.28, 0.28, 0.7, { radialSegments: 10 }),
        new Vec3(-0.8, 0, -1.85), 0, new Vec3(1, 1, 1), Math.PI / 2);
    b.addPrimitive(look.dark, primitives.cylinder(0.28, 0.28, 0.7, { radialSegments: 10 }),
        new Vec3(0.8, 0, -1.85), 0, new Vec3(1, 1, 1), Math.PI / 2);
    b.addBox(look.accent, new Vec3(0, 0.28, 1.2), 0, 2.22, 0.08, 0.25); // gold brow stripe
}

/** Build one procedural model for a base enemy type (1-4, or BOSS 5).
 * `elite` adds the gold trim. The returned root is named 'procModel'. */
export function buildEnemyModel(type: number, elite: boolean): Node {
    const look = LOOKS[type] || LOOKS[Constant.EnemyType.TYPE1];
    const b = new MeshBuilder();
    if (type === Constant.EnemyType.BOSS) {
        buildBoss(b, look);
    } else if (type === Constant.EnemyType.TYPE2) {
        buildType2(b, look);
    } else if (type === Constant.EnemyType.TYPE3) {
        buildType3(b, look);
    } else if (type === Constant.EnemyType.TYPE4) {
        buildType4(b, look);
    } else {
        buildType1(b, look);
    }
    if (elite) {
        addEliteTrim(b, look);
    }
    const root = new Node('procModel');
    root.layer = Layers.Enum.DEFAULT;
    b.build(root);
    return root;
}
