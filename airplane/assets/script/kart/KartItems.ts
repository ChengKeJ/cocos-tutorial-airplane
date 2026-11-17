/**
 * Items + AI item use for the kart game （飞车狂飙 v1.0.8, milestone 2).
 *
 * The 6 kinds from the spec (ChengKeJ/kart-royale Items.ts, MIT — numbers
 * ported, code rewritten for the arcade spline model):
 *   1 mushroom (boost 1.3x, 1.2s) · 2 triple mushroom (x3) ·
 *   3 green shell (straight, 33 m/s, wall bounce) ·
 *   4 red shell (homing, 37 m/s) · 5 banana (dropped hazard) ·
 *   6 star (8s invulnerable + 1.15x, knocks others aside).
 * Item boxes sit on the track (36 anchors from KartTrack.itemAnchors);
 * pickup -> 1.05s roulette arm -> use via the ITEM button / Space.
 * AI karts collect and spend items with the spec's decisions
 * (KartItemsLogic.decideAIItem) and rubber-banding lives in KartGame.
 *
 * Deliberate simplifications vs the spec (arcade model, documented):
 *  - No tow/shield two-stage: a shell fires forward, a banana drops
 *    behind. The AI may still drop a shell behind when hunted.
 *  - Shells fly in (s, d) space with a fixed heading: straight ahead for
 *    green, steered toward the target for red. Wall hits reflect the
 *    heading (green) — same feel, no world-space raycast needed.
 *  - The roulette is a 1.05s arm on the rolled kind (HUD shows it with
 *    a '…' suffix); the kind is rolled at pickup, as in the spec.
 */

import { Layers, Node, Quat, Vec3 } from 'cc';
import { ItemKind, KartConstants } from './KartConstants';
import { KartTrack, MeshBuilder } from './KartTrack';
import { aiItemDelay, decideAIItem, rollItemKind } from './KartItemsLogic';

const RAD2DEG = 180 / Math.PI;

/**
 * Structural view of a kart — KartGame's KartState satisfies this without
 * an import cycle (KartGame imports KartItems, KartItems must not import
 * KartGame's private interface).
 */
export interface ItemKart {
    model: { root: Node };
    stats: { name: string; handlingMul: number };
    isPlayer: boolean;
    sTotal: number;
    d: number;
    heading: number;
    speed: number;
    spinTime: number;
    spinYaw: number;
    driftTime: number;
    boostTime: number;
    boostMul: number;
    starTime: number;
    starHitT: number;
    finished: boolean;
    finishTime: number;
    lap: number;
    itemKind: number;
    itemCount: number;
    itemArm: number;
    aiSkill: number;
    aiAggression: number;
    aiItemDelay: number;
    aiHoldT: number;
}

interface ItemBox {
    s: number;
    lat: number;
    down: number; // > 0 = collected, counting down to respawn
    popT: number; // 0..1 respawn pop animation
    node: Node;
    spin: Node; // rotating child (the visible cube)
}

interface Shell {
    kind: number; // 3 green | 4 red
    s: number;
    d: number;
    heading: number;
    dir: number; // +1 forward, -1 dropped behind
    speed: number;
    life: number;
    bounces: number;
    target: ItemKart | null;
    owner: ItemKart;
    bornT: number;
    node: Node;
}

interface Banana {
    s: number;
    d: number;
    life: number;
    owner: ItemKart;
    bornT: number;
    node: Node;
}

const BOX_Y = 1.05; // spec BOX_HEIGHT — floats above the kart's nose
const SHELL_Y = 0.5;
const BANANA_Y = 0.18;

export class KartItems {
    private _track: KartTrack;
    private _root: Node;
    private _boxes: ItemBox[] = [];
    private _shells: Shell[] = [];
    private _bananas: Banana[] = [];
    private _tmpPos = new Vec3();
    private _tmpQ = new Quat();

    constructor(track: KartTrack, parent: Node) {
        this._track = track;
        this._root = new Node('items');
        this._root.layer = Layers.Enum.DEFAULT;
        this._root.setParent(parent);
    }

    /** Create one spinning box per track anchor. Call once in start(). */
    public buildBoxes(): void {
        const anchors = this._track.itemAnchors();
        for (const a of anchors) {
            const node = new Node('itemBox');
            node.layer = Layers.Enum.DEFAULT;
            node.setParent(this._root);
            const spin = new Node('spin');
            spin.layer = Layers.Enum.DEFAULT;
            spin.setParent(node);
            // cyan '?' box: bright outer cube + white inner cube (no art assets)
            const b = new MeshBuilder();
            b.addBox(0x22d3ee, new Vec3(0, 0, 0), 0, 1.15, 1.15, 1.15);
            b.addBox(0xffffff, new Vec3(0, 0, 0), 0, 0.55, 0.55, 1.25);
            b.build(spin);
            this._track.posAt(a.s, a.lat, this._tmpPos);
            node.setPosition(this._tmpPos.x, this._tmpPos.y + BOX_Y, this._tmpPos.z);
            this._boxes.push({ s: a.s, lat: a.lat, down: 0, popT: 1, node, spin });
        }
    }

    /** Clear all projectiles / bananas, restore all boxes. Call on race reset. */
    public reset(): void {
        for (const sh of this._shells) { sh.node.active = false; }
        this._shells = [];
        for (const bn of this._bananas) { bn.node.active = false; }
        this._bananas = [];
        for (const bx of this._boxes) {
            bx.down = 0;
            bx.popT = 1;
            bx.node.active = true;
            bx.node.setScale(1, 1, 1);
        }
    }

    /** Rank 1..8 by progress (same rule as KartGame._rankOf). */
    public rankOf(k: ItemKart, karts: ItemKart[]): number {
        let rank = 1;
        for (const o of karts) {
            if (o === k) { continue; }
            if (o.finished && (!k.finished || o.finishTime < k.finishTime)) { rank++; }
            else if (!o.finished && !k.finished && o.sTotal > k.sTotal) { rank++; }
        }
        return rank;
    }

    // ---- item use ----

    /**
     * Spend the held item. Returns true if something was spent.
     * Player calls with backwards=false; AI passes its decision.
     */
    public useItem(k: ItemKart, backwards: boolean, raceTime: number): boolean {
        if (k.finished || k.spinTime > 0) { return false; }
        if (k.itemKind === ItemKind.NONE || k.itemCount <= 0) { return false; }
        if (k.itemArm > 0) { return false; } // roulette still spinning
        const kind = k.itemKind;
        let spent = true;
        switch (kind) {
            case ItemKind.MUSHROOM:
            case ItemKind.TRIPLE_MUSHROOM:
                k.boostTime = KartConstants.ITEM_MUSHROOM_TIME;
                k.boostMul = KartConstants.ITEM_MUSHROOM_BOOST;
                break;
            case ItemKind.STAR:
                k.starTime = Math.max(k.starTime, KartConstants.ITEM_STAR_TIME);
                k.boostTime = 0.8;
                k.boostMul = 1.2;
                break;
            case ItemKind.GREEN_SHELL:
                spent = this._fireShell(k, ItemKind.GREEN_SHELL, backwards, raceTime);
                break;
            case ItemKind.RED_SHELL:
                spent = this._fireShell(k, ItemKind.RED_SHELL, backwards, raceTime);
                break;
            case ItemKind.BANANA:
                this._dropBanana(k, raceTime);
                break;
            default:
                return false;
        }
        if (!spent) { return false; } // shell pool full: keep the item
        k.itemCount--;
        if (k.itemCount <= 0) {
            k.itemKind = ItemKind.NONE;
            k.itemCount = 0;
        } else {
            // a triple is spent one at a time, each one arms briefly (spec)
            k.itemArm = 0.22;
        }
        k.aiHoldT = 0;
        return true;
    }

    private _fireShell(k: ItemKart, kind: number, backwards: boolean, raceTime: number): boolean {
        if (this._shells.length >= KartConstants.ITEM_SHELL_MAX) { return false; }
        const dir = backwards ? -1 : 1;
        const speed = kind === ItemKind.RED_SHELL
            ? KartConstants.ITEM_RED_SHELL_SPEED
            : KartConstants.ITEM_GREEN_SHELL_SPEED;
        const node = new Node('shell');
        node.layer = Layers.Enum.DEFAULT;
        node.setParent(this._root);
        const b = new MeshBuilder();
        const col = kind === ItemKind.RED_SHELL ? 0xef4444 : 0x22c55e;
        b.addSphere(col, new Vec3(0, 0, 0), 0, 0.45, 0.45, 0.45);
        b.addSphere(0xffffff, new Vec3(0, 0.1, 0.25), 0, 0.16, 0.16, 0.16);
        b.build(node);
        const s = this._track.wrapS(k.sTotal + dir * 2.5);
        this._track.posAt(s, k.d, this._tmpPos);
        node.setPosition(this._tmpPos.x, this._tmpPos.y + SHELL_Y, this._tmpPos.z);
        let target: ItemKart | null = null;
        if (kind === ItemKind.RED_SHELL && !backwards) {
            target = this._targetAhead(k);
        }
        this._shells.push({
            kind, s, d: k.d, heading: k.heading, dir, speed,
            life: KartConstants.ITEM_SHELL_LIFE, bounces: 0,
            target, owner: k, bornT: raceTime, node,
        });
        return true;
    }

    private _dropBanana(k: ItemKart, raceTime: number): void {
        if (this._bananas.length >= KartConstants.ITEM_BANANA_MAX) {
            // pool full: recycle the oldest (spec Projectiles pool behaviour)
            const old = this._bananas.shift();
            if (old) { old.node.active = false; }
        }
        const node = new Node('banana');
        node.layer = Layers.Enum.DEFAULT;
        node.setParent(this._root);
        const b = new MeshBuilder();
        b.addBox(0xfacc15, new Vec3(0, 0, 0), Math.PI / 4, 0.9, 0.22, 0.45);
        b.build(node);
        const s = this._track.wrapS(k.sTotal - 2.5);
        this._track.posAt(s, k.d, this._tmpPos);
        node.setPosition(this._tmpPos.x, this._tmpPos.y + BANANA_Y, this._tmpPos.z);
        this._bananas.push({ s, d: k.d, life: KartConstants.ITEM_BANANA_LIFE, owner: k, bornT: raceTime, node });
    }

    /** Nearest unfinished kart ahead of k (by sTotal), or null. */
    private _targetAhead(k: ItemKart): ItemKart | null {
        // target is resolved at fire time from the field — the caller passes
        // the full field via _kartsRef set in update(); fall back to null.
        if (!this._kartsRef) { return null; }
        let best: ItemKart | null = null;
        let bestDs = Infinity;
        for (const o of this._kartsRef) {
            if (o === k || o.finished) { continue; }
            const ds = o.sTotal - k.sTotal;
            if (ds > 0 && ds < 120 && ds < bestDs) { best = o; bestDs = ds; }
        }
        return best;
    }

    private _kartsRef: ItemKart[] | null = null;

    // ---- per-frame ----

    public update(dt: number, karts: ItemKart[], raceTime: number): void {
        this._kartsRef = karts;
        const L = this._track.length;
        this._updateBoxes(dt, karts, raceTime, L);
        this._updateShells(dt, karts, raceTime, L);
        this._updateBananas(dt, karts, raceTime, L);
        this._updateStarHits(dt, karts, L);
        // timers: roulette arm, star, star-hit cooldown, AI hold time
        for (const k of karts) {
            if (k.itemArm > 0) { k.itemArm -= dt; }
            if (k.starTime > 0) { k.starTime -= dt; }
            if (k.starHitT > 0) { k.starHitT -= dt; }
            if (k.itemKind !== ItemKind.NONE) { k.aiHoldT += dt; }
            if (k.aiItemDelay > 0) { k.aiItemDelay -= dt; }
        }
        // AI item decisions (player never reaches here)
        for (const k of karts) {
            if (k.isPlayer || k.finished || k.spinTime > 0) { continue; }
            if (k.itemKind === ItemKind.NONE || k.itemCount <= 0 || k.itemArm > 0) { continue; }
            if (k.aiItemDelay > 0) { continue; }
            const dec = decideAIItem(this._aiContext(k, karts, L));
            if (dec && dec.fire) {
                this.useItem(k, dec.back, raceTime);
            }
        }
    }

    private _aiContext(k: ItemKart, karts: ItemKart[], L: number): {
        heldKind: number; holdT: number; skill: number; aggression: number;
        aheadDist: number; aheadAngle: number; behindDist: number;
        straight: boolean; leading: boolean; speed: number;
    } {
        let aheadDist = Infinity;
        let aheadAngle = Math.PI;
        let behindDist = Infinity;
        for (const o of karts) {
            if (o === k || o.finished) { continue; }
            const ds = this._wrapDelta(o.sTotal - k.sTotal, L);
            const dd = o.d - k.d;
            const dist = Math.hypot(ds, dd);
            if (ds > 0 && dist < aheadDist) {
                aheadDist = dist;
                aheadAngle = Math.abs(Math.atan2(dd, Math.max(1, ds)));
            } else if (ds < 0 && dist < behindDist) {
                behindDist = dist;
            }
        }
        // straight if the road ahead (~40 m) stays nearly flat in curvature
        let peak = 0;
        for (let s = 10; s <= 40; s += 10) {
            peak = Math.max(peak, Math.abs(this._track.curvatureAt(k.sTotal + s)));
        }
        return {
            heldKind: k.itemKind,
            holdT: k.aiHoldT,
            skill: k.aiSkill,
            aggression: k.aiAggression,
            aheadDist, aheadAngle, behindDist,
            straight: peak < 0.011,
            leading: this.rankOf(k, karts) === 1,
            speed: k.speed,
        };
    }

    private _wrapDelta(ds: number, L: number): number {
        ds = ((ds % L) + L) % L;
        return ds > L / 2 ? ds - L : ds;
    }

    private _updateBoxes(dt: number, karts: ItemKart[], raceTime: number, L: number): void {
        for (const bx of this._boxes) {
            if (bx.down > 0) {
                bx.down -= dt;
                if (bx.down <= 0) {
                    bx.down = 0;
                    bx.popT = 0;
                    bx.node.active = true;
                }
                continue;
            }
            // spin + pop-in scale
            Quat.fromEuler(this._tmpQ, 0, (raceTime * 90) % 360, 0);
            bx.spin.setRotation(this._tmpQ);
            if (bx.popT < 1) {
                bx.popT = Math.min(1, bx.popT + dt / 0.25);
                const s = 0.1 + 0.9 * bx.popT;
                bx.node.setScale(s, s, s);
            }
            // pickup: any kart without an item, close in (s, d)
            for (const k of karts) {
                if (k.finished || k.spinTime > 0) { continue; }
                if (k.itemKind !== ItemKind.NONE) { continue; }
                const ds = Math.abs(this._wrapDelta(k.sTotal - bx.s, L));
                if (ds < 2.5 && Math.abs(k.d - bx.lat) < 2.0) {
                    this._grant(k, karts);
                    bx.down = KartConstants.ITEM_BOX_RESPAWN;
                    bx.node.active = false;
                    break;
                }
            }
        }
    }

    private _grant(k: ItemKart, karts: ItemKart[]): void {
        const place = this.rankOf(k, karts);
        const kind = rollItemKind(place, karts.length, Math.random);
        k.itemKind = kind;
        k.itemCount = kind === ItemKind.TRIPLE_MUSHROOM ? 3 : 1;
        k.itemArm = KartConstants.ITEM_ARM_TIME;
        k.aiHoldT = 0;
        if (!k.isPlayer) {
            k.aiItemDelay = aiItemDelay(k.aiSkill, karts.indexOf(k), kind);
        }
    }

    private _updateShells(dt: number, karts: ItemKart[], raceTime: number, L: number): void {
        for (let i = this._shells.length - 1; i >= 0; i--) {
            const sh = this._shells[i];
            sh.life -= dt;
            if (sh.life <= 0) {
                this._killShell(i);
                continue;
            }
            // red shell homes: steer the heading toward the target's lateral
            if (sh.kind === ItemKind.RED_SHELL && sh.target && !sh.target.finished) {
                const desired = Math.atan2(sh.target.d - sh.d, 10);
                const turn = Math.max(-2.5 * dt, Math.min(2.5 * dt, desired - sh.heading));
                sh.heading += turn;
            }
            const ds = sh.dir * sh.speed * Math.cos(sh.heading) * dt;
            const dd = sh.dir * sh.speed * Math.sin(sh.heading) * dt;
            sh.s = this._track.wrapS(sh.s + ds);
            sh.d += dd;
            // walls: reflect the heading, count a bounce
            const half = this._track.halfAt(sh.s);
            const lim = half - 0.9;
            if (Math.abs(sh.d) > lim) {
                sh.d = sh.d > 0 ? lim : -lim;
                sh.heading = -sh.heading;
                sh.bounces++;
                if (sh.bounces >= 3) {
                    this._killShell(i);
                    continue;
                }
            }
            this._track.posAt(sh.s, sh.d, this._tmpPos);
            sh.node.setPosition(this._tmpPos.x, this._tmpPos.y + SHELL_Y, this._tmpPos.z);
            // hit: first kart in range (owner is immune for 0.6s after firing)
            let hit = false;
            for (const k of karts) {
                if (k.finished || k.spinTime > 0) { continue; }
                if (k === sh.owner && raceTime - sh.bornT < 0.6) { continue; }
                const dsk = Math.abs(this._wrapDelta(k.sTotal - sh.s, L));
                if (dsk < 2.0 && Math.abs(k.d - sh.d) < 1.6) {
                    if (k.starTime > 0) {
                        // star kart is invulnerable — the shell just fizzles
                        this._killShell(i);
                    } else {
                        this._spinOut(k);
                        this._killShell(i);
                    }
                    hit = true;
                    break;
                }
            }
            if (hit) { continue; }
        }
    }

    private _killShell(i: number): void {
        const sh = this._shells[i];
        sh.node.active = false;
        this._shells.splice(i, 1);
    }

    private _updateBananas(dt: number, karts: ItemKart[], raceTime: number, L: number): void {
        for (let i = this._bananas.length - 1; i >= 0; i--) {
            const bn = this._bananas[i];
            bn.life -= dt;
            if (bn.life <= 0) {
                bn.node.active = false;
                this._bananas.splice(i, 1);
                continue;
            }
            for (const k of karts) {
                if (k.finished || k.spinTime > 0 || k.starTime > 0) { continue; }
                // the dropper is immune for 1s after dropping it
                if (k === bn.owner && raceTime - bn.bornT < 1) { continue; }
                const ds = Math.abs(this._wrapDelta(k.sTotal - bn.s, L));
                if (ds < 1.8 && Math.abs(k.d - bn.d) < 1.5) {
                    this._spinOut(k);
                    bn.node.active = false;
                    this._bananas.splice(i, 1);
                    break;
                }
            }
        }
    }

    private _updateStarHits(dt: number, karts: ItemKart[], L: number): void {
        for (const a of karts) {
            if (a.starTime <= 0 || a.finished) { continue; }
            for (const b of karts) {
                if (b === a || b.finished || b.spinTime > 0 || b.starTime > 0) { continue; }
                if (b.starHitT > 0) { continue; }
                const ds = Math.abs(this._wrapDelta(b.sTotal - a.sTotal, L));
                if (ds < 2.4 && Math.abs(b.d - a.d) < 1.9) {
                    this._spinOut(b, KartConstants.ITEM_STAR_SPIN);
                    b.starHitT = 0.8; // one knock-aside per pass (spec starHit cooldown)
                }
            }
        }
    }

    /** Spin-out: speed bleeds + kart rotates (KartGame._integrate drives it). */
    private _spinOut(k: ItemKart, seconds: number = KartConstants.ITEM_SPIN_TIME): void {
        if (k.starTime > 0 || k.spinTime > 0) { return; }
        k.spinTime = seconds;
        k.spinYaw = 0;
        // a spin-out drops any drift charge
        k.driftTime = 0;
    }
}
