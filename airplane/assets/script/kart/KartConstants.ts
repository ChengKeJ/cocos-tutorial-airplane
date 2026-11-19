/**
 * Kart tuning + roster for the Star Fighter hall kart game （飞车狂飙）.
 *
 * Numbers are taken from the Three.js kart design spec (MIT-licensed
 * reference implementation): BASE_TOP_SPEED 30 m/s, drift
 * tiers / boost tables, position-based item odds, roster stat multipliers.
 * The roster names, colours and all UI text are OUR OWN (divergence pass):
 * never ship the reference game's names or identity.
 *
 * The physics here is an arcade spline model, not the original's
 * raycast-suspension model: a kart's state is (s = metres along the
 * centreline, d = lateral offset, heading = yaw vs the tangent, speed).
 * That keeps the phone build robust while preserving the feel numbers
 * that matter (top speed, drift tiers, item odds).
 */

export class KartConstants {
    public static readonly LAP_COUNT = 3;
    public static readonly RACER_COUNT = 8;
    public static readonly CHECKPOINTS = 32;

    // --- speed / accel (spec: BASE_TOP_SPEED 30, MAX_DRIVE 3000N) ---
    /** Top speed on clean road, m/s. Multiplied by each driver's topSpeedMul. */
    public static readonly BASE_TOP_SPEED = 30;
    /** Full-throttle acceleration, m/s^2 (x accelMul). Reaches 30 in ~2.2s. */
    public static readonly ACCEL_RATE = 14;
    /** Braking deceleration, m/s^2 (spec A_BRAKE 11.5 for AI; player brake is stronger). */
    public static readonly BRAKE_DECEL = 18;
    /** Fastest reverse, m/s (spec MAX_REVERSE 8; arcade cap is lower). */
    public static readonly REVERSE_MAX = 5;
    /** Rolling + aero drag, m/s^2, applied when coasting above target speed. */
    public static readonly COAST_DECEL = 8;
    /** Off-road top-speed multiplier (spec: dirt/sand surfaces). */
    public static readonly OFFROAD_TOP_MUL = 0.45;
    /** Extra drag while off-road, m/s^2. */
    public static readonly OFFROAD_DRAG = 6;
    /** Boost-pad multiplier + duration (spec BOOST_PADS). */
    public static readonly PAD_BOOST_MUL = 1.3;
    public static readonly PAD_BOOST_TIME = 0.8;

    // --- steering (spec: MAX_STEER 0.55, STEER_RATE_LOW 10.5 / HIGH 5.6) ---
    /** Max yaw of the kart vs the track tangent, radians. */
    public static readonly MAX_STEER_ANGLE = 0.55;
    /** Yaw rate at low speed, rad/s (tight corners at low speed). */
    public static readonly TURN_RATE_LOW = 1.9;
    /** Yaw rate at top speed, rad/s. */
    public static readonly TURN_RATE_HIGH = 0.9;
    /** How fast the steer input itself moves, low speed (spec STEER_RATE_LOW). */
    public static readonly STEER_RATE_LOW = 10.5;
    /** How fast the steer input itself moves, top speed (spec STEER_RATE_HIGH). */
    public static readonly STEER_RATE_HIGH = 5.6;

    // --- drift / mini-turbo (spec: DRIFT_TIERS, DRIFT_BOOST_TIME/STRENGTH) ---
    /** Steer magnitude needed to engage a drift (spec DRIFT_ENGAGE_STEER). */
    public static readonly DRIFT_ENGAGE_STEER = 0.13;
    /** Minimum speed to drift, m/s. */
    public static readonly DRIFT_MIN_SPEED = 12;
    /** Drift charge thresholds, seconds -> tier 1/2/3 (spec DRIFT_TIERS). */
    public static readonly DRIFT_TIERS = [0.55, 0.95, 1.9];
    /** Mini-turbo duration per tier, seconds (spec DRIFT_BOOST_TIME). */
    public static readonly DRIFT_BOOST_TIME = [0, 0.95, 1.8, 3.0];
    /** Mini-turbo speed multiplier per tier (spec DRIFT_BOOST_STRENGTH). */
    public static readonly DRIFT_BOOST_STRENGTH = [1, 1.12, 1.25, 1.36];
    /** Drift yaw the kart is pulled toward, radians (spec DRIFT_MAX_YAW 26 deg). */
    public static readonly DRIFT_MAX_YAW = 0.454;
    /** Speed kept while drifting (spec DRIFT_SPEED_FACTOR 0.88). */
    public static readonly DRIFT_SPEED_FACTOR = 0.88;
    /** Drift can be held at most this long before it auto-releases (spec AI DRIFT_MAX_HOLD). */
    public static readonly DRIFT_MAX_HOLD = 4.5;

    // --- items (spec: Items.ts odds table, [front, mid, back] bands) ---
    public static readonly ITEM_ODDS: { [kind: number]: number[] } = {
        1: [10, 26, 16], // 蘑菇
        2: [0, 10, 21],  // 三连蘑菇
        3: [33, 19, 6],  // 绿龟壳
        4: [4, 21, 17],  // 红龟壳
        5: [38, 13, 4],  // 香蕉皮
        6: [0, 4, 17],   // 无敌星
    };
    public static readonly ITEM_MUSHROOM_BOOST = 1.3;
    public static readonly ITEM_MUSHROOM_TIME = 1.2;
    public static readonly ITEM_STAR_TIME = 8;
    public static readonly ITEM_STAR_MUL = 1.15;
    public static readonly ITEM_SPIN_TIME = 2;
    /** Shell speeds (spec Projectiles.ts GREEN_SPEED 33 / RED_SPEED 37). */
    public static readonly ITEM_GREEN_SHELL_SPEED = 33;
    public static readonly ITEM_RED_SHELL_SPEED = 37;
    public static readonly ITEM_BOX_RESPAWN = 5;
    /** Seconds the roulette spins before the item can be spent (spec ARM_TIME 1.05). */
    public static readonly ITEM_ARM_TIME = 1.05;
    /** Shell lifetime + wall bounces before it fizzles. */
    public static readonly ITEM_SHELL_LIFE = 8;
    public static readonly ITEM_SHELL_MAX = 8;
    /** Banana lifetime + max on track at once (oldest recycled). */
    public static readonly ITEM_BANANA_LIFE = 30;
    public static readonly ITEM_BANANA_MAX = 12;
    /** Spin-out from a star knock-aside (spec Items.ts 1.25). */
    public static readonly ITEM_STAR_SPIN = 1.25;

    // --- AI rubber band (spec AI.ts AIField: ASSIST_CATCHUP 0.85 / LEASH 0.6) ---
    /** Peak catch-up accel, m/s^2; leash decel for a clear leader. */
    public static readonly AI_CATCHUP = 0.85;
    public static readonly AI_LEASH = 0.6;

    // --- race flow (spec: Race.ts COUNTDOWN 4.4, OOB 1.5, STUCK 4.5) ---
    /** Countdown beats: 3, 2, 1, GO — seconds per beat after a 0.4s lead-in. */
    public static readonly COUNTDOWN_LEAD = 0.4;
    public static readonly COUNTDOWN_BEAT = 0.8;
    /** Seconds the green GO! + all-green lights stay up before the race starts. */
    public static readonly GO_HOLD = 0.7;
    /** Seconds fully off-track before respawn. */
    public static readonly OOB_LIMIT = 1.5;
    /** Seconds after the player finishes before results settle. */
    public static readonly RESULTS_DELAY = 6;

    // --- track constants (spec: TrackLayout.ts) ---
    public static readonly STATION_DS = 0.5;
    public static readonly KART_HALF_WIDTH = 0.86;
}

export interface DriverStats {
    name: string;
    color: number; // 0xRRGGBB body colour
    dark: number;  // darker shade for the nose / spoiler
    accelMul: number;
    topSpeedMul: number;
    weightMul: number;
    handlingMul: number;
    /** One-line personality tag, shown in the kart select screen. */
    tagline: string;
    /** Accent colour: deck stripe + helmet. */
    accent: number;
    /** Spoiler style: low / tall / wide / fin (procedural shape variant). */
    spoiler: 'low' | 'tall' | 'wide' | 'fin';
    /** Nose shape: point / flat / round (procedural shape variant). */
    nose: 'point' | 'flat' | 'round';
    /** Side-pod size multiplier (0.85..1.2). */
    pod: number;
    /** Visible 1..5 stats — filled by the derivation loop below from the
     * physics multipliers, so the select screen can never disagree with
     * how the kart actually drives. Placeholders here, never hand-edited. */
    speed: number;
    accel: number;
    drift: number;
    /** Drift charge rate, derived from the drift stat (0.90..1.10). */
    driftMul: number;
}

/**
 * Our own roster — stat multipliers follow the spec's roster, names and
 * colours are original Chinese driver names. Player is index 0 （凌风）.
 * The visible 1..5 stats are derived from these multipliers (see below):
 * no kart strictly dominates another on all three stats, and the
 * physics envelope is unchanged (top speed 0.93..1.08, accel/handling
 * 0.92..1.12), so track-1 balance stays close to drive119/122.
 */
export const ROSTER: DriverStats[] = [
    { name: '凌风', color: 0xff3b5c, dark: 0xc22540, accelMul: 1.00, topSpeedMul: 1.00, weightMul: 1.0, handlingMul: 1.00, tagline: '风一样快', accent: 0xffffff, spoiler: 'tall', nose: 'point', pod: 1.0, speed: 0, accel: 0, drift: 0, driftMul: 1 },
    { name: '海蓝', color: 0x2ea8ff, dark: 0x1d7cc9, accelMul: 0.92, topSpeedMul: 1.08, weightMul: 1.2, handlingMul: 0.97, tagline: '深海里的直线王', accent: 0x7ee8fa, spoiler: 'wide', nose: 'flat', pod: 1.15, speed: 0, accel: 0, drift: 0, driftMul: 1 },
    { name: '闪电', color: 0xffd23f, dark: 0xd9a91e, accelMul: 1.12, topSpeedMul: 0.93, weightMul: 0.82, handlingMul: 1.07, tagline: '起步就甩开所有人', accent: 0x1a1a20, spoiler: 'fin', nose: 'point', pod: 0.85, speed: 0, accel: 0, drift: 0, driftMul: 1 },
    { name: '青竹', color: 0x4ade5a, dark: 0x2fae3e, accelMul: 1.02, topSpeedMul: 0.97, weightMul: 0.95, handlingMul: 1.12, tagline: '竹林里练出的过弯', accent: 0x1a1a20, spoiler: 'low', nose: 'round', pod: 1.0, speed: 0, accel: 0, drift: 0, driftMul: 1 },
    { name: '紫曜', color: 0x8b5cf6, dark: 0x6a3fd1, accelMul: 0.95, topSpeedMul: 1.05, weightMul: 1.1, handlingMul: 1.02, tagline: '夜里最亮的那道光', accent: 0xffd23f, spoiler: 'tall', nose: 'flat', pod: 1.1, speed: 0, accel: 0, drift: 0, driftMul: 1 },
    { name: '橙光', color: 0xff8a3d, dark: 0xd9661a, accelMul: 1.05, topSpeedMul: 1.00, weightMul: 0.9, handlingMul: 0.92, tagline: '暖阳下从不减速', accent: 0x2ea8ff, spoiler: 'wide', nose: 'round', pod: 1.2, speed: 0, accel: 0, drift: 0, driftMul: 1 },
    { name: '雪驰', color: 0x7ee8fa, dark: 0x4cb8cc, accelMul: 0.92, topSpeedMul: 1.05, weightMul: 1.0, handlingMul: 1.07, tagline: '雪地里也能稳稳漂移', accent: 0xff3b5c, spoiler: 'fin', nose: 'flat', pod: 0.9, speed: 0, accel: 0, drift: 0, driftMul: 1 },
    { name: '绯焰', color: 0xe8456b, dark: 0xb92a4e, accelMul: 1.08, topSpeedMul: 0.95, weightMul: 0.88, handlingMul: 1.07, tagline: '火焰般的冲刺', accent: 0xffd23f, spoiler: 'low', nose: 'point', pod: 1.05, speed: 0, accel: 0, drift: 0, driftMul: 1 },
];

/** Map a physics multiplier to a visible 1..5 stat (linear, rounded). */
function stat5(mul: number, lo: number, hi: number): number {
    const v = 1 + Math.round((mul - lo) / (hi - lo) * 4);
    return Math.max(1, Math.min(5, v));
}

// Fill the visible stats from the physics multipliers (single source of
// truth). Resulting triples — 凌风 (3,3,3), 海蓝 (5,1,2), 闪电 (1,5,4),
// 青竹 (2,3,5), 紫曜 (4,2,3), 橙光 (3,4,1), 雪驰 (4,1,4), 绯焰 (2,4,4) —
// no kart dominates another on all three.
for (const d of ROSTER) {
    d.speed = stat5(d.topSpeedMul, 0.93, 1.08);
    d.accel = stat5(d.accelMul, 0.92, 1.12);
    d.drift = stat5(d.handlingMul, 0.92, 1.12);
    d.driftMul = 0.90 + (d.drift - 1) * 0.05;
}

// ---- Phase 2 step 3: progression (coins + unlockable paints) ----
// All local: coins are earned by finishing races, paints are cosmetic
// colour swaps only. Karts and tracks are never gated — progression
// only adds looks, never locks existing content.

/** Coins for finishing P1..P8 (index = position - 1). */
export const REWARD_BY_POSITION = [100, 80, 65, 50, 40, 30, 20, 10];
/** Bonus coins for a new personal best on that track + mode. */
export const REWARD_NEW_BEST = 50;

/** One paint scheme: a procedural colour swap of body / dark / accent.
 * Index 0 of each kart's list is the default ("经典", free, always owned). */
export interface PaintScheme {
    name: string;
    color: number;
    dark: number;
    accent: number;
    /** Coins to unlock (0 = free / always owned). */
    price: number;
}

/** 3 paints per kart: default + 2 unlockables (150 / 300 coins).
 * All original colour swaps — no copied designs. */
export const PAINTS: PaintScheme[][] = [
    [ // 凌风 (base red)
        { name: '经典', color: 0xff3b5c, dark: 0xc22540, accent: 0xffffff, price: 0 },
        { name: '晨曦金', color: 0xffb020, dark: 0xc07f00, accent: 0x1a1a20, price: 150 },
        { name: '午夜黑', color: 0x2b2b33, dark: 0x14141a, accent: 0xff3b5c, price: 300 },
    ],
    [ // 海蓝 (base blue)
        { name: '经典', color: 0x2ea8ff, dark: 0x1d7cc9, accent: 0x7ee8fa, price: 0 },
        { name: '珊瑚橙', color: 0xff7a5c, dark: 0xd94f2e, accent: 0xffffff, price: 150 },
        { name: '极光绿', color: 0x2ee6a8, dark: 0x1aa87e, accent: 0x1a1a20, price: 300 },
    ],
    [ // 闪电 (base yellow)
        { name: '经典', color: 0xffd23f, dark: 0xd9a91e, accent: 0x1a1a20, price: 0 },
        { name: '烈焰红', color: 0xff4a3d, dark: 0xc22e22, accent: 0xffd23f, price: 150 },
        { name: '幻影紫', color: 0x9b5cf6, dark: 0x6a3fd1, accent: 0xffffff, price: 300 },
    ],
    [ // 青竹 (base green)
        { name: '经典', color: 0x4ade5a, dark: 0x2fae3e, accent: 0x1a1a20, price: 0 },
        { name: '翠玉青', color: 0x2ee6c8, dark: 0x1aa88f, accent: 0xffffff, price: 150 },
        { name: '落樱粉', color: 0xff9ec7, dark: 0xd96a9e, accent: 0x1a1a20, price: 300 },
    ],
    [ // 紫曜 (base purple)
        { name: '经典', color: 0x8b5cf6, dark: 0x6a3fd1, accent: 0xffd23f, price: 0 },
        { name: '星云蓝', color: 0x3d7bff, dark: 0x2a56c2, accent: 0x7ee8fa, price: 150 },
        { name: '熔岩红', color: 0xff5a3d, dark: 0xc23a22, accent: 0xffd23f, price: 300 },
    ],
    [ // 橙光 (base orange)
        { name: '经典', color: 0xff8a3d, dark: 0xd9661a, accent: 0x2ea8ff, price: 0 },
        { name: '薄荷绿', color: 0x4ade9e, dark: 0x2fae6e, accent: 0x1a1a20, price: 150 },
        { name: '曜石灰', color: 0x8a94a6, dark: 0x5f6878, accent: 0xff8a3d, price: 300 },
    ],
    [ // 雪驰 (base light blue)
        { name: '经典', color: 0x7ee8fa, dark: 0x4cb8cc, accent: 0xff3b5c, price: 0 },
        { name: '樱花粉', color: 0xffb3d9, dark: 0xd986b3, accent: 0xff3b5c, price: 150 },
        { name: '深海蓝', color: 0x1d5fd6, dark: 0x144aab, accent: 0x7ee8fa, price: 300 },
    ],
    [ // 绯焰 (base rose)
        { name: '经典', color: 0xe8456b, dark: 0xb92a4e, accent: 0xffd23f, price: 0 },
        { name: '电光蓝', color: 0x3dc8ff, dark: 0x1e96cc, accent: 0x1a1a20, price: 150 },
        { name: '柠檬黄', color: 0xf2e93d, dark: 0xc2b81e, accent: 0xe8456b, price: 300 },
    ],
];

/** Parse an audio on/off store ('1' = on, '0' = off). Missing /
 * garbage defaults to ON — a fresh install is loud, and a corrupt
 * value never silently mutes the game. Pure function (node-testable). */
export function parseAudioOn(raw: string | null): boolean {
    if (raw === null || raw === undefined) { return true; }
    return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/** Stat 1..5 as a 0..1 bar fill (5 = full). Pure function. */
export function statBarFill(stat: number): number {
    const s = Math.max(1, Math.min(5, Math.floor(stat) || 1));
    return s / 5;
}

/** Drift charge tier from held seconds — the same thresholds the
 * physics uses (DRIFT_TIERS): 0 = not charged yet, 1/2/3 = the
 * mini-turbo tiers. Pure function (node-testable). */
export function driftTierFor(t: number): number {
    if (t >= KartConstants.DRIFT_TIERS[2]) { return 3; }
    if (t >= KartConstants.DRIFT_TIERS[1]) { return 2; }
    if (t >= KartConstants.DRIFT_TIERS[0]) { return 1; }
    return 0;
}

/** Coins earned for finishing `pos` (1..8), plus the new-best bonus
 * when `isNewBest`. Pure function (node-testable). */
export function rewardForFinish(pos: number, isNewBest: boolean): number {
    const p = Math.max(1, Math.min(8, Math.floor(pos) || 8));
    return REWARD_BY_POSITION[p - 1] + (isNewBest ? REWARD_NEW_BEST : 0);
}

/** Result of tapping a paint in the select screen. Pure decision:
 * owned -> just select it; affordable -> buy + select; else too poor. */
export function paintTapResult(coins: number, price: number, owned: boolean): 'selected' | 'bought' | 'poor' {
    if (owned) { return 'selected'; }
    return coins >= price ? 'bought' : 'poor';
}

/** Parse the owned-paints store (JSON array of 8 rows of [bool x3]).
 * Garbage / missing entries fall back to [true, false, false]; index 0
 * (default paint) is always owned. Pure function (node-testable). */
export function parseOwnedPaints(raw: string | null): boolean[][] {
    const out: boolean[][] = [];
    for (let i = 0; i < ROSTER.length; i++) { out.push([true, false, false]); }
    if (!raw) { return out; }
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) { return out; }
        for (let i = 0; i < ROSTER.length && i < arr.length; i++) {
            const row = arr[i];
            if (Array.isArray(row)) {
                out[i][1] = row[1] === true;
                out[i][2] = row[2] === true;
            }
        }
    } catch (e) { /* fall back to defaults */ }
    return out;
}

/** Parse the selected-paint store (JSON array of 8 ints 0..2).
 * Garbage / missing entries fall back to 0 (default paint). */
export function parseSelectedPaints(raw: string | null): number[] {
    const out: number[] = [];
    for (let i = 0; i < ROSTER.length; i++) { out.push(0); }
    if (!raw) { return out; }
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) { return out; }
        for (let i = 0; i < ROSTER.length && i < arr.length; i++) {
            const v = arr[i];
            out[i] = (typeof v === 'number' && v >= 0 && v < 3) ? Math.floor(v) : 0;
        }
    } catch (e) { /* fall back to defaults */ }
    return out;
}

/**
 * Grid order for a race: the player's pick first, then the rest in
 * roster order. So karts[0] is always the player and no AI duplicates
 * the player's pick. Pure function (node-testable).
 */
export function rosterOrder(sel: number): number[] {
    const s = (sel >= 0 && sel < ROSTER.length) ? sel : 0;
    const out: number[] = [s];
    for (let i = 0; i < ROSTER.length; i++) {
        if (i !== s) { out.push(i); }
    }
    return out;
}

export const enum ItemKind {
    NONE = 0,
    MUSHROOM = 1,
    TRIPLE_MUSHROOM = 2,
    GREEN_SHELL = 3,
    RED_SHELL = 4,
    BANANA = 5,
    STAR = 6,
}

export const ITEM_NAMES: { [kind: number]: string } = {
    1: '🍄 蘑菇',
    2: '🍄🍄🍄 三连蘑菇',
    3: '🟢 绿龟壳',
    4: '🔴 红龟壳',
    5: '🍌 香蕉皮',
    6: '⭐ 无敌星',
};
