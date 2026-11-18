/**
 * Kart track for the Star Fighter hall kart game （飞车狂飙）.
 *
 * Centreline math is a port of the Three.js kart design spec
 * (MIT-licensed reference implementation): the same 16-leg curvature schedule,
 * elevation / half-width / banking keyframes, box-blurred curvature,
 * exact -2PI renormalisation and uniform arc-length resampling.
 * Two circuits share this system (TrackDef): 'sunset' （阳光海岸， the
 * original coastal circuit) and 'canyon' （峡谷狂飙， desert canyon).
 * The world built on top of it is OURS: procedural Cocos meshes
 * (ribbon road, skirt, water / dry lake, trees / cacti, houses / huts,
 * rocks, tunnel / rock arch, bridge, start gantry, boost pads) — no art
 * assets, no Three.js, no DOM.
 *
 * AAA visual rework (2026-11-18): the same centreline and gameplay, but
 * the look is rebuilt to match the AAA karts — cute chunky low-poly +
 * glossy PBR hero surfaces (road, curbs, sea, boost pads, gantry) via a
 * local StdBuilder (MeshBuilder is untouched), a gradient sky dome + sun
 * ball per track (the scene has no skybox), two-tier rolling ground,
 * detailed trees / houses / boards / mountains / tunnel portals / a
 * suspension bridge, and a checkered finish line. All procedural and
 * original — no copied assets or textures.
 *
 * Arcade model: a kart's state is (s = metres along the centreline,
 * d = lateral offset from it). sampleAt(s) returns the interpolated
 * frame {pos, tangent, right, up, half, bank, zone, raceLat}.
 */

import { Layers, Material, ModelComponent, Node, Quat, Vec3, Color, primitives, utils } from 'cc';
import { stdMaterial } from './KartMaterials';

// ---------------------------------------------------------------------------
// Layout tables (spec: src/world/TrackLayout.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Track definitions — two circuits, one system.
// Track 1 'sunset' （阳光海岸） is the original 1606 m coastal circuit
// (harbour / village / cliff / tunnel / beach / bridge). Track 2 'canyon'
// （峡谷狂飙） is a NEW desert-canyon circuit: sand, rock walls, cacti,
// a natural rock arch, an oasis — same scale, same rules, different look
// and rhythm. Both are original content; nothing is copied from any
// commercial kart game.
// ---------------------------------------------------------------------------

export type TrackZoneKind = 'normal' | 'village' | 'tunnel' | 'bridge' | 'cliff';

type Keys = Array<[number, number]>;

export interface TrackZoneDef {
    t0: number;
    name: string;
    ground: number; // 0xRRGGBB skirt colour for this zone
    kind?: TrackZoneKind;
}

export interface TrackDef {
    id: string; // menu id + localStorage key suffix
    name: string; // menu name
    desc: string; // one-line menu description
    /** [length metres, heading change degrees] (negative = left). */
    legs: Array<[number, number]>;
    planLength: number;
    startHeadingDeg: number;
    elevation: Keys;
    halfWidth: Keys;
    bank: Keys; // degrees; positive = right side raised
    zones: TrackZoneDef[];
    boostPads: Array<{ t0: number; t1: number; lat: number; hw: number }>;
    // ---- theme (all procedural colours) ----
    road: number;
    water: number; // big flat plane under the world (sea / dry lake bed)
    treeKind: 'pine' | 'cactus';
    treeLeaf: [number, number]; // two greens, picked at random
    treeTrunk: number;
    houseWall: number;
    houseRoof: number;
    houseRoofKind: 'cone' | 'flat';
    mountain: [number, number];
    mountainKind: 'cone' | 'mesa';
    rock: number;
    tunnelRock: number; // portals + roof (tunnel / rock arch)
    cloud: number;
    // ---- AAA theme additions (visuals only) ----
    sky: number[]; // gradient dome bands, horizon -> zenith (5)
    sunDisc: number; // sun ball colour
    sunHalo: number; // halo ball colour (behind the disc)
    sunAzimDeg: number; // sun azimuth (deg, atan2-style in XZ)
    sunElevDeg: number; // sun elevation (deg)
    roadAlt: number; // second asphalt tone (alternating 8 m strips)
    shoulder: number; // paved shoulder outside the edge lines
    curbA: number; curbB: number; // alternating curb blocks
    waterRough: number; // PBR roughness of the water / lake-bed plane
    door: number; // house door colour
    windowLit: number; // lit window colour
    strata: number; // mesa strata band colour
    tuft: number; // grass / sand tuft colour
    pond?: number; // oasis pond colour (canyon only)
    // ---- scenery feature ranges (fractions of lap; omit if absent) ----
    villageT?: [number, number]; // houses / huts
    cliffT?: [number, number]; // rocks
    rockBothSides?: boolean; // rocks on both sides (default: left only)
    tunnelT?: [number, number]; // tunnel / rock arch
    bridgeT?: [number, number]; // bridge parapets
    seed: number; // scenery RNG seed (different per track)
}

const TRACK_SUNSET: TrackDef = {
    id: 'sunset',
    name: '阳光海岸',
    desc: '海港村庄 · 沙滩大桥',
    legs: [
        [160, -13.85],  // start straight — harbour boulevard
        [192, -102.06], // harbour sweep
        [70, -44.48],   // village ess A (left)
        [60, 40.84],    // village ess B (right)
        [66, -44.12],   // village ess C (left, off-camber)
        [60, -20.79],   // village ess D (left)
        [90, -21.02],   // cliff traverse A
        [74, -4.13],    // cliff traverse B
        [60, -17.70],   // cliff traverse C
        [128, -21.13],  // tunnel
        [110, -2.81],   // beach descent A
        [114, -21.15],  // beach descent B
        [192, -170.85], // banked coastal 180
        [60, 42.32],    // bridge approach
        [84, 11.22],    // bridge span
        [80, 24.47],    // return to the line
    ],
    planLength: 1600,
    startHeadingDeg: 45,
    elevation: [
        [0.000, 3.0], [0.100, 3.6], [0.220, 7.0], [0.300, 15.0],
        [0.380, 29.0], [0.440, 41.5], [0.500, 38.0], [0.560, 33.0],
        [0.600, 28.0], [0.660, 16.0], [0.720, 5.5], [0.800, 14.0],
        [0.860, 24.0], [0.900, 19.5], [0.935, 14.5], [0.962, 9.0],
        [0.982, 4.6], [0.995, 3.15],
    ],
    halfWidth: [
        [0.000, 8.8], [0.070, 8.6], [0.140, 8.1], [0.210, 7.5],
        [0.270, 7.0], [0.330, 6.8], [0.380, 6.4], [0.440, 5.7],
        [0.480, 5.4], [0.521, 5.9], [0.560, 6.3], [0.620, 6.9],
        [0.700, 7.6], [0.760, 8.8], [0.830, 8.7], [0.880, 7.2],
        [0.930, 7.0], [0.968, 8.2],
    ],
    bank: [
        [0.000, 0], [0.070, 0], [0.130, 7], [0.170, 9.5], [0.210, 5],
        [0.240, 4], [0.265, 5],
        [0.283, -6], [0.312, -4], [0.330, -4],
        [0.348, 0], [0.366, 4], [0.400, 3], [0.440, 2], [0.482, 3],
        [0.520, 4], [0.560, 5], [0.600, 3], [0.660, 2], [0.700, 6],
        [0.735, 12], [0.775, 20], [0.820, 20], [0.848, 12], [0.870, 2],
        [0.893, -5], [0.925, -3], [0.958, -6], [0.985, -2],
    ],
    zones: [
        { t0: 0.000, name: '起点', ground: 0x62a04e },
        { t0: 0.100, name: '海港', ground: 0x62a04e },
        { t0: 0.220, name: '村庄', ground: 0x86a860, kind: 'village' },
        { t0: 0.380, name: '悬崖', ground: 0x9a8a72, kind: 'cliff' },
        { t0: 0.521, name: '隧道', ground: 0x555560, kind: 'tunnel' },
        { t0: 0.600, name: '沙滩', ground: 0xe0c98f },
        { t0: 0.740, name: '弯道', ground: 0x62a04e },
        { t0: 0.860, name: '引桥', ground: 0x62a04e },
        { t0: 0.893, name: '大桥', ground: 0x62a04e, kind: 'bridge' },
        { t0: 0.950, name: '回程', ground: 0x62a04e },
    ],
    boostPads: [
        { t0: 0.5380, t1: 0.5555, lat: -2.9, hw: 1.9 },
        { t0: 0.5380, t1: 0.5555, lat: 2.9, hw: 1.9 },
        { t0: 0.5720, t1: 0.5895, lat: 0.0, hw: 2.6 },
        { t0: 0.9575, t1: 0.9740, lat: -3.1, hw: 2.2 },
        { t0: 0.9575, t1: 0.9740, lat: 3.1, hw: 2.2 },
    ],
    road: 0x585d6c,
    roadAlt: 0x5e636f,
    shoulder: 0x2e3138,
    curbA: 0xe63946,
    curbB: 0xf5f0e6,
    water: 0x2f7fc4,
    waterRough: 0.12,
    treeKind: 'pine',
    treeLeaf: [0x34823e, 0x3f9a4a],
    treeTrunk: 0x6e5234,
    houseWall: 0xe8d6b4,
    houseRoof: 0xac543e,
    houseRoofKind: 'cone',
    door: 0x5a3a28,
    windowLit: 0xffd97a,
    mountain: [0x5a6a7a, 0x4a6a52],
    mountainKind: 'cone',
    rock: 0x807a74,
    tunnelRock: 0x464650,
    cloud: 0xffffff,
    sky: [0xffb347, 0xff9e7d, 0xf78fb8, 0xc9a6e8, 0x7ec8f0],
    sunDisc: 0xfff3b0,
    sunHalo: 0xffc98a,
    sunAzimDeg: -90,
    sunElevDeg: 10,
    strata: 0x8a9aa8,
    tuft: 0x4a7a3a,
    villageT: [0.225, 0.375],
    cliffT: [0.385, 0.515],
    tunnelT: [0.521, 0.599],
    bridgeT: [0.893, 0.950],
    seed: 1907240611,
};

const TRACK_CANYON: TrackDef = {
    id: 'canyon',
    name: '峡谷狂飙',
    desc: '沙漠岩壁 · 岩拱绿洲',
    legs: [
        // NOTE: these turns were fitted numerically (see optimise-legs.js)
        // so the centreline closes naturally (residual 0.05 m, kscale
        // 0.98 — same as the sunset track). Do not "round" them by hand:
        // the closure is sensitive to the exact distribution.
        [200, -5.47],   // start straight — desert highway
        [130, -59.38],  // canyon sweep
        [80, 71.79],    // rock-gate kink (right)
        [70, -35.85],   // left
        [95, -145.47],  // hairpin — canyon bowl
        [200, -3.34],   // dune straight
        [65, 47.50],    // right
        [70, -35.34],   // slalom A (left)
        [65, 37.09],    // slalom B (right)
        [85, -20.24],   // left
        [150, -134.67], // mesa sweep
        [95, 16.40],    // right
        [145, -14.76],  // back straight
        [150, -84.89],  // final turn to the line
    ],
    planLength: 1600,
    startHeadingDeg: 45,
    elevation: [
        [0.000, 4.0], [0.100, 5.0], [0.200, 8.0], [0.300, 18.0],
        [0.380, 32.0], [0.450, 38.0], [0.500, 36.0], [0.580, 30.0],
        [0.660, 22.0], [0.740, 12.0], [0.820, 8.0], [0.900, 6.0],
        [0.950, 5.0], [0.980, 4.5],
    ],
    halfWidth: [
        [0.000, 8.5], [0.100, 8.2], [0.200, 7.2], [0.300, 6.2],
        [0.380, 5.8], [0.450, 5.6], [0.520, 6.0], [0.600, 6.8],
        [0.700, 7.5], [0.800, 8.4], [0.900, 8.2], [0.950, 8.0],
    ],
    bank: [
        [0.000, 0], [0.100, 0], [0.150, 6], [0.200, 8], [0.250, 4],
        [0.300, -4], [0.350, 0], [0.400, 3], [0.500, 4], [0.600, 5],
        [0.700, 10], [0.750, 16], [0.800, 14], [0.850, 6],
        [0.900, -3], [0.950, -2],
    ],
    zones: [
        { t0: 0.000, name: '起点', ground: 0xdfb47e },
        { t0: 0.100, name: '沙漠', ground: 0xdcb47e },
        { t0: 0.250, name: '岩门', ground: 0xc08a5a, kind: 'cliff' },
        { t0: 0.360, name: '岩拱', ground: 0xb0704a, kind: 'tunnel' },
        { t0: 0.430, name: '峡谷', ground: 0xb0704a, kind: 'cliff' },
        { t0: 0.520, name: '沙丘', ground: 0xe6c795 },
        { t0: 0.660, name: '绿洲', ground: 0x7fae62, kind: 'village' },
        { t0: 0.780, name: '台地', ground: 0xc08a5a },
        { t0: 0.900, name: '回程', ground: 0xdfb47e },
    ],
    boostPads: [
        { t0: 0.3350, t1: 0.3520, lat: -2.9, hw: 1.9 },
        { t0: 0.3350, t1: 0.3520, lat: 2.9, hw: 1.9 },
        { t0: 0.4850, t1: 0.5020, lat: 0.0, hw: 2.6 },
        { t0: 0.9050, t1: 0.9220, lat: -3.1, hw: 2.2 },
        { t0: 0.9050, t1: 0.9220, lat: 3.1, hw: 2.2 },
    ],
    road: 0x5f4a3a,
    roadAlt: 0x66503f,
    shoulder: 0x3a2d24,
    curbA: 0xd94f30,
    curbB: 0xf5ead6,
    water: 0xe8d0a0, // dry lake bed (sand), not sea
    waterRough: 1.0,
    treeKind: 'cactus',
    treeLeaf: [0x3d8a4a, 0x4a9a55],
    treeTrunk: 0x3d8a4a,
    houseWall: 0xe0c090, // adobe
    houseRoof: 0xb0703a, // terracotta flat roof
    houseRoofKind: 'flat',
    door: 0x6e4a2a,
    windowLit: 0xffd97a,
    mountain: [0xa85a34, 0x8a4a2c],
    mountainKind: 'mesa',
    rock: 0x9a5f38,
    tunnelRock: 0x9a5f38, // natural rock arch, sandstone
    cloud: 0xffffff,
    sky: [0xffe3a3, 0xffd28a, 0xf7b98a, 0xa8d4ee, 0x6fb7e8],
    sunDisc: 0xfff8d8,
    sunHalo: 0xffe9b0,
    sunAzimDeg: -60,
    sunElevDeg: 26,
    strata: 0xc98a5e,
    tuft: 0xc9a86a,
    pond: 0x3f9ec4,
    villageT: [0.665, 0.775],
    cliffT: [0.250, 0.520],
    rockBothSides: true,
    tunnelT: [0.360, 0.425],
    seed: 20261118,
};

export const TRACK_DEFS: TrackDef[] = [TRACK_SUNSET, TRACK_CANYON];

/** Unknown / legacy ids fall back to the original track. */
export function trackDefById(id: string): TrackDef {
    for (const d of TRACK_DEFS) { if (d.id === id) { return d; } }
    return TRACK_SUNSET;
}

export const CHECKPOINTS = 32;
export const STATION_DS = 0.5;
/** Grid: metres between rows, stagger, pole distance behind the line (spec). */
const GRID_LAT = 3.2;
const GRID_ROW_DS = 8.0;
const GRID_STAGGER = 4.0;
const GRID_BACK0 = 11;

// ---------------------------------------------------------------------------
// Small math helpers (ported from the spec)
// ---------------------------------------------------------------------------

function ss(a: number, b: number, x: number): number {
    if (b === a) { return x < a ? 0 : 1; }
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
}

function cyclic(keys: Keys, t: number): number {
    const n = keys.length;
    t -= Math.floor(t);
    let i = n - 1;
    for (let k = 0; k < n; k++) { if (keys[k][0] <= t) { i = k; } else { break; } }
    const k0 = keys[(i - 1 + n) % n], k1 = keys[i], k2 = keys[(i + 1) % n], k3 = keys[(i + 2) % n];
    let x0 = k0[0], x1 = k1[0], x2 = k2[0], x3 = k3[0];
    if (x1 > t) { x1 -= 1; }
    while (x0 > x1) { x0 -= 1; }
    while (x2 < x1) { x2 += 1; }
    while (x3 < x2) { x3 += 1; }
    const u = (t - x1) / (x2 - x1);
    const m1 = (k2[1] - k0[1]) / (x2 - x0) * (x2 - x1);
    const m2 = (k3[1] - k1[1]) / (x3 - x1) * (x2 - x1);
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * k1[1] + (u3 - 2 * u2 + u) * m1
        + (-2 * u3 + 3 * u2) * k2[1] + (u3 - u2) * m2;
}

function cyclicMonotone(keys: Keys, t: number): number {
    const n = keys.length;
    t -= Math.floor(t);
    let i = n - 1;
    for (let k = 0; k < n; k++) { if (keys[k][0] <= t) { i = k; } else { break; } }
    const k0 = keys[(i - 1 + n) % n], k1 = keys[i], k2 = keys[(i + 1) % n], k3 = keys[(i + 2) % n];
    let x0 = k0[0], x1 = k1[0], x2 = k2[0], x3 = k3[0];
    if (x1 > t) { x1 -= 1; }
    while (x0 > x1) { x0 -= 1; }
    while (x2 < x1) { x2 += 1; }
    while (x3 < x2) { x3 += 1; }
    const h = x2 - x1;
    const d0 = (k1[1] - k0[1]) / (x1 - x0);
    const d1 = (k2[1] - k1[1]) / h;
    const d2 = (k3[1] - k2[1]) / (x3 - x2);
    const hm = (a: number, b: number) => (a * b <= 0 ? 0 : (2 * a * b) / (a + b));
    const m1 = hm(d0, d1), m2 = hm(d1, d2);
    const u = (t - x1) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * k1[1] + (u3 - 2 * u2 + u) * h * m1
        + (-2 * u3 + 3 * u2) * k2[1] + (u3 - u2) * h * m2;
}

function circularBoxBlur(src: Float64Array, n: number, halfCells: number, passes: number): Float64Array {
    let a = src;
    const inv = 1 / (2 * halfCells + 1);
    for (let p = 0; p < passes; p++) {
        const b = new Float64Array(n);
        let acc = 0;
        for (let i = -halfCells; i <= halfCells; i++) { acc += a[((i % n) + n) % n]; }
        for (let i = 0; i < n; i++) {
            b[i] = acc * inv;
            acc -= a[((i - halfCells) % n + n) % n];
            acc += a[((i + halfCells + 1) % n + n) % n];
        }
        a = b;
    }
    return a;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let x = Math.imul(a ^ (a >>> 15), 1 | a);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Centreline
// ---------------------------------------------------------------------------

export interface TrackFrame {
    pos: Vec3;
    tangent: Vec3;
    right: Vec3; // banked right (unit)
    up: Vec3;    // banked up (unit)
    half: number;
    bank: number; // radians
    zone: number;
    raceLat: number; // ideal-line lateral offset
}

interface CenterlineData {
    count: number;
    length: number;
    ds: number;
    px: Float32Array; py: Float32Array; pz: Float32Array;
    tx: Float32Array; ty: Float32Array; tz: Float32Array;
    bx: Float32Array; by: Float32Array; bz: Float32Array; // banked right
    nx: Float32Array; ny: Float32Array; nz: Float32Array; // banked up
    half: Float32Array; bank: Float32Array; curv: Float32Array;
    race: Float32Array; zone: Uint8Array;
}

function buildCenterline(def: TrackDef): CenterlineData {
    // pass 1: integrate a smoothed curvature schedule in the XZ plane
    const DS0 = 0.25;
    const N0 = Math.round(def.planLength / DS0);
    const raw = new Float64Array(N0);
    {
        let s = 0;
        for (const [len, turn] of def.legs) {
            const k = (turn * Math.PI / 180) / len;
            const i0 = Math.round(s / DS0), i1 = Math.round((s + len) / DS0);
            for (let i = i0; i < i1; i++) { raw[i] = k; }
            s += len;
        }
    }
    const kap = circularBoxBlur(raw, N0, Math.round(30 / DS0 / 2), 2);
    let ksum = 0;
    for (let i = 0; i < N0; i++) { ksum += kap[i] * DS0; }
    const kscale = (-2 * Math.PI) / ksum; // exact 360 deg of left turn per lap

    const X = new Float64Array(N0 + 1), Z = new Float64Array(N0 + 1);
    {
        let th = def.startHeadingDeg * Math.PI / 180, x = 0, z = 0;
        for (let i = 0; i < N0; i++) {
            X[i] = x; Z[i] = z;
            x += Math.cos(th) * DS0;
            z += Math.sin(th) * DS0;
            th += kap[i] * kscale * DS0;
        }
        X[N0] = x; Z[N0] = z;
        // Residual closure is a couple of centimetres; shear it away.
        for (let i = 0; i <= N0; i++) {
            const f = i / N0;
            X[i] -= x * f; Z[i] -= z * f;
        }
    }
    const Y = new Float64Array(N0 + 1);
    for (let i = 0; i <= N0; i++) {
        const u = (i / N0) % 1;
        Y[i] = cyclic(def.elevation, u)
            + 0.74 * Math.sin(u * Math.PI * 2 * 7 + 0.9)
            + 0.33 * Math.sin(u * Math.PI * 2 * 13 + 2.4);
    }

    // pass 2: resample uniformly by true 3D arc length
    const cum = new Float64Array(N0 + 1);
    for (let i = 1; i <= N0; i++) {
        const dx = X[i] - X[i - 1], dy = Y[i] - Y[i - 1], dz = Z[i] - Z[i - 1];
        cum[i] = cum[i - 1] + Math.hypot(dx, dy, dz);
    }
    const length = cum[N0];
    const count = Math.round(length / STATION_DS);
    const ds = length / count;

    const cl: CenterlineData = {
        count, length, ds,
        px: new Float32Array(count), py: new Float32Array(count), pz: new Float32Array(count),
        tx: new Float32Array(count), ty: new Float32Array(count), tz: new Float32Array(count),
        bx: new Float32Array(count), by: new Float32Array(count), bz: new Float32Array(count),
        nx: new Float32Array(count), ny: new Float32Array(count), nz: new Float32Array(count),
        half: new Float32Array(count), bank: new Float32Array(count), curv: new Float32Array(count),
        race: new Float32Array(count), zone: new Uint8Array(count),
    };
    let cursor = 0;
    for (let i = 0; i < count; i++) {
        const target = i * ds;
        while (cursor < N0 - 1 && cum[cursor + 1] < target) { cursor++; }
        const seg = cum[cursor + 1] - cum[cursor];
        const f = seg > 1e-9 ? (target - cum[cursor]) / seg : 0;
        cl.px[i] = X[cursor] + (X[cursor + 1] - X[cursor]) * f;
        cl.py[i] = Y[cursor] + (Y[cursor + 1] - Y[cursor]) * f;
        cl.pz[i] = Z[cursor] + (Z[cursor + 1] - Z[cursor]) * f;
    }

    // tangents (central difference on the closed loop)
    for (let i = 0; i < count; i++) {
        const a = (i - 1 + count) % count, b = (i + 1) % count;
        const dx = cl.px[b] - cl.px[a], dy = cl.py[b] - cl.py[a], dz = cl.pz[b] - cl.pz[a];
        const inv = 1 / Math.hypot(dx, dy, dz);
        cl.tx[i] = dx * inv; cl.ty[i] = dy * inv; cl.tz[i] = dz * inv;
    }

    // widths, banking, banked frame, curvature
    for (let i = 0; i < count; i++) {
        const t = i / count;
        cl.half[i] = cyclicMonotone(def.halfWidth, t);
        const b = cyclic(def.bank, t) * Math.PI / 180;
        cl.bank[i] = b;
        // horizontal-reference right (rotation-minimising for a road)
        let hx = -cl.tz[i], hy = 0, hz = cl.tx[i];
        const inv = 1 / Math.hypot(hx, hz);
        hx *= inv; hz *= inv;
        const n0x = hy * cl.tz[i] - hz * cl.ty[i];
        const n0y = hz * cl.tx[i] - hx * cl.tz[i];
        const n0z = hx * cl.ty[i] - hy * cl.tx[i];
        const cb = Math.cos(b), sb = Math.sin(b);
        cl.bx[i] = hx * cb + n0x * sb;
        cl.by[i] = hy * cb + n0y * sb;
        cl.bz[i] = hz * cb + n0z * sb;
        cl.nx[i] = n0x * cb - hx * sb;
        cl.ny[i] = n0y * cb - hy * sb;
        cl.nz[i] = n0z * cb - hz * sb;
        // zone
        let zi = def.zones.length - 1;
        for (let k = 0; k < def.zones.length; k++) { if (def.zones[k].t0 <= t) { zi = k; } else { break; } }
        cl.zone[i] = zi;
    }
    for (let i = 0; i < count; i++) {
        const a = (i - 1 + count) % count, b = (i + 1) % count;
        const t1x = cl.tx[a], t1z = cl.tz[a], t2x = cl.tx[b], t2z = cl.tz[b];
        const cross = t1x * t2z - t1z * t2x;
        const dot = t1x * t2x + t1z * t2z;
        cl.curv[i] = Math.atan2(cross, dot) / (2 * ds);
    }

    // idealised racing line: outside-in-outside falls out of smoothing
    {
        const rawLat = new Float64Array(count);
        for (let i = 0; i < count; i++) {
            const k = cl.curv[i];
            const strength = Math.min(1, Math.abs(k) * 140);
            rawLat[i] = Math.sign(k) * strength * cl.half[i] * 0.52;
        }
        const sm = circularBoxBlur(rawLat, count, Math.round(46 / ds), 2);
        for (let i = 0; i < count; i++) { cl.race[i] = sm[i]; }
    }
    return cl;
}

// ---------------------------------------------------------------------------
// Track API
// ---------------------------------------------------------------------------

const _v1 = new Vec3();
const _v2 = new Vec3();

export class KartTrack {
    public readonly def: TrackDef;
    public readonly length: number;
    public readonly count: number;
    public readonly ds: number;
    private _cl: CenterlineData;

    /**
     * Race direction: false = 正赛 (drive +s), true = 逆向 (the same
     * 1606 m centreline driven the other way). All public queries take
     * RACE coordinates (s increases in the race direction) and map them
     * to physical centreline stations internally, so KartGame / KartItems
     * need no direction branches: the frame's tangent / right / raceLat /
     * bank are all flipped together (a proper rotation, not a mirror),
     * so yaw, camera, AI line, drift direction and grid placement all
     * follow the race direction automatically.
     */
    public reversed = false;

    constructor(def: TrackDef = TRACK_SUNSET) {
        this.def = def;
        this._cl = buildCenterline(def);
        this.length = this._cl.length;
        this.count = this._cl.count;
        this.ds = this._cl.ds;
    }

    public wrapS(s: number): number {
        const l = this.length;
        s %= l;
        return s < 0 ? s + l : s;
    }

    /** Race s -> physical station on the centreline (reversed: mirrored). */
    private _mapS(s: number): number {
        return this.reversed ? this.wrapS(-s) : this.wrapS(s);
    }

    /** Interpolated frame at arc length s (wraps). Writes into `out`. */
    public sampleAt(s: number, out: TrackFrame): TrackFrame {
        const cl = this._cl;
        s = this._mapS(s);
        const fi = s / cl.ds;
        const i0 = Math.floor(fi) % cl.count;
        const i1 = (i0 + 1) % cl.count;
        const f = fi - Math.floor(fi);
        const g = 1 - f;
        out.pos.set(
            cl.px[i0] * g + cl.px[i1] * f,
            cl.py[i0] * g + cl.py[i1] * f,
            cl.pz[i0] * g + cl.pz[i1] * f);
        out.tangent.set(
            cl.tx[i0] * g + cl.tx[i1] * f,
            cl.ty[i0] * g + cl.ty[i1] * f,
            cl.tz[i0] * g + cl.tz[i1] * f);
        out.right.set(
            cl.bx[i0] * g + cl.bx[i1] * f,
            cl.by[i0] * g + cl.by[i1] * f,
            cl.bz[i0] * g + cl.bz[i1] * f);
        out.up.set(
            cl.nx[i0] * g + cl.nx[i1] * f,
            cl.ny[i0] * g + cl.ny[i1] * f,
            cl.nz[i0] * g + cl.nz[i1] * f);
        out.half = cl.half[i0] * g + cl.half[i1] * f;
        out.bank = cl.bank[i0] * g + cl.bank[i1] * f;
        out.zone = f < 0.5 ? cl.zone[i0] : cl.zone[i1];
        out.raceLat = cl.race[i0] * g + cl.race[i1] * f;
        if (this.reversed) {
            // race frame = physical frame rotated half a turn about up:
            // tangent and right both flip, so the ideal line and the bank
            // sense flip with them; up, half and zone stay put.
            out.tangent.set(-out.tangent.x, -out.tangent.y, -out.tangent.z);
            out.right.set(-out.right.x, -out.right.y, -out.right.z);
            out.raceLat = -out.raceLat;
            out.bank = -out.bank;
        }
        return out;
    }

    /** World position at (s, lateral offset). Writes into `out`. */
    public posAt(s: number, lat: number, out: Vec3): Vec3 {
        const f = this._frame;
        this.sampleAt(s, f);
        out.set(
            f.pos.x + f.right.x * lat,
            f.pos.y + f.right.y * lat,
            f.pos.z + f.right.z * lat);
        return out;
    }

    private _frame: TrackFrame = {
        pos: new Vec3(), tangent: new Vec3(), right: new Vec3(), up: new Vec3(),
        half: 0, bank: 0, zone: 0, raceLat: 0,
    };

    /** Curvature at arc length s (for AI braking / drift decisions). */
    public curvatureAt(s: number): number {
        const cl = this._cl;
        const i = Math.floor(this._mapS(s) / cl.ds) % cl.count;
        const k = cl.curv[i];
        return this.reversed ? -k : k;
    }

    public halfAt(s: number): number {
        const cl = this._cl;
        const i = Math.floor(this._mapS(s) / cl.ds) % cl.count;
        return cl.half[i];
    }

    public zoneNameAt(s: number): string {
        const t = this._mapS(s) / this.length;
        let zi = this.def.zones.length - 1;
        for (let k = 0; k < this.def.zones.length; k++) { if (this.def.zones[k].t0 <= t) { zi = k; } else { break; } }
        return this.def.zones[zi].name;
    }

    /**
     * True if (race s, lateral d) is on a boost pad. The t-range is
     * looked up on the PHYSICAL station (mirrored in reverse); the
     * lateral check needs no flip because the pads are lat-symmetric
     * (pairs at ±lat, plus one centred at 0).
     */
    public padBoostAt(s: number, d: number): boolean {
        const t = this._mapS(s) / this.length;
        for (const pad of this.def.boostPads) {
            if (t >= pad.t0 && t <= pad.t1 && Math.abs(d - pad.lat) < pad.hw) { return true; }
        }
        return false;
    }

    /** Grid slot k (0 = pole): world pos + yaw, behind the start line. */
    public gridSlot(k: number, outPos: Vec3): number {
        const row = k >> 1, col = k & 1;
        const back = GRID_BACK0 + row * GRID_ROW_DS + col * GRID_STAGGER;
        const lat = (col === 0 ? -1 : 1) * GRID_LAT;
        const s = this.wrapS(-back);
        this.posAt(s, lat, outPos);
        const f = this._frame;
        this.sampleAt(s, f);
        return Math.atan2(f.tangent.x, f.tangent.z);
    }

    /** Item-box rows: every ~130 m, 3 across (milestone 2 placement). */
    public itemAnchors(): Array<{ s: number; lat: number }> {
        const out: Array<{ s: number; lat: number }> = [];
        for (let s = 100; s < this.length - 50; s += 130) {
            const half = this.halfAt(s);
            const lats = [-3.5, 0, 3.5];
            for (const lat of lats) {
                out.push({ s, lat: Math.max(-half + 2.5, Math.min(half - 2.5, lat)) });
            }
        }
        return out;
    }

    /** Centreline polyline for the minimap, in XZ, plus bounds. */
    public minimapPath(samples: number): { pts: Array<{ x: number; z: number }>; minX: number; maxX: number; minZ: number; maxZ: number } {
        const pts: Array<{ x: number; z: number }> = [];
        let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
        for (let i = 0; i < samples; i++) {
            const s = (i / samples) * this.length;
            const f = this._frame;
            this.sampleAt(s, f);
            pts.push({ x: f.pos.x, z: f.pos.z });
            if (f.pos.x < minX) { minX = f.pos.x; }
            if (f.pos.x > maxX) { maxX = f.pos.x; }
            if (f.pos.z < minZ) { minZ = f.pos.z; }
            if (f.pos.z > maxZ) { maxZ = f.pos.z; }
        }
        return { pts, minX, maxX, minZ, maxZ };
    }

    /** Track centroid (for the water plane). */
    public centroid(out: Vec3): Vec3 {
        const cl = this._cl;
        let x = 0, z = 0;
        for (let i = 0; i < cl.count; i += 16) { x += cl.px[i]; z += cl.pz[i]; }
        const n = Math.ceil(cl.count / 16);
        out.set(x / n, 0, z / n);
        return out;
    }

    /** How far the road reaches from `cc` in direction `ang` (radians).
     *  Max radius over centreline stations whose direction is within
     *  `halfWin` of `ang`. The loop is not circular, so a fixed-radius
     *  scenery ring can land ON the road — mesas are seated from this
     *  instead (see the mesa ring in _buildScenery). */
    private _roadExtentAt(cc: Vec3, ang: number, halfWin: number): number {
        const cl = this._cl;
        let ext = 0;
        for (let i = 0; i < cl.count; i += 4) {
            const dx = cl.px[i] - cc.x, dz = cl.pz[i] - cc.z;
            const a = Math.atan2(dz, dx);
            let d = a - ang;
            while (d > Math.PI) { d -= Math.PI * 2; }
            while (d < -Math.PI) { d += Math.PI * 2; }
            if (Math.abs(d) <= halfWin) {
                const r = Math.hypot(dx, dz);
                if (r > ext) { ext = r; }
            }
        }
        return ext;
    }

    // -----------------------------------------------------------------------
    // World meshes (all procedural, all unlit flat colours)
    // -----------------------------------------------------------------------

    public buildWorld(parent: Node): void {
        const cl = this._cl;
        const builder = new MeshBuilder();
        const std = new StdBuilder();
        const f = this._frame;

        // --- road ribbon (PBR asphalt): 3 verts per ring (left, crown,
        // right), every 2 m. Two subtly alternating 8 m tones so the
        // tarmac reads as laid strips, not one flat slab. Per-quad verts
        // (rings duplicated at tone boundaries) keep the two tones in
        // separate PBR buckets.
        // NOTE: frame.right = tangent x up points to the kart's LEFT in
        // this right-handed layout, so the ring order runs right-to-left
        // as seen from above — the winding below is the one whose
        // geometric normal points UP (+Y); the opposite order is
        // backface-culled and the road is invisible (found 2026-11-17).
        const ringStep = 4; // stations
        const rings = Math.floor(cl.count / ringStep);
        const roadPos: number[][] = [[], []];
        const roadNor: number[][] = [[], []];
        const roadUv: number[][] = [[], []];
        const roadIdx: number[][] = [[], []];
        const pushRing = (i: number, P: number[], N: number[], U: number[]): void => {
            this.sampleAt(i * cl.ds, f);
            const hw = f.half;
            const lats = [-hw, 0, hw];
            const lifts = [0, 0.09, 0];
            for (let k = 0; k < 3; k++) {
                P.push(
                    f.pos.x + f.right.x * lats[k] + f.up.x * lifts[k],
                    f.pos.y + f.right.y * lats[k] + f.up.y * lifts[k],
                    f.pos.z + f.right.z * lats[k] + f.up.z * lifts[k]);
                N.push(f.up.x, f.up.y, f.up.z);
                U.push(k * 0.5, i * cl.ds * 0.1);
            }
        };
        for (let r = 0; r < rings; r++) {
            const tone = Math.floor(r / 4) % 2;
            const P = roadPos[tone], N = roadNor[tone], U = roadUv[tone], I = roadIdx[tone];
            const base = P.length / 3;
            const i0 = (r * ringStep) % cl.count;
            const i1 = r === rings - 1 ? 0 : ((r + 1) * ringStep) % cl.count;
            pushRing(i0, P, N, U);
            pushRing(i1, P, N, U);
            I.push(base, base + 1, base + 3, base + 1, base + 4, base + 3);
            I.push(base + 1, base + 2, base + 4, base + 2, base + 5, base + 4);
        }
        std.addGeometry(this.def.road, roadPos[0], roadNor[0], roadUv[0], roadIdx[0], 0, 0.9);
        std.addGeometry(this.def.roadAlt, roadPos[1], roadNor[1], roadUv[1], roadIdx[1], 0, 0.9);

        // --- white edge lines: thin ribbons just inside each road edge ---
        const EDGE = 0xffffff; // shares the white bucket (clouds / snow / boards)
        const edgePos: number[] = [];
        const edgeNor: number[] = [];
        const edgeUv: number[] = [];
        const edgeIdx: number[] = [];
        for (let r = 0; r <= rings; r++) {
            const i = r === rings ? 0 : (r * ringStep) % cl.count;
            this.sampleAt(i * cl.ds, f);
            const hw = f.half;
            const lats = [-(hw - 0.15), -(hw - 0.5), hw - 0.5, hw - 0.15];
            for (let k = 0; k < 4; k++) {
                edgePos.push(
                    f.pos.x + f.right.x * lats[k] + f.up.x * 0.02,
                    f.pos.y + f.right.y * lats[k] + f.up.y * 0.02,
                    f.pos.z + f.right.z * lats[k] + f.up.z * 0.02);
                edgeNor.push(f.up.x, f.up.y, f.up.z);
                edgeUv.push(0, 0);
            }
        }
        for (let r = 0; r < rings; r++) {
            const a = r * 4, b = (r + 1) * 4;
            edgeIdx.push(a, a + 1, b, a + 1, b + 1, b);
            edgeIdx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
        }
        builder.addGeometry(EDGE, edgePos, edgeNor, edgeUv, edgeIdx);

        // --- asphalt shoulder: dark strip outside the edge lines, just
        // below the curb, so the road has a paved margin before the grass.
        const shPos: number[] = [];
        const shNor: number[] = [];
        const shUv: number[] = [];
        const shIdx: number[] = [];
        for (let r = 0; r <= rings; r++) {
            const i = r === rings ? 0 : (r * ringStep) % cl.count;
            this.sampleAt(i * cl.ds, f);
            const hw = f.half;
            const lats = [-(hw + 2.2), -(hw + 0.9), hw + 0.9, hw + 2.2];
            for (let k = 0; k < 4; k++) {
                shPos.push(
                    f.pos.x + f.right.x * lats[k] + f.up.x * -0.02,
                    f.pos.y + f.right.y * lats[k] + f.up.y * -0.02,
                    f.pos.z + f.right.z * lats[k] + f.up.z * -0.02);
                shNor.push(f.up.x, f.up.y, f.up.z);
                shUv.push(0, 0);
            }
        }
        for (let r = 0; r < rings; r++) {
            const a = r * 4, b = (r + 1) * 4;
            shIdx.push(a, a + 1, b, a + 1, b + 1, b);
            shIdx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
        }
        std.addGeometry(this.def.shoulder, shPos, shNor, shUv, shIdx, 0, 0.95);

        // --- red/white curbs: raised 0.8 m strips just outside the edge
        // lines, alternating 8 m blocks (glossy painted concrete). Top
        // face only — the step down to the shoulder reads as the curb
        // edge from the chase cam. Verts are ordered by increasing lat
        // per side so the winding matches the road's.
        const curbPos: number[][] = [[], []];
        const curbNor: number[][] = [[], []];
        const curbUv: number[][] = [[], []];
        const curbIdx: number[][] = [[], []];
        const curbQuads = Math.floor(rings / 2) + 1;
        for (let k = 0; k < curbQuads - 1; k++) {
            const tone = Math.floor(k / 2) % 2;
            const P = curbPos[tone], N = curbNor[tone], U = curbUv[tone], I = curbIdx[tone];
            const base = P.length / 3;
            for (const rr of [2 * k, 2 * k + 2]) {
                const i = ((rr % rings) * ringStep) % cl.count;
                this.sampleAt(i * cl.ds, f);
                const hw = f.half;
                // left outer, left inner, right inner, right outer
                const lats = [-(hw + 0.9), -(hw + 0.1), hw + 0.1, hw + 0.9];
                for (let m = 0; m < 4; m++) {
                    P.push(
                        f.pos.x + f.right.x * lats[m] + f.up.x * 0.14,
                        f.pos.y + f.right.y * lats[m] + f.up.y * 0.14,
                        f.pos.z + f.right.z * lats[m] + f.up.z * 0.14);
                    N.push(f.up.x, f.up.y, f.up.z);
                    U.push(0, 0);
                }
            }
            I.push(base, base + 1, base + 4, base + 1, base + 5, base + 4);
            I.push(base + 2, base + 3, base + 6, base + 3, base + 7, base + 6);
        }
        std.addGeometry(this.def.curbA, curbPos[0], curbNor[0], curbUv[0], curbIdx[0], 0.1, 0.35);
        std.addGeometry(this.def.curbB, curbPos[1], curbNor[1], curbUv[1], curbIdx[1], 0.1, 0.35);

        // --- ground skirt: per-zone ribbons beside the road (closed loop) ---
        const skirtStep = 8;
        const skirtRings = Math.floor(cl.count / skirtStep);
        const skirtStation = (r: number): number => (r === skirtRings ? 0 : (r * skirtStep) % cl.count);
        const ringZone: number[] = [];
        for (let r = 0; r <= skirtRings; r++) { ringZone.push(cl.zone[skirtStation(r)]); }
        let runStart = 0;
        let runZone = ringZone[0];
        const flushSkirt = (r0: number, r1: number, zone: number) => {
            // bridge span has no skirt (water below)
            if (this.def.zones[zone].kind === 'bridge') { return; }
            const ground = this.def.zones[zone].ground;
            const pos: number[] = [];
            const nor: number[] = [];
            const uv: number[] = [];
            const idx: number[] = [];
            // outer tier: a second, darker ribbon out to 70 m whose far
            // edge rolls gently (integer-frequency sines of lap fraction,
            // so the loop closes) — the world no longer ends in a hard
            // colour seam 26 m from the road. Its inner edge sits exactly
            // on the inner tier (-0.25) so no step opens at the join.
            const oPos: number[] = [];
            const oNor: number[] = [];
            const oUv: number[] = [];
            const oIdx: number[] = [];
            for (let r = r0; r <= r1; r++) {
                const i = skirtStation(r);
                this.sampleAt(i * cl.ds, f);
                const hw = f.half;
                const t = i / cl.count;
                const und = 0.9 + 0.7 * Math.sin(t * Math.PI * 2 * 3 + 1.3)
                    + 0.5 * Math.sin(t * Math.PI * 2 * 7 + 0.5);
                const lats = [-(hw + 26), -(hw + 0.4), hw + 0.4, hw + 26];
                for (let k = 0; k < 4; k++) {
                    pos.push(
                        f.pos.x + f.right.x * lats[k] + f.up.x * -0.25,
                        f.pos.y + f.right.y * lats[k] + f.up.y * -0.25,
                        f.pos.z + f.right.z * lats[k] + f.up.z * -0.25);
                    nor.push(f.up.x, f.up.y, f.up.z);
                    uv.push(0, 0);
                }
                const oLats = [-(hw + 70), -(hw + 26), hw + 26, hw + 70];
                const oLifts = [-0.25 - und, -0.25, -0.25, -0.25 - und];
                for (let k = 0; k < 4; k++) {
                    oPos.push(
                        f.pos.x + f.right.x * oLats[k] + f.up.x * oLifts[k],
                        f.pos.y + f.right.y * oLats[k] + f.up.y * oLifts[k],
                        f.pos.z + f.right.z * oLats[k] + f.up.z * oLifts[k]);
                    oNor.push(f.up.x, f.up.y, f.up.z);
                    oUv.push(0, 0);
                }
            }
            const n = r1 - r0;
            for (let r = 0; r < n; r++) {
                const a = r * 4, b = (r + 1) * 4;
                idx.push(a, a + 1, b, a + 1, b + 1, b);
                idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
                oIdx.push(a, a + 1, b, a + 1, b + 1, b);
                oIdx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
            }
            builder.addGeometry(ground, pos, nor, uv, idx);
            builder.addGeometry(shade(ground, 0.78), oPos, oNor, oUv, oIdx);
        };
        for (let r = 1; r <= skirtRings; r++) {
            // runs overlap by one ring so no slit opens at a zone boundary
            if (ringZone[r] !== runZone) {
                flushSkirt(runStart, r, runZone);
                runStart = r;
                runZone = ringZone[r];
            }
        }
        flushSkirt(runStart, skirtRings, runZone);

        // --- water: one big flat box under everything. PBR: glossy on
        // the coast (sun glint on the sea), matte sand on the dry lake.
        const c = this.centroid(_v1);
        std.addBox(this.def.water, _v2.set(c.x, 0.3, c.z), 0, 1400, 0.4, 1400, 0.05, this.def.waterRough);

        // --- scenery: trees, houses, rocks, tunnel, bridge, gantry, pads ---
        this._buildScenery(builder, std);

        // --- sky dome + sun ball (the scene has no skybox; see _buildSky) ---
        this._buildSky(builder);

        builder.build(parent);
        std.build(parent);
    }

    /** Zone kind at lap fraction t (for scenery skips). */
    private _zoneKindAt(t: number): TrackZoneKind {
        const zones = this.def.zones;
        let zi = zones.length - 1;
        for (let k = 0; k < zones.length; k++) { if (zones[k].t0 <= t) { zi = k; } else { break; } }
        return zones[zi].kind || 'normal';
    }

    private _buildScenery(b: MeshBuilder, sb: StdBuilder): void {
        const cl = this._cl;
        const rnd = mulberry32(this.def.seed);
        const f = this._frame;
        const pos = new Vec3();
        const ctr = this.centroid(new Vec3());
        const isCanyon = this.def.id === 'canyon';

        // trees: every ~10 m, one side, skipping tunnel + bridge.
        // Chunky two-tier pines (or round broadleafs near the village)
        // and saguaros + barrel cacti in the canyon — the old single
        // cone never read at speed.
        for (let s = 8; s < this.length; s += 10) {
            const t = s / this.length;
            const zk = this._zoneKindAt(t);
            if (zk === 'tunnel' || zk === 'bridge') { continue; }
            this.sampleAt(s, f);
            const side = rnd() < 0.5 ? -1 : 1;
            const lat = side * (f.half + 4 + rnd() * 10);
            this.posAt(s, lat, pos);
            const y = pos.y - 0.25;
            const sc = 1.3 + rnd() * 0.9;
            if (this.def.treeKind === 'cactus') {
                if (rnd() < 0.3) {
                    // barrel cactus: squat drum + domed top
                    b.addCylinder(this.def.treeLeaf[1], new Vec3(pos.x, y + 0.7 * sc, pos.z), 0, 0.95 * sc, 1.05 * sc, 1.4 * sc);
                    b.addSphere(this.def.treeLeaf[0], new Vec3(pos.x, y + 1.45 * sc, pos.z), 0, 0.9 * sc, 0.45 * sc, 0.9 * sc);
                } else {
                    // saguaro: main column + two arms (box arm + upright tip)
                    const colH = 4.6 * sc;
                    b.addCylinder(this.def.treeLeaf[0], new Vec3(pos.x, y + colH / 2, pos.z), 0, 0.5 * sc, 0.55 * sc, colH);
                    for (const armSide of [-1, 1]) {
                        if (rnd() < 0.3) { continue; }
                        const armY = y + colH * (0.45 + rnd() * 0.2);
                        b.addBox(this.def.treeLeaf[1],
                            new Vec3(pos.x + armSide * 1.0 * sc, armY, pos.z), 0, 1.6 * sc, 0.55 * sc, 0.55 * sc);
                        b.addCylinder(this.def.treeLeaf[1],
                            new Vec3(pos.x + armSide * 1.7 * sc, armY + 0.75 * sc, pos.z), 0, 0.27 * sc, 0.27 * sc, 1.5 * sc);
                    }
                }
            } else {
                const trunkH = 2.4 * sc;
                b.addCylinder(this.def.treeTrunk, new Vec3(pos.x, y + trunkH / 2, pos.z), 0, 0.3 * sc, 0.42 * sc, trunkH);
                const fol = rnd() < 0.5 ? this.def.treeLeaf[0] : this.def.treeLeaf[1];
                if (rnd() < 0.25) {
                    // round broadleaf: lollipop canopy
                    b.addSphere(fol, new Vec3(pos.x, y + trunkH + 1.6 * sc, pos.z), 0, 2.2 * sc, 1.8 * sc, 2.2 * sc);
                } else {
                    // chunky two-tier pine
                    b.addCone(fol, new Vec3(pos.x, y + trunkH + 1.7 * sc, pos.z), 0, 2.4 * sc, 3.6 * sc, 8);
                    b.addCone(fol, new Vec3(pos.x, y + trunkH + 3.9 * sc, pos.z), 0, 1.6 * sc, 3.0 * sc, 8);
                }
            }
        }

        // grass / sand tufts scattered on the skirt so the ground is not
        // one flat colour field. Skipping tunnel + bridge.
        for (let s = 5; s < this.length; s += 15) {
            const t = s / this.length;
            const zk = this._zoneKindAt(t);
            if (zk === 'tunnel' || zk === 'bridge') { continue; }
            this.sampleAt(s, f);
            const side = rnd() < 0.5 ? -1 : 1;
            const lat = side * (f.half + 3 + rnd() * 18);
            this.posAt(s, lat, pos);
            const sc = 0.7 + rnd() * 0.7;
            b.addCone(this.def.tuft, new Vec3(pos.x, pos.y - 0.25 + 0.45 * sc, pos.z), 0, 0.55 * sc, 0.9 * sc, 5);
        }

        // houses / huts in the village zone, both sides every ~22 m.
        // Now with a door + lit windows on the road-facing wall, a
        // chimney through the cone roof (coast) or a roof water tank
        // (adobe huts) — the old bare boxes read as placeholders.
        if (this.def.villageT) {
            const [v0, v1] = this.def.villageT;
            for (let s = v0 * this.length; s < v1 * this.length; s += 22) {
                this.sampleAt(s, f);
                for (const side of [-1, 1]) {
                    if (rnd() < 0.25) { continue; }
                    const lat = side * (f.half + 7 + rnd() * 4);
                    this.posAt(s, lat, pos);
                    const y = pos.y - 0.25;
                    const yaw = Math.atan2(f.tangent.x, f.tangent.z) + (rnd() - 0.5) * 0.3;
                    b.addBox(this.def.houseWall, new Vec3(pos.x, y + 2.2, pos.z), yaw, 7.5, 4.4, 6.5);
                    if (this.def.houseRoofKind === 'flat') {
                        // adobe hut: flat terracotta roof slab + water tank
                        b.addBox(this.def.houseRoof, new Vec3(pos.x, y + 4.55, pos.z), yaw, 8.1, 0.5, 7.1);
                        b.addCylinder(this.def.houseRoof,
                            new Vec3(pos.x + f.right.x * 2.0, y + 5.3, pos.z + f.right.z * 2.0), 0, 0.7, 0.7, 1.1);
                    } else {
                        b.addCone(this.def.houseRoof, new Vec3(pos.x, y + 4.4 + 1.4, pos.z), yaw + Math.PI / 4, 5.2, 2.8, 4);
                        // chimney poking through the roof slope
                        b.addBox(this.def.houseWall,
                            new Vec3(pos.x + f.tangent.x * 1.8 + f.right.x * 1.5, y + 6.0, pos.z + f.tangent.z * 1.8 + f.right.z * 1.5),
                            yaw, 0.9, 2.4, 0.9);
                    }
                    // door + lit windows on the road-facing wall (the
                    // local +/-X face: the house's width runs along its
                    // right, and the road sits at -side * right).
                    const wx = -side * f.right.x * 3.78, wz = -side * f.right.z * 3.78;
                    b.addBox(this.def.door, new Vec3(pos.x + wx, y + 1.1, pos.z + wz), yaw, 0.2, 2.2, 1.4);
                    for (const wside of [-1, 1]) {
                        b.addBox(this.def.windowLit,
                            new Vec3(pos.x + wx + f.tangent.x * wside * 2.0, y + 2.6, pos.z + wz + f.tangent.z * wside * 2.0),
                            yaw, 0.2, 1.0, 1.1);
                    }
                }
            }
        }

        // trackside boards: every ~60 m, alternating sides, face the road.
        // Skipping tunnel + bridge (no room there). Now framed: a white
        // backing board + the coloured face + a white top stripe — the
        // cheapest "big race" signal, and it finally looks printed.
        const BOARD_COLS = [0xe63946, 0x2a9d8f, 0xf4a261, 0x4361ee, 0x9b5de5, 0xf15bb5];
        let bi = 0;
        for (let s = 30; s < this.length; s += 60) {
            const t = s / this.length;
            const zk = this._zoneKindAt(t);
            if (zk === 'tunnel' || zk === 'bridge') { continue; }
            this.sampleAt(s, f);
            const side = (bi % 2 === 0) ? -1 : 1;
            const lat = side * (f.half + 4.5);
            this.posAt(s, lat, pos);
            const y = pos.y - 0.25;
            const yaw = Math.atan2(f.tangent.x, f.tangent.z) + Math.PI / 2;
            const nx = -side * f.right.x, nz = -side * f.right.z; // toward the road
            b.addBox(0x2b2b30, new Vec3(pos.x, y + 1.2, pos.z), yaw, 0.35, 2.4, 0.35);
            b.addBox(0xffffff, new Vec3(pos.x, y + 3.4, pos.z), yaw, 5.2, 2.5, 0.18);
            b.addBox(BOARD_COLS[bi % BOARD_COLS.length],
                new Vec3(pos.x + nx * 0.12, y + 3.4, pos.z + nz * 0.12), yaw, 4.6, 1.9, 0.25);
            b.addBox(0xffffff,
                new Vec3(pos.x + nx * 0.14, y + 4.15, pos.z + nz * 0.14), yaw, 4.6, 0.28, 0.28);
            // billboard content (fix131): the coloured face was blank — a
            // gold 5-point star + a white bar, proud of the face so they
            // never z-fight. Both windings are emitted so the star reads
            // from the road whichever way the unlit material culls.
            const starC = new Vec3(pos.x + nx * 0.26, y + 3.45, pos.z + nz * 0.26);
            const starPos: number[] = [starC.x, starC.y, starC.z];
            const starNor: number[] = [nx, 0, nz];
            const starUv: number[] = [0, 0];
            for (let vi = 0; vi < 10; vi++) {
                const a = Math.PI / 2 + vi * Math.PI / 5;
                const r = (vi % 2 === 0) ? 0.55 : 0.22;
                starPos.push(starC.x + (-nz) * Math.cos(a) * r, starC.y + Math.sin(a) * r, starC.z + nx * Math.cos(a) * r);
                starNor.push(nx, 0, nz);
                starUv.push(0, 0);
            }
            const starIdx: number[] = [];
            for (let vi = 1; vi <= 10; vi++) {
                const nxt = vi === 10 ? 1 : vi + 1;
                starIdx.push(0, nxt, vi, 0, vi, nxt);
            }
            b.addGeometry(0xf5d020, starPos, starNor, starUv, starIdx);
            b.addBox(0xffffff, new Vec3(pos.x + nx * 0.26, y + 2.65, pos.z + nz * 0.26), yaw, 2.4, 0.16, 0.05);
            bi++;
        }

        // distant mountains / mesas: a ring of big low-poly shapes around
        // the circuit so the horizon is never flat blue.
        // Both rings hug the track: the loop is not circular, so a
        // fixed-radius ring can land ON the road — the canyon's 10-mesa
        // ring did that (mesas sat on the road, worst −54 m) AND left sky
        // gaps between neighbours, a cloud + blue sky showing through as
        // a "waterfall" column (drive119 shots 225/227); the sunset ring
        // had the same flaw, one cone overlapping the road by ~35 m at
        // road height (found by the node clearance check, fix3). Each
        // shape is seated just outside the road in its own direction and
        // wide enough to overlap its neighbours (mesas), so the horizon
        // reads as continuous rock/forest and no shape ever touches the
        // road. Layout, checkpoints, pads and zones are untouched.
        // New: snow caps on the tall coastal cones, a lighter strata band
        // around each mesa.
        const isMesa = this.def.mountainKind === 'mesa';
        const ringN = isMesa ? 14 : 10;
        for (let i = 0; i < ringN; i++) {
            const ang = (i / ringN) * Math.PI * 2 + rnd() * 0.3;
            const h = 70 + rnd() * 80;
            const base = (90 + rnd() * 70) * (isMesa ? 1.35 : 1);
            const col = i % 2 === 0 ? this.def.mountain[0] : this.def.mountain[1];
            // seat just outside the road in this direction: road extent
            // over a ±0.7 rad window + shape radius + 40 m margin (a mesa
            // disc spans ~±0.5 rad as seen from the centroid, so the
            // window covers it; cones are seated the same way, which also
            // clears them at ground level where they are widest).
            const r = this._roadExtentAt(ctr, ang, 0.7) + base + 40;
            const mx = ctr.x + Math.cos(ang) * r, mz = ctr.z + Math.sin(ang) * r;
            if (isMesa) {
                // flat-topped mesa: wide cylinder + lighter strata band + cap rock
                b.addCylinder(col, new Vec3(mx, h / 2 - 0.5, mz), 0, base * 0.95, base, h);
                b.addCylinder(this.def.strata, new Vec3(mx, h * 0.45, mz), 0, base * 0.99, base * 0.99, 9);
                b.addCylinder(col, new Vec3(mx, h - 0.5 + 8, mz), 0, base * 0.55, base * 0.6, 16);
            } else {
                b.addCone(col, new Vec3(mx, h / 2 - 0.5, mz), 0, base, h, 6);
                if (h > 95) {
                    // fix131: the old cap shared the mountain's apex and
                    // its base ring was coplanar with the flank, which
                    // z-fought into a moire/dither band — the new cap is
                    // wider, slightly shorter and sits ~1 m proud.
                    const capH = h * 0.36 * 0.92;
                    b.addCone(0xf2f7ff, new Vec3(mx, h - 0.5 - capH / 2 + 1.5, mz), 0, base * 0.40, capH, 6);
                }
            }
        }

        // clouds: clusters of three flattened spheres (a big puff + two
        // small ones) high up, scattered over the map. On the coast every
        // third cloud is sunset-tinted peach.
        for (let i = 0; i < 12; i++) {
            const ang = rnd() * Math.PI * 2;
            const r = 120 + rnd() * 260;
            const cy = 65 + rnd() * 30;
            const cx = ctr.x + Math.cos(ang) * r, cz = ctr.z + Math.sin(ang) * r;
            const col = (!isCanyon && i % 3 === 0) ? 0xffd9c0 : this.def.cloud;
            const s0 = 18 + rnd() * 14;
            b.addSphere(col, new Vec3(cx, cy, cz), 0, s0, 4 + rnd() * 3, 12 + rnd() * 8);
            b.addSphere(col, new Vec3(cx - s0 * 0.9, cy - 1, cz + 2), 0, s0 * 0.6, 3 + rnd() * 2, 8 + rnd() * 4);
            b.addSphere(col, new Vec3(cx + s0 * 0.9, cy - 1, cz - 2), 0, s0 * 0.55, 3 + rnd() * 2, 7 + rnd() * 4);
        }

        // dashed centre line: yellow dashes every 6 m so speed reads on
        // the road itself (the old road was bare asphalt + edge lines).
        for (let s = 0; s < this.length; s += 6) {
            this.sampleAt(s, f);
            const yaw = Math.atan2(f.tangent.x, f.tangent.z);
            const px = f.pos.x + f.up.x * 0.12;
            const py = f.pos.y + f.up.y * 0.12;
            const pz = f.pos.z + f.up.z * 0.12;
            b.addBox(0xf5d020, new Vec3(px, py, pz), yaw, 0.3, 0.06, 2.5);
        }

        // rocks on the cliff side(s): chunky boulders in two tones, some
        // with a smaller cap stone.
        if (this.def.cliffT) {
            const [c0, c1] = this.def.cliffT;
            const sides = this.def.rockBothSides ? [-1, 1] : [-1];
            for (let s = c0 * this.length; s < c1 * this.length; s += 14) {
                this.sampleAt(s, f);
                for (const side of sides) {
                    const lat = side * (f.half + 3 + rnd() * 6);
                    this.posAt(s, lat, pos);
                    const sc = 1.5 + rnd() * 2.5;
                    const tone = rnd() < 0.5 ? this.def.rock : shade(this.def.rock, 0.82);
                    b.addSphere(tone, new Vec3(pos.x, pos.y - 0.25 + sc * 0.4, pos.z), 0, sc, sc * 0.7, sc);
                    if (rnd() < 0.4) {
                        b.addSphere(shade(this.def.rock, 0.82),
                            new Vec3(pos.x + sc * 0.5, pos.y - 0.25 + sc * 0.9, pos.z), 0, sc * 0.45, sc * 0.35, sc * 0.45);
                    }
                }
            }
        }

        // tunnel portals + roof segments (rock arch on the canyon track).
        // The roof run is unchanged; each end now gets a proper portal
        // frame — light stone columns + a beam (chevron-striped on the
        // coast, plain light sandstone on the arch).
        if (this.def.tunnelT) {
            const [tu0, tu1] = this.def.tunnelT;
            const tun0 = tu0 * this.length, tun1 = tu1 * this.length;
            for (let s = tun0; s < tun1; s += 12) {
                this.sampleAt(s, f);
                const yaw = Math.atan2(f.tangent.x, f.tangent.z);
                const hw = f.half + 1.2;
                for (const side of [-1, 1]) {
                    this.posAt(s, side * hw, pos);
                    b.addBox(this.def.tunnelRock, new Vec3(pos.x, pos.y + 3.5, pos.z), yaw, 0.8, 7, 0.8);
                }
                this.posAt(s, 0, pos);
                b.addBox(this.def.tunnelRock, new Vec3(pos.x, pos.y + 7.1, pos.z), yaw, hw * 2 + 1.6, 0.8, 0.8);
                b.addBox(this.def.tunnelRock, new Vec3(pos.x, pos.y + 6.6, pos.z), yaw, hw * 2 + 1.6, 0.25, 12.5);
            }
            for (const ps of [tun0, tun1]) {
                this.sampleAt(ps, f);
                const yaw = Math.atan2(f.tangent.x, f.tangent.z);
                const hw = f.half + 1.2;
                const portalCol = isCanyon ? shade(this.def.tunnelRock, 1.25) : 0x8a8a92;
                for (const side of [-1, 1]) {
                    this.posAt(ps, side * (hw + 0.9), pos);
                    b.addBox(portalCol, new Vec3(pos.x, pos.y + 4.0, pos.z), yaw, 1.4, 8, 1.4);
                }
                this.posAt(ps, 0, pos);
                const beamW = hw * 2 + 4.4;
                if (isCanyon) {
                    b.addBox(portalCol, new Vec3(pos.x, pos.y + 8.2, pos.z), yaw, beamW, 1.6, 1.6);
                } else {
                    const segW = beamW / 8;
                    for (let i = 0; i < 8; i++) {
                        const lat = -beamW / 2 + segW * (i + 0.5);
                        this.posAt(ps, lat, pos);
                        b.addBox(i % 2 === 0 ? 0xf5d020 : 0x222226,
                            new Vec3(pos.x, pos.y + 8.2, pos.z), yaw, segW, 1.6, 1.6);
                    }
                }
            }
        }

        // bridge parapets (sunset track only) + red/white top rail +
        // suspension pylons with crossbeams and diagonal cables.
        if (this.def.bridgeT) {
            const [br0t, br1t] = this.def.bridgeT;
            const br0 = br0t * this.length, br1 = br1t * this.length;
            for (let s = br0; s < br1; s += 10) {
                this.sampleAt(s, f);
                const yaw = Math.atan2(f.tangent.x, f.tangent.z);
                for (const side of [-1, 1]) {
                    this.posAt(s, side * (f.half + 1.7), pos);
                    b.addBox(0xa8a094, new Vec3(pos.x, pos.y + 0.6, pos.z), yaw, 0.6, 1.15, 10.5);
                    const seg = Math.floor(s / 10) % 2 === 0 ? this.def.curbA : 0xffffff;
                    b.addBox(seg, new Vec3(pos.x, pos.y + 1.25, pos.z), yaw, 0.65, 0.18, 10.5);
                }
            }
            for (const ft of [1 / 3, 2 / 3]) {
                const s = br0 + (br1 - br0) * ft;
                this.sampleAt(s, f);
                const yaw = Math.atan2(f.tangent.x, f.tangent.z);
                const deckY = f.pos.y;
                for (const side of [-1, 1]) {
                    this.posAt(s, side * (f.half + 4), pos);
                    const topY = deckY + 12;
                    b.addBox(0xffffff, new Vec3(pos.x, (0.5 + topY) / 2, pos.z), yaw, 1.2, topY - 0.5, 1.2);
                    // diagonal cables: pylon top -> deck, fore and aft.
                    // addPrimitive's rotX tilts the box in its local YZ
                    // plane (see MeshBuilder); +tilt drops the +Z end.
                    for (const dir of [-1, 1]) {
                        const cableLen = Math.hypot(12, 11.5);
                        const midS = s + dir * 6;
                        this.sampleAt(midS, f);
                        const myaw = Math.atan2(f.tangent.x, f.tangent.z);
                        this.posAt(midS, side * (f.half + 4), pos);
                        const tilt = Math.atan2(11.5, 12);
                        b.addPrimitive(0x2b2b30, primitives.box({ width: 0.28, height: 0.28, length: cableLen }),
                            new Vec3(pos.x, deckY + 6.25, pos.z), myaw, _sv.set(1, 1, 1), dir > 0 ? tilt : -tilt);
                    }
                }
                // crossbeam joining the two pylon tops
                this.posAt(s, 0, pos);
                b.addBox(0xffffff, new Vec3(pos.x, deckY + 11.4, pos.z), yaw, f.half * 2 + 10.4, 1.2, 1.2);
            }
        }

        // start gantry at s = 0 (PBR navy beam + pennant flags). fix131:
        // the old 0x182650 navy read as a black bar against the sky from
        // behind — lighter blue, so the beam reads as a beam, not a bar.
        this.sampleAt(0, f);
        const gyaw = Math.atan2(f.tangent.x, f.tangent.z);
        for (const side of [-1, 1]) {
            this.posAt(0, side * (f.half + 0.8), pos);
            sb.addBox(0x33507e, new Vec3(pos.x, pos.y + 3.25, pos.z), gyaw, 0.5, 6.5, 0.5, 0.6, 0.35);
            sb.addBox(side < 0 ? 0xe63946 : 0xf5d020,
                new Vec3(pos.x, pos.y + 7.0, pos.z), gyaw, 0.12, 1.0, 1.6, 0.1, 0.4);
        }
        this.posAt(0, 0, pos);
        sb.addBox(0x33507e, new Vec3(pos.x, pos.y + 6.5, pos.z), gyaw, f.half * 2 + 2.2, 1.4, 0.5, 0.6, 0.35);
        // fix132: the checkered start strip under the beam was 8 unlit
        // pure-black / pure-white boxes floating under the navy beam — it
        // read as a flat glitch bar from the grid. Rebuilt as PBR
        // (softer tones, roughness 0.6) on a navy backing board, so it
        // reads as a designed sign under the beam. The checkered finish
        // line ON the road stays unlit — it reads as road paint.
        sb.addBox(0x33507e,
            new Vec3(pos.x + f.tangent.x * 0.35, pos.y + 5.85, pos.z + f.tangent.z * 0.35),
            gyaw, f.half * 2 + 2.2, 1.1, 0.12, 0.6, 0.35);
        const stripW = f.half * 2 + 2.2;
        const segW = stripW / 8;
        for (let i = 0; i < 8; i++) {
            const lat = -stripW / 2 + segW * (i + 0.5);
            this.posAt(0, lat, pos);
            sb.addBox(i % 2 === 0 ? 0x232323 : 0xd8d8d8,
                new Vec3(pos.x, pos.y + 5.85, pos.z), gyaw, segW, 0.5, 0.6, 0, 0.6);
        }
        // checkered finish line ON the road under the gantry: two rows of
        // squares following the crown (lift falls to 0 at the road edge).
        for (let row = 0; row < 2; row++) {
            const rowS = row === 0 ? 1.1 : -1.1;
            for (let i = 0; i < 8; i++) {
                const lat = -stripW / 2 + segW * (i + 0.5);
                this.posAt(rowS, lat, pos);
                const lift = Math.max(0, 0.09 * (1 - Math.abs(lat) / f.half));
                b.addBox((i + row) % 2 === 0 ? 0x111111 : 0xffffff,
                    new Vec3(pos.x, pos.y + lift + 0.05, pos.z), gyaw, segW, 0.06, 1.1);
            }
        }

        // boost pads (PBR cyan, emissive, + white chevrons pointing forward).
        // fix131: the old full-cyan emissive filled the screen when driven
        // over — deeper cyan, ~40% emissive, rougher.
        for (const pad of this.def.boostPads) {
            const mid = ((pad.t0 + pad.t1) / 2) * this.length;
            const len = (pad.t1 - pad.t0) * this.length;
            this.sampleAt(mid, f);
            const yaw = Math.atan2(f.tangent.x, f.tangent.z);
            this.posAt(mid, pad.lat, pos);
            sb.addBox(0x00a8cc, new Vec3(pos.x, pos.y + 0.14, pos.z), yaw, pad.hw * 2, 0.06, len, 0, 0.45, 0x006a88);
            for (const cside of [-1, 1]) {
                b.addBox(0xffffff,
                    new Vec3(pos.x + f.right.x * cside * 0.9, pos.y + 0.2, pos.z + f.right.z * cside * 0.9),
                    yaw + cside * 0.6, 0.35, 0.05, 2.2);
            }
        }

        // sunset: sailboats on the sea beside the low beach stretch
        // (they sit ON the water plane at y 0.5, below the cliff road).
        // canyon: an oasis pond + round-top palms beside the village.
        if (!isCanyon) {
            for (const bs of [0.63, 0.70]) {
                const s = bs * this.length;
                this.sampleAt(s, f);
                const side = bs === 0.63 ? -1 : 1;
                this.posAt(s, side * (f.half + 32 + rnd() * 10), pos);
                const byaw = Math.atan2(f.tangent.x, f.tangent.z) + (rnd() - 0.5) * 0.6;
                b.addBox(0x8a5a3a, new Vec3(pos.x, 0.9, pos.z), byaw, 1.6, 0.8, 4.2);
                b.addCylinder(0x6e5234, new Vec3(pos.x, 3.0, pos.z), 0, 0.12, 0.12, 4.0);
                b.addCone(0xffffff, new Vec3(pos.x, 5.2, pos.z), byaw + Math.PI / 4, 1.8, 4.4, 4);
            }
        } else if (this.def.pond) {
            const ps = 0.72 * this.length;
            this.sampleAt(ps, f);
            this.posAt(ps, f.half + 16, pos);
            sb.addCylinder(this.def.pond, new Vec3(pos.x, pos.y - 0.1, pos.z), 0, 13, 14, 0.5, 0, 0.1);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2 + 0.5;
                const px = pos.x + Math.cos(a) * 17, pz = pos.z + Math.sin(a) * 17;
                b.addCylinder(this.def.treeTrunk, new Vec3(px, pos.y + 1.5, pz), 0, 0.28, 0.4, 3.0);
                b.addSphere(this.def.treeLeaf[1], new Vec3(px, pos.y + 4.6, pz), 0, 2.4, 1.9, 2.4);
            }
        }
    }

    /**
     * Gradient sky dome (unlit bands, horizon -> zenith) + sun ball.
     * kart.scene has no skybox and its camera clear colour is a flat
     * sky blue, so the dome carries the per-track sky: warm sunset bands
     * on the coast, pale gold on the canyon. Radius 650 < camera far
     * (1000); the bands face inward (reversed winding, inward normals)
     * so they are visible from inside the dome. The sun ball sits just
     * inside the dome with a larger pale halo ball behind it.
     */
    private _buildSky(b: MeshBuilder): void {
        const ctr = this.centroid(new Vec3());
        const R = 650;
        const bands = this.def.sky; // horizon -> zenith
        const edges = [-6, 6, 18, 32, 50, 90]; // degrees; bands.length + 1
        const LON = 24;
        const n = Math.min(bands.length, edges.length - 1);
        for (let bi = 0; bi < n; bi++) {
            const e0 = edges[bi] * Math.PI / 180, e1 = edges[bi + 1] * Math.PI / 180;
            const pArr: number[] = [];
            const nArr: number[] = [];
            const uArr: number[] = [];
            const iArr: number[] = [];
            for (let ring = 0; ring < 2; ring++) {
                const el = ring === 0 ? e0 : e1;
                for (let j = 0; j <= LON; j++) {
                    const az = (j / LON) * Math.PI * 2;
                    const x = Math.cos(el) * Math.cos(az), y = Math.sin(el), z = Math.cos(el) * Math.sin(az);
                    pArr.push(ctr.x + x * R, y * R, ctr.z + z * R);
                    nArr.push(-x, -y, -z);
                    uArr.push(0, 0);
                }
            }
            for (let j = 0; j < LON; j++) {
                const a = j, c = j + 1, d = (LON + 1) + j, e = (LON + 1) + j + 1;
                // (lower, upper+1, upper) + (lower, lower+1, upper+1): inward
                iArr.push(a, e, d, a, c, e);
            }
            b.addGeometry(bands[bi], pArr, nArr, uArr, iArr);
        }
        // sun ball + halo ball just behind it along the same ray
        const az = this.def.sunAzimDeg * Math.PI / 180;
        const el = this.def.sunElevDeg * Math.PI / 180;
        const dx = Math.cos(az) * Math.cos(el), dz = Math.sin(az) * Math.cos(el);
        const sx = ctr.x + dx * 600, sy = 600 * Math.sin(el), sz = ctr.z + dz * 600;
        b.addSphere(this.def.sunHalo, new Vec3(sx + dx * 45, sy, sz + dz * 45), 0, 52, 52, 52);
        b.addSphere(this.def.sunDisc, new Vec3(sx, sy, sz), 0, 32, 32, 32);
    }
}

// ---------------------------------------------------------------------------
// MeshBuilder — merge transformed primitives per colour into few draw calls
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

export class MeshBuilder {
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

    /** Raw geometry straight into a colour bucket (positions already world). */
    public addGeometry(hex: number, positions: number[], normals: number[], uvs: number[], indices: number[]): void {
        const bk = this._bucket(hex);
        const base = bk.positions.length / 3;
        for (let i = 0; i < positions.length; i++) { bk.positions.push(positions[i]); }
        for (let i = 0; i < normals.length; i++) { bk.normals.push(normals[i]); }
        for (let i = 0; i < uvs.length; i++) { bk.uvs.push(uvs[i]); }
        for (let i = 0; i < indices.length; i++) { bk.indices.push(indices[i] + base); }
    }

    /** Transform a primitive into a colour bucket.
     *  Manual TRS (scale -> rotate about Y -> translate): Mat4.fromTRS does
     *  not exist at runtime in Creator 3.8.8, and Vec3.transformMat4 would
     *  need the matrix — the same result by hand with transformQuat.
     *  rotX (radians, optional) tilts the primitive about X first — used
     *  for the boost-flame cone, which must point backwards (-Z). */
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

    /** Cone (radialSegments-sided; 4 = pyramid roof, 10 = tree) centred at pos. */
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
            // NOTE: cc.MeshRenderer is NOT exported by the engine module in
            // this project's build (Creator 3.8.8 prunes it); ModelComponent
            // is its base class and renders identically (verified live).
            const renderer = node.addComponent(ModelComponent);
            renderer.mesh = mesh;
            renderer.setMaterial(mat, 0);
        }
        return root;
    }
}

// ---------------------------------------------------------------------------
// StdBuilder — PBR twin of MeshBuilder (builtin-standard materials).
// MeshBuilder above is NOT to be touched (KartModel depends on it); the
// track's hero surfaces (road, curbs, shoulder, sea/sand, boost pads,
// gantry, oasis pond) get glossy PBR here instead, with the same
// merge-per-bucket draw-call discipline: one node per (colour, metallic,
// roughness, emissive) bucket. The rest of the track stays unlit flat
// colour (same pattern as the karts: PBR bodies + unlit driver/shadow),
// which keeps every vertical face readable with no ambient-light risk.
// ---------------------------------------------------------------------------

/** Multiply a hex colour's channels by f (clamped) — darker / lighter variants. */
function shade(hex: number, f: number): number {
    const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 0xff) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 0xff) * f)));
    const b = Math.min(255, Math.max(0, Math.round((hex & 0xff) * f)));
    return (r << 16) | (g << 8) | b;
}

// stdMaterial lives in KartMaterials.ts (shared with KartModel): it
// creates materials from the RUNTIME-LOADED anchor effect
// (resources.load kart-std-anchor), never from
// initialize({ effectName: 'builtin-standard' }) — the name lookup does
// not resolve at runtime and produced null-effect materials that
// half-initialised SubModels and bricked scene teardown (drive130).

interface StdBucket {
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
    hex: number;
    metallic: number;
    roughness: number;
    emissive: number;
}

export class StdBuilder {
    private _buckets = new Map<string, StdBucket>();

    private _bucket(hex: number, metallic: number, roughness: number, emissive: number): StdBucket {
        const key = hex.toString(16) + '_' + metallic + '_' + roughness + '_' + emissive.toString(16);
        let bk = this._buckets.get(key);
        if (!bk) {
            bk = { positions: [], normals: [], uvs: [], indices: [], hex, metallic, roughness, emissive };
            this._buckets.set(key, bk);
        }
        return bk;
    }

    /** Raw geometry straight into a PBR bucket (positions already world). */
    public addGeometry(hex: number, positions: number[], normals: number[], uvs: number[], indices: number[],
        metallic: number = 0, roughness: number = 0.9, emissive: number = 0): void {
        const bk = this._bucket(hex, metallic, roughness, emissive);
        const base = bk.positions.length / 3;
        for (let i = 0; i < positions.length; i++) { bk.positions.push(positions[i]); }
        for (let i = 0; i < normals.length; i++) { bk.normals.push(normals[i]); }
        for (let i = 0; i < uvs.length; i++) { bk.uvs.push(uvs[i]); }
        for (let i = 0; i < indices.length; i++) { bk.indices.push(indices[i] + base); }
    }

    /** Transform a primitive into a PBR bucket (same TRS as MeshBuilder). */
    public addPrimitive(hex: number, prim: any, pos: Vec3, rotY: number, scale: Vec3, rotX: number = 0,
        metallic: number = 0, roughness: number = 0.9, emissive: number = 0): void {
        Quat.fromEuler(_q, rotX * 180 / Math.PI, rotY * 180 / Math.PI, 0);
        const bk = this._bucket(hex, metallic, roughness, emissive);
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
    public addBox(hex: number, pos: Vec3, rotY: number, w: number, h: number, d: number,
        metallic: number = 0, roughness: number = 0.9, emissive: number = 0): void {
        this.addPrimitive(hex, primitives.box({ width: w, height: h, length: d }), pos, rotY, _sv.set(1, 1, 1), 0, metallic, roughness, emissive);
    }

    /** Y-axis cylinder (radiusTop 0 = cone tip) centred at pos. */
    public addCylinder(hex: number, pos: Vec3, rotY: number, rTop: number, rBottom: number, h: number,
        metallic: number = 0, roughness: number = 0.9, emissive: number = 0): void {
        this.addPrimitive(hex, primitives.cylinder(rTop, rBottom, h, { radialSegments: 12 }), pos, rotY, _sv.set(1, 1, 1), 0, metallic, roughness, emissive);
    }

    /** Emit one Node per PBR bucket under parent. Returns the root node. */
    public build(parent: Node): Node {
        const root = new Node('stdRoot');
        root.layer = Layers.Enum.DEFAULT;
        root.setParent(parent);
        for (const [, bk] of this._buckets) {
            if (bk.positions.length === 0 || bk.indices.length === 0) { continue; }
            // drive130: one bad bucket must never take out the whole
            // track (and the whole game with it) — skip it and keep
            // building the rest.
            let node: Node = null;
            try {
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
                node = new Node('std_' + bk.hex.toString(16) + '_' + bk.metallic + '_' + bk.roughness);
                node.layer = Layers.Enum.DEFAULT;
                node.setParent(root);
                const renderer = node.addComponent(ModelComponent);
                renderer.mesh = mesh;
                renderer.setMaterial(stdMaterial(bk.hex, bk.metallic, bk.roughness, bk.emissive), 0);
            } catch (e) {
                console.warn('[StdBuilder] skipped bucket #' + bk.hex.toString(16) + ': ' + e);
                if (node) { node.destroy(); }
            }
        }
        return root;
    }
}
