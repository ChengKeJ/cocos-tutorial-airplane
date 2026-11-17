/**
 * Kart race manager for the Star Fighter hall kart game （飞车狂飙 v1.0.8).
 *
 * Arcade spline model: each kart is (sTotal = unwrapped metres along the
 * centreline, d = lateral offset, heading = yaw vs the tangent, speed).
 * 8 karts (1 player + 7 AI), 3 laps, 32 checkpoints, countdown start,
 * drift + mini-turbo, boost pads, off-road slowdown, respawn, placement.
 * Items (boxes / shells / banana / star) land in milestone 2 — the hooks
 * (itemKind/itemCount/useItem) already exist so the UI stays stable.
 *
 * Scene contract (see build_kart_scene.py): this component lives on the
 * 'kartGame' node; the scene also has 'Main Camera' (3D) and 'Canvas'.
 * KartUI (on the Canvas) drives input + HUD and sets game.ui = itself.
 */

import { _decorator, Camera, Component, Node, Quat, Vec3, director, find, sys } from 'cc';
import { ItemKind, KartConstants, ROSTER } from './KartConstants';
import { BOOST_PADS, KartTrack, TrackFrame } from './KartTrack';
import { buildKartModel, KartModel } from './KartModel';
const { ccclass, property } = _decorator;

const BEST_TIME_KEY = 'kart_best_time';
const KART_VERSION = 'v1.0.8';
const RAD2DEG = 180 / Math.PI;

interface KartState {
    model: KartModel;
    stats: typeof ROSTER[0];
    isPlayer: boolean;
    sTotal: number; // unwrapped distance; 0 = start line, lap = floor(sTotal / L) + 1
    d: number;
    heading: number; // radians, + = turning right
    speed: number;
    steer: number; // smoothed -1..1
    driftTime: number; // > 0 while drifting (seconds held)
    driftDir: number;
    boostTime: number;
    boostMul: number;
    spinTime: number;
    spinYaw: number;
    lap: number;
    lapStartT: number;
    bestLap: number;
    finished: boolean;
    finishTime: number;
    offroad: boolean;
    oobTime: number;
    padCooldown: number;
    maxSTotal: number;
    wrongWayT: number;
    aiWobble: number;
    aiDrift: number;
    aiDriftDir: number;
    itemKind: number;
    itemCount: number;
    wheelSpin: number;
}

@ccclass('KartGame')
export class KartGame extends Component {
    /** Set by KartUI in its start(). All UI calls go through it (may be null). */
    public ui: any = null;
    /** Input from KartUI: -1..1 steer, drift held, brake held. */
    public steerInput = 0;
    public driftHeld = false;
    public brakeHeld = false;

    public state = 'menu'; // menu | countdown | racing | paused | finished

    private _track: KartTrack = null;
    private _karts: KartState[] = [];
    private _player: KartState = null;
    private _camera: Node = null;
    private _cameraComp: Camera = null;
    private _camPos = new Vec3();
    private _camLook = new Vec3();
    private _camInit = false;
    private _countdownT = 0;
    private _countdownShown = '';
    private _raceTime = 0;
    private _resultsShown = false;
    private _resultsT = 0;
    private _bestTime = 0; // ms, 0 = none
    private _frame: TrackFrame = {
        pos: new Vec3(), tangent: new Vec3(), right: new Vec3(), up: new Vec3(),
        half: 0, bank: 0, zone: 0, raceLat: 0,
    };
    private _tmpPos = new Vec3();
    private _tmpFrame2: TrackFrame = {
        pos: new Vec3(), tangent: new Vec3(), right: new Vec3(), up: new Vec3(),
        half: 0, bank: 0, zone: 0, raceLat: 0,
    };

    // ---- public state for the UI ----
    public get raceTime(): number { return this._raceTime; }
    public get playerLap(): number { return this._player ? this._player.lap : 1; }
    public get playerSpeedKmh(): number {
        return this._player ? Math.max(0, Math.round(this._player.speed * 3.6)) : 0;
    }
    public get playerPosition(): number { return this._rankOf(this._player); }
    public get bestTimeMs(): number { return this._bestTime; }
    public get karts(): KartState[] { return this._karts; }
    public get track(): KartTrack { return this._track; }

    start() {
        const saved = sys.localStorage.getItem(BEST_TIME_KEY);
        this._bestTime = saved ? parseInt(saved, 10) || 0 : 0;

        this._track = new KartTrack();
        const trackRoot = new Node('trackRoot');
        trackRoot.setParent(this.node);
        this._track.buildWorld(trackRoot);

        const kartsRoot = new Node('karts');
        kartsRoot.setParent(this.node);
        for (let i = 0; i < KartConstants.RACER_COUNT; i++) {
            const stats = ROSTER[i];
            const model = buildKartModel(stats.color, stats.dark);
            model.root.setParent(kartsRoot);
            const pos = new Vec3();
            const yaw = this._track.gridSlot(i, pos);
            model.root.setPosition(pos.x, pos.y, pos.z);
            const q = new Quat();
            Quat.fromEuler(q, 0, yaw * RAD2DEG, 0);
            model.root.setRotation(q);
            const back = 11 + (i >> 1) * 8 + (i & 1) * 4;
            const ks: KartState = {
                model, stats, isPlayer: i === 0,
                sTotal: -back, d: (i & 1) === 0 ? -3.2 : 3.2, heading: 0, speed: 0,
                steer: 0, driftTime: 0, driftDir: 0,
                boostTime: 0, boostMul: 1, spinTime: 0, spinYaw: 0,
                lap: 1, lapStartT: 0, bestLap: 0,
                finished: false, finishTime: 0,
                offroad: false, oobTime: 0, padCooldown: 0,
                maxSTotal: -back, wrongWayT: 0,
                aiWobble: i * 1.7, aiDrift: 0, aiDriftDir: 0,
                itemKind: ItemKind.NONE, itemCount: 0,
                wheelSpin: 0,
            };
            this._karts.push(ks);
            if (i === 0) { this._player = ks; }
        }

        const camNode = find('Main Camera');
        if (camNode) {
            this._camera = camNode;
            this._cameraComp = camNode.getComponent(Camera);
        }
        this._snapCameraToPlayer();
        console.log('[Star Kart] ' + KART_VERSION + ' track ' + Math.round(this._track.length) + 'm');
        if (this.ui) { this.ui.showMenu(); }
    }

    update(dt: number) {
        if (dt > 0.05) { dt = 0.05; }
        if (this.state === 'countdown') {
            this._countdownT -= dt;
            const elapsed = (KartConstants.COUNTDOWN_LEAD + 3 * KartConstants.COUNTDOWN_BEAT) - this._countdownT;
            let label = '';
            if (elapsed < KartConstants.COUNTDOWN_LEAD) { label = ''; }
            else {
                const beat = Math.floor((elapsed - KartConstants.COUNTDOWN_LEAD) / KartConstants.COUNTDOWN_BEAT);
                label = beat === 0 ? '3' : beat === 1 ? '2' : beat === 2 ? '1' : 'GO!';
            }
            if (label !== this._countdownShown) {
                this._countdownShown = label;
                if (this.ui) { this.ui.showCountdown(label); }
            }
            if (this._countdownT <= 0) {
                this.state = 'racing';
                this._raceTime = 0;
                if (this.ui) { this.ui.showCountdown(''); this.ui.showHud(true); }
            }
            this._updateCamera(dt, true);
            return;
        }
        if (this.state === 'racing') {
            this._raceTime += dt;
            for (const k of this._karts) {
                if (k.isPlayer) { this._updatePlayer(k, dt); }
                else { this._updateAI(k, dt); }
            }
            this._collideKarts();
            this._updateVisuals(dt);
            this._updateCamera(dt, false);
            if (this.ui) { this.ui.tickHud(); }
            if (this._player.finished && !this._resultsShown) {
                this._resultsT += dt;
                const allDone = this._karts.every((k) => k.finished);
                if (allDone || this._resultsT >= KartConstants.RESULTS_DELAY) {
                    this._resultsShown = true;
                    this.state = 'finished';
                    if (this.ui) { this.ui.showResults(this._results()); }
                }
            }
            return;
        }
        if (this.state === 'finished') {
            // background keeps rolling: finished karts coast, the rest race on
            for (const k of this._karts) {
                if (!k.finished) { this._updateAI(k, dt); }
                else { this._coastKart(k, dt); }
            }
            this._collideKarts();
            this._updateVisuals(dt);
            this._updateCamera(dt, false);
            return;
        }
        if (this.state === 'menu') {
            this._updateCamera(dt, true);
            return;
        }
        // paused: frozen
    }

    // ---- race flow ----

    public startRace() {
        this._resetGrid();
        this._countdownT = KartConstants.COUNTDOWN_LEAD + 3 * KartConstants.COUNTDOWN_BEAT;
        this._countdownShown = '';
        this._raceTime = 0;
        this._resultsShown = false;
        this._resultsT = 0;
        this.state = 'countdown';
        if (this.ui) { this.ui.showMenu(false); this.ui.showResults(null); this.ui.showHud(false); this.ui.showPause(false); }
    }

    public restartRace() {
        this.startRace();
    }

    public togglePause() {
        if (this.state === 'racing') {
            this.state = 'paused';
            if (this.ui) { this.ui.showPause(true); }
        } else if (this.state === 'paused') {
            this.state = 'racing';
            if (this.ui) { this.ui.showPause(false); }
        }
    }

    public quitToHall() {
        director.loadScene('hall');
    }

    /** Item use (milestone 2 fills this in; until then there is no item). */
    public useItem() {
        if (this.state !== 'racing' || !this._player) { return; }
        if (this._player.itemKind === ItemKind.NONE || this._player.itemCount <= 0) { return; }
        // milestone 2: mushroom / shells / banana / star effects
        this._player.itemCount--;
        if (this._player.itemCount <= 0) { this._player.itemKind = ItemKind.NONE; }
        if (this.ui) { this.ui.tickHud(); }
    }

    private _resetGrid() {
        for (let i = 0; i < this._karts.length; i++) {
            const k = this._karts[i];
            const pos = new Vec3();
            const yaw = this._track.gridSlot(i, pos);
            k.model.root.setPosition(pos.x, pos.y, pos.z);
            const q = new Quat();
            Quat.fromEuler(q, 0, yaw * RAD2DEG, 0);
            k.model.root.setRotation(q);
            const back = 11 + (i >> 1) * 8 + (i & 1) * 4;
            k.sTotal = -back;
            k.d = (i & 1) === 0 ? -3.2 : 3.2;
            k.heading = 0; k.speed = 0; k.steer = 0;
            k.driftTime = 0; k.driftDir = 0;
            k.boostTime = 0; k.boostMul = 1;
            k.spinTime = 0; k.spinYaw = 0;
            k.lap = 1; k.lapStartT = 0; k.bestLap = 0;
            k.finished = false; k.finishTime = 0;
            k.offroad = false; k.oobTime = 0; k.padCooldown = 0;
            k.maxSTotal = -back; k.wrongWayT = 0;
            k.aiDrift = 0; k.aiDriftDir = 0;
            k.itemKind = ItemKind.NONE; k.itemCount = 0;
        }
        this._snapCameraToPlayer();
    }

    private _results(): Array<{ name: string; time: number; isPlayer: boolean; bestLap: number }> {
        const rows = this._karts.map((k) => ({
            name: k.stats.name,
            time: k.finished ? k.finishTime : 0,
            isPlayer: k.isPlayer,
            bestLap: k.bestLap,
        }));
        rows.sort((a, b) => {
            if (a.time > 0 && b.time > 0) { return a.time - b.time; }
            if (a.time > 0) { return -1; }
            if (b.time > 0) { return 1; }
            return 0;
        });
        return rows;
    }

    private _rankOf(k: KartState): number {
        if (!k) { return 1; }
        let rank = 1;
        for (const o of this._karts) {
            if (o === k) { continue; }
            if (o.finished && (!k.finished || o.finishTime < k.finishTime)) { rank++; }
            else if (!o.finished && !k.finished && o.sTotal > k.sTotal) { rank++; }
        }
        return rank;
    }

    // ---- per-kart physics ----

    private _updatePlayer(k: KartState, dt: number) {
        if (k.finished) { this._coastKart(k, dt); return; }
        this._integrate(k, dt, this.steerInput, this.driftHeld, this.brakeHeld);
        this._afterMove(k, dt, true);
    }

    private _updateAI(k: KartState, dt: number) {
        if (k.finished) { this._coastKart(k, dt); return; }
        // racing line with a lookahead + a personal wobble
        const ahead = this._track.sampleAt(k.sTotal + 10, this._tmpFrame2);
        const targetD = ahead.raceLat + Math.sin(this._raceTime * 0.5 + k.aiWobble) * 1.2;
        const desired = Math.atan2(targetD - k.d, 10);
        let steer = (desired - k.heading) * 2.0;
        steer = Math.max(-1, Math.min(1, steer));
        // drift on corners (spec AI DRIFT_MIN_CURV 0.0072)
        const curvAhead = this._track.curvatureAt(k.sTotal + 25);
        let wantDrift = false;
        if (Math.abs(curvAhead) > 0.0072 && k.speed > 15 && k.aiDrift <= 0) {
            k.aiDrift = 1.0 + Math.random() * 0.5;
            k.aiDriftDir = curvAhead > 0 ? 1 : -1;
        }
        if (k.aiDrift > 0) {
            k.aiDrift -= dt;
            wantDrift = true;
            steer = k.aiDriftDir * 0.8;
        }
        this._integrate(k, dt, steer, wantDrift, false);
        this._afterMove(k, dt, false);
    }

    private _coastKart(k: KartState, dt: number) {
        // finished kart: ease down to a cruise and follow the line
        const target = 14;
        if (k.speed > target) { k.speed -= 6 * dt; }
        else { k.speed += 4 * dt; }
        const ahead = this._track.sampleAt(k.sTotal + 10, this._tmpFrame2);
        const desired = Math.atan2(ahead.raceLat - k.d, 10);
        k.steer += Math.max(-1, Math.min(1, (desired - k.heading) * 2.0)) * dt * 4;
        k.steer = Math.max(-1, Math.min(1, k.steer));
        this._moveKart(k, dt);
    }

    /** Shared arcade physics: accel / steer / drift / boost / walls / off-road. */
    private _integrate(k: KartState, dt: number, steerTarget: number, wantDrift: boolean, isPlayer: boolean) {
        const stats = k.stats;
        // spin-out: no control, speed bleeds, kart rotates
        if (k.spinTime > 0) {
            k.spinTime -= dt;
            k.speed = Math.max(0, k.speed - 14 * dt);
            k.spinYaw += 12 * dt;
            this._moveKart(k, dt);
            return;
        }
        // steer smoothing (spec STEER_RATE_LOW 10.5 / HIGH 5.6)
        const spdRatio = Math.min(1, Math.max(0, k.speed / KartConstants.BASE_TOP_SPEED));
        const steerRate = KartConstants.STEER_RATE_LOW + (KartConstants.STEER_RATE_HIGH - KartConstants.STEER_RATE_LOW) * spdRatio;
        const dSteer = steerTarget - k.steer;
        const maxStep = steerRate * dt;
        k.steer += Math.max(-maxStep, Math.min(maxStep, dSteer));

        // drift engage / hold / release
        if (wantDrift && Math.abs(k.steer) > KartConstants.DRIFT_ENGAGE_STEER && k.speed > KartConstants.DRIFT_MIN_SPEED) {
            if (k.driftTime <= 0) {
                k.driftTime = 0.001;
                k.driftDir = k.steer > 0 ? 1 : -1;
            }
            k.driftTime += dt;
            if (k.driftTime > KartConstants.DRIFT_MAX_HOLD) {
                this._releaseDrift(k);
            }
        } else if (k.driftTime > 0) {
            this._releaseDrift(k);
        }

        // speed
        const frame = this._track.sampleAt(k.sTotal, this._frame);
        const half = frame.half;
        k.offroad = Math.abs(k.d) > half;
        let target = KartConstants.BASE_TOP_SPEED * stats.topSpeedMul;
        if (k.offroad) { target *= KartConstants.OFFROAD_TOP_MUL; }
        if (k.driftTime > 0) { target *= KartConstants.DRIFT_SPEED_FACTOR; }
        if (k.boostTime > 0) {
            k.boostTime -= dt;
            target *= k.boostMul;
        }
        if (isPlayer && this.brakeHeld) {
            k.speed -= KartConstants.BRAKE_DECEL * dt;
            if (k.speed < -KartConstants.REVERSE_MAX) { k.speed = -KartConstants.REVERSE_MAX; }
        } else if (k.speed < target) {
            k.speed += KartConstants.ACCEL_RATE * stats.accelMul * dt;
            if (k.speed > target) { k.speed = target; }
        } else if (k.speed > target) {
            k.speed -= KartConstants.COAST_DECEL * dt;
            if (k.speed < target) { k.speed = target; }
        }
        if (k.offroad) { k.speed = Math.max(0, k.speed - KartConstants.OFFROAD_DRAG * dt); }

        // heading
        if (k.driftTime > 0) {
            const want = k.driftDir * KartConstants.DRIFT_MAX_YAW;
            k.heading += (want - k.heading) * Math.min(1, 6 * dt);
        } else {
            const turnRate = KartConstants.TURN_RATE_LOW + (KartConstants.TURN_RATE_HIGH - KartConstants.TURN_RATE_LOW) * spdRatio;
            k.heading += k.steer * turnRate * stats.handlingMul * dt;
            if (Math.abs(k.steer) < 0.05) {
                k.heading *= Math.max(0, 1 - 2.5 * dt);
            }
            const maxH = KartConstants.MAX_STEER_ANGLE;
            k.heading = Math.max(-maxH, Math.min(maxH, k.heading));
        }

        this._moveKart(k, dt);
    }

    private _releaseDrift(k: KartState) {
        const t = k.driftTime;
        k.driftTime = 0;
        let tier = 0;
        if (t >= KartConstants.DRIFT_TIERS[2]) { tier = 3; }
        else if (t >= KartConstants.DRIFT_TIERS[1]) { tier = 2; }
        else if (t >= KartConstants.DRIFT_TIERS[0]) { tier = 1; }
        if (tier > 0) {
            k.boostTime = KartConstants.DRIFT_BOOST_TIME[tier];
            k.boostMul = KartConstants.DRIFT_BOOST_STRENGTH[tier];
        }
    }

    private _moveKart(k: KartState, dt: number) {
        const ds = k.speed * Math.cos(k.heading) * dt;
        const dd = k.speed * Math.sin(k.heading) * dt;
        k.sTotal += ds;
        k.d += dd;
        // walls: clamp to the road, scrub heading + speed
        const half = this._track.halfAt(k.sTotal);
        const lim = half - KartConstants.KART_HALF_WIDTH;
        if (Math.abs(k.d) > lim) {
            k.d = k.d > 0 ? lim : -lim;
            k.heading *= 0.6;
            if (k.speed > 0) { k.speed *= 0.995; }
        }
    }

    private _afterMove(k: KartState, dt: number, isPlayer: boolean) {
        const L = this._track.length;
        // laps
        const lap = Math.floor(k.sTotal / L) + 1;
        if (lap > k.lap && lap <= KartConstants.LAP_COUNT + 1) {
            const lapTime = this._raceTime - k.lapStartT;
            if (k.lap >= 1 && lapTime > 5) {
                if (k.bestLap === 0 || lapTime < k.bestLap) { k.bestLap = lapTime; }
            }
            k.lap = lap;
            k.lapStartT = this._raceTime;
            if (isPlayer) {
                if (lap <= KartConstants.LAP_COUNT) {
                    if (this.ui) { this.ui.showToast('第 ' + lap + ' 圈！'); }
                }
            }
            if (lap > KartConstants.LAP_COUNT && !k.finished) {
                k.finished = true;
                k.finishTime = this._raceTime;
                if (isPlayer) {
                    const ms = Math.round(this._raceTime * 1000);
                    if (this._bestTime === 0 || ms < this._bestTime) {
                        this._bestTime = ms;
                        sys.localStorage.setItem(BEST_TIME_KEY, String(ms));
                    }
                    if (this.ui) { this.ui.showToast('🏁 完赛！'); }
                }
            }
        }
        // wrong-way
        if (k.sTotal > k.maxSTotal) { k.maxSTotal = k.sTotal; }
        if (isPlayer && k.sTotal < k.maxSTotal - 5 && this._raceTime - k.wrongWayT > 2) {
            k.wrongWayT = this._raceTime;
            if (this.ui) { this.ui.showToast('⚠️ 逆行！请掉头'); }
        }
        // off-track respawn
        const half = this._track.halfAt(k.sTotal);
        if (Math.abs(k.d) > half + 4) {
            k.oobTime += dt;
            if (k.oobTime > KartConstants.OOB_LIMIT) {
                const cpLen = L / KartConstants.CHECKPOINTS;
                k.sTotal = Math.floor(k.sTotal / cpLen) * cpLen;
                k.d = 0; k.heading = 0; k.speed = 0; k.oobTime = 0;
                // respawn moves the kart back: reset the wrong-way watermark
                k.maxSTotal = k.sTotal;
                if (isPlayer && this.ui) { this.ui.showToast('已回到赛道'); }
            }
        } else {
            k.oobTime = 0;
        }
        // boost pads
        if (k.padCooldown > 0) { k.padCooldown -= dt; }
        else {
            const t = this._track.wrapS(k.sTotal) / L;
            for (const pad of BOOST_PADS) {
                if (t >= pad.t0 && t <= pad.t1 && Math.abs(k.d - pad.lat) < pad.hw) {
                    k.boostTime = KartConstants.PAD_BOOST_TIME;
                    k.boostMul = KartConstants.PAD_BOOST_MUL;
                    k.padCooldown = 2;
                    break;
                }
            }
        }
    }

    private _collideKarts() {
        for (let i = 0; i < this._karts.length; i++) {
            for (let j = i + 1; j < this._karts.length; j++) {
                const a = this._karts[i], b = this._karts[j];
                const ds = Math.abs(a.sTotal - b.sTotal);
                const dd = Math.abs(a.d - b.d);
                if (ds < 2.4 && dd < 1.9) {
                    const push = 0.8 * (1 - dd / 1.9);
                    const dir = a.d >= b.d ? 1 : -1;
                    a.d += dir * push * 0.5;
                    b.d -= dir * push * 0.5;
                    const avg = (a.speed + b.speed) / 2;
                    a.speed = avg * 0.98;
                    b.speed = avg * 0.98;
                }
            }
        }
    }

    // ---- visuals + camera ----

    private _updateVisuals(dt: number) {
        for (const k of this._karts) {
            const s = this._track.wrapS(k.sTotal);
            const frame = this._track.sampleAt(s, this._frame);
            this._track.posAt(s, k.d, this._tmpPos);
            const node = k.model.root;
            node.setPosition(this._tmpPos.x, this._tmpPos.y, this._tmpPos.z);
            const pitch = Math.asin(Math.max(-1, Math.min(1, frame.tangent.y)));
            const yaw = Math.atan2(frame.tangent.x, frame.tangent.z) - k.heading + k.spinYaw;
            const q = new Quat();
            Quat.fromEuler(q, -pitch * RAD2DEG, yaw * RAD2DEG, -frame.bank * RAD2DEG);
            node.setRotation(q);
            // wheels: spin by distance, fronts steer with the input
            k.wheelSpin += (k.speed * dt) / 0.34;
            const spinDeg = (k.wheelSpin * RAD2DEG) % 360;
            k.model.wheelFL.eulerAngles = new Vec3(spinDeg, 0, 0);
            k.model.wheelFR.eulerAngles = new Vec3(spinDeg, 0, 0);
            k.model.wheelRL.eulerAngles = new Vec3(spinDeg, 0, 0);
            k.model.wheelRR.eulerAngles = new Vec3(spinDeg, 0, 0);
            const steerDeg = k.steer * 28;
            k.model.steerFL.eulerAngles = new Vec3(0, steerDeg, 0);
            k.model.steerFR.eulerAngles = new Vec3(0, steerDeg, 0);
            // body lean: into the drift, out of the turn otherwise
            const lean = k.driftTime > 0 ? -k.driftDir * 8 : -k.steer * 4;
            k.model.body.eulerAngles = new Vec3(0, 0, lean);
        }
    }

    private _snapCameraToPlayer() {
        if (!this._camera || !this._player) { return; }
        const s = this._track.wrapS(this._player.sTotal);
        const frame = this._track.sampleAt(s, this._frame);
        this._track.posAt(s, this._player.d, this._tmpPos);
        const yaw = Math.atan2(frame.tangent.x, frame.tangent.z);
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        this._camPos.set(this._tmpPos.x - fx * 11, this._tmpPos.y + 4.2, this._tmpPos.z - fz * 11);
        this._camLook.set(this._tmpPos.x + fx * 6, this._tmpPos.y + 1.0, this._tmpPos.z + fz * 6);
        this._camera.setPosition(this._camPos);
        this._camera.lookAt(this._camLook, new Vec3(0, 1, 0));
        this._camInit = true;
    }

    private _updateCamera(dt: number, menu: boolean) {
        if (!this._camera || !this._player) { return; }
        const s = this._track.wrapS(this._player.sTotal);
        const frame = this._track.sampleAt(s, this._frame);
        this._track.posAt(s, this._player.d, this._tmpPos);
        const yaw = Math.atan2(frame.tangent.x, frame.tangent.z) - this._player.heading * 0.5;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const sway = menu ? Math.sin(this._raceTime * 0.2 + 1.2) * 2 : 0;
        const tx = this._tmpPos.x - fx * 11 + sway;
        const ty = this._tmpPos.y + 4.2;
        const tz = this._tmpPos.z - fz * 11;
        const lx = this._tmpPos.x + fx * 6;
        const ly = this._tmpPos.y + 1.0;
        const lz = this._tmpPos.z + fz * 6;
        if (!this._camInit) {
            this._camPos.set(tx, ty, tz);
            this._camLook.set(lx, ly, lz);
            this._camInit = true;
        } else {
            const kp = 1 - Math.exp(-6 * dt);
            const kl = 1 - Math.exp(-10 * dt);
            this._camPos.x += (tx - this._camPos.x) * kp;
            this._camPos.y += (ty - this._camPos.y) * kp;
            this._camPos.z += (tz - this._camPos.z) * kp;
            this._camLook.x += (lx - this._camLook.x) * kl;
            this._camLook.y += (ly - this._camLook.y) * kl;
            this._camLook.z += (lz - this._camLook.z) * kl;
        }
        this._camera.setPosition(this._camPos);
        this._camera.lookAt(this._camLook, new Vec3(0, 1, 0));
        if (this._cameraComp) {
            const spdRatio = Math.min(1, Math.max(0, this._player.speed / KartConstants.BASE_TOP_SPEED));
            (this._cameraComp as any).fov = 60 + spdRatio * 8;
        }
    }
}
