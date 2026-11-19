/**
 * Kart HUD + touch controls for the hall kart game （飞车狂飙）.
 *
 * Touch (phones): left half = floating steer stick (push down = brake),
 * right side = DRIFT (hold) + ITEM (tap) buttons. Keyboard (desktop
 * playtest): arrows / WASD steer, Down/S brake, Shift drift, Space item,
 * Enter start, P pause, Esc back to hall.
 *
 * Everything is built at runtime under the scene's Canvas (same pattern
 * as GameManager's HUD): no scene-authored UI, no art assets. The
 * minimap is a Graphics polyline of the centreline + 8 kart dots.
 * Input listeners are registered in onEnable and removed in onDisable
 * (the scene is unloaded when returning to the hall — never leak them).
 *
 * Round-8 art direction ("PopKart candy"): the old deep-navy sticker
 * panels are gone — white candy cards with thick coloured outlines,
 * bright saturated button colours, chunky 3D toy-button faces (gloss
 * strip on top, darker shade at the bottom), bold dark type on white,
 * gold kept only as the hero accent on dark backgrounds (title,
 * countdown, results title). One language with the PopKart karts and
 * the bright hall: bright, chunky, rounded, glossy, playful. Layout
 * (node names + positions) is unchanged — the drive130 harness probes
 * buttons by name/position, so the redesign is look-only except where
 * noted (stat bars replace stat dots; guide chips replace the hint
 * line; a settings panel is added). Labels, buttons and flows are
 * unchanged; only the look moved.
 */

import { _decorator, Color, Component, EventTouch, Graphics, Input, input, KeyCode, Label, Layers, Node, UITransform, Vec3, find, view } from 'cc';
import { KartGame } from './KartGame';
import { TRACK_DEFS } from './KartTrack';
import { ITEM_NAMES, KartConstants, PAINTS, ROSTER, statBarFill } from './KartConstants';
const { ccclass, property } = _decorator;

const GOLD = new Color(255, 196, 0, 255);
const WHITE = new Color(255, 255, 255, 255);
const GREY = new Color(170, 170, 170, 255);
const RED = new Color(255, 90, 90, 255);
const STICK_RADIUS = 60;
// Round-8 "PopKart candy" palette: white candy cards, bright saturated
// buttons, bold dark type on white. Gold stays the hero accent, but
// only on dark backgrounds (title, countdown, results title) — gold
// type on white is unreadable.
const NAVY = new Color(16, 24, 42, 255);
const INK = new Color(26, 29, 36, 255);
const SLATE = new Color(100, 116, 139, 255);
const PILL_LINE = new Color(203, 213, 225, 255);
const SKY = new Color(46, 168, 255, 255);
const ORANGE = new Color(255, 122, 26, 255);
const MINT = new Color(60, 220, 130, 255);
const PINK = new Color(235, 80, 180, 255);
const SHADOW = new Color(0, 0, 0, 150);
const DIM_BG = new Color(52, 58, 72, 255);
// Chunky button colours (PopKart start/CTA language).
const CANDY_GREEN = new Color(34, 197, 94, 255);
const CANDY_RED = new Color(255, 59, 92, 255);
const CANDY_PURPLE = new Color(139, 92, 246, 255);
const CANDY_TEAL = new Color(20, 184, 166, 255);
const CANDY_ORANGE = new Color(255, 138, 61, 255);
// Drift turbo tier colours (PopKart drift flames: blue -> orange ->
// red -> gold as the charge builds).
const DRIFT_TIER_COLS = [SKY, ORANGE, CANDY_RED, GOLD];

/** Darker shade of a colour (the chunky button's bottom edge). */
function shadeColor(c: Color, f: number): Color {
    return new Color(
        Math.min(255, Math.max(0, Math.round(c.r * f))),
        Math.min(255, Math.max(0, Math.round(c.g * f))),
        Math.min(255, Math.max(0, Math.round(c.b * f))), c.a);
}

/** Restyleable button face (size + base colour), for selected states. */
interface BtnStyle { node: Node; w: number; h: number; bg: Color; }

// Decorative emoji per track, in TRACK_DEFS order (🌊 sunset, 🌵 canyon).
// Module-level so _buildPanels and _refreshTrackUI use the same icons.
const TRACK_ICONS = ['🌊', '🌵'];

function fmtTime(t: number): string {
    if (t <= 0) { return '0:00.0'; }
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const si = Math.floor(s);
    const d = Math.floor((s - si) * 10);
    return m + ':' + (si < 10 ? '0' : '') + si + '.' + d;
}

/** True when a 0xRRGGBB colour is light enough to need dark label text. */
function lightColour(hex: number): boolean {
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

@ccclass('KartUI')
export class KartUI extends Component {
    private _game: KartGame = null;
    private _canvas: Node = null;

    // HUD
    private _posLabel: Label = null;
    private _lapLabel: Label = null;
    private _timeLabel: Label = null;
    private _zoneLabel: Label = null;
    private _speedLabel: Label = null;
    private _itemLabel: Label = null;
    private _countdownLabel: Label = null;
    private _toastLabel: Label = null;
    private _toastTime = 0;
    // Pass E: countdown lights, big banner, results confetti + pop-in
    private _countLights: Label[] = [];
    private _countGantry: Node = null; // start-light gantry bar + posts behind the dots
    private _bannerLabel: Label = null;
    private _bannerTime = 0;
    private _bannerPill: Node = null;
    private _countPopT = 0; // countdown numeral pop (scale 1.3 -> 1)
    private _toastPill: Node = null;
    private _driftRing: Node = null; // gold ring around DRIFT while held
    private _confetti: Graphics = null;
    private _confettiParts: Array<{ x: number; y: number; vx: number; vy: number; c: Color; s: number; ph: number; round: boolean }> = [];
    private _confettiT = 0;
    private _resultsPopT = 0;
    private _minimap: Graphics = null;
    private _minimapNode: Node = null;
    private _minimapT = 0;
    private _hudRoot: Node = null;
    // Pass A: speed lines — radial streaks that fade in with speed
    private _speedLines: Graphics = null;
    private _speedLinesT = 0;

    // panels
    private _menuPanel: Node = null;
    private _menuScrim: Graphics = null;
    private _menuScrimNode: Node = null;
    private _menuBestLabel: Label = null;
    private _trackBtnLabels: Label[] = [];
    private _trackBtnStyles: BtnStyle[] = [];
    private _trackDescLabel: Label = null;
    // kart select (Phase 2 step 2): one chip per roster kart + the
    // selected kart's name/tagline and 1..5 stat bars (round 8: chunky
    // bars replace the cramped stat dots).
    private _kartBtnLabels: Label[] = [];
    private _kartBtnStyles: BtnStyle[] = [];
    private _kartNameLabel: Label = null;
    private _statBars: Array<{ fill: Graphics; w: number }> = [];
    private _statValueLabels: Label[] = [];
    // Round 8: drift turbo tier (button + ring recolour), item-roulette
    // pop, settings panel, pause scrim.
    private _driftBtnNode: Node = null;
    private _lastDriftTier = -1;
    private _itemPill: Node = null;
    private _itemPopT = 0;
    private _lastItemKind = 0;
    private _lastItemArm = 0;
    private _settingsPanel: Node = null;
    private _settingsFrom = 'menu';
    private _musicToggleLabel: Label = null;
    private _musicToggleStyle: BtnStyle = null;
    private _sfxToggleLabel: Label = null;
    private _sfxToggleStyle: BtnStyle = null;
    private _pauseScrim: Graphics = null;
    private _pauseScrimNode: Node = null;
    // progression (Phase 2 step 3): coins + races/wins line, and the
    // selected kart's 3 paint buttons (default + 2 unlockables).
    private _coinsLabel: Label = null;
    private _paintBtnLabels: Label[] = [];
    private _paintBtnStyles: BtnStyle[] = [];
    private _resultsPanel: Node = null;
    private _resultsLabel: Label = null;
    private _resultsTitle: Label = null;
    // results scrim: dims the live 3D world behind the standings so the
    // player's kart and drift smoke don't strike through the text
    // (same pattern as the menu scrim; drive127 found the reward line
    // half-covered by the kart at the finish).
    private _resultsScrim: Graphics = null;
    private _resultsScrimNode: Node = null;
    private _pausePanel: Node = null;

    // touch state
    private _stickId = -1;
    private _stickOX = 0;
    private _stickOY = 0;
    private _stickDX = 0;
    private _stickDY = 0;
    private _stickBase: Node = null;
    private _stickKnob: Node = null;
    private _driftId = -1;
    private _keys: { [code: number]: boolean } = {};

    start() {
        const gameNode = find('kartGame');
        if (gameNode) {
            this._game = gameNode.getComponent(KartGame);
            if (this._game) { this._game.ui = this; }
        }
        this._canvas = find('Canvas');
        if (!this._canvas) { return; }
        this._buildHud();
        this._buildPanels();
        this._buildSettings();
        this._buildStick();
        if (this._game && this._game.state === 'menu') { this.showMenu(); }
    }

    onEnable() {
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this._onKeyUp, this);
    }

    onDisable() {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this._onKeyUp, this);
    }

    update(dt: number) {
        if (!this._game) { return; }
        // toast auto-hide
        if (this._toastTime > 0) {
            this._toastTime -= dt;
            if (this._toastTime <= 0) {
                if (this._toastLabel) { this._toastLabel.node.active = false; }
                if (this._toastPill) { this._toastPill.active = false; }
            }
        }
        // banner auto-hide
        if (this._bannerTime > 0) {
            this._bannerTime -= dt;
            if (this._bannerTime <= 0) {
                if (this._bannerLabel) { this._setDisplayActive(this._bannerLabel, false); }
                if (this._bannerPill) { this._bannerPill.active = false; }
            }
        }
        // countdown numeral pop-in (scale 1.3 -> 1 over 0.18 s)
        if (this._countPopT > 0 && this._countdownLabel) {
            this._countPopT -= dt;
            const t = Math.max(0, this._countPopT / 0.18);
            const s = 1 + 0.3 * t;
            this._setDisplayScale(this._countdownLabel, s);
        }
        // drift button ring: gold halo while the drift touch is held
        if (this._driftRing) { this._driftRing.active = this._driftId >= 0; }
        // Round 8: item pop — the item pill punches out (1.25x -> 1)
        // when the roulette lands, then settles.
        if (this._itemPopT > 0) {
            this._itemPopT -= dt;
            const t = Math.max(0, this._itemPopT / 0.15);
            const s = 1 + 0.25 * t;
            if (this._itemPill) { this._itemPill.setScale(s, s, 1); }
            if (this._itemLabel) { this._itemLabel.node.setScale(s, s, 1); }
            if (this._itemPopT <= 0) {
                if (this._itemPill) { this._itemPill.setScale(1, 1, 1); }
                if (this._itemLabel) { this._itemLabel.node.setScale(1, 1, 1); }
            }
        }
        // results pop-in (scale 0.85 -> 1 over 0.25 s)
        if (this._resultsPopT > 0) {
            this._resultsPopT -= dt;
            const t = Math.max(0, this._resultsPopT / 0.25);
            const s = 1 - 0.15 * t;
            if (this._resultsPanel) { this._resultsPanel.setScale(s, s, 1); }
        }
        // results confetti
        this._updateConfetti(dt);
        // feed the game from the current input state (racing only)
        const racing = this._game.state === 'racing' || this._game.state === 'countdown';
        if (racing) {
            // Round 8: drift turbo tier — recolour the DRIFT button +
            // ring as the charge builds (blue -> orange -> red -> gold,
            // the PopKart drift-flame language).
            const tier = this._game.driftTier;
            if (tier !== this._lastDriftTier) {
                this._lastDriftTier = tier;
                this._applyDriftTier(tier);
            }
            let steer = 0;
            if (this._stickId >= 0) {
                steer = Math.max(-1, Math.min(1, this._stickDX / STICK_RADIUS));
            } else {
                if (this._keys[KeyCode.ARROW_LEFT] || this._keys[KeyCode.KEY_A]) { steer -= 1; }
                if (this._keys[KeyCode.ARROW_RIGHT] || this._keys[KeyCode.KEY_D]) { steer += 1; }
            }
            this._game.steerInput = steer;
            this._game.driftHeld = this._driftId >= 0
                || !!this._keys[KeyCode.SHIFT_LEFT] || !!this._keys[KeyCode.SHIFT_RIGHT];
            this._game.brakeHeld = (this._stickId >= 0 && this._stickDY < -40)
                || !!this._keys[KeyCode.ARROW_DOWN] || !!this._keys[KeyCode.KEY_S];
            // minimap refresh (4 Hz is plenty)
            this._minimapT += dt;
            if (this._minimapT > 0.25) {
                this._minimapT = 0;
                this._drawMinimap();
            }
            // speed lines: fade in above ~55% top speed, redrawn 8 Hz
            this._speedLinesT += dt;
            const spd = this._game.karts[0] ? this._game.karts[0].speed : 0;
            if (this._game.state === 'racing' && spd > 16) {
                if (this._speedLinesT > 0.12) {
                    this._speedLinesT = 0;
                    this._drawSpeedLines(spd / KartConstants.BASE_TOP_SPEED);
                }
            } else if (this._speedLines) {
                this._speedLines.clear();
            }
        } else {
            this._game.steerInput = 0;
            this._game.driftHeld = false;
            this._game.brakeHeld = false;
            // Round 8: the tier must reset to blue in the menu — a stale
            // gold DRIFT button would lie about the next race.
            if (this._lastDriftTier !== 0) {
                this._lastDriftTier = 0;
                this._applyDriftTier(0);
            }
        }
    }

    // ---- public API called by KartGame ----

    public showMenu(show: boolean = true) {
        if (this._menuPanel) { this._menuPanel.active = show; }
        if (show) {
            this.showHud(false);
            this._refreshTrackUI();
            this._refreshKartUI();
            this._refreshProgressUI();
            this._redrawScrim();
            this._setPlayerKartVisible(false);
        } else {
            this._setPlayerKartVisible(true);
        }
    }

    /** Redraw the menu scrim to cover the whole visible screen at a
     * stronger alpha. Called when the menu is built and every time it is
     * shown (the visible size only changes on resize/orientation, but
     * redrawing here costs nothing and stays correct). */
    private _redrawScrim(): void {
        if (!this._menuScrim || !this._canvas) { return; }
        const vs = view.getVisibleSize();
        const w = vs.width > 0 ? vs.width : 720;
        const h = vs.height > 0 ? vs.height : 1280;
        const g = this._menuScrim;
        g.clear();
        g.fillColor = new Color(10, 15, 25, 170);
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        if (this._menuScrimNode) {
            const t = this._menuScrimNode.getComponent(UITransform);
            if (t) { t.setContentSize(w, h); }
        }
    }

    /** Same dimming as the menu scrim, for the results panel. Drawn 25%
     * oversize: the results panel pops in from scale 0.85, and an
     * exactly-screen-sized rect would leave the rim undimmed mid-pop.
     * Redrawn every time results are shown (visible size can change). */
    private _redrawResultsScrim(): void {
        if (!this._resultsScrim || !this._canvas) { return; }
        const vs = view.getVisibleSize();
        const w = (vs.width > 0 ? vs.width : 720) * 1.25;
        const h = (vs.height > 0 ? vs.height : 1280) * 1.25;
        const g = this._resultsScrim;
        g.clear();
        g.fillColor = new Color(10, 15, 25, 170);
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        if (this._resultsScrimNode) {
            const t = this._resultsScrimNode.getComponent(UITransform);
            if (t) { t.setContentSize(w, h); }
        }
    }

    /** Same dimming as the menu scrim, for the pause panel (round 8:
     * the pause screen used to float bare over the live 3D world). */
    private _redrawPauseScrim(): void {
        if (!this._pauseScrim || !this._canvas) { return; }
        const vs = view.getVisibleSize();
        const w = (vs.width > 0 ? vs.width : 720) * 1.25;
        const h = (vs.height > 0 ? vs.height : 1280) * 1.25;
        const g = this._pauseScrim;
        g.clear();
        g.fillColor = new Color(10, 15, 25, 170);
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        if (this._pauseScrimNode) {
            const t = this._pauseScrimNode.getComponent(UITransform);
            if (t) { t.setContentSize(w, h); }
        }
    }

    /** The parked player kart sits in front of the hint line and peeks
     * above the start button in the menu backdrop — hide it while the
     * menu is up, restore it when a race starts. */
    private _setPlayerKartVisible(visible: boolean): void {
        if (!this._game) { return; }
        const player = this._game.karts && this._game.karts[0];
        if (player && player.model && player.model.root) {
            player.model.root.active = visible;
        }
    }

    /** Track buttons (✓ on the selected one) + desc + best label. */
    private _refreshTrackUI(): void {
        if (!this._game) { return; }
        const sel = this._game.trackId;
        for (let i = 0; i < TRACK_DEFS.length && i < this._trackBtnLabels.length; i++) {
            const d = TRACK_DEFS[i];
            const icon = i < TRACK_ICONS.length ? TRACK_ICONS[i] : '';
            this._trackBtnLabels[i].string = (d.id === sel ? '✓ ' : '') + (icon ? icon + ' ' : '') + d.name;
            if (i < this._trackBtnStyles.length) {
                this._drawButtonFace(this._trackBtnStyles[i], d.id === sel);
            }
        }
        if (this._trackDescLabel) {
            let def = TRACK_DEFS[0];
            for (const d of TRACK_DEFS) { if (d.id === sel) { def = d; } }
            const len = this._game.track ? Math.round(this._game.track.length) : 0;
            this._trackDescLabel.string = def.desc + (len > 0 ? ' · ' + len + 'm' : '');
        }
        if (this._menuBestLabel) {
            const b = this._game.bestTimes();
            const f = b.fwd > 0 ? fmtTime(b.fwd / 1000) : '——';
            const r = b.rev > 0 ? fmtTime(b.rev / 1000) : '——';
            this._menuBestLabel.string = (b.fwd > 0 || b.rev > 0)
                ? '正赛最佳 ' + f + ' · 逆向最佳 ' + r
                : '暂无成绩，来跑第一圈！';
        }
    }

    private _selectTrack(id: string): void {
        if (!this._game) { return; }
        this._game.selectTrack(id);
        this._refreshTrackUI();
        // the rebuild recreates the kart nodes (active again) — re-hide
        // the player kart while the menu is still up.
        this._setPlayerKartVisible(false);
    }

    /** Kart select chips (✓ on the player's pick) + the selected kart's
     * name/tagline + 1..5 stat bars (round 8: chunky bars in the kart's
     * body colour replace the cramped stat dots). */
    private _refreshKartUI(): void {
        if (!this._game) { return; }
        const sel = this._game.selectedKart;
        for (let i = 0; i < ROSTER.length && i < this._kartBtnLabels.length; i++) {
            this._kartBtnLabels[i].string = (i === sel ? '✓ ' : '') + ROSTER[i].name;
            if (i < this._kartBtnStyles.length) {
                this._drawButtonFace(this._kartBtnStyles[i], i === sel);
            }
        }
        const d = ROSTER[sel];
        if (!d) { return; }
        if (this._kartNameLabel) { this._kartNameLabel.string = d.name + ' · ' + d.tagline; }
        const stats = [d.speed, d.accel, d.drift];
        const col = new Color((d.color >> 16) & 0xff, (d.color >> 8) & 0xff, d.color & 0xff, 255);
        for (let i = 0; i < 3 && i < this._statBars.length; i++) {
            this._drawStatBar(this._statBars[i], statBarFill(stats[i]), col);
            if (i < this._statValueLabels.length) {
                this._statValueLabels[i].string = stats[i] + '/5';
            }
        }
        this._refreshPaintUI();
    }

    /** Coins + races/wins line at the top of the menu. */
    private _refreshProgressUI(): void {
        if (!this._game) { return; }
        if (this._coinsLabel) {
            this._coinsLabel.string = '🪙 ' + this._game.coins + ' 金币 · 已跑 '
                + this._game.races + ' 场 · 胜 ' + this._game.wins + ' 场';
        }
    }

    /** Paint buttons for the selected kart: ✓ on the equipped paint,
     * 🔒 + price on locked ones. Round 8: the button face IS the paint
     * colour (a glossy swatch, not a flat navy square) — dark text on
     * light paints, white text on dark ones; locked = dim grey. */
    private _refreshPaintUI(): void {
        if (!this._game) { return; }
        const sel = this._game.selectedKart;
        const owned = this._game.paintsOwned(sel);
        const cur = this._game.selectedPaint(sel);
        for (let p = 0; p < 3 && p < this._paintBtnLabels.length; p++) {
            const paint = PAINTS[sel][p];
            let s = (p === cur ? '✓ ' : '') + paint.name;
            if (!owned[p]) { s += ' 🔒' + paint.price; }
            this._paintBtnLabels[p].string = s;
            // equipped = gold ring; locked = dim face + grey text;
            // owned = the paint's own colour as the face.
            this._paintBtnLabels[p].color = !owned[p] ? GREY
                : (lightColour(paint.color) ? INK : WHITE);
            if (p < this._paintBtnStyles.length) {
                const st = this._paintBtnStyles[p];
                st.bg = !owned[p] ? DIM_BG
                    : new Color((paint.color >> 16) & 0xff, (paint.color >> 8) & 0xff, paint.color & 0xff, 255);
                this._drawButtonFace(st, p === cur);
            }
        }
    }

    /** Tap a paint button: owned -> equip, locked + affordable -> buy +
     * equip, locked + too poor -> toast (the toast label lives on the
     * Canvas, so it shows in the menu too). */
    private _onPaintTap(p: number): void {
        if (!this._game) { return; }
        const res = this._game.tapPaint(this._game.selectedKart, p);
        if (res === 'poor') {
            this.showToast('金币不够，再跑几场吧！');
            return;
        }
        if (res === 'invalid') { return; }
        this._refreshPaintUI();
        this._refreshProgressUI();
        // the rebuild recreates the kart nodes (active again) — re-hide
        // the player kart while the menu is still up.
        this._setPlayerKartVisible(false);
        if (res === 'bought') { this.showToast('已解锁新涂装！'); }
    }

    private _selectKart(i: number): void {
        if (!this._game) { return; }
        this._game.selectKart(i);
        this._refreshKartUI();
        // the rebuild recreates the kart nodes (active again) — re-hide
        // the player kart while the menu is still up.
        this._setPlayerKartVisible(false);
    }

    public showHud(show: boolean) {
        if (this._hudRoot) { this._hudRoot.active = show; }
        // Fix140: the DRIFT button is a canvas child (not under the HUD
        // root) so it stays touchable during the countdown — the perfect
        // start (hold DRIFT at GO) is otherwise impossible on touch, and
        // the menu guide teaches exactly that move. startRace() hides the
        // HUD while state is already 'countdown', so the button stays
        // live then; it hides in menu/finished like the rest of the HUD.
        if (this._driftBtnNode) {
            this._driftBtnNode.active = show || (this._game !== null && this._game.state === 'countdown');
        }
    }

    public showCountdown(text: string) {
        if (!this._countdownLabel) { return; }
        this._setDisplayText(this._countdownLabel, text);
        this._setDisplayActive(this._countdownLabel, text.length > 0);
        // numeral pop: big beat numbers punch in at 1.3x and settle
        if (text.length > 0) {
            this._countPopT = 0.18;
            this._setDisplayScale(this._countdownLabel, 1.3);
        } else {
            this._setDisplayScale(this._countdownLabel, 1);
        }
        // gantry: the start-light bar + posts show with the lights
        if (this._countGantry) { this._countGantry.active = text.length > 0; }
        // lights: 3/2/1 fill red one by one, GO turns all green, '' hides
        const lit = text === '3' ? 1 : text === '2' ? 2 : text === '1' ? 3 : text === 'GO!' ? 3 : 0;
        const col = text === 'GO!' ? MINT : new Color(230, 50, 50, 255);
        for (let i = 0; i < this._countLights.length; i++) {
            const dot = this._countLights[i];
            dot.node.active = text.length > 0;
            dot.color = i < lit ? col : GREY;
            // the white-ring disc behind each dot toggles with it
            const ring = this._canvas ? this._canvas.getChildByName('countLightRing' + i) : null;
            if (ring) { ring.active = text.length > 0; }
        }
    }

    /** Big centre banner (final lap) — auto-hides after `seconds`. */
    public showBanner(text: string, seconds: number = 2) {
        if (!this._bannerLabel) { return; }
        this._setDisplayText(this._bannerLabel, text);
        this._setDisplayActive(this._bannerLabel, true);
        if (this._bannerPill) { this._bannerPill.active = true; }
        this._bannerTime = seconds;
    }

    public showToast(text: string, seconds: number = 1.6) {
        if (!this._toastLabel) { return; }
        this._toastLabel.string = text;
        this._toastLabel.node.active = true;
        if (this._toastPill) { this._toastPill.active = true; }
        this._toastTime = seconds;
        // Render above everything (menu scrim, results, pause panels):
        // re-assert last-sibling order on every show. A start()-time
        // setParent() to the same parent is a no-op in Creator 3.8, so
        // the drive124 fix left the toast dimmed under the scrim
        // (drive125) — only setSiblingIndex() actually reorders it.
        if (this._canvas) {
            this._toastLabel.node.setSiblingIndex(this._canvas.children.length - 1);
            // the pill was built before the menu/results panels, so it
            // would sit under their scrims — keep it just under the text
            if (this._toastPill) {
                this._toastPill.setSiblingIndex(this._canvas.children.length - 2);
            }
        }
    }

    public showPause(show: boolean) {
        if (this._pausePanel) { this._pausePanel.active = show; }
    }

    /** rows = null hides the panel. */
    public showResults(rows: Array<{ name: string; time: number; isPlayer: boolean; bestLap: number }> | null) {
        if (!this._resultsPanel) { return; }
        if (!rows) {
            this._resultsPanel.active = false;
            return;
        }
        this._resultsPanel.active = true;
        this.showHud(false);
        this._redrawResultsScrim();
        // ceremony: panel pops in from 0.85, confetti rains while it is up
        this._resultsPanel.setScale(0.85, 0.85, 1);
        this._resultsPopT = 0.25;
        this._startConfetti();
        if (this._resultsTitle) {
            const mine = rows.findIndex((r) => r.isPlayer);
            this._setDisplayText(this._resultsTitle, mine === 0 ? '🏆 冠军！' : '完赛！第 ' + (mine + 1) + ' 名');
        }
        if (this._resultsLabel) {
            const lines: string[] = [];
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const t = r.time > 0 ? fmtTime(r.time) : '--:--.-';
                const best = r.bestLap > 0 ? ' · 最快 ' + fmtTime(r.bestLap) : '';
                lines.push((i + 1) + '. ' + r.name + (r.isPlayer ? ' (你)' : '') + '  ' + t + best);
            }
            // Phase 2 step 3: race rewards (coins earned this race).
            if (this._game) {
                const rw = this._game.lastReward;
                if (rw > 0) {
                    lines.push('');
                    lines.push('🪙 +' + rw + ' 金币' + (this._game.lastNewBest ? ' · 新纪录！' : ''));
                }
            }
            this._resultsLabel.string = lines.join('\n');
        }
    }

    /** Called by KartGame every racing frame. */
    public tickHud() {
        if (!this._game || !this._hudRoot || !this._hudRoot.active) { return; }
        if (this._posLabel) {
            this._posLabel.string = '第 ' + this._game.playerPosition + '/8 名';
        }
        if (this._lapLabel) {
            const lap = Math.min(3, this._game.playerLap);
            this._lapLabel.string = '第 ' + lap + '/3 圈' + (this._game.reverseMode ? ' · 逆向' : '');
        }
        if (this._timeLabel) { this._timeLabel.string = fmtTime(this._game.raceTime); }
        if (this._speedLabel) { this._speedLabel.string = this._game.playerSpeedKmh + ' km/h'; }
        if (this._zoneLabel && this._game.track) {
            const player = this._game.karts[0];
            if (player) {
                this._zoneLabel.string = this._game.track.zoneNameAt(player.sTotal);
            }
        }
        if (this._itemLabel && this._game.karts[0]) {
            const p = this._game.karts[0];
            if (p.starTime > 0) {
                this._itemLabel.string = '⭐ 无敌中';
            } else if (p.itemKind > 0) {
                // '…' while the roulette is still spinning (itemArm > 0)
                this._itemLabel.string = (ITEM_NAMES[p.itemKind] || '')
                    + (p.itemCount > 1 ? ' ×' + p.itemCount : '')
                    + (p.itemArm > 0 ? ' …' : '');
            } else {
                this._itemLabel.string = '—';
            }
            // Round 8: roulette landed — the arm just hit 0 with an item
            // in hand — pop the item pill (the punch in update()).
            if (p.itemKind !== this._lastItemKind || p.itemArm !== this._lastItemArm) {
                if (p.itemKind > 0 && this._lastItemArm > 0 && p.itemArm <= 0) {
                    this._itemPopT = 0.15;
                }
                this._lastItemKind = p.itemKind;
                this._lastItemArm = p.itemArm;
            }
        }
    }

    // ---- input ----

    private _onTouchStart(event: EventTouch) {
        if (!this._game) { return; }
        const racing = this._game.state === 'racing' || this._game.state === 'countdown';
        if (!racing) { return; }
        const touch = event.touch;
        if (!touch) { return; }
        const loc = touch.getUILocation();
        // left half = stick (UI space is 720 wide, origin bottom-left)
        if (loc.x < 360 && this._stickId < 0) {
            this._stickId = touch.getID();
            this._stickOX = loc.x - 360;
            this._stickOY = loc.y - 640;
            this._stickDX = 0;
            this._stickDY = 0;
            this._showStick(this._stickOX, this._stickOY, 0, 0);
        }
    }

    private _onTouchMove(event: EventTouch) {
        if (!this._game) { return; }
        const touch = event.touch;
        if (!touch) { return; }
        if (touch.getID() === this._stickId) {
            const loc = touch.getUILocation();
            let dx = (loc.x - 360) - this._stickOX;
            let dy = (loc.y - 640) - this._stickOY;
            const len = Math.hypot(dx, dy);
            if (len > STICK_RADIUS) {
                dx = dx / len * STICK_RADIUS;
                dy = dy / len * STICK_RADIUS;
            }
            this._stickDX = dx;
            this._stickDY = dy;
            this._showStick(this._stickOX, this._stickOY, dx, dy);
        }
    }

    private _onTouchEnd(event: EventTouch) {
        const touch = event.touch;
        if (!touch) { return; }
        if (touch.getID() === this._stickId) {
            this._stickId = -1;
            this._stickDX = 0;
            this._stickDY = 0;
            this._hideStick();
        }
        if (touch.getID() === this._driftId) { this._driftId = -1; }
    }

    private _onKeyDown(event: any) {
        if (!this._game) { return; }
        const code = event.keyCode;
        this._keys[code] = true;
        if (code === KeyCode.SPACE && this._game.state === 'racing') { this._game.useItem(); }
        if (code === KeyCode.ENTER) {
            if (this._game.state === 'menu' || this._game.state === 'finished') { this._game.startRace(); }
        }
        if (code === KeyCode.KEY_P) { this._game.togglePause(); }
        if (code === KeyCode.ESCAPE) {
            if (this._game.state === 'paused') { this._game.togglePause(); }
            else { this._game.quitToHall(); }
        }
    }

    private _onKeyUp(event: any) {
        this._keys[event.keyCode] = false;
    }

    // ---- builders ----

    /** Display text with a chunky drop shadow: the shadow is a dark copy
     * straight below (offset (0,-7), fix131 — the old diagonal (-4,-5)
     * offset read as a doubled numeral) created first (renders behind),
     * named <name>_sh. _setDisplayText keeps the shadow's string in sync,
     * _setDisplayScale keeps it in sync through pop animations. */
    private _makeDisplayLabel(parent: Node, name: string, x: number, y: number, fontSize: number, color: Color, text: string): Label {
        this._makeLabel(parent, name + '_sh', x, y - 7, fontSize, SHADOW, text);
        const main = this._makeLabel(parent, name, x, y, fontSize, color, text);
        (main as any).isBold = true;
        return main;
    }

    /** Set a display label's string and its shadow twin's. */
    private _setDisplayText(label: Label, text: string): void {
        label.string = text;
        const p = label.node.parent;
        const sh = p ? p.getChildByName(label.node.name + '_sh') : null;
        if (sh) {
            const l = sh.getComponent(Label);
            if (l) { l.string = text; }
        }
    }

    /** Toggle a display label and its shadow twin together. */
    private _setDisplayActive(label: Label, active: boolean): void {
        label.node.active = active;
        const p = label.node.parent;
        const sh = p ? p.getChildByName(label.node.name + '_sh') : null;
        if (sh) { sh.active = active; }
    }

    /** Scale a display label and its shadow twin together, so a pop
     * animation never leaves the shadow behind (the old pop scaled only
     * the main label, so the twin diverged mid-pop and the numeral read
     * doubled). */
    private _setDisplayScale(label: Label, s: number): void {
        label.node.setScale(s, s, 1);
        const p = label.node.parent;
        const sh = p ? p.getChildByName(label.node.name + '_sh') : null;
        if (sh) { sh.setScale(s, s, 1); }
    }

    /** Solid rounded bar (title underlines, accent strips). */
    private _makeBar(parent: Node, name: string, x: number, y: number, w: number, h: number, color: Color): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const t = node.addComponent(UITransform);
        t.setContentSize(w, h);
        const g = node.addComponent(Graphics);
        g.fillColor = color;
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fill();
        return node;
    }

    /** (Re)draw a rectangular button face: chunky toy button — rounded
     * body, big gloss strip near the top, a darker shade strip along
     * the bottom edge (the 3D toy feel), thick outline (white on
     * saturated colours, light slate-grey on near-white fills — a white
     * ring on white is invisible), gold + wider when selected. */
    private _drawButtonFace(st: BtnStyle, selected: boolean): void {
        const g = st.node.getComponent(Graphics);
        if (!g) { return; }
        const w = st.w, h = st.h;
        const r = Math.min(22, h * 0.35);
        const lum = (st.bg.r * 299 + st.bg.g * 587 + st.bg.b * 114) / 1000;
        g.clear();
        g.fillColor = st.bg;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        // gloss strip (top)
        const stripH = Math.min(12, h * 0.22);
        g.fillColor = new Color(255, 255, 255, selected ? 95 : 85);
        g.roundRect(-w / 2 + 8, h / 2 - 6 - stripH, w - 16, stripH, stripH / 2);
        g.fill();
        // shade strip (bottom edge — the toy-button 3D base)
        const sh = Math.min(12, h * 0.22);
        g.fillColor = shadeColor(st.bg, 0.68);
        g.roundRect(-w / 2 + 4, -h / 2 + 2, w - 8, sh, sh / 2);
        g.fill();
        // outline
        if (selected) {
            g.strokeColor = GOLD;
            g.lineWidth = 5;
        } else {
            g.strokeColor = lum > 200 ? new Color(148, 163, 184, 255) : WHITE;
            g.lineWidth = 4;
        }
        g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, r);
        g.stroke();
    }

    /** (Re)draw a round button face: filled disc, gloss blob, shade
     * crescent at the bottom, thick ring (white, or slate-grey on
     * near-white fills). */
    private _drawRoundFace(node: Node, r: number, bg: Color): void {
        const g = node.getComponent(Graphics);
        if (!g) { return; }
        const lum = (bg.r * 299 + bg.g * 587 + bg.b * 114) / 1000;
        g.clear();
        g.fillColor = bg;
        g.circle(0, 0, r);
        g.fill();
        g.fillColor = new Color(255, 255, 255, 85);
        g.ellipse(-r * 0.35, r * 0.32, r * 0.42, r * 0.28);
        g.fill();
        g.fillColor = shadeColor(bg, 0.68);
        g.ellipse(0, -r * 0.72, r * 0.72, r * 0.26);
        g.fill();
        g.strokeColor = lum > 200 ? new Color(148, 163, 184, 255) : WHITE;
        g.lineWidth = 4;
        g.circle(0, 0, r - 2);
        g.stroke();
    }

    /** Round-8: recolour the DRIFT button + its halo ring by drift
     * charge tier (blue -> orange -> red -> gold, the PopKart
     * drift-flame language). Called from update() only when the tier
     * actually changes, so no per-frame redraw. */
    private _applyDriftTier(tier: number): void {
        const col = DRIFT_TIER_COLS[Math.max(0, Math.min(3, tier))];
        if (this._driftBtnNode) { this._drawRoundFace(this._driftBtnNode, 62, col); }
        if (this._driftRing) {
            const g = this._driftRing.getComponent(Graphics);
            if (g) {
                g.clear();
                g.strokeColor = col;
                g.lineWidth = 5;
                g.circle(0, 0, 72);
                g.stroke();
            }
        }
    }

    /** A chunky stat bar row: light track + a fill drawn by
     * _drawStatBar in the kart's body colour. */
    private _makeStatBar(parent: Node, name: string, x: number, y: number, w: number): { fill: Graphics; w: number } {
        const track = new Node(name + 'Track');
        track.layer = Layers.Enum.UI_2D;
        track.setParent(parent);
        track.setPosition(x, y, 0);
        const tt = track.addComponent(UITransform);
        tt.setContentSize(w, 16);
        const tg = track.addComponent(Graphics);
        tg.fillColor = new Color(226, 232, 240, 255);
        tg.roundRect(-w / 2, -8, w, 16, 8);
        tg.fill();
        const fill = new Node(name + 'Fill');
        fill.layer = Layers.Enum.UI_2D;
        fill.setParent(parent);
        fill.setPosition(x, y, 0);
        const ft = fill.addComponent(UITransform);
        ft.setContentSize(w, 16);
        const fg = fill.addComponent(Graphics);
        return { fill: fg, w };
    }

    /** (Re)draw one stat bar's fill (left-aligned pill, min 16 px so
     * a 1/5 stat still shows). */
    private _drawStatBar(bar: { fill: Graphics; w: number }, frac: number, color: Color): void {
        const g = bar.fill;
        if (!g) { return; }
        const fw = Math.max(16, bar.w * frac);
        g.clear();
        g.fillColor = color;
        g.roundRect(-bar.w / 2, -8, fw, 16, 8);
        g.fill();
    }

    /** A small rounded guide chip: coloured pastel fill, thin outline,
     * dark text — one glance, no wall of text. */
    private _makeChip(parent: Node, name: string, x: number, y: number, w: number, h: number, fill: Color, text: string, fontSize: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const t = node.addComponent(UITransform);
        t.setContentSize(w, h);
        const g = node.addComponent(Graphics);
        g.fillColor = fill;
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fill();
        g.strokeColor = PILL_LINE;
        g.lineWidth = 2;
        g.roundRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, h / 2);
        g.stroke();
        this._makeLabel(node, 'label', 0, 0, fontSize, INK, text);
        return node;
    }

    private _makeLabel(parent: Node, name: string, x: number, y: number, fontSize: number, color: Color, text: string): Label {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = fontSize;
        label.color = color;
        label.string = text;
        return label;
    }

    /** White candy card: white fill, light grey-blue outline, and a
     * gold strip across the top when `accent` (the menu hero cards).
     * The old deep-navy fill made every screen read dark and heavy —
     * the PopKart language is bright cards on the 3D world. */
    private _makeBackingPanel(parent: Node, name: string, x: number, y: number,
        w: number, h: number, r: number, accent: boolean = false, alpha: number = 235): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const t = node.addComponent(UITransform);
        t.setContentSize(w, h);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(255, 255, 255, alpha);
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        g.strokeColor = PILL_LINE;
        g.lineWidth = 2;
        g.roundRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, r);
        g.stroke();
        if (accent) {
            // gold hero strip along the top edge
            g.fillColor = GOLD;
            g.roundRect(-w / 2 + 16, h / 2 - 12, w - 32, 6, 3);
            g.fill();
        }
        return node;
    }

    private _makeButton(parent: Node, name: string, x: number, y: number, w: number, h: number,
        text: string, fontSize: number, bg: Color, onTap: () => void, labelColor: Color = WHITE): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const t = node.addComponent(UITransform);
        t.setContentSize(w, h);
        node.addComponent(Graphics);
        this._drawButtonFace({ node, w, h, bg }, false);
        const labelNode = new Node('label');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.setParent(node);
        labelNode.setPosition(0, 0, 0);
        const label = labelNode.addComponent(Label);
        label.fontSize = fontSize;
        label.color = labelColor;
        label.string = text;
        node.on(Node.EventType.TOUCH_START, onTap, this);
        return node;
    }

    private _makeRoundButton(parent: Node, name: string, x: number, y: number, r: number,
        text: string, fontSize: number, bg: Color, onDown: (e: EventTouch) => void, onUp?: (e: EventTouch) => void): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const t = node.addComponent(UITransform);
        t.setContentSize(r * 2, r * 2);
        node.addComponent(Graphics);
        this._drawRoundFace(node, r, bg);
        const labelNode = new Node('label');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.setParent(node);
        labelNode.setPosition(0, 0, 0);
        const label = labelNode.addComponent(Label);
        label.fontSize = fontSize;
        label.color = WHITE;
        label.string = text;
        node.on(Node.EventType.TOUCH_START, onDown, this);
        if (onUp) {
            node.on(Node.EventType.TOUCH_END, onUp, this);
            node.on(Node.EventType.TOUCH_CANCEL, onUp, this);
        }
        return node;
    }

    private _buildHud() {
        const hud = new Node('kartHud');
        hud.layer = Layers.Enum.UI_2D;
        hud.setParent(this._canvas);
        hud.setPosition(0, 0, 0);
        this._hudRoot = hud;
        hud.active = false;

        // pill backings behind the HUD clusters (created before the
        // labels so they render underneath): top-left position/lap,
        // top-centre time/zone, bottom speed + item slot. Round 8:
        // white candy pills, dark type on white.
        this._makeBackingPanel(hud, 'hudPosPill', -230, 565, 270, 120, 20, false, 200);
        this._makeBackingPanel(hud, 'hudTimePill', 0, 565, 280, 120, 20, false, 200);
        this._makeBackingPanel(hud, 'hudSpeedPill', 280, -520, 190, 76, 20, false, 200);
        this._itemPill = this._makeBackingPanel(hud, 'hudItemPill', 0, -520, 220, 76, 20, false, 200);

        this._posLabel = this._makeLabel(hud, 'posLabel', -230, 590, 44, CANDY_RED, '第 1/8 名');
        this._lapLabel = this._makeLabel(hud, 'lapLabel', -230, 540, 28, INK, '第 1/3 圈');
        this._timeLabel = this._makeLabel(hud, 'timeLabel', 0, 590, 30, INK, '0:00.0');
        this._zoneLabel = this._makeLabel(hud, 'zoneLabel', 0, 540, 24, SLATE, '');
        this._speedLabel = this._makeLabel(hud, 'speedLabel', 280, -520, 36, INK, '0 km/h');
        this._itemLabel = this._makeLabel(hud, 'itemLabel', 0, -520, 32, INK, '—');
        // countdown: huge display numeral with a drop shadow (pops in at
        // 1.3x — see showCountdown / update)
        this._countdownLabel = this._makeDisplayLabel(this._canvas, 'countdownLabel', 0, 150, 110, GOLD, '');
        this._setDisplayActive(this._countdownLabel, false);
        // countdown gantry (fix131): the light dots used to float in
        // mid-air as bare red/grey balls — a navy bar with a gold top
        // strip + two posts now holds them, created BEFORE the dots so
        // it renders underneath. Toggled with the lights in showCountdown.
        this._countGantry = new Node('countGantry');
        this._countGantry.layer = Layers.Enum.UI_2D;
        this._countGantry.setParent(this._canvas);
        this._countGantry.active = false;
        this._makeBackingPanel(this._countGantry, 'gantryBar', 0, 330, 460, 120, 24, true, 215);
        this._makeBar(this._countGantry, 'gantryPostL', -210, 245, 16, 90, NAVY);
        this._makeBar(this._countGantry, 'gantryPostR', 210, 245, 16, 90, NAVY);
        // countdown lights: 3 dots above the numeral, fill red per beat, green on GO.
        // Round 8: each dot sits on a white-ring disc (chunky traffic-light
        // look) — the bare red/grey balls floated in mid-air before.
        for (let i = 0; i < 3; i++) {
            const rx = (i - 1) * 130;
            const ring = new Node('countLightRing' + i);
            ring.layer = Layers.Enum.UI_2D;
            ring.setParent(this._canvas);
            ring.setPosition(rx, 330, 0);
            const rgt = ring.addComponent(UITransform);
            rgt.setContentSize(116, 116);
            const rg = ring.addComponent(Graphics);
            rg.fillColor = WHITE;
            rg.circle(0, 0, 56);
            rg.fill();
            rg.fillColor = new Color(226, 232, 240, 255);
            rg.circle(0, 0, 50);
            rg.fill();
            rg.strokeColor = PILL_LINE;
            rg.lineWidth = 2;
            rg.circle(0, 0, 55);
            rg.stroke();
            ring.active = false;
            const dot = this._makeLabel(this._canvas, 'countLight' + i, rx, 330, 96, GREY, '●');
            dot.node.active = false;
            this._countLights.push(dot);
        }
        // final-lap / big banner: white candy pill behind a shadowed display label
        this._bannerPill = this._makeBackingPanel(this._canvas, 'bannerPill', 0, 250, 560, 92, 24, true, 215);
        this._bannerPill.active = false;
        this._bannerLabel = this._makeDisplayLabel(this._canvas, 'bannerLabel', 0, 250, 54, CANDY_RED, '');
        this._setDisplayActive(this._bannerLabel, false);
        // toast pill: white candy pill behind the toast text
        this._toastPill = this._makeBackingPanel(this._canvas, 'toastPill', 0, 460, 620, 56, 28, false, 215);
        this._toastPill.active = false;
        // toast: built on the Canvas (not the HUD) so menu feedback —
        // e.g. "金币不够" when tapping a locked paint — is visible too.
        // It auto-hides after 1.6 s in update(), in any state. Position
        // y=460 is clear in both layouts: in the menu it sits above the
        // coins line (y=420, top edge ~433); in a race it sits below the
        // HUD labels (zone y=540, bottom edge ~528). The old spot (0,-100)
        // sat inside the track/mode buttons and was covered by the menu.
        this._toastLabel = this._makeLabel(this._canvas, 'toastLabel', 0, 460, 28, INK, '');
        this._toastLabel.node.active = false;

        // pause button (top-right corner): white candy button, dark 'II'
        this._makeButton(hud, 'pauseBtn', 330, 590, 56, 56, 'II', 28,
            WHITE, () => { if (this._game) { this._game.togglePause(); } }, INK);

        // drift + item buttons (right side, hold / tap)
        // Fix140: the DRIFT button is parented to the canvas, NOT the HUD
        // root — showHud(false) during the countdown must not deactivate
        // it, or the touch perfect start is unreachable (no node receives
        // the hold). Position is unchanged: the HUD root sits at the
        // canvas origin, so (250, -400) is the same screen spot.
        const driftBtn = this._makeRoundButton(this._canvas, 'driftBtn', 250, -400, 62, '漂移', 34,
            SKY,
            (e: EventTouch) => { this._driftId = e.touch ? e.touch.getID() : 0; },
            () => { this._driftId = -1; });
        this._driftBtnNode = driftBtn;
        // gold halo ring around DRIFT while held (toggled in update)
        const ring = new Node('driftRing');
        ring.layer = Layers.Enum.UI_2D;
        ring.setParent(driftBtn);
        ring.setPosition(0, 0, 0);
        const rt = ring.addComponent(UITransform);
        rt.setContentSize(150, 150);
        const rg = ring.addComponent(Graphics);
        rg.strokeColor = GOLD;
        rg.lineWidth = 5;
        rg.circle(0, 0, 72);
        rg.stroke();
        ring.active = false;
        this._driftRing = ring;
        this._makeRoundButton(hud, 'itemBtn', 250, -260, 52, '道具', 30,
            ORANGE,
            () => { if (this._game) { this._game.useItem(); } });

        // minimap (top-right, under the pause button) + its pill backing
        this._makeBackingPanel(hud, 'minimapPanel', 255, 425, 214, 214, 24, false, 200);
        const mm = new Node('minimap');
        mm.layer = Layers.Enum.UI_2D;
        mm.setParent(hud);
        mm.setPosition(255, 425, 0);
        const mt = mm.addComponent(UITransform);
        mt.setContentSize(190, 190);
        this._minimap = mm.addComponent(Graphics);
        this._minimapNode = mm;
        // speed-lines overlay (full screen, drawn under the buttons)
        const sl = new Node('speedLines');
        sl.layer = Layers.Enum.UI_2D;
        sl.setParent(hud);
        sl.setPosition(0, 0, 0);
        const st = sl.addComponent(UITransform);
        st.setContentSize(720, 1280);
        this._speedLines = sl.addComponent(Graphics);
        // NOTE: the floating stick is driven by the global input listeners
        // (onEnable), not by a node — the input system fires for any touch.
    }

    private _buildPanels() {
        // --- menu ---
        const menu = new Node('kartMenu');
        menu.layer = Layers.Enum.UI_2D;
        menu.setParent(this._canvas);
        menu.setPosition(0, 0, 0);
        this._menuPanel = menu;
        menu.active = false;
        // scrim: dim the live 3D world behind the menu so road dashes and
        // the player's kart don't strike through the menu text. First child
        // of the menu panel, so it renders behind every label/button; it has
        // no touch handler, so taps still reach the buttons. Sized in
        // _redrawScrim() from the visible size — the old fixed 720x1280
        // rect left the top/bottom bands undimmed on taller phones, and
        // alpha 110 was too weak for the bright yellow centre dashes.
        const scrim = new Node('menuScrim');
        scrim.layer = Layers.Enum.UI_2D;
        scrim.setParent(menu);
        scrim.setPosition(0, 0, 0);
        scrim.addComponent(UITransform);
        this._menuScrimNode = scrim;
        this._menuScrim = scrim.addComponent(Graphics);
        this._redrawScrim();
        // solid backing panels behind the bare text labels (desc + best,
        // and the hint line at the bottom): the full-screen scrim alone
        // could not hide the yellow centre dashes behind them. descBest
        // panel spans y -230..-120 around desc (y -147) + best (y -202);
        // hint panel spans y -611..-559 around the hint (y -585); the
        // kart detail panel spans y 64..160 around name (y 130) + stats
        // (y 96). Buttons are solid already, so they need no panel.
        this._makeBackingPanel(menu, 'descBestPanel', 0, -175, 680, 110, 18);
        this._makeBackingPanel(menu, 'hintPanel', 0, -585, 680, 52, 14);
        this._makeDisplayLabel(menu, 'title', 0, 320, 64, GOLD, '飞车狂飙');
        this._makeBar(menu, 'titleBar', 0, 282, 220, 8, GOLD);
        this._makeBackingPanel(menu, 'subtitlePill', 0, 250, 430, 46, 23);
        this._makeLabel(menu, 'subtitle', 0, 250, 28, INK, '3 圈 · 8 辆车 · 漂移加速');
        // progression (Phase 2 step 3): coins + races/wins, top of the menu.
        // Round 8: 600 px wide — the settings gear sits at (330, 420).
        this._makeBackingPanel(menu, 'coinsPill', 0, 420, 600, 48, 24);
        this._coinsLabel = this._makeLabel(menu, 'coins', 0, 420, 26, CANDY_ORANGE, '');
        // Round 8: settings gear (top-right, next to the coins pill).
        this._makeButton(menu, 'settingsBtn', 330, 420, 48, 48, '⚙', 30,
            WHITE, () => { this._showSettings('menu'); }, INK);
        // kart select: 8 chips in one row (body colour, dark text on
        // light colours), ✓ on the player's pick; the selected kart's
        // name/tagline + 1..5 stat dots sit on the panel below.
        for (let i = 0; i < ROSTER.length; i++) {
            const d = ROSTER[i];
            const x = -287 + i * 82;
            const btn = this._makeButton(menu, 'kartBtn' + i, x, 200, 78, 64,
                d.name, 22,
                new Color((d.color >> 16) & 0xff, (d.color >> 8) & 0xff, d.color & 0xff, 255),
                () => { this._selectKart(i); },
                lightColour(d.color) ? new Color(26, 26, 32, 255) : WHITE);
            this._kartBtnStyles.push({
                node: btn, w: 78, h: 64,
                bg: new Color((d.color >> 16) & 0xff, (d.color >> 8) & 0xff, d.color & 0xff, 255),
            });
            const lab = btn.getChildByName('label');
            if (lab) { this._kartBtnLabels.push(lab.getComponent(Label)); }
        }
        // kart detail: name/tagline + 3 chunky stat bars (speed/accel/
        // drift) in the kart's body colour. Panel is taller now (120)
        // to fit the bars: name y 142, bars y 112/88/64.
        this._makeBackingPanel(menu, 'kartDetailPanel', 0, 100, 680, 120, 16, true);
        this._kartNameLabel = this._makeLabel(menu, 'kartName', 0, 142, 28, INK, '');
        const statNames = ['速度', '加速', '漂移'];
        const statYs = [112, 88, 64];
        for (let i = 0; i < 3; i++) {
            this._makeLabel(menu, 'statName' + i, -170, statYs[i], 22, INK, statNames[i]);
            this._statBars.push(this._makeStatBar(menu, 'statBar' + i, 0, statYs[i], 240));
            this._statValueLabels.push(this._makeLabel(menu, 'statValue' + i, 150, statYs[i], 22, INK, '3/5'));
        }
        // paints (Phase 2 step 3): 3 schemes for the selected kart —
        // default + 2 unlockables. Labels refresh in _refreshPaintUI
        // (✓ equipped, 🔒 + price locked). The lower block (track
        // buttons on down) moved 80 px down to make room for this row.
        for (let p = 0; p < 3; p++) {
            const x = (p - 1) * 230;
            const btn = this._makeButton(menu, 'paintBtn' + p, x, 30, 210, 54,
                '', 22, new Color(40, 50, 70, 255),
                () => { this._onPaintTap(p); });
            this._paintBtnStyles.push({ node: btn, w: 210, h: 54, bg: new Color(40, 50, 70, 255) });
            const lab = btn.getChildByName('label');
            if (lab) { this._paintBtnLabels.push(lab.getComponent(Label)); }
        }
        // track select: two circuits, each playable fwd + reverse.
        // Icons are decorative; the ✓ prefix marks the selected one.
        // (TRACK_ICONS is module-level: _refreshTrackUI re-applies the same
        // icon when the selection changes, or the emoji vanishes.)
        // Round 8: per-track candy colours (sunset orange, canyon teal).
        for (let i = 0; i < TRACK_DEFS.length; i++) {
            const d = TRACK_DEFS[i];
            const icon = i < TRACK_ICONS.length ? TRACK_ICONS[i] : '';
            const x = i === 0 ? -125 : 125;
            const tc = i === 0 ? CANDY_ORANGE : CANDY_TEAL;
            const btn = this._makeButton(menu, 'trackBtn' + d.id, x, -80, 230, 90,
                icon + ' ' + d.name, 30, tc,
                () => { this._selectTrack(d.id); });
            this._trackBtnStyles.push({ node: btn, w: 230, h: 90, bg: tc });
            const lab = btn.getChildByName('label');
            if (lab) { this._trackBtnLabels.push(lab.getComponent(Label)); }
        }
        this._trackDescLabel = this._makeLabel(menu, 'trackDesc', 0, -147, 24, SLATE, '');
        this._menuBestLabel = this._makeLabel(menu, 'best', 0, -202, 28, CANDY_ORANGE, '');
        // mode select: 正赛 drives the circuit forward, 逆向 drives the
        // same centreline the other way (reversed checkpoints / racing line).
        // Round 8: START is vivid green, reverse is vivid purple, hall is slate.
        this._makeButton(menu, 'startFwdBtn', 0, -285, 480, 100, '🏁 正赛开始', 42,
            CANDY_GREEN, () => { if (this._game) { this._game.startRaceInMode(false); } });
        this._makeButton(menu, 'startRevBtn', 0, -395, 480, 100, '🔄 逆向开始', 42,
            CANDY_PURPLE, () => { if (this._game) { this._game.startRaceInMode(true); } });
        this._makeButton(menu, 'hallBtn', 0, -505, 480, 100, '回大厅', 40,
            SLATE, () => { if (this._game) { this._game.quitToHall(); } });
        // Round 8: the guide is 3 pastel chips on the hint panel, not a
        // wall of small text — one glance teaches the controls, and the
        // middle chip teaches the perfect start (hold DRIFT at GO).
        this._makeChip(menu, 'guideChip0', -230, -585, 200, 40, new Color(219, 234, 254, 255), '🕹 摇杆转向·刹车', 18);
        this._makeChip(menu, 'guideChip1', 0, -585, 200, 40, new Color(255, 237, 213, 255), '🚀 起步按住漂移', 18);
        this._makeChip(menu, 'guideChip2', 230, -585, 200, 40, new Color(220, 252, 231, 255), '💨 漂移攒气·道具', 18);

        // --- results ---
        const res = new Node('kartResults');
        res.layer = Layers.Enum.UI_2D;
        res.setParent(this._canvas);
        res.setPosition(0, 0, 0);
        this._resultsPanel = res;
        res.active = false;
        // results scrim: same dimming as the menu scrim — without it the
        // player's kart sits centre-screen behind the standings and the
        // reward line, and drift smoke drifts across the panel. First
        // child of the results panel, so it renders behind the confetti
        // and every label/button. Sized in _redrawResultsScrim().
        const rscrim = new Node('resultsScrim');
        rscrim.layer = Layers.Enum.UI_2D;
        rscrim.setParent(res);
        rscrim.setPosition(0, 0, 0);
        rscrim.addComponent(UITransform);
        this._resultsScrimNode = rscrim;
        this._resultsScrim = rscrim.addComponent(Graphics);
        this._redrawResultsScrim();
        // solid backing behind the standings + reward lines: the scrim
        // alone can't hide the bright kart / yellow dashes behind the
        // text. The rows label is 8 rows + blank + reward = 10 lines at
        // ~40 px pitch (measured off the drive127 results screenshot),
        // so the block is ~400 px tall centred on y 60; the panel gives
        // ~25 px of slack top and bottom.
        this._makeBackingPanel(res, 'rowsPanel', 0, 60, 680, 450, 18, true);
        // confetti layer (OVER the rows panel, UNDER the text — round 8:
        // it used to sit behind the panel, so the rain was invisible
        // except around the edges).
        const cf = new Node('confetti');
        cf.layer = Layers.Enum.UI_2D;
        cf.setParent(res);
        cf.setPosition(0, 0, 0);
        const ct = cf.addComponent(UITransform);
        ct.setContentSize(720, 1280);
        this._confetti = cf.addComponent(Graphics);
        this._resultsTitle = this._makeDisplayLabel(res, 'title', 0, 330, 64, GOLD, '完赛！');
        this._resultsLabel = this._makeLabel(res, 'rows', 0, 60, 26, INK, '');
        this._makeButton(res, 'againBtn', 0, -260, 480, 110, '再来一局', 44,
            CANDY_GREEN, () => { if (this._game) { this._game.startRace(); } });
        this._makeButton(res, 'hallBtn', 0, -380, 480, 110, '回大厅', 40,
            SLATE, () => { if (this._game) { this._game.quitToHall(); } });

        // --- pause ---
        const pau = new Node('kartPause');
        pau.layer = Layers.Enum.UI_2D;
        pau.setParent(this._canvas);
        pau.setPosition(0, 0, 0);
        this._pausePanel = pau;
        pau.active = false;
        // Round 8: the pause screen gets its own scrim (it used to float
        // bare over the live 3D world). First child, so it renders behind
        // the title and buttons; sized in _redrawPauseScrim().
        const pscrim = new Node('pauseScrim');
        pscrim.layer = Layers.Enum.UI_2D;
        pscrim.setParent(pau);
        pscrim.setPosition(0, 0, 0);
        pscrim.addComponent(UITransform);
        this._pauseScrimNode = pscrim;
        this._pauseScrim = pscrim.addComponent(Graphics);
        this._redrawPauseScrim();
        this._makeDisplayLabel(pau, 'title', 0, 200, 64, GOLD, '暂停');
        this._makeButton(pau, 'resumeBtn', 0, 40, 480, 110, '继续', 44,
            CANDY_GREEN, () => { if (this._game) { this._game.togglePause(); } });
        this._makeButton(pau, 'restartBtn', 0, -80, 480, 110, '重开', 40,
            SLATE, () => { if (this._game) { this._game.startRace(); } });
        this._makeButton(pau, 'hallBtn', 0, -200, 480, 110, '回大厅', 40,
            SLATE, () => { if (this._game) { this._game.quitToHall(); } });
        // Round 8: settings are reachable from pause too.
        this._makeButton(pau, 'settingsBtn', 0, -320, 480, 110, '⚙ 设置', 40,
            SLATE, () => { this._showSettings('pause'); });
    }

    // ---- settings (round 8: new — music / SFX toggles, persisted) ----

    /** Settings card, built on the Canvas AFTER the menu/pause/results
     * panels, so it overlays whichever screen opened it. The card is
     * white candy like the rest of the round-8 UI; the two toggles are
     * chunky pills (green 开 / grey 关). */
    private _buildSettings(): void {
        const st = new Node('kartSettings');
        st.layer = Layers.Enum.UI_2D;
        st.setParent(this._canvas);
        st.setPosition(0, 0, 0);
        this._settingsPanel = st;
        st.active = false;
        this._makeBackingPanel(st, 'settingsCard', 0, 40, 560, 420, 24, true);
        this._makeDisplayLabel(st, 'settingsTitle', 0, 210, 44, INK, '⚙ 设置');
        this._makeLabel(st, 'musicRowLabel', -140, 100, 30, INK, '🎵 音乐');
        this._makeLabel(st, 'sfxRowLabel', -140, 20, 30, INK, '🔊 音效');
        const mBtn = this._makeButton(st, 'musicToggle', 140, 100, 120, 56, '开', 30,
            CANDY_GREEN, () => { this._onMusicToggle(); });
        this._musicToggleStyle = { node: mBtn, w: 120, h: 56, bg: CANDY_GREEN };
        const mLab = mBtn.getChildByName('label');
        if (mLab) { this._musicToggleLabel = mLab.getComponent(Label); }
        const sBtn = this._makeButton(st, 'sfxToggle', 140, 20, 120, 56, '开', 30,
            CANDY_GREEN, () => { this._onSfxToggle(); });
        this._sfxToggleStyle = { node: sBtn, w: 120, h: 56, bg: CANDY_GREEN };
        const sLab = sBtn.getChildByName('label');
        if (sLab) { this._sfxToggleLabel = sLab.getComponent(Label); }
        this._makeButton(st, 'settingsCloseBtn', 0, -110, 300, 80, '完成', 36,
            CANDY_GREEN, () => { this._hideSettings(); });
    }

    /** Open the settings card from the menu gear or the pause button.
     * The opener stays up underneath (menu or pause); closing just
     * hides the card again. */
    private _showSettings(from: string): void {
        this._settingsFrom = from;
        this._refreshSettingsUI();
        if (this._settingsPanel) { this._settingsPanel.active = true; }
    }

    private _hideSettings(): void {
        if (this._settingsPanel) { this._settingsPanel.active = false; }
    }

    /** Redraw both toggle pills from the game's persisted flags. */
    private _refreshSettingsUI(): void {
        if (!this._game) { return; }
        const offBg = new Color(148, 163, 184, 255);
        if (this._musicToggleStyle) {
            this._musicToggleStyle.bg = this._game.musicOn ? CANDY_GREEN : offBg;
            this._drawButtonFace(this._musicToggleStyle, false);
        }
        if (this._musicToggleLabel) { this._musicToggleLabel.string = this._game.musicOn ? '开' : '关'; }
        if (this._sfxToggleStyle) {
            this._sfxToggleStyle.bg = this._game.sfxOn ? CANDY_GREEN : offBg;
            this._drawButtonFace(this._sfxToggleStyle, false);
        }
        if (this._sfxToggleLabel) { this._sfxToggleLabel.string = this._game.sfxOn ? '开' : '关'; }
    }

    private _onMusicToggle(): void {
        if (!this._game) { return; }
        this._game.setMusicOn(!this._game.musicOn);
        this._refreshSettingsUI();
    }

    private _onSfxToggle(): void {
        if (!this._game) { return; }
        this._game.setSfxOn(!this._game.sfxOn);
        this._refreshSettingsUI();
    }

    private _buildStick() {
        const base = new Node('stickBase');
        base.layer = Layers.Enum.UI_2D;
        base.setParent(this._canvas);
        base.setPosition(0, 0, 0);
        const bt = base.addComponent(UITransform);
        bt.setContentSize(STICK_RADIUS * 2 + 20, STICK_RADIUS * 2 + 20);
        const bg = base.addComponent(Graphics);
        bg.fillColor = new Color(255, 255, 255, 60);
        bg.circle(0, 0, STICK_RADIUS + 10);
        bg.fill();
        bg.strokeColor = new Color(255, 255, 255, 140);
        bg.lineWidth = 3;
        bg.circle(0, 0, STICK_RADIUS + 10);
        bg.stroke();
        const knob = new Node('stickKnob');
        knob.layer = Layers.Enum.UI_2D;
        knob.setParent(base);
        knob.setPosition(0, 0, 0);
        const kt = knob.addComponent(UITransform);
        kt.setContentSize(64, 64);
        const kg = knob.addComponent(Graphics);
        kg.fillColor = GOLD;
        kg.circle(0, 0, 32);
        kg.fill();
        kg.fillColor = new Color(255, 255, 255, 110);
        kg.circle(-9, 10, 9);
        kg.fill();
        kg.strokeColor = new Color(255, 255, 255, 255);
        kg.lineWidth = 3;
        kg.circle(0, 0, 32);
        kg.stroke();
        base.active = false;
        this._stickBase = base;
        this._stickKnob = knob;
    }

    private _showStick(ox: number, oy: number, dx: number, dy: number) {
        if (!this._stickBase || !this._stickKnob) { return; }
        this._stickBase.active = true;
        this._stickBase.setPosition(ox, oy, 0);
        this._stickKnob.setPosition(dx, dy, 0);
    }

    private _hideStick() {
        if (this._stickBase) { this._stickBase.active = false; }
    }

    // ---- results confetti ----

    private _startConfetti(): void {
        if (!this._confetti) { return; }
        this._confettiParts = [];
        // palette-matched to the UI art direction: red/teal/amber/blue/
        // gold + the mint and pink accents
        const cols = [
            new Color(230, 57, 70, 255), new Color(42, 157, 143, 255),
            new Color(244, 162, 97, 255), new Color(67, 97, 238, 255),
            new Color(255, 210, 63, 255), MINT, PINK,
        ];
        for (let i = 0; i < 150; i++) {
            this._confettiParts.push({
                x: (Math.random() - 0.5) * 700,
                y: 300 + Math.random() * 340,
                vx: (Math.random() - 0.5) * 60,
                vy: -(120 + Math.random() * 180),
                c: cols[i % cols.length],
                s: 12 + Math.random() * 12,
                ph: Math.random() * Math.PI * 2,
                round: i % 3 === 0,
            });
        }
        // fix132: no countdown — the rain lasts while the results panel
        // is up (the old 8 s countdown expired before the slow headless
        // clock showed the panel; the probe found 0 parts at 4 s).
        // _confettiT is now elapsed time, driving the sideways sway.
        this._confettiT = 0;
    }

    private _updateConfetti(dt: number): void {
        if (!this._confetti) { return; }
        // rain while the results panel is up; once it hides, clear once
        if (!this._resultsPanel || !this._resultsPanel.active) {
            if (this._confettiParts.length > 0) { this._confettiParts = []; this._confetti.clear(); }
            return;
        }
        this._confettiT += dt;
        const g = this._confetti;
        g.clear();
        for (const p of this._confettiParts) {
            // sideways sway as they fall, so the rain feels alive
            p.x += (p.vx + Math.sin(this._confettiT * 3 + p.ph) * 25) * dt;
            p.y += p.vy * dt;
            p.vy -= 60 * dt; // gravity: falls faster over time
            // respawn at the top while it rains — continuous confetti
            if (p.y < -680) {
                p.y = 620 + Math.random() * 80;
                p.x = (Math.random() - 0.5) * 700;
                p.vy = -(120 + Math.random() * 180);
            }
            g.fillColor = p.c;
            if (p.round) {
                g.circle(p.x, p.y, p.s / 2);
            } else {
                g.rect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s * 0.6);
            }
            g.fill();
        }
    }

    // ---- speed lines ----

    /** Radial streaks from the centre outward; alpha grows with speed.
     * Every 4th streak is gold and thicker, for a speed-boost feel. */
    private _drawSpeedLines(ratio: number): void {
        if (!this._speedLines) { return; }
        const g = this._speedLines;
        g.clear();
        const a = Math.round(50 + Math.min(1, ratio) * 140);
        g.strokeColor = new Color(255, 255, 255, a);
        g.lineWidth = 3;
        for (let i = 0; i < 12; i++) {
            const ang = Math.random() * Math.PI * 2;
            const r1 = 130 + Math.random() * 90;
            const r2 = r1 + 80 + Math.random() * 170;
            const c = Math.cos(ang), s = Math.sin(ang);
            g.moveTo(c * r1, s * r1);
            g.lineTo(c * r2, s * r2);
        }
        g.stroke();
        g.strokeColor = new Color(255, 196, 0, a);
        g.lineWidth = 5;
        for (let i = 0; i < 6; i++) {
            const ang = Math.random() * Math.PI * 2;
            const r1 = 150 + Math.random() * 80;
            const r2 = r1 + 100 + Math.random() * 180;
            const c = Math.cos(ang), s = Math.sin(ang);
            g.moveTo(c * r1, s * r1);
            g.lineTo(c * r2, s * r2);
        }
        g.stroke();
    }

    // ---- minimap ----

    private _drawMinimap() {
        if (!this._game || !this._game.track || !this._minimap) { return; }
        const g = this._minimap;
        const track = this._game.track;
        const path = track.minimapPath(80);
        const rangeX = path.maxX - path.minX;
        const rangeZ = path.maxZ - path.minZ;
        const scale = 170 / Math.max(rangeX, rangeZ, 1);
        const cx = (path.minX + path.maxX) / 2;
        const cz = (path.minZ + path.maxZ) / 2;
        const mx = (x: number): number => (x - cx) * scale;
        const mz = (z: number): number => -(z - cz) * scale;
        g.clear();
        g.strokeColor = new Color(255, 255, 255, 220);
        g.lineWidth = 3;
        g.moveTo(mx(path.pts[0].x), mz(path.pts[0].z));
        for (let i = 1; i < path.pts.length; i++) {
            g.lineTo(mx(path.pts[i].x), mz(path.pts[i].z));
        }
        g.close();
        g.stroke();
        // start line tick
        g.strokeColor = GOLD;
        g.lineWidth = 4;
        g.moveTo(mx(path.pts[0].x) - 6, mz(path.pts[0].z));
        g.lineTo(mx(path.pts[0].x) + 6, mz(path.pts[0].z));
        g.stroke();
        // kart dots
        const wp = new Vec3();
        for (const k of this._game.karts) {
            track.posAt(track.wrapS(k.sTotal), k.d, wp);
            const col = k.isPlayer ? 0xffc400 : k.stats.color;
            g.fillColor = new Color((col >> 16) & 0xff, (col >> 8) & 0xff, col & 0xff, 255);
            g.circle(mx(wp.x), mz(wp.z), k.isPlayer ? 5.5 : 4);
            g.fill();
        }
    }
}
