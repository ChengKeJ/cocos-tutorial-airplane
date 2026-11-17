/**
 * Pure item + AI decision logic for the kart game （飞车狂飙）.
 *
 * NO 'cc' import here on purpose: this module is unit-testable in plain
 * node (tsc -> node assertions), while the Cocos glue lives in
 * KartItems.ts. Every number is ported from the kart-royale design spec
 * (ChengKeJ/kart-royale, MIT): Items.ts (odds table, roll, ARM_TIME,
 * MUSHROOM_BOOST/STRENGTH, STAR_TIME) and AI.ts (skill formula, rubber
 * band ASSIST_CATCHUP/LEASH, item spend decisions).
 */

// Odds table: [leader, midfield, last] per kind (spec Items.ts WEIGHTS).
// Kinds 1..6 = mushroom, triple mushroom, green shell, red shell, banana, star.
export const ITEM_ODDS: { [kind: number]: number[] } = {
    1: [10, 26, 16],
    2: [0, 10, 21],
    3: [33, 19, 6],
    4: [4, 21, 17],
    5: [38, 13, 4],
    6: [0, 4, 17],
};

export function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Weighted roll (spec Items.ts roll()): place is 1-based; the position is
 * normalised across the field, then each kind's weight is a two-segment
 * lerp through the midfield column. Reservoir sampling with the given
 * rand() in [0, 1).
 */
export function rollItemKind(place: number, racers: number, rand: () => number): number {
    const p = racers > 1 ? clamp((place - 1) / (racers - 1), 0, 1) : 0;
    let total = 0;
    let pick = 1; // mushroom fallback (spec: total > 0 ? pick : Mushroom)
    for (let kind = 1; kind <= 6; kind++) {
        const w = ITEM_ODDS[kind];
        if (!w) { continue; }
        const v = p < 0.5 ? w[0] + (w[1] - w[0]) * (p * 2) : w[1] + (w[2] - w[1]) * ((p - 0.5) * 2);
        if (v <= 0) { continue; }
        total += v;
        if (rand() * total < v) { pick = kind; }
    }
    return total > 0 ? pick : 1;
}

/**
 * AI skill (spec AI.ts): leans on handling (a nimble character is driven
 * by a nimble AI) plus a per-driver hash h0 in [0, 1). Clamped to [0.5, 1].
 */
export function aiSkillOf(handlingMul: number, h0: number): number {
    return clamp(0.70 + (handlingMul - 1) * 1.5 + (h0 - 0.5) * 0.20, 0.5, 1);
}

/** Deterministic [0, 1) hash for a driver index (stable across runs). */
export function hash01(n: number): number {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
}

/** Reaction delay after picking up an item (spec AI.ts): sharper drivers think faster. */
export function aiItemDelay(skill: number, kartIndex: number, heldKind: number): number {
    return 0.25 + (1 - skill) * 0.7 + hash01(kartIndex * 31 + heldKind) * 0.45;
}

export interface RubberBandIn {
    /** metres behind the live leader (0 = leading). */
    gapToLead: number;
    /** signed metres vs the player: > 0 = ahead of the player. */
    gapToPlayer: number;
    leading: boolean;
    prevBand: number;
    prevAssist: number;
    dt: number;
}

export interface RubberBandOut { band: number; assist: number; }

/**
 * Rubber band (spec AI.ts AIField.beginFrame): two restrained levers,
 * neither applied to the player.
 *  - band scales target speed: +5% at 110 m adrift, -4% for a clear leader.
 *  - assist is a longitudinal accel: +0.85 m/s^2 catch-up, -0.6 leash.
 * Both are slew-limited so a lap-counter flip cannot snap everyone's pace.
 * Bounds: band in [0.96, 1.05], assist in [-0.6, 0.85].
 */
export function computeRubberBand(inp: RubberBandIn): RubberBandOut {
    let band = 1;
    let assist = 0;
    // catch-up: nothing inside 30 m, saturating at 110 m adrift
    const behind = clamp((inp.gapToLead - 30) / 80, 0, 1);
    band += behind * 0.05;
    assist += behind * 0.85;
    // leash: only the actual leader, and only once genuinely clear ahead
    if (inp.leading) {
        const clear = clamp((inp.gapToPlayer - 40) / 110, 0, 1);
        band -= clear * 0.04;
        assist -= clear * 0.6;
    }
    const bandOut = inp.prevBand + clamp(band - inp.prevBand, -inp.dt * 0.3, inp.dt * 0.3);
    const assistOut = inp.prevAssist + clamp(assist - inp.prevAssist, -inp.dt * 1.2, inp.dt * 1.2);
    return { band: bandOut, assist: assistOut };
}

export interface ItemDecisionCtx {
    /** 1..6 held kind, 0 = none. */
    heldKind: number;
    /** seconds the kart has held this item. */
    holdT: number;
    /** driver skill 0.5..1. */
    skill: number;
    /** 0.5..1, derived from skill: higher = spends sooner. */
    aggression: number;
    /** metres to the nearest kart ahead (Infinity = none). */
    aheadDist: number;
    /** angle to that kart, radians off straight ahead. */
    aheadAngle: number;
    /** metres to the nearest kart behind (Infinity = none). */
    behindDist: number;
    /** true if the road ahead (~40 m) is straight (peak curvature < 0.011). */
    straight: boolean;
    /** true if the kart is currently leading the race. */
    leading: boolean;
    /** kart speed, m/s. */
    speed: number;
}

export interface ItemDecision {
    /** use the item now. */
    fire: boolean;
    /** true = deploy backwards (drop behind); false = forward. */
    back: boolean;
}

/**
 * AI item spend decision (spec AI.ts spend logic, simplified for the
 * arcade model: no tow/shield two-stage — a shell fires forward, a
 * banana drops behind; the AI may drop a shell behind when hunted).
 * Returns null = hold the item.
 */
export function decideAIItem(ctx: ItemDecisionCtx): ItemDecision | null {
    const kind = ctx.heldKind;
    if (kind <= 0) { return null; }
    const hunted = ctx.behindDist < 17;
    const bored = ctx.holdT > 9 + (1 - ctx.aggression) * 8;

    switch (kind) {
        case 1: // mushroom
        case 2: // triple mushroom
            // spend on a straight, or when slow (stuck / spun out recovery)
            if (ctx.straight || ctx.speed < 8) { return { fire: true, back: false }; }
            return null;
        case 6: // star: useful anywhere; spend after a short hold
            if (ctx.holdT > 1.5) { return { fire: true, back: false }; }
            return null;
        case 4: // red shell: homing — fire the moment there is anything to home on
            if (ctx.aheadDist < 85) { return { fire: true, back: false }; }
            if (hunted || bored) { return { fire: true, back: true }; }
            return null;
        case 3: // green shell: needs a line on the target, else drop behind
            if (ctx.aheadDist < 34 && ctx.aheadAngle < 0.20) { return { fire: true, back: false }; }
            if (hunted || bored) { return { fire: true, back: true }; }
            return null;
        case 5: // banana: drop it behind — best on a corner apex, or when hunted
            if (hunted || (bored && !ctx.straight) || ctx.holdT > 16) { return { fire: true, back: true }; }
            return null;
        default:
            return null;
    }
}
