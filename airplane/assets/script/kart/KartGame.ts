/**
 * Kart race manager for the Star Fighter hall kart game （飞车狂飙 v1.0.12).
 *
 * Arcade spline model: each kart is (sTotal = unwrapped metres along the
 * centreline, d = lateral offset, heading = yaw vs the tangent, speed).
 * 8 karts (1 player + 7 AI), 3 laps, 32 checkpoints, countdown start,
 * drift + mini-turbo, boost pads, off-road slowdown, respawn, placement.
 * Milestone 2: item boxes / shells / banana / star (KartItems) + AI item
 * use + rubber-banding (KartItemsLogic). The hooks (itemKind/itemCount/
 * useItem) already exist so the UI stays stable.
 *
 * Scene contract (see build_kart_scene.py): this component lives on the
 * 'kartGame' node; the scene also has 'Main Camera' (3D) and 'Canvas'.
 * KartUI (on the Canvas) drives input + HUD and sets game.ui = itself.
 */

import { _decorator, AudioClip, AudioSource, Camera, Color, Component, DirectionalLight, isValid, Layers, ModelComponent, Node, Quat, Vec3, director, find, primitives, sys, utils } from 'cc';
import { ItemKind, KartConstants, PAINTS, PaintScheme, ROSTER, driftTierFor, paintTapResult, parseAudioOn, parseOwnedPaints, parseSelectedPaints, rewardForFinish, rosterOrder } from './KartConstants';
import { KartTrack, MeshBuilder, TrackFrame, trackDefById } from './KartTrack';
import { buildKartModel, KartModel } from './KartModel';
import { ensureStdEffect } from './KartMaterials';
import { KartItems } from './KartItems';
import { aiSkillOf, computeRubberBand, hash01 } from './KartItemsLogic';
const { ccclass, property } = _decorator;

const BEST_TIME_KEY = 'kart_best_time'; // 正赛 best (existing key, kept)
const BEST_TIME_KEY_REV = 'kart_best_time_rev'; // 逆向 best
const MODE_KEY = 'kart_mode'; // 'fwd' | 'rev', last chosen race direction
const TRACK_KEY = 'kart_track'; // selected track id ('sunset' | 'canyon')
const KART_KEY = 'kart_selected'; // selected roster index 0..7 (NEW key)
// Phase 2 step 3: progression — all local, all cosmetic. Coins are
// earned by finishing races; paints are colour swaps, never a gate.
const COINS_KEY = 'kart_coins'; // coin balance
const RACES_KEY = 'kart_races'; // total races finished
const WINS_KEY = 'kart_wins'; // total P1 finishes
const PAINTS_KEY = 'kart_paints'; // JSON: 8 rows of [bool x3] owned paints
const SELECTED_PAINTS_KEY = 'kart_paint_selected'; // JSON: 8 ints 0..2
const MUSIC_KEY = 'kart_music_on'; // '1' = music on, '0' = off (round 8 settings)
const SFX_KEY = 'kart_sfx_on'; // '1' = sfx on, '0' = off (round 8 settings)
const KART_VERSION = 'v1.0.12';
const RAD2DEG = 180 / Math.PI;

// Pass A (production feel): the old chase cam sat 11 m back / 4.2 m up, so
// the kart read tiny and the road was a thin band with empty sky below.
// Closer + lower + a stronger speed FOV kick fills the frame.
const CAM_BACK = 7.5; // metres behind the kart (was 11)
const CAM_UP = 2.9; // metres above the road (was 4.2)
const CAM_LOOK = 4.5; // metres ahead to look at (was 6)
const CAM_LOOK_Y = 0.9;
const FOV_BASE = 62; // was 60
const FOV_KICK = 14; // + at top speed (was 8)
const SMOKE_POOL = 56; // AAA: bigger puffs need more heads
const SPARK_POOL = 36; // drift-spark pool (step 4): small bright orange nodes

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
    itemArm: number; // > 0 while the roulette is spinning (item not usable)
    starTime: number; // > 0 while invulnerable (star)
    starHitT: number; // cooldown between star knock-asides
    aiSkill: number; // 0.5..1 (spec AI.ts skill formula)
    aiAggression: number; // 0.5..1, derived from skill
    aiItemDelay: number; // reaction delay after picking up an item
    aiHoldT: number; // seconds the current item has been held
    aiBand: number; // rubber-band target-speed multiplier (AI only)
    aiAssist: number; // rubber-band longitudinal accel, m/s^2 (AI only)
    wheelSpin: number;
    flame: Node; // boost flame cone (child of the kart root, on while boosting)
    smokeAcc: number; // drift-smoke spawn accumulator (seconds)
    wallHit: boolean; // set by _moveKart on a wall clamp, consumed by _afterMove (step 4 thud)
}

@ccclass('KartGame')
export class KartGame extends Component {
    /** Set by KartUI in its start(). All UI calls go through it (may be null). */
    public ui: any = null;
    /** Input from KartUI: -1..1 steer, drift held, brake held. */
    public steerInput = 0;
    public driftHeld = false;
    public brakeHeld = false;

    // ---- Pass D: audio clips, wired in kart.scene (uuids in res/audio) ----
    // bgm is kart-bgm.wav (step 4: own 120 BPM chiptune loop, replaces the
    // plane's tutorial bgm); use/spin still reuse the plane's clips;
    // engine/beep/go/pickup/screech/lap/finish/thud are kart-*.wav
    // synthesised for this game (see res/audio/sound).
    @property({ type: AudioClip })
    public bgmClip: AudioClip = null;
    @property({ type: AudioClip })
    public engineClip: AudioClip = null;
    @property({ type: AudioClip })
    public beepClip: AudioClip = null;
    @property({ type: AudioClip })
    public goClip: AudioClip = null;
    @property({ type: AudioClip })
    public pickupClip: AudioClip = null;
    @property({ type: AudioClip })
    public useClip: AudioClip = null;
    @property({ type: AudioClip })
    public spinClip: AudioClip = null;
    @property({ type: AudioClip })
    public screechClip: AudioClip = null;
    @property({ type: AudioClip })
    public lapClip: AudioClip = null;
    @property({ type: AudioClip })
    public finishClip: AudioClip = null;
    @property({ type: AudioClip })
    public thudClip: AudioClip = null;

    public state = 'menu'; // menu | countdown | racing | paused | finished

    private _reverse = false;
    /** True while racing 逆向 (reverse mode: same track, opposite direction). */
    public get reverseMode(): boolean { return this._reverse; }

    private _track: KartTrack = null;
    /** True once _buildWorld() has run (start() is async — see below). */
    private _worldBuilt = false;
    private _trackId = 'sunset';
    private _trackRoot: Node = null;
    private _karts: KartState[] = [];
    private _kartsRoot: Node = null;
    private _kartIdx = 0; // selected roster index (player's pick)
    private _player: KartState = null;
    private _items: KartItems = null;
    private _camera: Node = null;
    private _cameraComp: Camera = null;
    private _camPos = new Vec3();
    private _camLook = new Vec3();
    private _camInit = false;
    private _countdownT = 0;
    private _countdownShown = '';
    private _goHoldT = 0; // GO! display hold before racing starts (BUG 2)
    private _raceTime = 0;
    private _resultsShown = false;
    private _resultsT = 0;
    private _menuT = 0; // menu backdrop pan clock (raceTime is frozen in menu)
    private _bestTime = 0; // ms, 0 = none
    // ---- Phase 2 step 3: progression state (loaded in start()) ----
    private _coins = 0;
    private _races = 0;
    private _wins = 0;
    private _ownedPaints: boolean[][] = [];
    private _selectedPaints: number[] = [];
    private _lastReward = 0; // coins earned in the last finished race
    private _lastNewBest = false; // the last finish set a personal best
    private _frame: TrackFrame = {
        pos: new Vec3(), tangent: new Vec3(), right: new Vec3(), up: new Vec3(),
        half: 0, bank: 0, zone: 0, raceLat: 0,
    };
    private _tmpPos = new Vec3();
    private _tmpFrame2: TrackFrame = {
        pos: new Vec3(), tangent: new Vec3(), right: new Vec3(), up: new Vec3(),
        half: 0, bank: 0, zone: 0, raceLat: 0,
    };
    // ---- Pass A feel FX ----
    private _smoke: Array<{ node: Node; life: number; maxLife: number; vx: number; vz: number }> = [];
    private _smokePos = new Vec3();
    private _shakeAmp = 0;
    private _lastCollideShake = -10;
    // ---- Step 4 feel FX ----
    private _sparks: Array<{ node: Node; life: number; maxLife: number; vx: number; vy: number; vz: number }> = [];
    private _fovKick = 0; // extra FOV on boost, decays in _updateCamera
    private _lastWallThud = -10; // raceTime of the last wall-thud (throttled)
    // ---- Pass E presentation ----
    private _lastPos = 0;
    // ---- Pass D audio ----
    private _bgmSrc: AudioSource = null;
    private _engineSrc: AudioSource = null;
    private _sfxSrc: AudioSource = null;
    private _audioStarted = false;
    // Round 8 settings (persisted, default ON — loaded in start()
    // before _buildWorld creates the audio sources).
    private _musicOn = true;
    private _sfxOn = true;

    // ---- public state for the UI ----
    public get raceTime(): number { return this._raceTime; }
    public get playerLap(): number { return this._player ? this._player.lap : 1; }
    public get playerSpeedKmh(): number {
        return this._player ? Math.max(0, Math.round(this._player.speed * 3.6)) : 0;
    }
    public get playerPosition(): number { return this._rankOf(this._player); }
    public get bestTimeMs(): number { return this._bestTime; }
    /** Best times for both modes, for the menu (0 = none). */
    public bestTimes(): { fwd: number; rev: number } {
        const f = sys.localStorage.getItem(this._bestKey(false));
        const r = sys.localStorage.getItem(this._bestKey(true));
        return { fwd: f ? parseInt(f, 10) || 0 : 0, rev: r ? parseInt(r, 10) || 0 : 0 };
    }

    // ---- Phase 2 step 3: progression (public state for the UI) ----
    public get coins(): number { return this._coins; }
    public get races(): number { return this._races; }
    public get wins(): number { return this._wins; }
    /** Coins earned in the last finished race (0 = none yet). */
    public get lastReward(): number { return this._lastReward; }
    /** The last finish set a personal best on that track + mode. */
    public get lastNewBest(): boolean { return this._lastNewBest; }

    // ---- Round 8 settings (music / SFX toggles, persisted) ----
    public get musicOn(): boolean { return this._musicOn; }
    public get sfxOn(): boolean { return this._sfxOn; }
    public setMusicOn(on: boolean): void {
        this._musicOn = !!on;
        sys.localStorage.setItem(MUSIC_KEY, this._musicOn ? '1' : '0');
        if (this._bgmSrc) { (this._bgmSrc as any).volume = this._musicOn ? 0.3 : 0; }
    }
    public setSfxOn(on: boolean): void {
        this._sfxOn = !!on;
        sys.localStorage.setItem(SFX_KEY, this._sfxOn ? '1' : '0');
    }

    // ---- Round 8 drift HUD (live charge for the drift button) ----
    /** Player's live drift charge tier (0 = not charged, 1/2/3 = the
     * mini-turbo tiers) — the HUD recolours the DRIFT button by tier. */
    public get driftTier(): number {
        if (!this._player) { return 0; }
        return driftTierFor(this._player.driftTime);
    }
    /** Player's drift charge 0..1 (tier-3 threshold = full). */
    public get driftCharge(): number {
        if (!this._player) { return 0; }
        return Math.min(1, Math.max(0, this._player.driftTime / KartConstants.DRIFT_TIERS[2]));
    }

    /** Owned paints for a kart ([default, alt1, alt2]); default always owned. */
    public paintsOwned(kartIdx: number): boolean[] {
        if (kartIdx < 0 || kartIdx >= ROSTER.length) { return [true, false, false]; }
        // drive130: start() used to abort before progression loaded,
        // leaving _ownedPaints empty — never throw from here.
        const row = this._ownedPaints[kartIdx];
        return row ? row.slice() : [true, false, false];
    }

    /** Selected paint index (0..2) for a kart. */
    public selectedPaint(kartIdx: number): number {
        if (kartIdx < 0 || kartIdx >= ROSTER.length) { return 0; }
        return this._selectedPaints[kartIdx] || 0;
    }

    /** Tap a paint in the menu: owned -> select; locked + affordable ->
     * buy + select; locked + too poor -> 'poor' (UI toasts). Menu-only:
     * races never call it mid-race. */
    public tapPaint(kartIdx: number, paintIdx: number): 'selected' | 'bought' | 'poor' | 'invalid' {
        if (kartIdx < 0 || kartIdx >= ROSTER.length || paintIdx < 0 || paintIdx >= PAINTS[kartIdx].length) { return 'invalid'; }
        if (!this._ownedPaints[kartIdx]) { return 'invalid'; } // progression not loaded yet
        const res = paintTapResult(this._coins, PAINTS[kartIdx][paintIdx].price, this._ownedPaints[kartIdx][paintIdx]);
        if (res === 'poor') { return 'poor'; }
        if (res === 'bought') {
            this._coins -= PAINTS[kartIdx][paintIdx].price;
            this._ownedPaints[kartIdx][paintIdx] = true;
            sys.localStorage.setItem(COINS_KEY, String(this._coins));
            sys.localStorage.setItem(PAINTS_KEY, JSON.stringify(this._ownedPaints));
        }
        this._selectedPaints[kartIdx] = paintIdx;
        sys.localStorage.setItem(SELECTED_PAINTS_KEY, JSON.stringify(this._selectedPaints));
        if (this._karts.length > 0) { this._rebuildKarts(); }
        return res;
    }

    /** Paint scheme for a kart's selected paint, or null for the default. */
    private _paintFor(kartIdx: number): PaintScheme | null {
        if (kartIdx < 0 || kartIdx >= ROSTER.length) { return null; }
        const sel = this._selectedPaints[kartIdx] || 0;
        if (sel <= 0) { return null; }
        return PAINTS[kartIdx][sel];
    }

    /** Non-negative int from storage, 0 on garbage / missing. */
    private _loadInt(key: string): number {
        const raw = sys.localStorage.getItem(key);
        const n = raw ? parseInt(raw, 10) : 0;
        return (isNaN(n) || n < 0) ? 0 : n;
    }

    /**
     * Best-time key for the current track + direction. Track 1 keeps the
     * legacy keys (kart_best_time / _rev) so existing records survive;
     * later tracks get kart_best_time_<id> / _rev.
     */
    private _bestKey(reverse: boolean): string {
        if (this._trackId === 'sunset') { return reverse ? BEST_TIME_KEY_REV : BEST_TIME_KEY; }
        return 'kart_best_time_' + this._trackId + (reverse ? '_rev' : '');
    }

    /** Switch tracks from the menu: rebuild the world, re-place the karts. */
    public selectTrack(id: string): void {
        const def = trackDefById(id);
        if (def.id === this._trackId && this._track) { return; }
        this._trackId = def.id;
        sys.localStorage.setItem(TRACK_KEY, def.id);
        this._rebuildTrack();
        const saved = sys.localStorage.getItem(this._bestKey(this._reverse));
        this._bestTime = saved ? parseInt(saved, 10) || 0 : 0;
    }

    /** Selected roster index (the player's kart). */
    public get selectedKart(): number { return this._kartIdx; }

    /** Pick a kart from the menu (persisted). Rebuilds all kart models
     * so the player drives the new pick and no AI duplicates it. The
     * menu re-hides the player kart after this (see KartUI._selectKart).
     * Menu-only: races never call it mid-race. */
    public selectKart(index: number): void {
        if (this._karts.length === 0) { return; }
        const idx = (index >= 0 && index < ROSTER.length) ? index : 0;
        if (idx === this._kartIdx) { return; }
        this._kartIdx = idx;
        sys.localStorage.setItem(KART_KEY, String(idx));
        this._rebuildKarts();
    }

    /** Saved kart pick (0..7), default 凌风. Garbage in storage falls back to 0. */
    private _loadKartIdx(): number {
        const raw = sys.localStorage.getItem(KART_KEY);
        const n = raw ? parseInt(raw, 10) : 0;
        return (n >= 0 && n < ROSTER.length) ? n : 0;
    }

    /** Destroy all kart models and rebuild them in the new grid order
     * (player's pick first, then the rest in roster order). */
    private _rebuildKarts(): void {
        for (const k of this._karts) { k.model.root.destroy(); }
        this._karts = [];
        this._player = null;
        const order = rosterOrder(this._kartIdx);
        for (let i = 0; i < KartConstants.RACER_COUNT; i++) {
            const ks = this._makeKart(i, ROSTER[order[i]]);
            this._karts.push(ks);
            if (i === 0) { this._player = ks; }
        }
        this._snapCameraToPlayer();
    }

    /** Build one kart entry (model + flame + grid placement + state).
     * Used by start() and by _rebuildKarts() after a selection change.
     * The player kart uses the selected paint; AI karts always use
     * their default paint. */
    private _makeKart(i: number, stats: typeof ROSTER[0]): KartState {
        const model = buildKartModel(stats, i === 0 ? this._paintFor(this._kartIdx) : null);
        model.root.setParent(this._kartsRoot);
        // boost flame: 7 flat discs (short cylinders, axis along Z) in a
        // red -> white gradient, radii shrinking 0.19 -> 0.035 and spaced
        // 0.14 m apart along the kart's length — a long tapered tongue,
        // not a ball. fix133: the fix132 6-disc version (radii 0.30 ->
        // 0.07 over 0.60 m) still read as a round orange disc/balloon
        // from the chase cam (49y-drift-sparks.png, 49y-race-boost.png):
        // the discs were too wide and too short, so from behind they
        // were one big concentric circle. These are ~40% narrower and
        // 40% longer, and _updateVisuals flattens them vertically
        // (scale y 0.62x), so from behind they read as a flat flame
        // tongue with layered rings, and from the side as a tapered
        // tongue pointing backward. The flicker still stretches/scales
        // the node.
        const flame = new Node('flame');
        flame.layer = Layers.Enum.DEFAULT;
        flame.setParent(model.root);
        flame.setPosition(0, 0.34, -0.98);
        const fb = new MeshBuilder();
        const FLAME_DISCS: Array<[number, number, number]> = [
            [0xff4d00, 0.19, 0], [0xff7a1a, 0.16, -0.14], [0xffa31a, 0.13, -0.28],
            [0xffc21a, 0.10, -0.42], [0xffd23f, 0.075, -0.56], [0xffe97a, 0.05, -0.70],
            [0xfff6c9, 0.035, -0.84],
        ];
        for (const [hex, r, z] of FLAME_DISCS) {
            fb.addPrimitive(hex, primitives.cylinder(r, r, 0.06, { radialSegments: 12 }),
                new Vec3(0, 0, z), 0, new Vec3(1, 1, 1), Math.PI / 2);
        }
        fb.build(flame);
        flame.active = false;
        const pos = new Vec3();
        const yaw = this._track.gridSlot(i, pos);
        model.root.setPosition(pos.x, pos.y, pos.z);
        const q = new Quat();
        Quat.fromEuler(q, 0, yaw * RAD2DEG, 0);
        model.root.setRotation(q);
        const back = 11 + (i >> 1) * 8 + (i & 1) * 4;
        const skill = aiSkillOf(stats.handlingMul, hash01(i * 7 + 3));
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
            itemKind: ItemKind.NONE, itemCount: 0, itemArm: 0,
            starTime: 0, starHitT: 0,
            aiSkill: skill, aiAggression: 0.5 + skill * 0.5,
            aiItemDelay: 0, aiHoldT: 0, aiBand: 1, aiAssist: 0,
            wheelSpin: 0,
            flame, smokeAcc: 0, wallHit: false,
        };
        return ks;
    }

    /** Destroy the old track world and build the selected one. */
    private _rebuildTrack(): void {
        if (this._trackRoot) { this._trackRoot.destroy(); this._trackRoot = null; }
        const def = trackDefById(this._trackId);
        this._track = new KartTrack(def);
        this._track.reversed = this._reverse;
        const trackRoot = new Node('trackRoot');
        trackRoot.setParent(this.node);
        // drive130: a track-build failure must never abort the whole
        // game — the karts / menu / UI still load on a degraded track.
        try {
            this._track.buildWorld(trackRoot);
        } catch (e) {
            console.error('[Star Kart] buildWorld failed, continuing on degraded track: ' + e);
        }
        this._trackRoot = trackRoot;
        if (this._items) { this._items.setTrack(this._track); }
        this._resetGrid();
        this._snapCameraToPlayer();
    }
    /** Switch race direction (from the menu) and start in that mode. */
    public startRaceInMode(reverse: boolean) {
        this._reverse = reverse;
        sys.localStorage.setItem(MODE_KEY, reverse ? 'rev' : 'fwd');
        if (this._track) { this._track.reversed = reverse; }
        const saved = sys.localStorage.getItem(this._bestKey(reverse));
        this._bestTime = saved ? parseInt(saved, 10) || 0 : 0;
        this.startRace();
    }
    public get karts(): KartState[] { return this._karts; }
    public get track(): KartTrack { return this._track; }
    /** Selected track id ('sunset' | 'canyon'). */
    public get trackId(): string { return this._trackId; }

    start() {
        // race direction: last chosen mode (default 正赛）; the track maps
        // race coordinates to the centreline, so the grid / AI / items all
        // follow the mode without further branches.
        this._reverse = sys.localStorage.getItem(MODE_KEY) === 'rev';
        this._trackId = sys.localStorage.getItem(TRACK_KEY) || 'sunset';
        if (trackDefById(this._trackId).id !== this._trackId) { this._trackId = 'sunset'; }
        const saved = sys.localStorage.getItem(this._bestKey(this._reverse));
        this._bestTime = saved ? parseInt(saved, 10) || 0 : 0;

        // Phase 2 step 3: progression state FIRST (drive130) — start()
        // used to abort inside _rebuildTrack before this ran, leaving
        // _ownedPaints empty and the menu throwing on paintsOwned().
        this._coins = this._loadInt(COINS_KEY);
        this._races = this._loadInt(RACES_KEY);
        this._wins = this._loadInt(WINS_KEY);
        this._ownedPaints = parseOwnedPaints(sys.localStorage.getItem(PAINTS_KEY));
        this._selectedPaints = parseSelectedPaints(sys.localStorage.getItem(SELECTED_PAINTS_KEY));

        // Round 8 settings: music / SFX toggles (default ON).
        this._musicOn = parseAudioOn(sys.localStorage.getItem(MUSIC_KEY));
        this._sfxOn = parseAudioOn(sys.localStorage.getItem(SFX_KEY));

        // fix130 re-run 2: the world (track + karts) is built ONLY after
        // the PBR anchor effect has loaded (or failed — unlit fallback).
        // Building with an unresolved effect half-initialises SubModels
        // and bricks scene teardown (drive130d/f) — see KartMaterials.ts.
        // The menu (KartUI) shows meanwhile from its own start(), and
        // update() is null-safe until the world exists.
        ensureStdEffect().then(() => {
            if (this._worldBuilt) { return; }
            if (!isValid(this) || !this.node || !isValid(this.node)) { return; }
            this._buildWorld();
        });
    }

    /** Build the track world, sun, karts, pools, items and audio — only
     * after the material path is settled (see start()). */
    private _buildWorld(): void {
        this._worldBuilt = true;
        // selected track world (karts / items are created after this)
        this._rebuildTrack();

        // AAA rework: a real sun. kart.scene has no directional light
        // node at all, and the PBR kart paint needs a directional source
        // for specular pops — created in code (safer than scene JSON).
        // The sun (yaw 180) lights the karts' FRONT; the chase cam sees
        // the rear, so without a fill the rear is in deep shadow and dark
        // paints go black — the fill (yaw 0, ~half strength) lights
        // the chase-cam side, so the rear view reads glossy, not a black
        // silhouette. (The cc.d.ts stub has no HemisphereLight, so the
        // fill is a second directional, mirrored from the sun.)
        // fix133: the fill MUST be warm white, not cool blue — the old
        // cool fill (215,228,255) tinted yellow paint green, so kart 2
        // 闪电's rear rendered olive-green even though the material was
        // bright yellow [255,210,63] (probe-proven). Warm fill +
        // the paint emissive floor (KartModel.ts) keep the rear its own
        // hue. Sun 2.4 -> 2.6 for the lighter road (item 5).
        // fix134: the illuminances were ~40,000x too dim — Cocos
        // Creator 3.8 treats DirectionalLight.illuminance as LUX, and
        // 2.6/2.0 lux contributes ~nothing (probe-proven: sun=20/fill=10
        // changed nothing, sun=100000/fill=50000 brightened the road
        // from (24,53,89) to (83,103,130)). The scene was lit only by
        // the dim blue ambient + the 15% paint emissive floor — that is
        // why there was NO gloss anywhere, why orange read brown and
        // yellow read olive, and why the road read dark navy. The FILL
        // is the main light (renderScene._mainLight is the fill, not
        // the sun — the sun does not light the road or the kart rear in
        // this build, probe-proven), so fill 2.0 -> 80000 at elevation
        // 50° (road reads light grey-blue (109,124,148), paint vivid,
        // helmet shows a clear specular highlight). Sun 2.6 -> 40000:
        // dead in the web build, harmless there, may help other
        // pipelines. Rotations unchanged. Paint roughness 0.12 -> 0.08
        // (KartModel.ts) tightens the highlight further.
        const sun = new Node('sun');
        sun.layer = Layers.Enum.DEFAULT;
        sun.setParent(this.node);
        sun.setRotationFromEuler(-55, 180, 0);
        const sunLight = sun.addComponent(DirectionalLight);
        sunLight.illuminance = 40000;
        sunLight.color = new Color(255, 244, 214, 255);

        const fill = new Node('fill');
        fill.layer = Layers.Enum.DEFAULT;
        fill.setParent(this.node);
        fill.setRotationFromEuler(-50, 0, 0);
        const fillLight = fill.addComponent(DirectionalLight);
        fillLight.illuminance = 80000;
        fillLight.color = new Color(255, 238, 220, 255);

        // fix136: the side fills are REMOVED (were fix135). The two
        // extra directional lights (yaw ±90, 15000 lux) hijacked
        // renderScene._mainLight — the last-added directional became
        // the main light, so it dropped from the 80000-lux fill to the
        // 15000-lux fillL, and the road went dark navy again
        // (drive130 seventh re-run: road patch (44,71,105) mean 67
        // vs run 6 (114,129,152) mean 127). They also failed their
        // stated purpose (kart 2 side flank still olive, karts 3/7
        // still no side hotspot). With only sun + fill, _mainLight
        // is the 80000-lux fill again and run-6 brightness returns.

        const kartsRoot = new Node('karts');
        kartsRoot.setParent(this.node);
        this._kartsRoot = kartsRoot;
        // grid order: the saved pick drives karts[0] (the player), the
        // other 7 follow in roster order — no AI duplicates the pick.
        this._kartIdx = this._loadKartIdx();
        const order = rosterOrder(this._kartIdx);
        for (let i = 0; i < KartConstants.RACER_COUNT; i++) {
            const ks = this._makeKart(i, ROSTER[order[i]]);
            this._karts.push(ks);
            if (i === 0) { this._player = ks; }
        }

        // drift-smoke pool: shared sphere mesh + one grey material, nodes
        // reused so a race never allocates mid-frame. Small + short-lived
        // (fix131): the old 0.45->1.95 puffs were oversized white blobs.
        const smokePrim = primitives.sphere(0.5, { segments: 8 });
        const smokeMesh = utils.MeshUtils.createMesh({
            positions: smokePrim.positions, normals: smokePrim.normals,
            uvs: smokePrim.uvs, indices: smokePrim.indices,
            minPos: new Vec3(-0.5, -0.5, -0.5), maxPos: new Vec3(0.5, 0.5, 0.5),
        });
        const smokeMat = MeshBuilder.unlitMaterial(0x9aa0a6);
        for (let i = 0; i < SMOKE_POOL; i++) {
            const node = new Node('smoke');
            node.layer = Layers.Enum.DEFAULT;
            node.setParent(this.node);
            const r = node.addComponent(ModelComponent);
            r.mesh = smokeMesh;
            r.setMaterial(smokeMat, 0);
            node.active = false;
            this._smoke.push({ node, life: 0, maxLife: 0.55, vx: 0, vz: 0 });
        }

        this._items = new KartItems(this._track, this.node);
        this._items.buildBoxes();

        // Step 4: drift-spark pool — same pattern as the smoke pool, but
        // small bright gold nodes that live fast and die fast. Brighter
        // and bigger than smoke (fix131) so sparks are unmistakable.
        const sparkPrim = primitives.sphere(0.5, { segments: 6 });
        const sparkMesh = utils.MeshUtils.createMesh({
            positions: sparkPrim.positions, normals: sparkPrim.normals,
            uvs: sparkPrim.uvs, indices: sparkPrim.indices,
            minPos: new Vec3(-0.5, -0.5, -0.5), maxPos: new Vec3(0.5, 0.5, 0.5),
        });
        const sparkMat = MeshBuilder.unlitMaterial(0xff9d00);
        for (let i = 0; i < SPARK_POOL; i++) {
            const node = new Node('spark');
            node.layer = Layers.Enum.DEFAULT;
            node.setParent(this.node);
            const r = node.addComponent(ModelComponent);
            r.mesh = sparkMesh;
            r.setMaterial(sparkMat, 0);
            node.active = false;
            this._sparks.push({ node, life: 0, maxLife: 0.4, vx: 0, vy: 0, vz: 0 });
        }

        // Pass D: audio — three runtime sources (BGM loop, engine loop,
        // one-shots). Clips come from the @property fields wired in the scene.
        this._bgmSrc = this.node.addComponent(AudioSource);
        (this._bgmSrc as any).clip = this.bgmClip;
        (this._bgmSrc as any).loop = true;
        (this._bgmSrc as any).volume = this._musicOn ? 0.3 : 0;
        this._engineSrc = this.node.addComponent(AudioSource);
        (this._engineSrc as any).clip = this.engineClip;
        (this._engineSrc as any).loop = true;
        (this._engineSrc as any).volume = 0;
        this._sfxSrc = this.node.addComponent(AudioSource);
        // item sound hooks (player only — 7 AI karts stay silent)
        this._items.onPickup = (k) => { if (k.isPlayer) { this._playSfx(this.pickupClip); } };
        this._items.onUse = (k) => { if (k.isPlayer) { this._playSfx(this.useClip); } };
        this._items.onSpinOut = (k) => { if (k.isPlayer) { this._playSfx(this.spinClip); } };

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
        this._updateEngineAudio();
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
                if (label === '3' || label === '2' || label === '1') { this._playSfx(this.beepClip); }
                else if (label === 'GO!') { this._playSfx(this.goClip); }
                if (this.ui) { this.ui.showCountdown(label); }
            }
            if (this._countdownT <= 0) {
                // hold GO! + all-green lights so they are actually visible
                // (was: same frame switched to racing and cleared the label)
                if (this._goHoldT > 0) {
                    this._goHoldT -= dt;
                } else {
                    this.state = 'racing';
                    this._raceTime = 0;
                    // Round 8: perfect start — holding DRIFT as GO fires
                    // grants a tier-2 mini-turbo (PopKart feel: time the
                    // start, get the boost). The menu guide teaches it.
                    if (this.driftHeld && this._player) {
                        this._player.boostTime = KartConstants.DRIFT_BOOST_TIME[2];
                        this._player.boostMul = KartConstants.DRIFT_BOOST_STRENGTH[2];
                        this._boostKick(6, 0.08);
                        if (this.ui) { this.ui.showToast('🚀 完美起步！'); }
                    }
                    if (this.ui) { this.ui.showCountdown(''); this.ui.showHud(true); }
                }
            }
            this._updateCamera(dt, true);
            return;
        }
        if (this.state === 'racing') {
            // drive130: if start() aborted before the karts were built,
            // _player is null — never flood per-frame errors.
            if (!this._player || this._karts.length === 0) { return; }
            this._raceTime += dt;
            this._updateRubberBand(dt);
            for (const k of this._karts) {
                if (k.isPlayer) { this._updatePlayer(k, dt); }
                else { this._updateAI(k, dt); }
            }
            this._collideKarts();
            if (this._items) { this._items.update(dt, this._karts, this._raceTime); }
            this._updateVisuals(dt);
            this._updateCamera(dt, false);
            if (this.ui) { this.ui.tickHud(); }
            // position-change toasts (skip the opening scramble; player still racing)
            if (!this._player.finished) {
                const pos = this.playerPosition;
                if (this._lastPos > 0 && pos !== this._lastPos && this._raceTime > 3) {
                    if (this.ui) {
                        this.ui.showToast(pos < this._lastPos ? '⬆ 超到第 ' + pos + ' 名！' : '⬇ 掉到第 ' + pos + ' 名！');
                    }
                }
                this._lastPos = pos;
            }
            if (this._player.finished && !this._resultsShown) {
                this._resultsT += dt;
                const allDone = this._karts.every((k) => k.finished);
                if (allDone || this._resultsT >= KartConstants.RESULTS_DELAY) {
                    this._resultsShown = true;
                    this.state = 'finished';
                    // kill live smoke/spark puffs so none drift across the
                    // results panel while it is up (the background keeps
                    // rolling behind it).
                    this._clearSmokeSparks();
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
            this._menuT += dt;
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
        this._goHoldT = KartConstants.GO_HOLD;
        this._raceTime = 0;
        this._resultsShown = false;
        this._resultsT = 0;
        this._lastPos = 0;
        this._lastReward = 0;
        this._lastNewBest = false;
        this.state = 'countdown';
        this._startRaceAudio();
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

    /** Item use (milestone 2: mushroom / shells / banana / star via KartItems). */
    public useItem() {
        if (this.state !== 'racing' || !this._player || !this._items) { return; }
        if (this._player.finished) { return; }
        if (this._items.useItem(this._player, false, this._raceTime)) {
            if (this.ui) { this.ui.tickHud(); }
        }
    }

    /** Rubber band (spec AI.ts AIField.beginFrame) — AI only, never the player. */
    private _updateRubberBand(dt: number): void {
        // finished karts are excluded from the reference (they keep circulating
        // for the results backdrop; measuring against them would pin catch-up
        // at maximum once the winner crosses the line).
        let leadDist = -Infinity;
        for (const k of this._karts) {
            if (!k.finished && k.sTotal > leadDist) { leadDist = k.sTotal; }
        }
        if (leadDist === -Infinity) {
            for (const k of this._karts) { if (k.sTotal > leadDist) { leadDist = k.sTotal; } }
        }
        for (const k of this._karts) {
            if (k.isPlayer) { continue; }
            const gapToLead = leadDist - k.sTotal;
            const gapToPlayer = k.sTotal - this._player.sTotal;
            const out = computeRubberBand({
                gapToLead, gapToPlayer,
                leading: gapToLead < 1,
                prevBand: k.aiBand, prevAssist: k.aiAssist, dt,
            });
            k.aiBand = out.band;
            k.aiAssist = out.assist;
        }
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
            k.itemKind = ItemKind.NONE; k.itemCount = 0; k.itemArm = 0;
            k.starTime = 0; k.starHitT = 0; k.wallHit = false;
            k.aiItemDelay = 0; k.aiHoldT = 0; k.aiBand = 1; k.aiAssist = 0;
        }
        if (this._items) { this._items.reset(); }
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
            if (k.spinTime <= 0) {
                // spin ends aligned with the road (milestone 1 never spun a
                // kart, so this reset was dead code until milestone 2)
                k.spinTime = 0;
                k.spinYaw = 0;
            }
            this._moveKart(k, dt);
            return;
        }
        // steer smoothing (spec STEER_RATE_LOW 10.5 / HIGH 5.6)
        const spdRatio = Math.min(1, Math.max(0, k.speed / KartConstants.BASE_TOP_SPEED));
        const steerRate = KartConstants.STEER_RATE_LOW + (KartConstants.STEER_RATE_HIGH - KartConstants.STEER_RATE_LOW) * spdRatio;
        const dSteer = steerTarget - k.steer;
        const maxStep = steerRate * dt;
        k.steer += Math.max(-maxStep, Math.min(maxStep, dSteer));

        // drift engage / hold / release — charge rate scales with the
        // kart's drift stat (driftMul 0.90..1.10), so the visible drift
        // stat changes how fast a mini-turbo builds, not just the turn.
        if (wantDrift && Math.abs(k.steer) > KartConstants.DRIFT_ENGAGE_STEER && k.speed > KartConstants.DRIFT_MIN_SPEED) {
            if (k.driftTime <= 0) {
                k.driftTime = 0.001;
                k.driftDir = k.steer > 0 ? 1 : -1;
            }
            k.driftTime += dt * stats.driftMul;
            if (k.driftTime > KartConstants.DRIFT_MAX_HOLD) {
                const tier = this._releaseDrift(k);
                if (isPlayer && tier >= 1) { this._boostKick(3 + tier * 1.5, 0.06 + tier * 0.02); if (tier >= 2) { this._playSfx(this.screechClip); } }
            }
        } else if (k.driftTime > 0) {
            const tier = this._releaseDrift(k);
            if (isPlayer && tier >= 1) { this._boostKick(3 + tier * 1.5, 0.06 + tier * 0.02); if (tier >= 2) { this._playSfx(this.screechClip); } }
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
        // star: faster while invulnerable (spec STAR_MUL 1.15)
        if (k.starTime > 0) { target *= KartConstants.ITEM_STAR_MUL; }
        // rubber band: AI only, never the player (spec AI.ts)
        if (!isPlayer) { target *= k.aiBand; }
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
        if (!isPlayer && k.aiAssist !== 0) {
            // catch-up / leash accel, capped so it can never launch a kart
            k.speed += k.aiAssist * dt;
            const cap = target * 1.1 + 2;
            if (k.speed > cap) { k.speed = cap; }
            if (k.speed < 0) { k.speed = 0; }
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

    private _releaseDrift(k: KartState): number {
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
        return tier;
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
            k.wallHit = true; // step 4: _afterMove turns this into a thud (throttled)
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
                    this._playSfx(this.lapClip); // step 4: lap fanfare
                    if (this.ui) {
                        if (lap === KartConstants.LAP_COUNT) { this.ui.showBanner('🏁 最后一圈！', 2); }
                        else { this.ui.showToast('第 ' + lap + ' 圈！'); }
                    }
                }
            }
            if (lap > KartConstants.LAP_COUNT && !k.finished) {
                k.finished = true;
                k.finishTime = this._raceTime;
                if (isPlayer) {
                    const ms = Math.round(this._raceTime * 1000);
                    const isNewBest = this._bestTime === 0 || ms < this._bestTime;
                    if (isNewBest) {
                        this._bestTime = ms;
                        sys.localStorage.setItem(this._bestKey(this._reverse), String(ms));
                    }
                    // Phase 2 step 3: race rewards — position coins + a
                    // new-best bonus; races/wins counters. Saved at once,
                    // shown on the results panel (UI reads lastReward).
                    const pos = this._rankOf(k);
                    this._lastReward = rewardForFinish(pos, isNewBest);
                    this._lastNewBest = isNewBest;
                    this._coins += this._lastReward;
                    this._races += 1;
                    if (pos === 1) { this._wins += 1; }
                    sys.localStorage.setItem(COINS_KEY, String(this._coins));
                    sys.localStorage.setItem(RACES_KEY, String(this._races));
                    sys.localStorage.setItem(WINS_KEY, String(this._wins));
                    this._playSfx(this.finishClip); // step 4: finish jingle
                    if (this.ui) { this.ui.showToast('🏁 完赛！'); }
                }
            }
        }
        // wall thud (step 4): the clamp flag rides the wall for many
        // frames, so the sound + shake are throttled to once per 0.4 s.
        if (k.wallHit) {
            k.wallHit = false;
            if (isPlayer && this._raceTime - this._lastWallThud > 0.4) {
                this._lastWallThud = this._raceTime;
                this._playSfx(this.thudClip);
                this.addShake(0.06);
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
        // boost pads (direction-aware: the track mirrors the t-range in reverse)
        if (k.padCooldown > 0) { k.padCooldown -= dt; }
        else if (this._track.padBoostAt(k.sTotal, k.d)) {
            k.boostTime = KartConstants.PAD_BOOST_TIME;
            k.boostMul = KartConstants.PAD_BOOST_MUL;
            k.padCooldown = 2;
            if (isPlayer) { this._boostKick(9, 0.10); } // step 4: FOV kick + shake (round 8: 7 -> 9, pads must feel fast)
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
                    // bump shake + thud (player only, at most once per 0.5 s)
                    if ((a.isPlayer || b.isPlayer) && this._raceTime - this._lastCollideShake > 0.5) {
                        this._lastCollideShake = this._raceTime;
                        this.addShake(0.12);
                        this._playSfx(this.thudClip); // step 4: collision thud
                    }
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
            // boost flame: on while boosting, flickers; stronger boosts
            // (tier 2/3 mini-turbo, pad) read bigger and longer
            const boosting = k.boostTime > 0 && !k.finished;
            k.flame.active = boosting;
            if (boosting) {
                const tier = k.boostMul >= 1.3 ? 1.25 : k.boostMul >= 1.2 ? 1.12 : 1;
                const f = (0.85 + 0.35 * Math.sin(this._raceTime * 43 + k.sTotal * 0.1)) * tier;
                // fix133: flatten vertically (y 0.62x) so the flame reads
                // as a flat horizontal tongue from the chase cam, not a
                // round ball — the discs face the camera base-on.
                k.flame.setScale(f, f * 0.62, (0.8 + 0.6 * Math.random()) * tier);
            }
            // drift smoke: rear-wheel puffs while drifting (nearby karts only).
            // No new puffs once results are up — the panel is on screen and
            // the background karts keep coasting/drifting behind it.
            if (k.driftTime > 0 && this.state !== 'finished' && Math.abs(k.sTotal - this._player.sTotal) < 90) {
                k.smokeAcc += dt;
                while (k.smokeAcc >= 0.09) {
                    k.smokeAcc -= 0.09;
                    const side = Math.random() < 0.5 ? -0.85 : 0.85;
                    const sideSign = side < 0 ? -1 : 1;
                    this._track.posAt(k.sTotal - 1.1, k.d + side, this._smokePos);
                    // puffs billow outward from the wheel, along the road's
                    // lateral axis; sparks burst the same way, faster
                    const ovx = frame.right.x * sideSign * 1.6;
                    const ovz = frame.right.z * sideSign * 1.6;
                    this._spawnSmoke(this._smokePos.x, this._smokePos.y + 0.25, this._smokePos.z, ovx, ovz);
                    // step 4: drift sparks — bright orange flecks at the
                    // same rear wheels, fewer and faster than the smoke
                    if (Math.random() < 0.8) {
                        this._spawnSpark(this._smokePos.x, this._smokePos.y + 0.15, this._smokePos.z, ovx * 2.2, ovz * 2.2);
                    }
                }
            }
        }
        this._updateSmoke(dt);
        this._updateSparks(dt);
    }

    /** Camera shake: amp in metres, decays in _updateCamera. */
    public addShake(amp: number): void {
        if (amp > this._shakeAmp) { this._shakeAmp = amp; }
    }

    /** Step 4: boost feel — FOV kick (decays in _updateCamera) + shake. */
    private _boostKick(fovAmp: number, shakeAmp: number): void {
        if (fovAmp > this._fovKick) { this._fovKick = fovAmp; }
        this.addShake(shakeAmp);
    }

    // ---- Pass D audio ----

    private _playSfx(clip: AudioClip | null): void {
        if (!clip || !this._sfxSrc || !this._sfxOn) { return; }
        (this._sfxSrc as any).playOneShot(clip, 0.9);
    }

    /** Start BGM + engine loops on the first race (kept running after). */
    private _startRaceAudio(): void {
        if (this._audioStarted) { return; }
        this._audioStarted = true;
        if (this._bgmSrc && this.bgmClip) { this._bgmSrc.play(); }
        if (this._engineSrc && this.engineClip) { this._engineSrc.play(); }
    }

    /** Engine pitch + volume follow player speed; quiet idle in menu/pause. */
    private _updateEngineAudio(): void {
        if (!this._engineSrc || !this._audioStarted) { return; }
        const spd = this._player ? this._player.speed : 0;
        const ratio = Math.min(1, Math.max(0, spd / KartConstants.BASE_TOP_SPEED));
        (this._engineSrc as any).pitch = 0.7 + ratio * 0.9;
        let vol = 0.08; // menu / finished idle
        if (this.state === 'racing') { vol = 0.22 + ratio * 0.28; }
        else if (this.state === 'countdown') { vol = 0.15; }
        else if (this.state === 'paused') { vol = 0.03; }
        (this._engineSrc as any).volume = this._sfxOn ? vol : 0;
    }

    /** Results are up: deactivate every live smoke/spark puff at once
     * (they fade in 0.25–0.8 s on their own, which is long enough to
     * drift across the panel). Emission is separately gated in
     * _updateVisuals while state is 'finished'. */
    private _clearSmokeSparks(): void {
        for (const s of this._smoke) { s.node.active = false; }
        for (const s of this._sparks) { s.node.active = false; }
    }

    /** fix132: smaller, shorter-lived, darker puffs (spawn 0.22, grow to
     * ~0.55, mid-grey so they never read as white blobs) that billow
     * outward from the wheel — plus a near-camera shrink, so a puff
     * right in front of the chase cam can never fill the frame. */
    private _spawnSmoke(x: number, y: number, z: number, vx: number = 0, vz: number = 0): void {
        for (const s of this._smoke) {
            if (s.node.active) { continue; }
            s.node.active = true;
            s.node.setPosition(x, y, z);
            s.life = s.maxLife = 0.45 + Math.random() * 0.15;
            s.vx = vx;
            s.vz = vz;
            s.node.setScale(0.22, 0.22, 0.22);
            return;
        }
    }

    private _updateSmoke(dt: number): void {
        for (const s of this._smoke) {
            if (!s.node.active) { continue; }
            s.life -= dt;
            if (s.life <= 0) { s.node.active = false; continue; }
            const t = 1 - s.life / s.maxLife; // 0..1 grown
            const grow = 0.22 + t * 0.33;
            const end = s.life < 0.18 ? Math.max(0.05, s.life / 0.18) : 1;
            // shrink puffs near the chase cam (scale x0.25 at the lens,
            // full size past 4 m) — smoke must read as drift effect,
            // never as a wall in front of the camera
            const p = s.node.position;
            const dx = p.x - this._camPos.x, dy = p.y - this._camPos.y, dz = p.z - this._camPos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const near = dist < 4 ? Math.max(0.25, dist / 4) : 1;
            const sc = grow * end * near;
            s.node.setScale(sc, sc, sc);
            s.node.setPosition(p.x + s.vx * dt, p.y + dt * 0.6, p.z + s.vz * dt);
        }
    }

    /** Step 4: grab a free spark node, light it at the rear wheel.
     * fix132: bigger + deeper gold-orange (the old 0xffc21a dots read
     * white next to the near-white smoke; the smoke is darker now too). */
    private _spawnSpark(x: number, y: number, z: number, vx: number = 0, vz: number = 0): void {
        for (const s of this._sparks) {
            if (s.node.active) { continue; }
            s.node.active = true;
            s.node.setPosition(x, y, z);
            s.life = s.maxLife = 0.4 + Math.random() * 0.2;
            s.vx = vx;
            s.vy = 2.0 + Math.random() * 1.5;
            s.vz = vz;
            s.node.setScale(0.38, 0.38, 0.38);
            return;
        }
    }

    /** Step 4: sparks burst outward, arc up, then fall and flicker out. */
    private _updateSparks(dt: number): void {
        for (const s of this._sparks) {
            if (!s.node.active) { continue; }
            s.life -= dt;
            if (s.life <= 0) { s.node.active = false; continue; }
            const t = s.life / s.maxLife; // 1..0 shrinking
            const sc = 0.38 * t;
            s.node.setScale(sc, sc, sc);
            s.vy -= 6 * dt; // gravity: the burst arcs and falls
            const p = s.node.position;
            s.node.setPosition(p.x + s.vx * dt, p.y + s.vy * dt, p.z + s.vz * dt);
        }
    }

    private _snapCameraToPlayer() {
        if (!this._camera || !this._player) { return; }
        const s = this._track.wrapS(this._player.sTotal);
        const frame = this._track.sampleAt(s, this._frame);
        this._track.posAt(s, this._player.d, this._tmpPos);
        const yaw = Math.atan2(frame.tangent.x, frame.tangent.z);
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        this._camPos.set(this._tmpPos.x - fx * CAM_BACK, this._tmpPos.y + CAM_UP, this._tmpPos.z - fz * CAM_BACK);
        this._camLook.set(this._tmpPos.x + fx * CAM_LOOK, this._tmpPos.y + CAM_LOOK_Y, this._tmpPos.z + fz * CAM_LOOK);
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
        const sway = menu ? Math.sin(this._menuT * 0.15) * 6 : 0;
        const tx = this._tmpPos.x - fx * CAM_BACK + sway;
        const ty = this._tmpPos.y + CAM_UP;
        const tz = this._tmpPos.z - fz * CAM_BACK;
        const lx = this._tmpPos.x + fx * CAM_LOOK;
        const ly = this._tmpPos.y + CAM_LOOK_Y;
        const lz = this._tmpPos.z + fz * CAM_LOOK;
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
        // shake: random offset that decays (boost / collision kicks)
        if (this._shakeAmp > 0.001) {
            this._camPos.x += (Math.random() - 0.5) * this._shakeAmp;
            this._camPos.y += (Math.random() - 0.5) * this._shakeAmp;
            this._camPos.z += (Math.random() - 0.5) * this._shakeAmp;
            this._shakeAmp = Math.max(0, this._shakeAmp - dt * 0.5);
        }
        this._camera.setPosition(this._camPos);
        this._camera.lookAt(this._camLook, new Vec3(0, 1, 0));
        if (this._cameraComp) {
            const spdRatio = Math.min(1, Math.max(0, this._player.speed / KartConstants.BASE_TOP_SPEED));
            // step 4: boost FOV kick rides on top of the speed FOV and decays
            if (this._fovKick > 0) { this._fovKick = Math.max(0, this._fovKick - dt * 14); }
            (this._cameraComp as any).fov = FOV_BASE + spdRatio * FOV_KICK + this._fovKick;
        }
    }
}
