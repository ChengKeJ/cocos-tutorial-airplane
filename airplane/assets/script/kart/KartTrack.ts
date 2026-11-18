/**
 * Kart track for the Star Fighter hall kart game （飞车狂飙）.
 *
 * Centreline math is a port of the Three.js kart design spec
 * (MIT-licensed reference implementation): the same 16-leg curvature schedule,
 * elevation / half-width / banking keyframes, box-blurred curvature,
 * exact -2PI renormalisation and uniform arc-length resampling.
 * The world built on top of it is OURS: procedural Cocos meshes
 * (ribbon road, skirt, water, trees, houses, rocks, tunnel, bridge,
 * start gantry, boost pads) — no art assets, no Three.js, no DOM.
 *
 * Arcade model: a kart's state is (s = metres along the centreline,
 * d = lateral offset from it). sampleAt(s) returns the interpolated
 * frame {pos, tangent, right, up, half, bank, zone, raceLat}.
 */

import { Layers, Material, ModelComponent, Node, Quat, Vec3, Color, primitives, utils } from 'cc';

// ---------------------------------------------------------------------------
// Layout tables (spec: src/world/TrackLayout.ts)
// ---------------------------------------------------------------------------

/** [length metres, heading change degrees] (negative = left). */
const LEGS: Array<[number, number]> = [
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
];
const PLAN_LENGTH = 1600;
const START_HEADING = 45 * Math.PI / 180;

type Keys = Array<[number, number]>;

const ELEVATION: Keys = [
    [0.000, 3.0], [0.100, 3.6], [0.220, 7.0], [0.300, 15.0],
    [0.380, 29.0], [0.440, 41.5], [0.500, 38.0], [0.560, 33.0],
    [0.600, 28.0], [0.660, 16.0], [0.720, 5.5], [0.800, 14.0],
    [0.860, 24.0], [0.900, 19.5], [0.935, 14.5], [0.962, 9.0],
    [0.982, 4.6], [0.995, 3.15],
];

const HALF_WIDTH: Keys = [
    [0.000, 8.8], [0.070, 8.6], [0.140, 8.1], [0.210, 7.5],
    [0.270, 7.0], [0.330, 6.8], [0.380, 6.4], [0.440, 5.7],
    [0.480, 5.4], [0.521, 5.9], [0.560, 6.3], [0.620, 6.9],
    [0.700, 7.6], [0.760, 8.8], [0.830, 8.7], [0.880, 7.2],
    [0.930, 7.0], [0.968, 8.2],
];

/** degrees; positive = right side raised. */
const BANK: Keys = [
    [0.000, 0], [0.070, 0], [0.130, 7], [0.170, 9.5], [0.210, 5],
    [0.240, 4], [0.265, 5],
    [0.283, -6], [0.312, -4], [0.330, -4],
    [0.348, 0], [0.366, 4], [0.400, 3], [0.440, 2], [0.482, 3],
    [0.520, 4], [0.560, 5], [0.600, 3], [0.660, 2], [0.700, 6],
    [0.735, 12], [0.775, 20], [0.820, 20], [0.848, 12], [0.870, 2],
    [0.893, -5], [0.925, -3], [0.958, -6], [0.985, -2],
];

/** Zone names + ground colour, by start t. Names are ours; t-ranges follow the spec. */
const ZONES: Array<{ t0: number; name: string; ground: number }> = [
    { t0: 0.000, name: '起点', ground: 0x5a9448 },
    { t0: 0.100, name: '海港', ground: 0x5a9448 },
    { t0: 0.220, name: '村庄', ground: 0x7a9a58 },
    { t0: 0.380, name: '悬崖', ground: 0x8a7a68 },
    { t0: 0.521, name: '隧道', ground: 0x555560 },
    { t0: 0.600, name: '沙滩', ground: 0xd8c28a },
    { t0: 0.740, name: '弯道', ground: 0x5a9448 },
    { t0: 0.860, name: '引桥', ground: 0x5a9448 },
    { t0: 0.893, name: '大桥', ground: 0x5a9448 },
    { t0: 0.950, name: '回程', ground: 0x5a9448 },
];

export const BOOST_PADS: Array<{ t0: number; t1: number; lat: number; hw: number }> = [
    { t0: 0.5380, t1: 0.5555, lat: -2.9, hw: 1.9 },
    { t0: 0.5380, t1: 0.5555, lat: 2.9, hw: 1.9 },
    { t0: 0.5720, t1: 0.5895, lat: 0.0, hw: 2.6 },
    { t0: 0.9575, t1: 0.9740, lat: -3.1, hw: 2.2 },
    { t0: 0.9575, t1: 0.9740, lat: 3.1, hw: 2.2 },
];

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

function buildCenterline(): CenterlineData {
    // pass 1: integrate a smoothed curvature schedule in the XZ plane
    const DS0 = 0.25;
    const N0 = Math.round(PLAN_LENGTH / DS0);
    const raw = new Float64Array(N0);
    {
        let s = 0;
        for (const [len, turn] of LEGS) {
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
        let th = START_HEADING, x = 0, z = 0;
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
        Y[i] = cyclic(ELEVATION, u)
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
        cl.half[i] = cyclicMonotone(HALF_WIDTH, t);
        const b = cyclic(BANK, t) * Math.PI / 180;
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
        let zi = ZONES.length - 1;
        for (let k = 0; k < ZONES.length; k++) { if (ZONES[k].t0 <= t) { zi = k; } else { break; } }
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

    constructor() {
        this._cl = buildCenterline();
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
        let zi = ZONES.length - 1;
        for (let k = 0; k < ZONES.length; k++) { if (ZONES[k].t0 <= t) { zi = k; } else { break; } }
        return ZONES[zi].name;
    }

    /**
     * True if (race s, lateral d) is on a boost pad. The t-range is
     * looked up on the PHYSICAL station (mirrored in reverse); the
     * lateral check needs no flip because the pads are lat-symmetric
     * (pairs at ±lat, plus one centred at 0).
     */
    public padBoostAt(s: number, d: number): boolean {
        const t = this._mapS(s) / this.length;
        for (const pad of BOOST_PADS) {
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

    // -----------------------------------------------------------------------
    // World meshes (all procedural, all unlit flat colours)
    // -----------------------------------------------------------------------

    public buildWorld(parent: Node): void {
        const cl = this._cl;
        const builder = new MeshBuilder();

        // --- road ribbon: 3 verts per ring (left, crown, right), every 2 m ---
        const ROAD = 0x3a3f4a;
        const ringStep = 4; // stations
        const rings = Math.floor(cl.count / ringStep);
        const roadPos: number[] = [];
        const roadNor: number[] = [];
        const roadUv: number[] = [];
        const roadIdx: number[] = [];
        const f = this._frame;
        for (let r = 0; r <= rings; r++) {
            // last ring closes the loop exactly on ring 0's station
            const i = r === rings ? 0 : (r * ringStep) % cl.count;
            const s = i * cl.ds;
            this.sampleAt(s, f);
            const hw = f.half;
            // left, centre (+crown), right
            const lats = [-hw, 0, hw];
            const lifts = [0, 0.09, 0];
            for (let k = 0; k < 3; k++) {
                roadPos.push(
                    f.pos.x + f.right.x * lats[k] + f.up.x * lifts[k],
                    f.pos.y + f.right.y * lats[k] + f.up.y * lifts[k],
                    f.pos.z + f.right.z * lats[k] + f.up.z * lifts[k]);
                roadNor.push(f.up.x, f.up.y, f.up.z);
                roadUv.push(k * 0.5, s * 0.1);
            }
        }
        for (let r = 0; r < rings; r++) {
            const a = r * 3, b = (r + 1) * 3;
            // NOTE: frame.right = tangent x up points to the kart's LEFT in
            // this right-handed layout, so the ring order runs right-to-left
            // as seen from above — the winding below is the one whose
            // geometric normal points UP (+Y); the opposite order is
            // backface-culled and the road is invisible (found 2026-11-17).
            roadIdx.push(a, a + 1, b, a + 1, b + 1, b);
            roadIdx.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
        }
        builder.addGeometry(ROAD, roadPos, roadNor, roadUv, roadIdx);

        // --- white edge lines: thin ribbons just inside each road edge ---
        const EDGE = 0xf2f2f2;
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
            if (zone === 8) { return; }
            const ground = ZONES[zone].ground;
            const pos: number[] = [];
            const nor: number[] = [];
            const uv: number[] = [];
            const idx: number[] = [];
            for (let r = r0; r <= r1; r++) {
                const i = skirtStation(r);
                this.sampleAt(i * cl.ds, f);
                const hw = f.half;
                const lats = [-(hw + 26), -(hw + 0.4), hw + 0.4, hw + 26];
                for (let k = 0; k < 4; k++) {
                    pos.push(
                        f.pos.x + f.right.x * lats[k] + f.up.x * -0.25,
                        f.pos.y + f.right.y * lats[k] + f.up.y * -0.25,
                        f.pos.z + f.right.z * lats[k] + f.up.z * -0.25);
                    nor.push(f.up.x, f.up.y, f.up.z);
                    uv.push(0, 0);
                }
            }
            const n = r1 - r0;
            for (let r = 0; r < n; r++) {
                const a = r * 4, b = (r + 1) * 4;
                idx.push(a, a + 1, b, a + 1, b + 1, b);
                idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
            }
            builder.addGeometry(ground, pos, nor, uv, idx);
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

        // --- water: one big flat box under everything ---
        const c = this.centroid(_v1);
        builder.addBox(0x3f8cc8, _v2.set(c.x, 0.3, c.z), 0, 1400, 0.4, 1400);

        // --- scenery: trees, houses, rocks, tunnel, bridge, gantry, pads ---
        this._buildScenery(builder);

        builder.build(parent);
    }

    private _buildScenery(b: MeshBuilder): void {
        const cl = this._cl;
        const rnd = mulberry32(1907240611);
        const f = this._frame;
        const pos = new Vec3();

        // trees: every ~10 m, both sides, skipping tunnel + bridge.
        // Pass B: bigger + closer + denser — the old trees (scale 0.8-1.5,
        // 7-25 m off the road) never read in screenshots.
        for (let s = 8; s < this.length; s += 10) {
            const t = s / this.length;
            let zi = ZONES.length - 1;
            for (let k = 0; k < ZONES.length; k++) { if (ZONES[k].t0 <= t) { zi = k; } else { break; } }
            if (zi === 4 || zi === 8) { continue; } // tunnel, bridge
            this.sampleAt(s, f);
            const side = rnd() < 0.5 ? -1 : 1;
            const lat = side * (f.half + 4 + rnd() * 10);
            this.posAt(s, lat, pos);
            const y = pos.y - 0.25;
            const sc = 1.3 + rnd() * 0.9;
            const trunkH = 2.4 * sc;
            b.addCylinder(0x6e5234, new Vec3(pos.x, y + trunkH / 2, pos.z), 0, 0.3 * sc, 0.42 * sc, trunkH);
            const fol = rnd() < 0.5 ? 0x34823e : 0x3f9a4a;
            b.addCone(fol, new Vec3(pos.x, y + trunkH + 2.4 * sc, pos.z), 0, 2.3 * sc, 5.2 * sc, 10);
        }

        // houses in the village (t 0.22-0.38), both sides every ~22 m
        for (let s = 0.225 * this.length; s < 0.375 * this.length; s += 22) {
            this.sampleAt(s, f);
            for (const side of [-1, 1]) {
                if (rnd() < 0.25) { continue; }
                const lat = side * (f.half + 7 + rnd() * 4);
                this.posAt(s, lat, pos);
                const y = pos.y - 0.25;
                const yaw = Math.atan2(f.tangent.x, f.tangent.z) + (rnd() - 0.5) * 0.3;
                b.addBox(0xe8d6b4, new Vec3(pos.x, y + 2.2, pos.z), yaw, 7.5, 4.4, 6.5);
                b.addCone(0xac543e, new Vec3(pos.x, y + 4.4 + 1.4, pos.z), yaw + Math.PI / 4, 5.2, 2.8, 4);
            }
        }

        // trackside boards: every ~60 m, alternating sides, face the road.
        // Skipping tunnel + bridge (no room there). Bright colours so they
        // read at speed — they are the cheapest "big race" signal.
        const BOARD_COLS = [0xe63946, 0x2a9d8f, 0xf4a261, 0x4361ee, 0x9b5de5, 0xf15bb5];
        let bi = 0;
        for (let s = 30; s < this.length; s += 60) {
            const t = s / this.length;
            let zi = ZONES.length - 1;
            for (let k = 0; k < ZONES.length; k++) { if (ZONES[k].t0 <= t) { zi = k; } else { break; } }
            if (zi === 4 || zi === 8) { continue; }
            this.sampleAt(s, f);
            const side = (bi % 2 === 0) ? -1 : 1;
            const lat = side * (f.half + 4.5);
            this.posAt(s, lat, pos);
            const y = pos.y - 0.25;
            const yaw = Math.atan2(f.tangent.x, f.tangent.z) + Math.PI / 2;
            b.addBox(0x2b2b30, new Vec3(pos.x, y + 1.2, pos.z), yaw, 0.35, 2.4, 0.35);
            b.addBox(BOARD_COLS[bi % BOARD_COLS.length], new Vec3(pos.x, y + 3.4, pos.z), yaw, 4.6, 1.9, 0.25);
            bi++;
        }

        // distant mountains: a ring of big low-poly cones around the
        // circuit so the horizon is never flat blue.
        const cc = this.centroid(new Vec3());
        for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * Math.PI * 2 + rnd() * 0.3;
            const r = 380 + rnd() * 140;
            const h = 70 + rnd() * 80;
            const base = 90 + rnd() * 70;
            const col = i % 2 === 0 ? 0x5a6a7a : 0x4a6a52;
            b.addCone(col, new Vec3(cc.x + Math.cos(ang) * r, h / 2 - 0.5, cc.z + Math.sin(ang) * r), 0, base, h, 6);
        }

        // clouds: flattened white spheres high up, scattered over the map
        for (let i = 0; i < 12; i++) {
            const ang = rnd() * Math.PI * 2;
            const r = 120 + rnd() * 260;
            b.addSphere(0xffffff,
                new Vec3(cc.x + Math.cos(ang) * r, 65 + rnd() * 30, cc.z + Math.sin(ang) * r),
                0, 18 + rnd() * 14, 4 + rnd() * 3, 12 + rnd() * 8);
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

        // rocks on the cliff left side (t 0.38-0.52)
        for (let s = 0.385 * this.length; s < 0.515 * this.length; s += 14) {
            this.sampleAt(s, f);
            const lat = -(f.half + 3 + rnd() * 6);
            this.posAt(s, lat, pos);
            const sc = 1.5 + rnd() * 2.5;
            b.addSphere(0x807a74, new Vec3(pos.x, pos.y - 0.25 + sc * 0.4, pos.z), 0, sc, sc * 0.7, sc);
        }

        // tunnel portals + roof segments (t 0.521-0.599)
        const tun0 = 0.521 * this.length, tun1 = 0.599 * this.length;
        for (let s = tun0; s < tun1; s += 12) {
            this.sampleAt(s, f);
            const yaw = Math.atan2(f.tangent.x, f.tangent.z);
            const hw = f.half + 1.2;
            for (const side of [-1, 1]) {
                this.posAt(s, side * hw, pos);
                b.addBox(0x464650, new Vec3(pos.x, pos.y + 3.5, pos.z), yaw, 0.8, 7, 0.8);
            }
            this.posAt(s, 0, pos);
            b.addBox(0x464650, new Vec3(pos.x, pos.y + 7.1, pos.z), yaw, hw * 2 + 1.6, 0.8, 0.8);
            b.addBox(0x3a3a44, new Vec3(pos.x, pos.y + 6.6, pos.z), yaw, hw * 2 + 1.6, 0.25, 12.5);
        }

        // bridge parapets (t 0.893-0.950)
        const br0 = 0.893 * this.length, br1 = 0.950 * this.length;
        for (let s = br0; s < br1; s += 10) {
            this.sampleAt(s, f);
            const yaw = Math.atan2(f.tangent.x, f.tangent.z);
            for (const side of [-1, 1]) {
                this.posAt(s, side * (f.half + 1.7), pos);
                b.addBox(0xa8a094, new Vec3(pos.x, pos.y + 0.6, pos.z), yaw, 0.6, 1.15, 10.5);
            }
        }

        // start gantry at s = 0
        this.sampleAt(0, f);
        const gyaw = Math.atan2(f.tangent.x, f.tangent.z);
        for (const side of [-1, 1]) {
            this.posAt(0, side * (f.half + 0.8), pos);
            b.addBox(0x182650, new Vec3(pos.x, pos.y + 3.25, pos.z), gyaw, 0.5, 6.5, 0.5);
        }
        this.posAt(0, 0, pos);
        b.addBox(0x182650, new Vec3(pos.x, pos.y + 6.5, pos.z), gyaw, f.half * 2 + 2.2, 1.4, 0.5);
        // checkered start strip under the beam (replaces the old yellow bar)
        const stripW = f.half * 2 + 2.2;
        const segW = stripW / 8;
        for (let i = 0; i < 8; i++) {
            const lat = -stripW / 2 + segW * (i + 0.5);
            this.posAt(0, lat, pos);
            b.addBox(i % 2 === 0 ? 0x111111 : 0xffffff,
                new Vec3(pos.x, pos.y + 5.85, pos.z), gyaw, segW, 0.5, 0.6);
        }

        // boost pads (cyan strips on the road)
        for (const pad of BOOST_PADS) {
            const mid = ((pad.t0 + pad.t1) / 2) * this.length;
            const len = (pad.t1 - pad.t0) * this.length;
            this.sampleAt(mid, f);
            const yaw = Math.atan2(f.tangent.x, f.tangent.z);
            this.posAt(mid, pad.lat, pos);
            b.addBox(0x00d2ff, new Vec3(pos.x, pos.y + 0.05, pos.z), yaw, pad.hw * 2, 0.08, len);
        }
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
