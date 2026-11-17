import { _decorator, Camera, Component, EventKeyboard, EventTouch, find, Input, input, KeyCode, Node, Touch, Vec3 } from 'cc';
import { GameManager } from '../framework/GameManager';
const { ccclass, property } = _decorator;

/**
 * Predefined variables
 * Name = UIMain
 * DateTime = Mon Nov 15 2021 14:10:01 GMT+0800 (China Standard Time)
 * Author = mywayday
 * FileBasename = UIMain.ts
 * FileBasenameNoExtension = UIMain
 * URL = db://assets/script/ui/UIMain.ts
 * ManualUrl = https://docs.cocos.com/creator/3.3/manual/en/
 *
 * Upgraded for Star Fighter v1.0.0 (2026-11-17):
 * - systemEvent (deprecated in 3.4+, removed in later 3.x) replaced by the `input`
 *   singleton, which works on 3.3 and 3.8 alike.
 * - Auto-fire: firing is always on while playing (GameManager), touch only moves
 *   the plane. Movement is clamped to the playfield.
 * - Keyboard (desktop testing): arrows/WASD move, Space = bomb, Enter/Space starts.
 *
 * Drag fix (2026-11-17, user reported 无法拖动操作 on the trial build):
 * - Primary control is now ABSOLUTE: the touch point is mapped onto the
 *   ground plane (y=0) through the Main Camera and the plane is set to
 *   that world X/Z directly, clamped to the playfield — the plane follows
 *   the finger 1:1. Verified against the Cocos 3.8.0 engine source:
 *   Touch.getLocation() is already in device pixels, which is exactly
 *   what Camera.screenToWorld expects; its 3.8 signature is
 *   screenToWorld(out, screenPos) and screenPos.z is a NORMALIZED depth
 *   (0 = near plane, 1 = far plane), so two calls give two points on the
 *   same ray and intersecting that ray with y=0 is exact for both
 *   perspective and orthographic cameras. A one-time calibration maps the
 *   screen corners and checks the span against the camera's orthoHeight;
 *   if the mapping looks wrong (e.g. a units mismatch) absolute mapping
 *   is disabled and the old delta drag is used instead of pinning the
 *   plane to an edge.
 * - SECOND touch channel: the same handlers are registered on the game
 *   page node as well as the global `input` singleton, so dragging works
 *   even if one channel stops delivering on WeChat. Both channels deliver
 *   the same move event; a (touchId, location) key dedupes it so the
 *   plane moves once, not twice.
 * - Stuck-state retry: if the menu is already hidden but the game never
 *   started (e.g. the "heavy" subpackage bundle failed to load), tapping
 *   the screen retries gameStart() instead of doing nothing forever.
 * - The input singleton delivers a single EventTouch argument (its
 *   .touch is the Touch); _extractTouch normalizes both shapes.
 * - Diagnostics (trial only, remove before review submission): the game
 *   page shows a small line with the last touch world position, the plane
 *   position and the drag mode (see GameManager.setDebugInfo); the menu
 *   shows the bundle state (loading/ready/failed).
 */

const PLANE_MIN_X = -24;
const PLANE_MAX_X = 24;
const PLANE_MIN_Z = -8;
const PLANE_MAX_Z = 20;

@ccclass('UIMain')
export class UIMain extends Component {
    @property
    public planeSpeed = 1;

    @property(Node)
    public playerPlane: Node = null;

    @property(GameManager)
    public gameManager: GameManager = null;

    @property(Node)
    public gameStart: Node = null;
    @property(Node)
    public game: Node = null;
    @property(Node)
    public gameOver: Node = null;

    private _keys: { [code: number]: boolean } = {};
    private _spaceUsed = false;

    // drag: absolute touch -> ground-plane mapping (Main Camera)
    private _mainCamera: Camera | null = null;
    private _absChecked = false;
    private _absOk = false;
    private _lastMoveKey = '';

    start () {
        // Main Camera: same lookup GameManager uses for the screen shake.
        const camNode = find('Main Camera');
        if (camNode) {
            this._mainCamera = camNode.getComponent(Camera);
        }

        // Channel 1: the global input singleton.
        input.on(Input.EventType.TOUCH_START, this._inputTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._inputTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._inputTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._inputTouchEnd, this);
        input.on(Input.EventType.KEY_DOWN, this._keyDown, this);
        input.on(Input.EventType.KEY_UP, this._keyUp, this);

        // Channel 2: the game page node itself (full-screen UI page).
        // Fires even if the global channel ever stops delivering.
        if (this.game) {
            this.game.on(Node.EventType.TOUCH_START, this._nodeTouchStart, this);
            this.game.on(Node.EventType.TOUCH_MOVE, this._nodeTouchMove, this);
            this.game.on(Node.EventType.TOUCH_END, this._nodeTouchEnd, this);
            this.game.on(Node.EventType.TOUCH_CANCEL, this._nodeTouchEnd, this);
        }

        this.gameStart.active  = true;
    }

    onDestroy () {
        input.off(Input.EventType.TOUCH_START, this._inputTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._inputTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._inputTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._inputTouchEnd, this);
        input.off(Input.EventType.KEY_DOWN, this._keyDown, this);
        input.off(Input.EventType.KEY_UP, this._keyUp, this);
        if (this.game) {
            this.game.off(Node.EventType.TOUCH_START, this._nodeTouchStart, this);
            this.game.off(Node.EventType.TOUCH_MOVE, this._nodeTouchMove, this);
            this.game.off(Node.EventType.TOUCH_END, this._nodeTouchEnd, this);
            this.game.off(Node.EventType.TOUCH_CANCEL, this._nodeTouchEnd, this);
        }
    }

    update (deltaTime: number) {
        // keyboard movement (desktop testing)
        if (!this.gameManager.isGameStart) {
            return;
        }
        let dx = 0;
        let dz = 0;
        if (this._keys[KeyCode.ARROW_LEFT] || this._keys[KeyCode.KEY_A]) { dx -= 1; }
        if (this._keys[KeyCode.ARROW_RIGHT] || this._keys[KeyCode.KEY_D]) { dx += 1; }
        if (this._keys[KeyCode.ARROW_UP] || this._keys[KeyCode.KEY_W]) { dz -= 1; }
        if (this._keys[KeyCode.ARROW_DOWN] || this._keys[KeyCode.KEY_S]) { dz += 1; }
        if (dx !== 0 || dz !== 0) {
            const speed = 30 * deltaTime;
            const pos = this.playerPlane.position;
            this._setPlanePos(pos.x + dx * speed, pos.z + dz * speed);
        }
    }

    public reStart(){
        this.gameOver.active = false;
        this.game.active = true;
        this.gameManager.playAudioEffect('button');
        this.gameManager.gameReStart();
    }

    public returnMain(){
        this.gameOver.active = false;
        this.gameStart.active = true;
        this.gameManager.playAudioEffect('button');
        this.gameManager.returnMain();
    }

    private _setPlanePos(x: number, z: number){
        if (!this.playerPlane) {
            return;
        }
        const cx = Math.max(PLANE_MIN_X, Math.min(PLANE_MAX_X, x));
        const cz = Math.max(PLANE_MIN_Z, Math.min(PLANE_MAX_Z, z));
        this.playerPlane.setPosition(cx, this.playerPlane.position.y, cz);
    }

    // ---------- touch channels ----------

    // The input singleton delivers a single EventTouch (its .touch is the
    // Touch). Older code typed the first arg as Touch — EventTouch
    // delegates getLocation/getDelta to .touch, so either shape works;
    // _extractTouch normalizes to the real Touch.
    private _extractTouch(a: any): Touch | null {
        if (!a) {
            return null;
        }
        if (a.touch) {
            return a.touch as Touch;
        }
        if (typeof a.getLocation === 'function') {
            return a as Touch;
        }
        return null;
    }

    private _inputTouchStart(a: any, _b?: any) {
        const t = this._extractTouch(a);
        if (t) {
            this._handleTouchStart(t);
        }
    }

    private _inputTouchMove(a: any, _b?: any) {
        const t = this._extractTouch(a);
        if (t) {
            this._handleTouchMove(t);
        }
    }

    private _inputTouchEnd(_a: any, _b?: any) {
        // auto-fire stays on; nothing to stop
    }

    private _nodeTouchStart(event: EventTouch) {
        const t = event.touch;
        if (t) {
            this._handleTouchStart(t);
        }
    }

    private _nodeTouchMove(event: EventTouch) {
        const t = event.touch;
        if (t) {
            this._handleTouchMove(t);
        }
    }

    private _nodeTouchEnd(_event: EventTouch) {
        // auto-fire stays on; nothing to stop
    }

    private _handleTouchStart(touch: Touch) {
        if (!this.gameManager.isGameStart) {
            if (this.gameStart.active) {
                // first tap anywhere starts the game (menu page is showing)
                this.gameStart.active = false;
                this.game.active = true;
                this.gameManager.playAudioEffect('button');
                this.gameManager.gameStart();
                if (this.gameManager.isGameStart) {
                    this._movePlaneToTouch(touch);
                }
            } else {
                // Stuck state: the menu is already hidden but the game never
                // started (e.g. the "heavy" bundle failed to load). A tap
                // retries the start instead of doing nothing forever.
                this.gameManager.gameStart();
                this.gameManager.setDebugInfo('点屏幕重试：资源加载中…');
            }
            return;
        }
        // Tapping the bomb button must not also yank the plane to the corner.
        if (this.gameManager.isBombTouch(touch)) {
            return;
        }
        // auto-fire is always on while playing — touch only moves the plane
        this._movePlaneToTouch(touch);
    }

    private _handleTouchMove(touch: Touch) {
        if (!this.gameManager.isGameStart) {
            return;
        }
        // Both channels deliver the same move event; process it once.
        const loc = touch.getLocation();
        const key = touch.getID() + ':' + loc.x.toFixed(1) + ',' + loc.y.toFixed(1);
        if (key === this._lastMoveKey) {
            return;
        }
        this._lastMoveKey = key;
        this._movePlaneToTouch(touch);
    }

    /** Move the plane to the finger: absolute mapping first, delta fallback. */
    private _movePlaneToTouch(touch: Touch) {
        if (!this.playerPlane) {
            return;
        }
        const world = this._worldFromTouch(touch);
        if (world) {
            this._setPlanePos(world.x, world.z);
            const p = this.playerPlane.position;
            this.gameManager.setDebugInfo(
                '触 ' + world.x.toFixed(0) + ',' + world.z.toFixed(0)
                + ' 飞机 ' + p.x.toFixed(0) + ',' + p.z.toFixed(0) + ' 绝对',
            );
            return;
        }
        // Fallback: the old delta drag (kept working even when the camera
        // mapping is unavailable).
        const delta = touch.getDelta();
        const pos = this.playerPlane.position;
        this._setPlanePos(
            pos.x + 0.01 * this.planeSpeed * delta.x,
            pos.z - 0.01 * this.planeSpeed * delta.y,
        );
        this.gameManager.setDebugInfo(
            '增量 ' + delta.x.toFixed(0) + ',' + delta.y.toFixed(0) + ' 绝对不可用',
        );
    }

    /**
     * Map a touch onto the ground plane (y=0) the plane flies on.
     * touch.getLocation() is in device pixels — exactly what
     * Camera.screenToWorld expects. screenToWorld's z is a normalized
     * depth (0 = near plane, 1 = far plane), so two calls give two points
     * on the same ray; intersecting that ray with y=0 is exact for both
     * perspective and orthographic cameras.
     * Returns null when the mapping cannot be trusted (the caller then
     * falls back to delta drag).
     */
    private _worldFromTouch(touch: Touch): Vec3 | null {
        if (!this._mainCamera) {
            return null;
        }
        if (!this._absChecked) {
            this._calibrateAbsolute();
        }
        if (!this._absOk) {
            return null;
        }
        const loc = touch.getLocation();
        return this._screenToGround(loc.x, loc.y);
    }

    private _screenToGround(px: number, py: number): Vec3 | null {
        if (!this._mainCamera) {
            return null;
        }
        const near = new Vec3();
        const far = new Vec3();
        this._mainCamera.screenToWorld(near, new Vec3(px, py, 0));
        this._mainCamera.screenToWorld(far, new Vec3(px, py, 1));
        const dx = far.x - near.x;
        const dy = far.y - near.y;
        const dz = far.z - near.z;
        if (Math.abs(dy) < 1e-6) {
            return null;
        }
        const t = -near.y / dy;
        if (t < 0) {
            return null;
        }
        return new Vec3(near.x + dx * t, 0, near.z + dz * t);
    }

    /**
     * One-time sanity check of the absolute mapping: map the bottom-left
     * and top-right screen corners onto the ground plane and compare the
     * span with what the camera's orthoHeight predicts. A units mismatch
     * (e.g. points fed where pixels were expected) shows up as a span
     * several times too big or small — in that case absolute mapping is
     * disabled and delta drag is used instead of pinning the plane to an
     * edge.
     */
    private _calibrateAbsolute(): void {
        this._absChecked = true;
        this._absOk = false;
        if (!this._mainCamera) {
            return;
        }
        try {
            const w = this._mainCamera.width;
            const h = this._mainCamera.height;
            if (!w || !h) {
                return;
            }
            const bl = this._screenToGround(0, 0);
            const tr = this._screenToGround(w, h);
            if (!bl || !tr) {
                return;
            }
            const spanX = Math.abs(tr.x - bl.x);
            const spanZ = Math.abs(tr.z - bl.z);
            if (!isFinite(spanX) || !isFinite(spanZ) || spanX < 1 || spanZ < 1) {
                return;
            }
            const orthoH = this._mainCamera.orthoHeight;
            if (typeof orthoH === 'number' && orthoH > 0) {
                const expectX = 2 * orthoH * (w / h);
                const expectZ = 2 * orthoH;
                if (spanX > expectX * 0.5 && spanX < expectX * 2
                    && spanZ > expectZ * 0.5 && spanZ < expectZ * 2) {
                    this._absOk = true;
                }
            } else {
                // perspective camera: accept any finite, sane span
                this._absOk = true;
            }
        } catch (e) {
            this._absOk = false;
        }
    }

    _keyDown(event: EventKeyboard){
        const code = event.keyCode;
        if (!this.gameManager.isGameStart) {
            if ((code === KeyCode.SPACE || code === KeyCode.ENTER) && this.gameStart.active) {
                this.gameStart.active = false;
                this.game.active = true;
                this.gameManager.playAudioEffect('button');
                this.gameManager.gameStart();
            }
            return;
        }
        if (code === KeyCode.SPACE) {
            if (!this._spaceUsed) {
                this._spaceUsed = true;
                this.gameManager.useBomb();
            }
            return;
        }
        this._keys[code] = true;
    }

    _keyUp(event: EventKeyboard){
        const code = event.keyCode;
        if (code === KeyCode.SPACE) {
            this._spaceUsed = false;
            return;
        }
        this._keys[code] = false;
    }
}

/**
 * [1] Class member could be defined like this.
 * [2] Use `property` decorator if your want the member to be serializable.
 * [3] Your initialization goes here.
 * [4] Your update function goes here.
 *
 * Learn more about scripting: https://docs.cocos.com/creator/3.3/manual/en/scripting/
 * Learn more about CCClass: https://docs.cocos.com/creator/3.3/manual/en/scripting/ccclass.html
 * Learn more about life-cycle callbacks: https://docs.cocos.com/creator/3.3/manual/en/scripting/life-cycle-callbacks.html
 */
