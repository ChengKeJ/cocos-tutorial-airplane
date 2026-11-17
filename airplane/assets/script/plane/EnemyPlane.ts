
import { _decorator, Component, Node, ITriggerEvent, Collider } from 'cc';
import { Constant } from '../framework/Constant';
import { GameManager } from '../framework/GameManager';
import { PoolManager } from '../framework/PoolManager';
const { ccclass, property } = _decorator;

/**
 * Predefined variables
 * Name = EnemyPlane
 * DateTime = Mon Nov 15 2021 18:00:28 GMT+0800 (China Standard Time)
 * Author = mywayday
 * FileBasename = EnemyPlane.ts
 * FileBasenameNoExtension = EnemyPlane
 * URL = db://assets/script/plane/EnemyPlane.ts
 * ManualUrl = https://docs.cocos.com/creator/3.3/manual/en/
 *
 * Upgraded for Star Fighter v1.0.0 (2026-11-17):
 * - HP per enemy (tanky / boss take several hits), hit flash (scale pop).
 * - Movement modes: straight / sine-wave / dive toward the player.
 * - Boss mode: huge scale, big HP, spread + aimed fire, HP reported to GameManager.
 */

const OUTOFBOUNCE = 50;

export interface EnemyShowOptions {
    hp?: number;
    moveMode?: number;
    scale?: number;
    isBoss?: boolean;
    score?: number;
    type?: number;
}

@ccclass('EnemyPlane')
export class EnemyPlane extends Component {
    @property
    public createBulletTime = 0.5;

    private _enemySpeed = 0;
    private _needBullet = false;
    private _gameManager: GameManager = null;

    private _currCreateBulletTime = 0;

    // v1.0.0: HP / movement / boss state
    private _hp = 1;
    private _maxHp = 1;
    private _moveMode = Constant.MoveMode.STRAIGHT;
    private _baseX = 0;
    private _sineTime = 0;
    private _sineAmp = 8;
    private _sineFreq = 1.6;
    private _baseScale = 1;
    private _isBoss = false;
    private _score = Constant.Score.KILL_SMALL;
    private _type = Constant.EnemyType.TYPE1;
    private _flashTime = 0;
    private _bossFireTime = 0;
    private _bossAimTime = 0;

    onEnable () {
        const collider = this.getComponent(Collider);
        collider.on('onTriggerEnter', this._onTriggerEnter, this);
    }

    onDisable () {
        const collider = this.getComponent(Collider);
        collider.off('onTriggerEnter', this._onTriggerEnter, this);
    }

    update (deltaTime: number) {
        const pos = this.node.position;
        let movePos = pos.z;
        let moveX = pos.x;

        if (this._isBoss) {
            // Boss hovers near the top, swaying side to side; it never flies past.
            this._sineTime += deltaTime;
            moveX = this._baseX + Math.sin(this._sineTime * this._sineFreq) * this._sineAmp;
            this.node.setPosition(moveX, pos.y, pos.z);
            this._bossFire(deltaTime);
        } else {
            movePos = pos.z + this._enemySpeed;
            if (this._moveMode === Constant.MoveMode.SINE) {
                this._sineTime += deltaTime;
                moveX = this._baseX + Math.sin(this._sineTime * this._sineFreq) * this._sineAmp;
            } else if (this._moveMode === Constant.MoveMode.DIVE) {
                const playerX = this._gameManager ? this._gameManager.playerPlane.node.position.x : 0;
                moveX = pos.x + (playerX - pos.x) * 0.02;
            }
            this.node.setPosition(moveX, pos.y, movePos);
        }

        if (this._needBullet && !this._isBoss) {
            this._currCreateBulletTime += deltaTime;
            if (this._currCreateBulletTime > this.createBulletTime) {
                this._gameManager.createEnemyBullet(this.node.position);
                this._currCreateBulletTime = 0;
            }
        }

        // hit flash: brief scale pop, then back to base scale
        if (this._flashTime > 0) {
            this._flashTime -= deltaTime;
            if (this._flashTime <= 0) {
                this.node.setScale(this._baseScale, this._baseScale, this._baseScale);
            }
        }

        if (!this._isBoss && movePos > OUTOFBOUNCE) {
            PoolManager.instance().putNode(this.node);
            // this.node.destroy();
        }
    }

    show(gameManager: GameManager, speed: number, needBullet: boolean, opts: EnemyShowOptions = {}){
        this._gameManager = gameManager;
        this._enemySpeed = speed;
        this._needBullet = needBullet;
        this._hp = opts.hp !== undefined ? opts.hp : 1;
        this._maxHp = this._hp;
        this._moveMode = opts.moveMode !== undefined ? opts.moveMode : Constant.MoveMode.STRAIGHT;
        this._baseScale = opts.scale !== undefined ? opts.scale : 1;
        this._isBoss = !!opts.isBoss;
        this._score = opts.score !== undefined ? opts.score : Constant.Score.KILL_SMALL;
        this._type = opts.type !== undefined ? opts.type : Constant.EnemyType.TYPE1;
        this._sineTime = 0;
        this._flashTime = 0;
        this._bossFireTime = 0;
        this._bossAimTime = 0;
        this._currCreateBulletTime = 0;
        // pooled nodes keep their old scale — always reset it here
        this.node.setScale(this._baseScale, this._baseScale, this._baseScale);
        this._baseX = this.node.position.x;
    }

    public get isBoss(): boolean {
        return this._isBoss;
    }

    public get type(): number {
        return this._type;
    }

    public get hp(): number {
        return this._hp;
    }

    public get maxHp(): number {
        return this._maxHp;
    }

    /** Direct damage (bomb). Applies hit flash and dies at 0 HP like a bullet hit. */
    public damage(amount: number){
        this._hp -= amount;
        if (this._hp <= 0) {
            this._die();
        } else {
            this.node.setScale(this._baseScale * 1.18, this._baseScale * 1.18, this._baseScale * 1.18);
            this._flashTime = 0.09;
            if (this._isBoss) {
                this._gameManager.onBossDamaged(this._hp, this._maxHp);
            }
        }
    }

    private _bossFire(deltaTime: number) {
        // spread volley every ~1.1s, aimed shot every ~3.2s
        this._bossFireTime += deltaTime;
        if (this._bossFireTime > 1.1) {
            this._gameManager.createBossSpread(this.node.position);
            this._bossFireTime = 0;
        }
        this._bossAimTime += deltaTime;
        if (this._bossAimTime > 3.2) {
            this._gameManager.createBossAimed(this.node.position);
            this._bossAimTime = 0;
        }
    }

    private _onTriggerEnter(event: ITriggerEvent){
        const collisionGroup = event.otherCollider.getGroup();
        if (collisionGroup === Constant.CollisionType.SELF_BULLET) {
            // take one hit; only die at 0 HP (boss / tanky survive several hits)
            this._hp -= 1;
            if (this._hp <= 0) {
                this._die();
            } else {
                // hit flash: scale pop + sound handled by the bullet impact
                this.node.setScale(this._baseScale * 1.18, this._baseScale * 1.18, this._baseScale * 1.18);
                this._flashTime = 0.09;
                if (this._isBoss) {
                    this._gameManager.onBossDamaged(this._hp, this._maxHp);
                }
            }
        } else if (collisionGroup === Constant.CollisionType.SELF_PLANE) {
            // ramming destroys the enemy outright (player damage is handled by SelfPlane)
            this._die();
        }
    }

    private _die() {
        this._gameManager.playAudioEffect('enemy');
        this._gameManager.createEnemyEffect(this.node.position);
        this._gameManager.onEnemyKilled(this._type, this._score, this.node.position, this._isBoss);
        PoolManager.instance().putNode(this.node);
        // this.node.destroy();
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
