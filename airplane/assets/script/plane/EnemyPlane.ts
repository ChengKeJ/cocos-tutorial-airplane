
import { _decorator, Color, Component, Material, ModelComponent, Node, Vec3, ITriggerEvent, Collider } from 'cc';
import { Constant } from '../framework/Constant';
import { GameManager } from '../framework/GameManager';
import { PoolManager } from '../framework/PoolManager';
import { buildEnemyModel } from './EnemyModel';
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
 *
 * Hit feedback (2026-11-18): a non-lethal hit also swaps the visible
 * procedural model's materials to white for ~0.12 s (restored on expiry,
 * death, and pooled reuse — a reused enemy never stays white) and
 * spawns a small impact burst at the nose via GameManager.createHitEffect.
 * The death explosion is untouched; damage / HP / balance are unchanged.
 *
 * v1.0.8 fix A: the prefab's FBX 'body' is hidden; each type shows its
 * own procedural model from EnemyModel.ts (elite = same model + gold trim).
 */

const OUTOFBOUNCE = 50;

// White-flash length on a non-lethal hit (seconds). The scale pop
// alongside it is 0.09 s; the white flash lingers a touch longer so
// the hit reads even on the big Boss model.
const HIT_FLASH_TIME = 0.12;

// One shared white unlit material for the hit flash, created lazily.
// It is never mutated after creation, so sharing it across enemies is
// safe; the original per-model materials are restored, not modified.
let _flashWhiteMat: Material | null = null;
function flashWhiteMaterial(): Material {
    if (!_flashWhiteMat) {
        _flashWhiteMat = new Material();
        _flashWhiteMat.initialize({ effectName: 'builtin-unlit' });
        _flashWhiteMat.setProperty('mainColor', new Color(255, 255, 255, 255));
    }
    return _flashWhiteMat;
}

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

    // v1.0.8 fix A: procedural per-type models (EnemyModel.ts). Pooled
    // nodes are reused across types, so models are cached per node and
    // toggled in show(); the prefab's FBX 'body' child is hidden once.
    private _modelCache = new Map<string, Node>();
    private _fbxHidden = false;

    // Hit-feedback flash: the visible model's meshes + their original
    // materials, so a hit can swap in the shared white material and
    // swap back. Rebuilt in _applyModel() whenever the model changes.
    private _flashComps: { comp: ModelComponent; origMat: Material }[] = [];
    private _colorFlashTime = 0;

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

        // white-flash expiry: restore the model's original materials
        if (this._colorFlashTime > 0) {
            this._colorFlashTime -= deltaTime;
            if (this._colorFlashTime <= 0) {
                this._restoreFlash();
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
        this._colorFlashTime = 0;
        this._bossFireTime = 0;
        this._bossAimTime = 0;
        this._currCreateBulletTime = 0;
        // pooled nodes keep their old scale — always reset it here
        this.node.setScale(this._baseScale, this._baseScale, this._baseScale);
        this._baseX = this.node.position.x;
        // a pooled node reused mid-flash must never stay white; restore
        // BEFORE _applyModel() rebuilds the flash cache for the new model
        this._restoreFlash();
        this._applyModel();
    }

    /** v1.0.8 fix A: show this spawn's procedural model (one per base
     * type + gold trim for elites), hide the prefab's FBX 'body'. */
    private _applyModel(): void {
        if (!this._fbxHidden) {
            this._fbxHidden = true;
            const body = this.node.getChildByName('body');
            if (body) {
                body.active = false;
            } else {
                // Fallback: hide any non-procedural mesh child.
                for (const c of this.node.children) {
                    if (c.name !== 'procModel' && c.getComponent(ModelComponent)) {
                        c.active = false;
                    }
                }
            }
        }
        const elite = this._type >= 10;
        const baseType = elite ? this._type - 10 : this._type;
        const key = baseType + ':' + (elite ? 1 : 0);
        this._modelCache.forEach((n) => { n.active = false; });
        let m = this._modelCache.get(key);
        if (!m) {
            m = buildEnemyModel(baseType, elite);
            m.setParent(this.node);
            this._modelCache.set(key, m);
        }
        m.active = true;
        // rebuild the flash cache for the now-visible model: its meshes
        // + their original materials, so a hit flash can swap in white
        // and back. The materials are per-model instances (MeshBuilder
        // creates them per build), never shared with another enemy.
        this._flashComps.length = 0;
        for (const r of m.getComponentsInChildren(ModelComponent)) {
            const orig = r.getMaterial(0);
            if (orig) { this._flashComps.push({ comp: r, origMat: orig }); }
        }
    }

    /** Swap the visible model's materials to the shared white material
     * for HIT_FLASH_TIME; update() restores the originals on expiry. */
    private _startHitFlash(): void {
        const white = flashWhiteMaterial();
        for (const f of this._flashComps) {
            f.comp.setMaterial(white, 0);
        }
        this._colorFlashTime = HIT_FLASH_TIME;
    }

    /** Restore the model's original materials after a white flash.
     * Idempotent — safe to call from show()/_die() even when no flash
     * is active, so a pooled node can never stay white. */
    private _restoreFlash(): void {
        this._colorFlashTime = 0;
        for (const f of this._flashComps) {
            f.comp.setMaterial(f.origMat, 0);
        }
    }

    /** Non-lethal hit feedback: scale pop (existing) + white flash on
     * the procedural model + a small impact burst at the nose. This is
     * presentation only — damage, HP and balance are untouched. */
    private _hitSurvived(): void {
        this.node.setScale(this._baseScale * 1.18, this._baseScale * 1.18, this._baseScale * 1.18);
        this._flashTime = 0.09;
        this._startHitFlash();
        const pos = this.node.position;
        this._gameManager.createHitEffect(
            new Vec3(pos.x, pos.y, pos.z + 1.5 * this._baseScale),
            Math.min(0.45 * this._baseScale, 0.8),
        );
        if (this._isBoss) {
            this._gameManager.onBossDamaged(this._hp, this._maxHp);
        }
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
            this._hitSurvived();
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
                this._hitSurvived();
            }
        } else if (collisionGroup === Constant.CollisionType.SELF_PLANE) {
            // ramming destroys the enemy outright (player damage is handled by SelfPlane)
            this._die();
        }
    }

    private _die() {
        this._restoreFlash();
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
