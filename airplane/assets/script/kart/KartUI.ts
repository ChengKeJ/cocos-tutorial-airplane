/**
 * Kart HUD + touch controls for the hall kart game （飞车狂飙 v1.0.8).
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
 */

import { _decorator, Color, Component, EventTouch, Graphics, Input, input, KeyCode, Label, Layers, Node, UITransform, Vec3, find } from 'cc';
import { KartGame } from './KartGame';
import { ITEM_NAMES } from './KartConstants';
const { ccclass, property } = _decorator;

const GOLD = new Color(255, 196, 0, 255);
const WHITE = new Color(255, 255, 255, 255);
const GREY = new Color(170, 170, 170, 255);
const RED = new Color(255, 90, 90, 255);
const STICK_RADIUS = 60;

function fmtTime(t: number): string {
    if (t <= 0) { return '0:00.0'; }
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const si = Math.floor(s);
    const d = Math.floor((s - si) * 10);
    return m + ':' + (si < 10 ? '0' : '') + si + '.' + d;
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
    private _minimap: Graphics = null;
    private _minimapNode: Node = null;
    private _minimapT = 0;
    private _hudRoot: Node = null;

    // panels
    private _menuPanel: Node = null;
    private _menuBestLabel: Label = null;
    private _resultsPanel: Node = null;
    private _resultsLabel: Label = null;
    private _resultsTitle: Label = null;
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
            if (this._toastTime <= 0 && this._toastLabel) { this._toastLabel.node.active = false; }
        }
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
            if (this._menuBestLabel && this._game) {
                const best = this._game.bestTimeMs;
                this._menuBestLabel.string = best > 0
                    ? '最佳成绩 ' + fmtTime(best / 1000)
                    : '暂无成绩，来跑第一圈！';
            }
        }
    }

    public showHud(show: boolean) {
        if (this._hudRoot) { this._hudRoot.active = show; }
    }

    public showCountdown(text: string) {
        if (!this._countdownLabel) { return; }
        this._countdownLabel.string = text;
        this._countdownLabel.node.active = text.length > 0;
    }

    public showToast(text: string, seconds: number = 1.6) {
        if (!this._toastLabel) { return; }
        this._toastLabel.string = text;
        this._toastLabel.node.active = true;
        this._toastTime = seconds;
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
        if (this._resultsTitle) {
            const mine = rows.findIndex((r) => r.isPlayer);
            this._resultsTitle.string = mine === 0 ? '🏆 冠军！' : '完赛！第 ' + (mine + 1) + ' 名';
        }
        if (this._resultsLabel) {
            const lines: string[] = [];
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const t = r.time > 0 ? fmtTime(r.time) : '--:--.-';
                const best = r.bestLap > 0 ? ' · 最快 ' + fmtTime(r.bestLap) : '';
                lines.push((i + 1) + '. ' + r.name + (r.isPlayer ? ' (你)' : '') + '  ' + t + best);
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
            this._lapLabel.string = '第 ' + lap + '/3 圈';
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
            this._itemLabel.string = p.itemKind > 0
                ? (ITEM_NAMES[p.itemKind] || '') + (p.itemCount > 1 ? ' ×' + p.itemCount : '')
                : '—';
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

    private _makeButton(parent: Node, name: string, x: number, y: number, w: number, h: number,
        text: string, fontSize: number, bg: Color, onTap: () => void): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const t = node.addComponent(UITransform);
        t.setContentSize(w, h);
        const g = node.addComponent(Graphics);
        g.fillColor = bg;
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        g.strokeColor = new Color(255, 255, 255, 255);
        g.lineWidth = 2;
        g.rect(-w / 2, -h / 2, w, h);
        g.stroke();
        const labelNode = new Node('label');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.setParent(node);
        labelNode.setPosition(0, 0, 0);
        const label = labelNode.addComponent(Label);
        label.fontSize = fontSize;
        label.color = WHITE;
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
        const g = node.addComponent(Graphics);
        g.fillColor = bg;
        g.circle(0, 0, r);
        g.fill();
        g.strokeColor = new Color(255, 255, 255, 255);
        g.lineWidth = 2;
        g.circle(0, 0, r);
        g.stroke();
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

        this._posLabel = this._makeLabel(hud, 'posLabel', -300, 590, 44, GOLD, '第 1/8 名');
        this._lapLabel = this._makeLabel(hud, 'lapLabel', -300, 540, 28, WHITE, '第 1/3 圈');
        this._timeLabel = this._makeLabel(hud, 'timeLabel', 0, 590, 30, WHITE, '0:00.0');
        this._zoneLabel = this._makeLabel(hud, 'zoneLabel', 0, 540, 24, GREY, '');
        this._speedLabel = this._makeLabel(hud, 'speedLabel', 280, -520, 36, WHITE, '0 km/h');
        this._itemLabel = this._makeLabel(hud, 'itemLabel', 0, -520, 32, WHITE, '—');
        this._countdownLabel = this._makeLabel(hud, 'countdownLabel', 0, 150, 120, GOLD, '');
        this._countdownLabel.node.active = false;
        this._toastLabel = this._makeLabel(hud, 'toastLabel', 0, -100, 28, WHITE, '');
        this._toastLabel.node.active = false;

        // pause button (top-right corner)
        this._makeButton(hud, 'pauseBtn', 330, 590, 56, 56, 'II', 28,
            new Color(40, 50, 70, 255), () => { if (this._game) { this._game.togglePause(); } });

        // drift + item buttons (right side, hold / tap)
        this._makeRoundButton(hud, 'driftBtn', 250, -400, 62, '漂移', 34,
            new Color(30, 120, 220, 255),
            (e: EventTouch) => { this._driftId = e.touch ? e.touch.getID() : 0; },
            () => { this._driftId = -1; });
        this._makeRoundButton(hud, 'itemBtn', 250, -260, 52, '道具', 30,
            new Color(220, 140, 30, 255),
            () => { if (this._game) { this._game.useItem(); } });

        // minimap (top-right, under the pause button)
        const mm = new Node('minimap');
        mm.layer = Layers.Enum.UI_2D;
        mm.setParent(hud);
        mm.setPosition(255, 425, 0);
        const mt = mm.addComponent(UITransform);
        mt.setContentSize(190, 190);
        this._minimap = mm.addComponent(Graphics);
        this._minimapNode = mm;
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
        this._makeLabel(menu, 'title', 0, 300, 72, GOLD, '飞车狂飙');
        this._makeLabel(menu, 'subtitle', 0, 220, 28, WHITE, '3 圈 · 8 辆车 · 漂移加速');
        this._menuBestLabel = this._makeLabel(menu, 'best', 0, 120, 28, GOLD, '');
        this._makeButton(menu, 'startBtn', 0, -40, 480, 110, '开始比赛', 44,
            new Color(30, 120, 220, 255), () => { if (this._game) { this._game.startRace(); } });
        this._makeButton(menu, 'hallBtn', 0, -180, 480, 110, '回大厅', 40,
            new Color(90, 100, 120, 255), () => { if (this._game) { this._game.quitToHall(); } });
        this._makeLabel(menu, 'hint', 0, -320, 24, GREY, '左半屏摇杆转向（下推刹车）· 右侧漂移 / 道具');

        // --- results ---
        const res = new Node('kartResults');
        res.layer = Layers.Enum.UI_2D;
        res.setParent(this._canvas);
        res.setPosition(0, 0, 0);
        this._resultsPanel = res;
        res.active = false;
        this._resultsTitle = this._makeLabel(res, 'title', 0, 330, 56, GOLD, '完赛！');
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
        this._makeLabel(pau, 'title', 0, 200, 56, GOLD, '暂停');
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
