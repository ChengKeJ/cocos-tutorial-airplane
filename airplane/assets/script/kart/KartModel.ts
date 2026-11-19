/**
 * Kart model for the hall kart game （飞车狂飙） — round-7 PopKart rebuild.
 *
 * The 8 karts are built procedurally from primitives in ONE coherent
 * style language (see buildPopKartBody): a chunky low wide tub, big
 * thick exposed wheels (rear bigger), a high driver with a big glossy
 * helmet + visor, bright glossy paint, a small rear spoiler, exhausts,
 * headlights, a number plate and a brake-light bar. Per-kart
 * differentiation is colour + spoiler style (low / tall / wide / fin)
 * + nose shape (round / point / flat) + side-pod width — same
 * construction, one family. The kart faces +Z locally; KartGame drives
 * position / yaw / bank / pitch. Wheels keep the old structure — steer
 * pivots in front (rotate Y), spin nodes (rotate X) — so steering /
 * spin / collision footprint are unchanged. Paints recolour the body:
 * buildKartModel takes the selected PaintScheme and every paint part
 * uses it, exactly like the baked bodies did.
 *
 * Why procedural (round 7, 2026-11-19): the previous karts were 8
 * different baked low-poly models from different sources (Poly Pizza /
 * Kenney), filtered 5 times (R1–R5). The result was incoherent — 8
 * style languages patched together — and kejun's verdict on v1.0.11
 * was "画的啥玩意啊" / "这个车 我想要跑跑卡丁车的样式". Rounds 1–6
 * removed defects (spikes, discs, dark lighting) but could not fix
 * style. The baked bodies are no longer rendered; KartModelsData.ts
 * stays in the repo (license attribution + the node-tested triangle
 * filters), but nothing in the game reads it. Wheel centres, seat and
 * steering are STANDARDISED for all 8 karts (the baked centres were
 * part of the incoherence: track widths 0.66–1.46 m, tyre radii
 * 0.13–0.30). The physics footprint is the constant KART_HALF_WIDTH
 * in KartConstants.ts, not the visual wheel positions, so gameplay
 * is untouched.
 *
 * Layout (metres, origin at the road contact point): ~2.1 m long,
 * ground at y 0, forward +Z. Shadow: two nested opaque discs
 * (lighter outer + dark core) as a cheap soft blob — no transparency,
 * so it works on every backend. Lighting (sun 40000 lux / fill
 * 80000 lux, paint 0.15 metallic / 0.08 roughness + 15% emissive
 * floor) is unchanged from rounds 4/6 — see KartMaterials.ts.
 * Reference: PopKart / KartRider classic karts (ref-lime.jpg,
 * ref-drift.jpg, ref-marshmallow.jpg in the round-7 work dir).
 * Every kart was render-verified rear/side/front in Python
 * (render7.py) before this code was written.
 */

import { Layers, Material, ModelComponent, Node, Vec3, primitives, utils } from 'cc';
import { MeshBuilder } from './KartTrack';
import { stdMaterial } from './KartMaterials';
import { DriverStats, PaintScheme, ROSTER } from './KartConstants';
import { KartModelBucket } from './KartModelsData';

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

// ---- round-7 PopKart style table: one construction, three knobs ----
// spoiler: 'low' = small wing, 'tall' = high wing, 'wide' = full-width
// wing, 'fin' = vertical centre fin + small stabiliser.
// nose: 'round' = sphere, 'point' = cone, 'flat' = box.
// pod: side-pod width multiplier (0.85 slim … 1.20 wide).
export type KartSpoiler = 'low' | 'tall' | 'wide' | 'fin';
export type KartNose = 'round' | 'point' | 'flat';
export interface KartStyle { spoiler: KartSpoiler; nose: KartNose; pod: number; }
export const POPKART_STYLE: KartStyle[] = [
    { spoiler: 'tall', nose: 'point', pod: 1.00 }, // 0 凌风
    { spoiler: 'wide', nose: 'flat', pod: 1.15 },  // 1 海蓝
    { spoiler: 'fin', nose: 'point', pod: 0.85 },  // 2 闪电
    { spoiler: 'low', nose: 'round', pod: 1.00 },  // 3 青竹
    { spoiler: 'tall', nose: 'flat', pod: 1.10 },  // 4 紫曜
    { spoiler: 'wide', nose: 'round', pod: 1.20 }, // 5 橙光
    { spoiler: 'fin', nose: 'flat', pod: 0.90 },   // 6 雪驰
    { spoiler: 'low', nose: 'point', pod: 1.05 },  // 7 绯焰
];

// ---- round-7 standardised layout (all 8 karts, metres, forward +Z) ----
// Front wheels (±0.48, 0.26, 0.68) R 0.26 W 0.24; rear wheels
// (±0.50, 0.30, -0.70) R 0.30 W 0.32 (rear bigger, PopKart style).
// Tyre radius == centre height, so every tyre touches the road.
export const POPKART_WHEEL_FL: number[] = [0.48, 0.26, 0.68];
export const POPKART_WHEEL_FR: number[] = [-0.48, 0.26, 0.68];
export const POPKART_WHEEL_RL: number[] = [0.50, 0.30, -0.70];
export const POPKART_WHEEL_RR: number[] = [-0.50, 0.30, -0.70];
export const POPKART_SEAT: number[] = [0, 0.36, -0.25];
export const POPKART_STEER: number[] = [0, 0.46, 0.18];

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

// PBR materials come from KartMaterials.stdMaterial (shared cache):
// real builtin-standard via the runtime-loaded anchor effect, or the
// builtin-unlit fallback — never a null-effect material (see
// KartMaterials.ts for why the old initialize({ effectName:
// 'builtin-standard' }) path bricked the game in drive130).
function standardMaterial(hex: number, metallic: number, roughness: number, emissiveHex: number = 0): Material {
    return stdMaterial(hex, metallic, roughness, emissiveHex);
}

/** Scale a hex colour's channels by f (clamped) — used for the paint
 * emissive below. Exported for the node tests. */
export function dimHex(hex: number, f: number): number {
    const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 0xff) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 0xff) * f)));
    const b = Math.min(255, Math.max(0, Math.round((hex & 0xff) * f)));
    return (r << 16) | (g << 8) | b;
}

/** Finish per bucket role. fix132: the old paint finish (metallic 0.55 /
 * roughness 0.25) rendered flat and dark — with no environment map /
 * IBL in the scene, metallic kills ~55% of the diffuse and the only
 * specular comes from the punctual sun/fill, so yellow paint went olive
 * and white went grey. Gloss here comes from LOW metallic (keeps the
 * diffuse) + LOW roughness (tight sun highlight): paint 0.15 / 0.12.
 * fix134: roughness 0.12 -> 0.08 (with the fill at 80000 lux the
 * highlight tightens further — the gloss the AAA pass needs) and the
 * directional lights are physical lux now (KartGame.ts), so the
 * specular is actually visible. Same for helmet / driver / rims /
 * detail; tires stay matte rubber. */
function materialForRole(role: string, hex: number): Material {
    // fix133: paint gets a small emissive (15% of its own colour) so a
    // rear face lit only by the fill can never go dark-olive — the
    // rendered rear of kart 2 闪电 read olive-green even though the
    // material was bright yellow [255,210,63], because the rear faces
    // away from the sun and the cool fill tints yellow green. The
    // emissive is a floor under the paint colour, not a glow: it lifts
    // shadowed paint to its own hue while the sunlit side (2.6) still
    // dominates. Same finish for the procedural paint bodywork below.
    if (role === 'paint') { return standardMaterial(hex, 0.15, 0.08, dimHex(hex, 0.15)); }
    if (role === 'driver') { return standardMaterial(hex, 0.15, 0.30); }
    if (role === 'tire') { return standardMaterial(hex, 0.0, 0.95); }
    if (role === 'rim') { return standardMaterial(hex, 0.45, 0.18); }
    return standardMaterial(hex, 0.15, 0.35); // detail
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

/** Driver suit/helmet colour: dark accents (near-black) are invisible
 * in the cockpit shadow, so lift them to bright off-white. Bright
 * accents pass through unchanged. Paint colours are unaffected. */
export function driverColor(accent: number): number {
    return luminance(accent) < 0.30 ? 0xf5f5f5 : accent;
}

/** fix131 visual overrides for the baked buckets. Kept in code, not in
 * KartModelsData.ts, so a converter re-bake does not silently drop them:
 *  - kart 1 海蓝: the chassis/exhaust bucket is near-black (#180c19) and
 *    reads as a huge black cannon — lift to a readable slate purple.
 *  - kart 2 闪电: the floor/steering-column bucket is near-black
 *    (#000105) — bright blue, as on the original F1 model. This is the
 *    HELMET + floor, NOT the rear wing: the wing lives in the driver
 *    bucket (#000f2b) and is split out separately in buildKartModel
 *    (fix132) — the fix131 override never touched it, which is why the
 *    wing stayed pale grey-blue.
 *  - kart 3 青竹: the blue cable buckets are part of the bodywork — they
 *    take the kart colour so the skeletal frame reads as a bodied kart.
 *  - kart 5 橙光: UNUSED since fix132 — the baked body is skipped
 *    entirely (rebuilt procedurally in buildBuggyBody); the entries are
 *    kept so a re-bake / re-enable still recolours the panels. */
const BUCKET_OVERRIDES: { [ki: number]: { [hex: string]: { role?: string; hex?: string } } } = {
    1: { '#180c19': { hex: '#5a4a7a' } },
    2: { '#000105': { hex: '#2a5fd0' } },
    3: { '#3362cc': { role: 'paint' }, '#0003cc': { role: 'paint' } },
    5: { '#a1b2b8': { role: 'paint' }, '#424f58': { role: 'paint' }, '#bd540f': { role: 'paint' } },
};

/** Effective role/hex for one body bucket after the fix131 overrides.
 * Exported so the node tests can assert the overrides without an engine. */
export function bucketOverride(ki: number, b: KartModelBucket): { role: string; hex: string } {
    const ov = BUCKET_OVERRIDES[ki] && BUCKET_OVERRIDES[ki][b.hex.toLowerCase()];
    return { role: (ov && ov.role) ? ov.role : b.role, hex: (ov && ov.hex) ? ov.hex : b.hex };
}

/** fix132 kart 2 闪电: the rear wing lives in the driver bucket (the
 * converter stripped the whole dark-navy material as "driver"). The wing
 * is the only driver-bucket geometry behind z -0.6 (33 of 150 tris);
 * everything else (figure, seat) is at z > -0.6. Exported for the node
 * tests. */
export function kart2WingTri(cz: number): boolean {
    return cz < -0.6;
}

/** One decoded triangle of a bucket: centroid + max vertex height +
 * min/max |x| of its verts + max/min z of its verts + max radial
 * distance from the axle (sqrt(y^2+z^2) — the wheel axle is the local
 * X axis) + longest edge. maxR/maxEdge drive the kart 7 wheel-fin
 * filter (fix133/135); the body filters use cz/maxVy, fix134 R4 uses
 * minVx, and fix135 R5 uses maxVx (any vertex outboard) and maxVz
 * (nose-tip long triangles) — see kart7DropTri. */
interface TriGeom { cx: number; cy: number; cz: number; maxVy: number; minVx: number; maxVx: number; maxVz: number; minVz: number; maxR: number; maxEdge: number; }

/** fix132 kart 7 绯焰: drop the spiky rear (245 of 1242 body tris,
 * verified against the baked data):
 *  R1 — the jumbled rear plates + vertical fins (anything behind z -0.40
 *  reaching above y 0.32; the flat rear deck at y 0.28 survives);
 *  R2 — the black nose-fin blade (the #101010 bucket's only geometry
 *  above y 0.55, at z 0.18..0.26);
 *  R3 — the front-corner spikes (past z 0.98, |x| > 0.30).
 * fix134 R4 — the vertical side plates at x = ±0.62 (z -0.35..-0.59,
 * y 0.02..0.40), which R1 misses because they are LOW (maxVy ≈ 0.28
 * < 0.32) and R2/R3 miss because they are not #101010 and not past
 * z 0.98. A plate triangle has ALL THREE verts outboard of ±0.58
 * (minVx > 0.58); the main body reaches only |x| ≈ 0.50, and the
 * front fairing panels that span out to 0.62 have a vert at lower
 * |x|, so they survive. Drops 59 more tris (304 total, 938 kept).
 * fix135 R5 (drive130 sixth re-run: spikes STILL jutting after R4 —
 * the R4 minVx test keeps any long triangle with ONE vert inboard,
 * so the front fairing panels R4 deliberately kept ARE the spikes):
 *  R5a — ANY vertex outboard of |x| 0.52 (the main body shell
 *  reaches only |x| ≈ 0.40; catches the front-corner flares
 *  body[2] ti 276-283 + body[3] ti 110/111/120/121, the rear side
 *  plates body[1] ti 116-121/150-153 + body[2] ti 132-134/234/
 *  295/296/301/302/306/307, the long side plates body[2] ti 141/
 *  143/145/226/229/235/237/243, the front wheel-well trim, and
 *  body[0]'s 30 small front-side tris at |x| 0.55);
 *  R5b — the nose-tip slivers (body[2] ti 258, body[3] ti 105/114:
 *  a vertex past z 1.00 on a LONG triangle, maxEdge > 0.4 — the
 *  pink nose spike; the small tip caps, maxEdge <= 0.17, survive).
 *  R5 drops 213 more tris: 517 total, 725 kept (body[0] 464,
 *  body[1] 105, body[2] 124, body[3] 32). The wedge nose + floor
 *  pan (long tris up to maxEdge 1.46) and the nose spine survive:
 *  they stay inboard of |x| 0.52 and short of z 1.00, except the
 *  three slivers R5b takes. Verified in a Python render before
 *  committing (fix135/kart7-r5final-zoom.png).
 * fix133: the shipped call site passed this to filterBucketTriangles
 * WITHOUT the negation, so the game kept ONLY these 245 spike tris
 * and dropped the other 997 body triangles — from the side/front the
 * kart was a skeleton (drive130 fourth re-run 49y-kart7-side/front.png)
 * and the "spikes" in the rear view WERE the kept body. The node test
 * always used the negated predicate, so the inversion was never caught.
 * The call site below now negates it. Exported for the node tests. */
export function kart7DropTri(hex: string, g: TriGeom): boolean {
    if (g.cz < -0.40 && g.maxVy > 0.32) { return true; }
    if (hex.toLowerCase() === '#101010' && g.maxVy > 0.55) { return true; }
    if (g.cz > 0.98 && Math.abs(g.cx) > 0.30) { return true; }
    if (g.minVx > 0.58) { return true; }
    if (g.maxVx > 0.52) { return true; }
    if (g.maxVz > 1.00 && g.maxEdge > 0.4) { return true; }
    return false;
}

/** fix133 kart 7 绯焰: the wheel buckets also carry long fins — the
 * Ben Harrison dragster's wheel fairings are baked into the tyre
 * buckets as long thin triangles sticking out past the tyre (up to
 * 1 m in z, tall black sails above the rear tyres). A fin triangle
 * is one whose verts leave the tyre envelope: radial distance from
 * the axle (sqrt(y^2+z^2), axle = local X) past the tyre radius
 * (~0.29 rear / 0.24 front), or a longest edge >= 0.45 m (a tyre
 * triangle's longest edge is < 0.4).
 * fix134: the 0.36 threshold missed the borderline fins — 14 thin
 * triangles with maxR 0.34..0.36 (wheelR#0a0a0a ×10, wheelR#303030
 * ×4, plus 1 maxEdge fin) that sit just outside the tyre surface
 * (tyre maxR ≤ 0.33, clean gap to 0.35) and read as a black sail
 * above the rear tyre in the side view (verified in a Python render
 * with the borderline tris highlighted). Tightened to 0.34: drops
 * 38 of 361 wheel tris (was 23).
 * fix135: the maxR-only test STILL missed the fins that run ALONG
 * the axle — e.g. wheelF[1] #0d0d0d ti=85 has a vertex at local
 * x -0.426 (world x -0.852 on the fr wheel: a spike jutting out
 * sideways). And the buckets are not tyres at all: only 17-57% of
 * their verts sit inside the tyre-ring envelope (radial r max 0.78
 * vs a 0.24 tyre). So this is now a full envelope clip, per axle:
 * a triangle is a fin iff ANY vertex leaves the tyre cylinder
 * (front: maxR > 0.26 or maxAx > 0.17; rear: maxR > 0.31 or
 * maxAx > 0.26) — the cylinder is convex, so a triangle with all
 * verts inside cannot stick out; the maxEdge clause stays as a
 * backstop. Drops 96 of 361 wheel tris (front 25, rear 71;
 * wheelF[2] drops entirely — a disc at |x| 0.22, r <= 0.12,
 * floating off the axle; wheelR[2] keeps all 19 — a proper rim).
 * NOTE: kart 7's wheels are now procedural (see mkWheel), so this
 * filter is currently unused in the game — kept as the documented
 * filter for the baked data, node-tested. Exported for the node tests. */
export function kart7WheelFinTri(g: TriGeom, rear: boolean): boolean {
    if (rear) { return g.maxR > 0.31 || g.maxVx > 0.26 || g.maxEdge >= 0.45; }
    return g.maxR > 0.26 || g.maxVx > 0.17 || g.maxEdge >= 0.45;
}

/** bytes -> base64 (inverse of b64ToBytes, same alphabet; used when a
 * bucket's index list is rebuilt by the triangle filters below). */
function bytesToB64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64_ALPHABET[a >> 2];
        out += B64_ALPHABET[((a & 3) << 4) | (b >> 4)];
        out += i + 1 < bytes.length ? B64_ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
        out += i + 2 < bytes.length ? B64_ALPHABET[c & 63] : '=';
    }
    return out;
}

/** Walk a bucket's triangles, calling fn(geom, i0, i1, i2) per triangle.
 * Positions are Int16 mm, indices Uint16 — same decoding as bucketMesh. */
function forEachTri(b: KartModelBucket, fn: (g: TriGeom, a: number, c: number, d: number) => void): void {
    const posB = b64ToBytes(b.pos);
    const idxB = b64ToBytes(b.idx);
    const comp = (vi: number, off: number): number => {
        let v = posB[vi * 6 + off] | (posB[vi * 6 + off + 1] << 8);
        if (v >= 32768) { v -= 65536; }
        return v / 1000;
    };
    const idxCount = Math.floor(idxB.length / 2);
    for (let t = 0; t + 2 < idxCount; t += 3) {
        const a = idxB[t * 2] | (idxB[t * 2 + 1] << 8);
        const c = idxB[t * 2 + 2] | (idxB[t * 2 + 3] << 8);
        const d = idxB[t * 2 + 4] | (idxB[t * 2 + 5] << 8);
        const x0 = comp(a, 0), y0 = comp(a, 2), z0 = comp(a, 4);
        const x1 = comp(c, 0), y1 = comp(c, 2), z1 = comp(c, 4);
        const x2 = comp(d, 0), y2 = comp(d, 2), z2 = comp(d, 4);
        const edge = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number => {
            const dx = ax - bx, dy = ay - by, dz = az - bz;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        };
        fn({
            cx: (x0 + x1 + x2) / 3, cy: (y0 + y1 + y2) / 3, cz: (z0 + z1 + z2) / 3,
            maxVy: Math.max(y0, y1, y2),
            minVx: Math.min(Math.abs(x0), Math.abs(x1), Math.abs(x2)),
            maxVx: Math.max(Math.abs(x0), Math.abs(x1), Math.abs(x2)),
            maxVz: Math.max(z0, z1, z2), minVz: Math.min(z0, z1, z2),
            maxR: Math.max(Math.sqrt(y0 * y0 + z0 * z0), Math.sqrt(y1 * y1 + z1 * z1), Math.sqrt(y2 * y2 + z2 * z2)),
            maxEdge: Math.max(edge(x0, y0, z0, x1, y1, z1), edge(x1, y1, z1, x2, y2, z2), edge(x2, y2, z2, x0, y0, z0)),
        }, a, c, d);
    }
}

/** Encode a kept index list back to base64 (Uint16 little-endian). */
function encodeIdx(idxs: number[]): string {
    const bytes = new Uint8Array(idxs.length * 2);
    for (let i = 0; i < idxs.length; i++) {
        bytes[i * 2] = idxs[i] & 0xff;
        bytes[i * 2 + 1] = (idxs[i] >> 8) & 0xff;
    }
    return bytesToB64(bytes);
}

/** Rebuild a bucket keeping only triangles where keep() is true.
 * Positions/normals are unchanged (unreferenced verts are harmless);
 * n becomes the kept triangle count. Returns null when nothing is kept.
 * The new idx length changes the bucketMesh cache key, so the filtered
 * mesh never collides with the unfiltered one. Exported for the node
 * tests (they verify the base64 round-trip without an engine). */
export function filterBucketTriangles(b: KartModelBucket, keep: (g: TriGeom) => boolean): KartModelBucket | null {
    const kept: number[] = [];
    forEachTri(b, (g, a, c, d) => { if (keep(g)) { kept.push(a, c, d); } });
    if (kept.length === 0) { return null; }
    return { role: b.role, hex: b.hex, pos: b.pos, nor: b.nor, idx: encodeIdx(kept), n: kept.length / 3 };
}

/** Split a bucket's triangles into two buckets by a predicate (true =
 * the split-out part). The kept bucket keeps the original role/hex; the
 * split bucket is returned with role 'paint' so the caller can shade it
 * as bodywork. Returns [kept, split | null]. Exported for the node
 * tests. */
export function splitBucketTriangles(b: KartModelBucket, split: (g: TriGeom) => boolean): [KartModelBucket, KartModelBucket | null] {
    const kept: number[] = [];
    const out: number[] = [];
    forEachTri(b, (g, a, c, d) => { (split(g) ? out : kept).push(a, c, d); });
    const keptB: KartModelBucket = { role: b.role, hex: b.hex, pos: b.pos, nor: b.nor, idx: encodeIdx(kept), n: kept.length / 3 };
    const splitB: KartModelBucket | null = out.length === 0 ? null
        : { role: 'paint', hex: b.hex, pos: b.pos, nor: b.nor, idx: encodeIdx(out), n: out.length / 3 };
    return [keptB, splitB];
}

/** Vertex count of a baked bucket (pos = base64 of 6 bytes per vertex). */
function bucketVerts(b: KartModelBucket): number {
    return Math.floor(b.pos.replace(/=+$/, '').length * 3 / 4 / 6);
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

// ---- procedural driver (all 8 karts; round 7) ----
// Big glossy helmet in the kart accent colour (white when the accent
// is too dark to read — karts 2/3 and dark paint schemes), dark slate
// suit, arms down to the steering wheel. Round 7: the suit is dark
// slate again (0x35383f) — the fix134 medium slate (0x6b7280) read as
// a grey blob against the bright PopKart bodies in the Python renders,
// and the seat back is now body-coloured, so the dark torso pops
// against it instead of merging. The helmet is bigger than the torso
// (r 0.17 vs 0.12) — the cute PopKart proportion. The steering wheel
// is a full torus tilted 30 deg from vertical, on a short column.
function buildDriver(body: Node, seat: number[], steer: number[], accent: number): void {
    const sx = seat[0], sy = seat[1], sz = seat[2];
    const tx = steer[0], ty = steer[1], tz = steer[2];
    const suitHex = 0x35383f;
    const suitMat = MeshBuilder.unlitMaterial(suitHex);
    // torso + gloves: one merged unlit mesh (the suit reads flat; the
    // glossy part is the helmet, built separately). The visor is a
    // separate dark node (it must contrast with the helmet, not the suit).
    const db = new MeshBuilder();
    db.addCylinder(suitHex, new Vec3(sx, sy + 0.15, sz), 0, 0.12, 0.14, 0.24); // torso
    db.addSphere(suitHex, new Vec3(tx - 0.12, ty, tz), 0, 0.05, 0.05, 0.05); // glove L
    db.addSphere(suitHex, new Vec3(tx + 0.12, ty, tz), 0, 0.05, 0.05, 0.05); // glove R
    db.build(body);
    // glossy helmet in the kart accent colour
    const helmetHex = driverColor(accent);
    const helmPrim = primitives.sphere(0.17, { segments: 12 });
    const helmMesh = utils.MeshUtils.createMesh({
        positions: helmPrim.positions, normals: helmPrim.normals,
        uvs: helmPrim.uvs, indices: helmPrim.indices,
        minPos: new Vec3(-0.17, -0.17, -0.17),
        maxPos: new Vec3(0.17, 0.17, 0.17),
    });
    const helm = addMeshNode(body, 'helmet', helmMesh, standardMaterial(helmetHex, 0.15, 0.08));
    helm.setPosition(sx, sy + 0.42, sz + 0.02);
    // dark visor: a flat box on the helmet's front face, just proud of
    // the sphere at the centre (front face z +0.195 vs sphere +0.19)
    primNode(body, 'visor',
        primitives.box({ width: 0.20, height: 0.09, length: 0.04 }),
        MeshBuilder.unlitMaterial(0x1a1d24), sx, sy + 0.42, sz + 0.175);
    // steering wheel: full torus tilted 30 deg from vertical + column
    // down to the tub (column top meets the wheel hub, bottom embeds
    // in the cockpit tub)
    const darkMat = standardMaterial(0x1a1d24, 0.15, 0.35);
    primNode(body, 'steer_wheel',
        primitives.torus(0.11, 0.018, { radialSegments: 12, tubularSegments: 12 }),
        darkMat, tx, ty, tz, 60, 0, 0);
    primNode(body, 'steer_column',
        primitives.cylinder(0.025, 0.025, 0.16, { radialSegments: 8 }),
        darkMat, 0, 0.41, 0.13, 45, 0, 0);
    // arms: thin cylinders aimed shoulder -> glove (Euler YXZ: pitch =
    // acos(dy/len), yaw = atan2(dx, dz); see Quat.fromEuler order)
    for (const side of [-1, 1]) {
        const gx = tx + side * 0.12;
        const shx = sx + side * 0.14, shy = sy + 0.30, shz = sz;
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

// ---- procedural rim disc + hub (karts whose baked wheels have no
// readable rim — the tire alone reads as a black blob at race distance) ----
const _rimMeshes = new Map<string, any>();

/** Flat disc (cylinder axis Y) — rotated 90 deg about Z at the wheel so
 * its axis lies along the axle. Radius ~0.62x the tire radius, so it
 * reads as a rim inset in the tire; height 0.30 spans the tire sidewall. */
function rimDiscMesh(radius: number, height: number): any {
    const key = radius.toFixed(3) + '/' + height.toFixed(3);
    let m = _rimMeshes.get(key);
    if (!m) {
        const prim = primitives.cylinder(radius, radius, height, { radialSegments: 16 });
        m = utils.MeshUtils.createMesh({
            positions: prim.positions, normals: prim.normals, uvs: prim.uvs,
            indices: prim.indices,
            minPos: new Vec3(-radius, -height / 2, -radius),
            maxPos: new Vec3(radius, height / 2, radius),
        });
        _rimMeshes.set(key, m);
    }
    return m;
}

/** One procedural part from a cc primitive (box / cylinder / sphere):
 * builds the mesh with exact bounds (bounds follow the node scale, so
 * scaled parts still cull correctly) and adds it as a child node.
 * Rotation is in degrees (Euler); scale is applied to the node. Used by
 * the procedural bodywork (kart 3 panels, kart 7 wing, kart 5 buggy)
 * and the brake lights. */
function primNode(parent: Node, name: string, prim: any, mat: Material, x: number, y: number, z: number, rx: number = 0, ry: number = 0, rz: number = 0, sx: number = 1, sy: number = 1, sz: number = 1): Node {
    const p = prim.positions as number[];
    let minX = 1e9, minY = 1e9, minZ = 1e9;
    let maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    for (let i = 0; i < p.length; i += 3) {
        if (p[i] < minX) { minX = p[i]; }
        if (p[i] > maxX) { maxX = p[i]; }
        if (p[i + 1] < minY) { minY = p[i + 1]; }
        if (p[i + 1] > maxY) { maxY = p[i + 1]; }
        if (p[i + 2] < minZ) { minZ = p[i + 2]; }
        if (p[i + 2] > maxZ) { maxZ = p[i + 2]; }
    }
    const mesh = utils.MeshUtils.createMesh({
        positions: prim.positions, normals: prim.normals, uvs: prim.uvs,
        indices: prim.indices,
        minPos: new Vec3(minX * sx, minY * sy, minZ * sz),
        maxPos: new Vec3(maxX * sx, maxY * sy, maxZ * sz),
    });
    const n = addMeshNode(parent, name, mesh, mat);
    n.setPosition(x, y, z);
    if (rx !== 0 || ry !== 0 || rz !== 0) { n.setRotationFromEuler(rx, ry, rz); }
    if (sx !== 1 || sy !== 1 || sz !== 1) { n.setScale(sx, sy, sz); }
    return n;
}

/** Round-7 PopKart body — ONE construction for all 8 karts, built
 * from primitives. Verified rear/side/front in Python (render7.py)
 * before coding. Parts (metres, forward +Z, ground y 0):
 *  floor pan + dark lower skirt, nose (round sphere / point cone /
 *  flat box per style), sloped hood, cockpit tub, long side pods with
 *  an accent stripe, rear deck + quarter panels, paint-colour seat +
 *  backrest, spoiler per style (low / tall / wide wing on dark struts
 *  + endplates, or a centre fin + stabiliser), twin dark exhausts
 *  with glowing tips, unlit headlights half-embedded in the nose,
 *  dark front bumper bar, white number plate, unlit red tail-light
 *  bar ('brake_light'). NO fender arches: the torus hoops read as
 *  roll bars in every view (tried x2.0 and x3.0 bands) — classic
 *  KartRider runs exposed wheels at the body corners, and the wide
 *  body + long pods wrap the wheels instead. All paint parts use the
 *  kart/paint colour, so paints recolour the whole body. */
function buildPopKartBody(body: Node, ki: number, colour: number, accent: number): void {
    const style = POPKART_STYLE[ki] || POPKART_STYLE[0];
    const paint = standardMaterial(colour, 0.15, 0.08, dimHex(colour, 0.15)); // fix133 emissive floor
    const dark = standardMaterial(0x1a1d24, 0.15, 0.35);
    const accentMat = standardMaterial(driverColor(accent), 0.15, 0.08, dimHex(driverColor(accent), 0.15));
    const lamp = MeshBuilder.unlitMaterial(0xfff2b0);
    const tail = MeshBuilder.unlitMaterial(0xff2a2a);
    const tip = MeshBuilder.unlitMaterial(0xff9d00);
    const plate = MeshBuilder.unlitMaterial(0xf5f5f5);
    const box = (name: string, mat: Material, cx: number, cy: number, cz: number, w: number, h: number, d: number, rx: number = 0): void => {
        primNode(body, name, primitives.box({ width: w, height: h, length: d }), mat, cx, cy, cz, rx, 0, 0);
    };
    // floor pan + dark lower skirt
    box('body_paint_floor', paint, 0, 0.24, -0.02, 1.00, 0.10, 1.72);
    box('body_detail_skirt', dark, 0, 0.14, -0.02, 0.88, 0.12, 1.60);
    // nose by style; headlights sit half-embedded in its front face
    let lightZ = 1.05;
    if (style.nose === 'round') {
        primNode(body, 'body_paint_nose', primitives.sphere(1, { segments: 12 }),
            paint, 0, 0.32, 0.80, 0, 0, 0, 0.56, 0.22, 0.30);
        lightZ = 1.05;
    } else if (style.nose === 'point') {
        // cone apex +Y; rx 90 tips it forward (+Z)
        primNode(body, 'body_paint_nose',
            primitives.cylinder(0, 0.34, 0.55, { radialSegments: 12 }),
            paint, 0, 0.32, 0.80, 90, 0, 0);
        lightZ = 0.72;
    } else {
        box('body_paint_nose', paint, 0, 0.32, 0.90, 0.66, 0.24, 0.30);
        lightZ = 1.04;
    }
    // sloped hood + cockpit tub
    box('body_paint_hood', paint, 0, 0.34, 0.52, 0.70, 0.08, 0.62, 14);
    box('body_paint_tub', paint, 0, 0.32, -0.22, 0.80, 0.20, 0.80);
    // long side pods (wrap the wheels) + accent stripe on the outer face
    for (const side of [-1, 1]) {
        box('body_paint_pod', paint, side * 0.50, 0.28, 0.02, 0.24 * style.pod, 0.16, 1.55);
        box('body_detail_stripe', accentMat, side * (0.505 + 0.12 * style.pod), 0.28, 0.02, 0.02, 0.05, 1.30);
    }
    // rear deck + quarter panels (join the deck to the rear wheels)
    box('body_paint_deck', paint, 0, 0.36, -0.72, 0.84, 0.10, 0.34);
    for (const side of [-1, 1]) {
        box('body_paint_quarter', paint, side * 0.50, 0.32, -0.92, 0.14, 0.14, 0.28);
    }
    // seat + backrest in the body colour, so the dark driver pops
    box('body_paint_seat', paint, 0, 0.36, -0.28, 0.42, 0.10, 0.30);
    box('body_paint_seatback', paint, 0, 0.50, -0.44, 0.42, 0.34, 0.08, -12);
    // spoiler by style
    if (style.spoiler === 'low' || style.spoiler === 'tall' || style.spoiler === 'wide') {
        const wingY = style.spoiler === 'tall' ? 0.82 : 0.64;
        const wingW = style.spoiler === 'wide' ? 0.92 : 0.66;
        const wingD = style.spoiler === 'wide' ? 0.24 : 0.22;
        const strutX = style.spoiler === 'wide' ? 0.28 : 0.20;
        const endX = style.spoiler === 'wide' ? 0.46 : 0.33;
        const strutH = wingY - 0.41;
        box('body_paint_wing', paint, 0, wingY, -0.86, wingW, 0.04, wingD);
        for (const side of [-1, 1]) {
            box('body_detail_strut', dark, side * strutX, 0.41 + strutH / 2, -0.86, 0.04, strutH, 0.04);
            box('body_detail_endplate', dark, side * endX, wingY, -0.86, 0.03, style.spoiler === 'tall' ? 0.20 : 0.14, wingD);
        }
    } else {
        // fin: vertical centre fin + small top stabiliser
        box('body_paint_fin', paint, 0, 0.56, -0.70, 0.04, 0.34, 0.55);
        box('body_paint_finstab', paint, 0, 0.72, -0.80, 0.30, 0.03, 0.18);
    }
    // twin exhausts + glowing tips, headlights, bumper, plate, tail light
    for (const side of [-1, 1]) {
        primNode(body, 'body_detail_exhaust',
            primitives.cylinder(0.045, 0.045, 0.20, { radialSegments: 10 }),
            dark, side * 0.22, 0.28, -0.90, 90, 0, 0);
        primNode(body, 'body_detail_exhaust_tip',
            primitives.cylinder(0.035, 0.035, 0.02, { radialSegments: 10 }),
            tip, side * 0.22, 0.28, -1.00, 90, 0, 0);
        primNode(body, 'body_detail_headlight',
            primitives.sphere(0.05, { segments: 10 }),
            lamp, side * 0.22, 0.34, lightZ);
    }
    box('body_detail_bumper', dark, 0, 0.18, 1.00, 0.56, 0.07, 0.06);
    box('body_detail_plate', plate, 0, 0.32, -0.895, 0.30, 0.14, 0.02);
    box('brake_light', tail, 0, 0.32, -0.91, 0.26, 0.05, 0.02);
}

/** Build one kart from its roster entry — round-7 PopKart
 * construction. `paint` (when given) overrides the body colour with
 * an unlocked paint scheme — same model, new look. */
export function buildKartModel(stats: DriverStats, paint?: PaintScheme | null): KartModel {
    const colour = paint ? paint.color : stats.color;
    const accent = paint ? paint.accent : stats.accent;
    const ki = Math.max(0, ROSTER.findIndex((d) => d.name === stats.name));
    const root = new Node('kart');
    root.layer = Layers.Enum.DEFAULT;

    const body = new Node('body');
    body.layer = Layers.Enum.DEFAULT;
    body.setParent(root);

    // round-7 procedural PopKart body (no baked meshes any more)
    buildPopKartBody(body, ki, colour, accent);

    // driver (all 8 karts; the old baked built-in driver for kart 2 is gone)
    buildDriver(body, POPKART_SEAT, POPKART_STEER, accent);

    // soft blob shadow: smaller + lighter than the old 1.25/0.85 discs,
    // which read as a huge oil slick on the road
    const shadowOuter = addMeshNode(root, 'shadowOuter', shadowMesh(1.0), MeshBuilder.unlitMaterial(0x2a2d33));
    shadowOuter.setPosition(0, 0.04, 0);
    const shadowInner = addMeshNode(root, 'shadowInner', shadowMesh(0.65), MeshBuilder.unlitMaterial(0x1a1d24));
    shadowInner.setPosition(0, 0.05, 0);

    // wheels: steer pivots in front, plain spinners behind. All four
    // wheels are procedural now (the round-5 kart-7 pattern
    // generalised): a full dark tyre cylinder (radius == centre
    // height, so it touches the road; rear tyres wider) + a silver
    // rim disc on the outer face + a dark hub. The spin node still
    // spins/steers them, and the collision footprint uses the
    // standardised wheel centres, so gameplay is untouched.
    const mkWheel = (parent: Node, name: string, center: number[], rear: boolean): Node => {
        const pivot = new Node(name);
        pivot.layer = Layers.Enum.DEFAULT;
        pivot.setPosition(center[0], center[1], center[2]);
        pivot.setParent(parent);
        const spin = new Node(name + '_spin');
        spin.layer = Layers.Enum.DEFAULT;
        spin.setParent(pivot);
        const tyreR = center[1];
        const tyreW = rear ? 0.32 : 0.24;
        const tyre = addMeshNode(spin, 'tyre', rimDiscMesh(tyreR, tyreW), standardMaterial(0x1a1a1a, 0.0, 0.95));
        tyre.setRotationFromEuler(0, 0, 90);
        const out = center[0] > 0 ? 1 : -1;
        const rimR = 0.60 * tyreR;
        // rim/hub sit 0.01 proud of the tyre face — exactly flush would
        // z-fight with the tyre's flat cap.
        const rim = addMeshNode(spin, 'rim', rimDiscMesh(rimR, 0.06), standardMaterial(0xd7dae0, 0.45, 0.20));
        rim.setRotationFromEuler(0, 0, 90);
        rim.setPosition(out * (tyreW / 2 - 0.02), 0, 0);
        const hub = addMeshNode(spin, 'hub', rimDiscMesh(rimR * 0.45, 0.08), standardMaterial(0x2a2d33, 0.4, 0.35));
        hub.setRotationFromEuler(0, 0, 90);
        hub.setPosition(out * (tyreW / 2 - 0.02), 0, 0);
        return pivot;
    };
    const steerFL = mkWheel(root, 'wheelFL', POPKART_WHEEL_FL, false);
    const steerFR = mkWheel(root, 'wheelFR', POPKART_WHEEL_FR, false);
    const wheelRL = mkWheel(root, 'wheelRL', POPKART_WHEEL_RL, true);
    const wheelRR = mkWheel(root, 'wheelRR', POPKART_WHEEL_RR, true);
    const wheelFL = steerFL.children[0];
    const wheelFR = steerFR.children[0];

    return {
        root, steerFL, steerFR,
        wheelFL, wheelFR, wheelRL: wheelRL.children[0], wheelRR: wheelRR.children[0],
        body,
    };
}
