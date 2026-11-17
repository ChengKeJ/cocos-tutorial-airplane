
import { _decorator, Component, Node, input, Input, Touch, EventTouch, EventKeyboard, KeyCode } from 'cc';
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

    start () {
        input.on(Input.EventType.TOUCH_START, this._touchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._touchMove, this);
        input.on(Input.EventType.TOUCH_END, this._touchEnd, this);
        input.on(Input.EventType.KEY_DOWN, this._keyDown, this);
        input.on(Input.EventType.KEY_UP, this._keyUp, this);

        this.gameStart.active  = true;
    }

    onDestroy () {
        input.off(Input.EventType.TOUCH_START, this._touchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._touchMove, this);
        input.off(Input.EventType.TOUCH_END, this._touchEnd, this);
        input.off(Input.EventType.KEY_DOWN, this._keyDown, this);
        input.off(Input.EventType.KEY_UP, this._keyUp, this);
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
        const cx = Math.max(PLANE_MIN_X, Math.min(PLANE_MAX_X, x));
        const cz = Math.max(PLANE_MIN_Z, Math.min(PLANE_MAX_Z, z));
        this.playerPlane.setPosition(cx, this.playerPlane.position.y, cz);
    }

    _touchStart(touch: Touch, event: EventTouch){
        if (!this.gameManager.isGameStart) {
            // first tap anywhere starts the game (menu page is showing)
            if (this.gameStart.active) {
                this.gameStart.active = false;
                this.game.active = true;
                this.gameManager.playAudioEffect('button');
                this.gameManager.gameStart();
            }
        }
        // auto-fire is always on while playing — touch only moves the plane
    }

    _touchMove(touch: Touch, event: EventTouch){
        if (!this.gameManager.isGameStart) {
            return;
        }

        const delta = touch.getDelta();
        const pos = this.playerPlane.position;
        this._setPlanePos(
            pos.x + 0.01 * this.planeSpeed * delta.x,
            pos.z - 0.01 * this.planeSpeed * delta.y,
        );
    }

    _touchEnd(touch: Touch, event: EventTouch){
        // auto-fire stays on; nothing to stop
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
