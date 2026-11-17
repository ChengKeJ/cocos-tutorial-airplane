
import { _decorator, Component, Node, Collider, ITriggerEvent, AudioSource } from 'cc';
import { Constant } from '../framework/Constant';
import { GameManager } from '../framework/GameManager';
const { ccclass, property } = _decorator;

/**
 * Predefined variables
 * Name = SelfPlane
 * DateTime = Mon Nov 15 2021 10:27:19 GMT+0800 (China Standard Time)
 * Author = mywayday
 * FileBasename = SelfPlane.ts
 * FileBasenameNoExtension = SelfPlane
 * URL = db://assets/script/SelfPlane.ts
 * ManualUrl = https://docs.cocos.com/creator/3.3/manual/en/
 *
 * Upgraded for Star Fighter v1.0.0 (2026-11-17):
 * - HP is per-life (lifeValue hits); lives are owned by GameManager (3 lives).
 * - Hits are routed to GameManager.onPlayerHit(), which owns shield /
 *   invulnerability / lives / respawn, so this class only renders HP + death.
 */

@ccclass('SelfPlane')
export class SelfPlane extends Component {
    @property(Node)
    public explode: Node = null;
    @property(Node)
    public bloodFace: Node = null;
    @property(Node)
    public blood: Node = null;
    public lifeValue = 5;
    public isDie = false;

    // set by GameManager at start (scene wires playerPlane -> GameManager, not the reverse)
    public gameManager: GameManager = null;

    private _currLife = 0;
    private _audioEffect: AudioSource = null;

    start(){
        this._audioEffect = this.getComponent(AudioSource);
    }


    onEnable () {
        const collider = this.getComponent(Collider);
        collider.on('onTriggerEnter', this._onTriggerEnter, this);
    }

    onDisable () {
        const collider = this.getComponent(Collider);
        collider.off('onTriggerEnter', this._onTriggerEnter, this);
    }

    // update (deltaTime: number) {
    //     // [4]
    // }

    public init(){
        this._currLife = this.lifeValue;
        this.isDie = false;
        this.explode.active = false;
        this.bloodFace.setScale(1, 1, 1);
    }

    /** Full HP for the current life (used on respawn). */
    public resetLife(){
        this._currLife = this.lifeValue;
        this.isDie = false;
        this.explode.active = false;
        this.bloodFace.setScale(1, 1, 1);
    }

    /** Apply one hit. Returns remaining HP (0 = this life is spent). */
    public damage(): number {
        if (this._currLife === this.lifeValue) {
            this.blood.active = true;
        }
        this._currLife--;
        this.bloodFace.setScale(Math.max(this._currLife, 0) / this.lifeValue, 1, 1);
        return this._currLife;
    }

    public get currLife(): number {
        return this._currLife;
    }

    /** Final death: explosion + hide the blood bar. */
    public die(){
        this.isDie = true;
        this._audioEffect.play();
        this.explode.active = true;
        this.blood.active = false;
        console.log('self plane is die');
    }

    private _onTriggerEnter(event: ITriggerEvent){
        // some trick to fix "trigger vs trigger problem" in physx
        if(event.otherCollider.material.friction == 100){
            return;
        }

        const collisionGroup = event.otherCollider.getGroup();
        if(collisionGroup === Constant.CollisionType.ENEMY_PLANE || collisionGroup === Constant.CollisionType.ENEMY_BULLET){
            if (this.gameManager) {
                this.gameManager.onPlayerHit();
            }
        }
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
