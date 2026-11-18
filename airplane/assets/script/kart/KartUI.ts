/**
 * Kart HUD + touch controls for the hall kart game （飞车狂飙 v1.0.10).
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
 * AAA visual pass: one art direction with the PBR karts — chunky
 * rounded "sticker" panels (deep navy, thick white/gold outlines,
 * gloss strip on every button), gold hero accent, drop-shadowed
 * display type, selected states as gold rings. Labels, buttons and
 * flows are unchanged; only the look moved.
 */

import { _decorator, Color, Component, EventTouch, Graphics, Input, input, KeyCode, Label, Layers, Node, UITransform, Vec3, find, view } from 'cc';
import { KartGame } from './KartGame';
import { TRACK_DEFS } from './KartTrack';
import { ITEM_NAMES, KartConstants, PAINTS, ROSTER } from './KartConstants';
const { ccclass, property } = _decorator;

const GOLD = new Color(255, 196, 0, 255);
const WHITE = new Color(255, 255, 255, 255);
const GREY = new Color(170, 170, 170, 255);
const RED = new Color(255, 90, 90, 255);
const STICK_RADIUS = 60;
// AAA art direction (matches the glossy PBR karts): cute chunky low-poly
// "sticker" UI — deep-navy panels, thick white/gold outlines, a gloss
// highlight strip on every button, gold as the hero accent.
const NAVY = new Color(16, 24, 42, 255);
const SKY = new Color(30, 120, 220, 255);
const ORANGE = new Color(255, 122, 26, 255);
const MINT = new Color(60, 220, 130, 255);
const PINK = new Color(235, 80, 180, 255);
const SHADOW = new Color(0, 0, 0, 150);
const DIM_BG = new Color(52, 58, 72, 255);

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

/** 1..5 stat as filled/empty dots, e.g. ●●●○○. */
function statDots(n: number): string {
    const f = Math.max(0, Math.min(5, n));
    return '●'.repeat(f) + '○'.repeat(5 - f);
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
    // selected kart's name/tagline and 1..5 stat dots.
    private _kartBtnLabels: Label[] = [];
    private _kartBtnStyles: BtnStyle[] = [];
    private _kartNameLabel: Label = null;
    private _kartStatsLabel: Label = null;
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
     * name/tagline + 1..5 stat dots. */
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
        if (this._kartStatsLabel) {
            this._kartStatsLabel.string = '速度 ' + statDots(d.speed)
                + '  加速 ' + statDots(d.accel)
                + '  漂移 ' + statDots(d.drift);
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
     * 🔒 + price on locked ones. */
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
            // equipped = gold ring + gold text; locked = dim face + grey
            // text; owned but not equipped = plain white text.
            this._paintBtnLabels[p].color = p === cur ? GOLD : (!owned[p] ? GREY : WHITE);
            if (p < this._paintBtnStyles.length) {
                const st = this._paintBtnStyles[p];
                st.bg = !owned[p] ? DIM_BG : NAVY;
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

    /** (Re)draw a rectangular button face: rounded body, gloss strip
     * near the top edge, thick outline — white normally, gold + wider
     * when selected. */
    private _drawButtonFace(st: BtnStyle, selected: boolean): void {
        const g = st.node.getComponent(Graphics);
        if (!g) { return; }
        const w = st.w, h = st.h;
        const r = Math.min(18, h * 0.3);
        g.clear();
        g.fillColor = st.bg;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        g.fillColor = new Color(255, 255, 255, selected ? 90 : 55);
        g.roundRect(-w / 2 + 10, h / 2 - 16, w - 20, 9, 4);
        g.fill();
        g.strokeColor = selected ? GOLD : new Color(255, 255, 255, 255);
        g.lineWidth = selected ? 5 : 3;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.stroke();
    }

    /** (Re)draw a round button face: filled disc, gloss blob, white ring. */
    private _drawRoundFace(node: Node, r: number, bg: Color): void {
        const g = node.getComponent(Graphics);
        if (!g) { return; }
        g.clear();
        g.fillColor = bg;
        g.circle(0, 0, r);
        g.fill();
        g.fillColor = new Color(255, 255, 255, 70);
        g.circle(-r * 0.3, r * 0.35, r * 0.32);
        g.fill();
        g.strokeColor = new Color(255, 255, 255, 255);
        g.lineWidth = 3;
        g.circle(0, 0, r);
        g.stroke();
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

    /** Near-opaque rounded backing panel for a menu text block. Alpha
     * nudges (110, then 170) both failed to hide the bright yellow centre
     * dashes behind the desc/best labels, so the text now sits on a
     * solid panel instead: no backdrop pixel can show through it.
     * Created right after the scrim, so it renders below every label
     * and button; buttons are solid anyway. */
    private _makeBackingPanel(parent: Node, name: string, x: number, y: number,
        w: number, h: number, r: number, accent: boolean = false, alpha: number = 235): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const t = node.addComponent(UITransform);
        t.setContentSize(w, h);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(10, 15, 25, alpha);
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        g.strokeColor = new Color(255, 255, 255, 80);
        g.lineWidth = 2;
        g.roundRect(-w / 2, -h / 2, w, h, r);
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
        // top-centre time/zone, bottom speed + item slot.
        this._makeBackingPanel(hud, 'hudPosPill', -230, 565, 270, 120, 20, false, 200);
        this._makeBackingPanel(hud, 'hudTimePill', 0, 565, 280, 120, 20, false, 200);
        this._makeBackingPanel(hud, 'hudSpeedPill', 280, -520, 190, 76, 20, false, 200);
        this._makeBackingPanel(hud, 'hudItemPill', 0, -520, 220, 76, 20, false, 200);

        this._posLabel = this._makeLabel(hud, 'posLabel', -230, 590, 44, GOLD, '第 1/8 名');
        this._lapLabel = this._makeLabel(hud, 'lapLabel', -230, 540, 28, WHITE, '第 1/3 圈');
        this._timeLabel = this._makeLabel(hud, 'timeLabel', 0, 590, 30, WHITE, '0:00.0');
        this._zoneLabel = this._makeLabel(hud, 'zoneLabel', 0, 540, 24, GREY, '');
        this._speedLabel = this._makeLabel(hud, 'speedLabel', 280, -520, 36, WHITE, '0 km/h');
        this._itemLabel = this._makeLabel(hud, 'itemLabel', 0, -520, 32, WHITE, '—');
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
        // countdown lights: 3 dots above the numeral, fill red per beat, green on GO
        for (let i = 0; i < 3; i++) {
            const dot = this._makeLabel(this._canvas, 'countLight' + i, (i - 1) * 130, 330, 96, GREY, '●');
            dot.node.active = false;
            this._countLights.push(dot);
        }
        // final-lap / big banner: gold pill behind a shadowed display label
        this._bannerPill = this._makeBackingPanel(this._canvas, 'bannerPill', 0, 250, 560, 92, 24, true, 215);
        this._bannerPill.active = false;
        this._bannerLabel = this._makeDisplayLabel(this._canvas, 'bannerLabel', 0, 250, 54, GOLD, '');
        this._setDisplayActive(this._bannerLabel, false);
        // toast pill: dark gold-rimmed pill behind the toast text
        this._toastPill = this._makeBackingPanel(this._canvas, 'toastPill', 0, 460, 620, 56, 28, false, 215);
        this._toastPill.active = false;
        // toast: built on the Canvas (not the HUD) so menu feedback —
        // e.g. "金币不够" when tapping a locked paint — is visible too.
        // It auto-hides after 1.6 s in update(), in any state. Position
        // y=460 is clear in both layouts: in the menu it sits above the
        // coins line (y=420, top edge ~433); in a race it sits below the
        // HUD labels (zone y=540, bottom edge ~528). The old spot (0,-100)
        // sat inside the track/mode buttons and was covered by the menu.
        this._toastLabel = this._makeLabel(this._canvas, 'toastLabel', 0, 460, 28, WHITE, '');
        this._toastLabel.node.active = false;

        // pause button (top-right corner)
        this._makeButton(hud, 'pauseBtn', 330, 590, 56, 56, 'II', 28,
            new Color(40, 50, 70, 255), () => { if (this._game) { this._game.togglePause(); } });

        // drift + item buttons (right side, hold / tap)
        const driftBtn = this._makeRoundButton(hud, 'driftBtn', 250, -400, 62, '漂移', 34,
            SKY,
            (e: EventTouch) => { this._driftId = e.touch ? e.touch.getID() : 0; },
            () => { this._driftId = -1; });
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
        this._makeLabel(menu, 'subtitle', 0, 250, 28, WHITE, '3 圈 · 8 辆车 · 漂移加速');
        // progression (Phase 2 step 3): coins + races/wins, top of the menu.
        this._makeBackingPanel(menu, 'coinsPill', 0, 420, 640, 48, 24);
        this._coinsLabel = this._makeLabel(menu, 'coins', 0, 420, 26, GOLD, '');
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
        this._makeBackingPanel(menu, 'kartDetailPanel', 0, 112, 680, 96, 16, true);
        this._kartNameLabel = this._makeLabel(menu, 'kartName', 0, 130, 28, WHITE, '');
        this._kartStatsLabel = this._makeLabel(menu, 'kartStats', 0, 96, 24, GOLD, '');
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
        for (let i = 0; i < TRACK_DEFS.length; i++) {
            const d = TRACK_DEFS[i];
            const icon = i < TRACK_ICONS.length ? TRACK_ICONS[i] : '';
            const x = i === 0 ? -125 : 125;
            const btn = this._makeButton(menu, 'trackBtn' + d.id, x, -80, 230, 90,
                icon + ' ' + d.name, 30, new Color(40, 90, 60, 255),
                () => { this._selectTrack(d.id); });
            this._trackBtnStyles.push({ node: btn, w: 230, h: 90, bg: new Color(40, 90, 60, 255) });
            const lab = btn.getChildByName('label');
            if (lab) { this._trackBtnLabels.push(lab.getComponent(Label)); }
        }
        this._trackDescLabel = this._makeLabel(menu, 'trackDesc', 0, -147, 24, GREY, '');
        this._menuBestLabel = this._makeLabel(menu, 'best', 0, -202, 28, GOLD, '');
        // mode select: 正赛 drives the circuit forward, 逆向 drives the
        // same centreline the other way (reversed checkpoints / racing line).
        this._makeButton(menu, 'startFwdBtn', 0, -285, 480, 100, '🏁 正赛开始', 42,
            new Color(30, 120, 220, 255), () => { if (this._game) { this._game.startRaceInMode(false); } });
        this._makeButton(menu, 'startRevBtn', 0, -395, 480, 100, '🔄 逆向开始', 42,
            new Color(150, 80, 200, 255), () => { if (this._game) { this._game.startRaceInMode(true); } });
        this._makeButton(menu, 'hallBtn', 0, -505, 480, 100, '回大厅', 40,
            new Color(90, 100, 120, 255), () => { if (this._game) { this._game.quitToHall(); } });
        this._makeLabel(menu, 'hint', 0, -585, 24, GREY, '左半屏摇杆转向（下推刹车）· 右侧漂移 / 道具');

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
        // confetti layer (behind the text, full screen)
        const cf = new Node('confetti');
        cf.layer = Layers.Enum.UI_2D;
        cf.setParent(res);
        cf.setPosition(0, 0, 0);
        const ct = cf.addComponent(UITransform);
        ct.setContentSize(720, 1280);
        this._confetti = cf.addComponent(Graphics);
        // solid backing behind the standings + reward lines: the scrim
        // alone can't hide the bright kart / yellow dashes behind the
        // text. The rows label is 8 rows + blank + reward = 10 lines at
        // ~40 px pitch (measured off the drive127 results screenshot),
        // so the block is ~400 px tall centred on y 60; the panel gives
        // ~25 px of slack top and bottom.
        this._makeBackingPanel(res, 'rowsPanel', 0, 60, 680, 450, 18, true);
        this._resultsTitle = this._makeDisplayLabel(res, 'title', 0, 330, 64, GOLD, '完赛！');
        this._resultsLabel = this._makeLabel(res, 'rows', 0, 60, 26, WHITE, '');
        this._makeButton(res, 'againBtn', 0, -260, 480, 110, '再来一局', 44,
            new Color(30, 120, 220, 255), () => { if (this._game) { this._game.startRace(); } });
        this._makeButton(res, 'hallBtn', 0, -380, 480, 110, '回大厅', 40,
            new Color(90, 100, 120, 255), () => { if (this._game) { this._game.quitToHall(); } });

        // --- pause ---
        const pau = new Node('kartPause');
        pau.layer = Layers.Enum.UI_2D;
        pau.setParent(this._canvas);
        pau.setPosition(0, 0, 0);
        this._pausePanel = pau;
        pau.active = false;
        this._makeDisplayLabel(pau, 'title', 0, 200, 64, GOLD, '暂停');
        this._makeButton(pau, 'resumeBtn', 0, 40, 480, 110, '继续', 44,
            new Color(30, 120, 220, 255), () => { if (this._game) { this._game.togglePause(); } });
        this._makeButton(pau, 'restartBtn', 0, -80, 480, 110, '重开', 40,
            new Color(90, 100, 120, 255), () => { if (this._game) { this._game.startRace(); } });
        this._makeButton(pau, 'hallBtn', 0, -200, 480, 110, '回大厅', 40,
            new Color(90, 100, 120, 255), () => { if (this._game) { this._game.quitToHall(); } });
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
