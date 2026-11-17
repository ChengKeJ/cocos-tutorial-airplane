/**
 * Kart tuning + roster for the Star Fighter hall kart game （飞车狂飙）.
 *
 * Numbers are taken from the kart-royale design spec (ChengKeJ/kart-royale,
 * MIT, ryancampbell/kart-royale upstream): BASE_TOP_SPEED 30 m/s, drift
 * tiers / boost tables, position-based item odds, roster stat multipliers.
 * The roster names, colours and all UI text are OUR OWN (divergence pass):
 * never ship the upstream "Kart Royale" names or identity.
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
}

/**
 * Our own roster — stat multipliers follow the spec's roster, names and
 * colours are original Chinese driver names. Player is index 0 （凌风）.
 */
export const ROSTER: DriverStats[] = [
    { name: '凌风', color: 0xff3b5c, dark: 0xc22540, accelMul: 1.00, topSpeedMul: 1.00, weightMul: 1.0, handlingMul: 1.00 },
    { name: '海蓝', color: 0x2ea8ff, dark: 0x1d7cc9, accelMul: 0.92, topSpeedMul: 1.08, weightMul: 1.2, handlingMul: 0.92 },
    { name: '闪电', color: 0xffd23f, dark: 0xd9a91e, accelMul: 1.12, topSpeedMul: 0.93, weightMul: 0.82, handlingMul: 1.12 },
    { name: '青竹', color: 0x4ade5a, dark: 0x2fae3e, accelMul: 1.02, topSpeedMul: 0.99, weightMul: 0.95, handlingMul: 1.05 },
    { name: '紫曜', color: 0x8b5cf6, dark: 0x6a3fd1, accelMul: 0.95, topSpeedMul: 1.05, weightMul: 1.1, handlingMul: 0.96 },
    { name: '橙光', color: 0xff8a3d, dark: 0xd9661a, accelMul: 1.05, topSpeedMul: 0.97, weightMul: 0.9, handlingMul: 1.08 },
    { name: '雪驰', color: 0x7ee8fa, dark: 0x4cb8cc, accelMul: 0.98, topSpeedMul: 1.02, weightMul: 1.0, handlingMul: 1.00 },
    { name: '绯焰', color: 0xe8456b, dark: 0xb92a4e, accelMul: 1.08, topSpeedMul: 0.95, weightMul: 0.88, handlingMul: 1.10 },
];

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
