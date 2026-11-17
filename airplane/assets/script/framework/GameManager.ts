
import { _decorator, Component, Node, Prefab, math, Vec3, BoxCollider, Label, Animation, sys, find, UITransform, Color } from 'cc';
import { Bullet } from '../bullet/Bullet';
import { BulletProp } from '../bullet/BulletProp';
import { EnemyPlane } from '../plane/EnemyPlane';
import { SelfPlane } from '../plane/SelfPlane';
import { AudioManager } from './AudioManager';
import { Constant } from './Constant';
import { PoolManager } from './PoolManager';
const { ccclass, property } = _decorator;

/**
 * Predefined variables
 * Name = GameManager
 * DateTime = Mon Nov 15 2021 16:15:32 GMT+0800 (China Standard Time)
 * Author = mywayday
 *
 * FileBasename = GameManager.ts
 * FileBasenameNoExtension = GameManager
 * URL = db://assets/script/framework/GameManager.ts
 * ManualUrl = https://docs.cocos.com/creator/3.3/manual/en/
 *
 * Rewritten for Star Fighter v1.0.0 (2026-11-17):
 * - 5 waves with rising count / speed / HP, wave-clear banner + bonus, boss at wave 5.
 * - 4 enemy types (straight / sine / tanky / dart) + boss (spread + aimed fire).
 * - 3 lives, shield (8s), bomb (clears screen, stock max 3), prop drops.
 * - Best score in local storage, runtime HUD (lives / wave / bombs / boss HP),
 *   screen shake on player hit, auto-fire always on.
 * - Fully offline, no IAP, no ad calls (AD hook placeholder: none yet — ads are
 *   wired in a later release once the rewarded-video unit exists).
 */

interface WaveDef {
    quota: number;      // kills needed to clear the wave (0 = boss wave)
    interval: number;   // seconds between spawns
    speedMul: number;   // enemy speed multiplier
    types: number[];    // enemy types allowed this wave (weighted by repetition)
}

const WAVES: WaveDef[] = [
    { quota: 12, interval: 1.0, speedMul: 1.00, types: [1, 1, 2] },
    { quota: 16, interval: 0.9, speedMul: 1.15, types: [1, 2, 2, 3] },
    { quota: 20, interval: 0.8, speedMul: 1.30, types: [1, 2, 3, 3, 4] },
    { quota: 24, interval: 0.7, speedMul: 1.45, types: [1, 2, 3, 4, 4] },
    { quota: 0,  interval: 5.0, speedMul: 1.50, types: [4] }, // boss wave: dart adds only
];

const BEST_KEY = 'starfighter_best';
const BOMB_MAX = 3;
const SHIELD_SECONDS = 8;

@ccclass('GameManager')
export class GameManager extends Component {
    @property(SelfPlane)
    public playerPlane: SelfPlane = null;
    // bullet
    @property(Prefab)
    public bullet01: Prefab = null;
    @property(Prefab)
    public bullet02: Prefab = null;
    @property(Prefab)
    public bullet03: Prefab = null;
    @property(Prefab)
    public bullet04: Prefab = null;
    @property(Prefab)
    public bullet05: Prefab = null;
    @property
    public shootTime = 0.3;
    @property
    public bulletSpeed = 1;
    @property(Node)
    public bulletRoot: Node = null;

    // enemy
    @property(Prefab)
    public enemy01: Prefab = null;
    @property(Prefab)
    public enemy02: Prefab = null;
    @property
    public createEnemyTime = 1;
    @property
    public enemy1Speed = 0.5;
    @property
    public enemy2Speed = 0.7;
    @property(Prefab)
    public enemyExplode: Prefab = null;

    // prop
    @property(Prefab)
    public bulletPropM: Prefab = null;
    @property(Prefab)
    public bulletPropH: Prefab = null;
    @property(Prefab)
    public bulletPropS: Prefab = null;
    @property
    public bulletPropSpeed = 0.3;

    // ui
    @property(Node)
    public gamePage: Node = null;
    @property(Node)
    public gameOverPage: Node = null;
    @property(Label)
    public gameScore: Label = null;
    @property(Label)
    public gameOverScore: Label = null;
    @property(Animation)
    public overAnim: Animation = null;
    // menu page (wired in the scene as the gameStart node via UIMain; set from start())
    public gameStartPage: Node = null;

    // audio
    @property(AudioManager)
    public audioEffect: AudioManager = null;

    public isGameStart = false;

    private _currShootTime = 0;
    private _isShooting = false;
    private _bulletType = Constant.BulletPropType.BULLET_M;
    private _score = 0;
    private _best = 0;

    // waves
    private _wave = 0;
    private _killsInWave = 0;
    private _waveState = 'idle'; // idle | banner | fighting | clear | boss
    private _stateTimer = 0;
    private _spawnTimer = 0;
    private _formationTimer = 0;
    private _propTimer = 0;
    private _boss: EnemyPlane = null;
    private _victoryPending = false;

    // lives / shield / bomb
    private _lives = 3;
    private _bombs = 1;
    private _shieldTime = 0;
    private _invulnTime = 0;
    private _blinkTime = 0;
    private _blinkOn = true;

    // hud (created at runtime under the scene's UI pages)
    private _livesLabel: Label = null;
    private _waveLabel: Label = null;
    private _bombLabel: Label = null;
    private _bannerLabel: Label = null;
    private _toastLabel: Label = null;
    private _bossLabel: Label = null;
    private _bestLabel: Label = null;
    private _victoryLabel: Label = null;
    private _bannerTime = 0;
    private _toastTime = 0;

    // screen shake (Main Camera)
    private _camera: Node = null;
    private _cameraBase = new Vec3();
    private _shakeTime = 0;
    private _shakeMag = 0;


    start () {
        this._init();
    }

    update (deltaTime: number) {
        if(!this.isGameStart){
            return;
        }

        if(this.playerPlane.isDie){
            this.gameOver(false);
            return;
        }

        // victory is deferred one frame so the boss node finishes its own
        // trigger handling (and its pool return) before _destroyAll runs
        if (this._victoryPending) {
            this._victoryPending = false;
            this.gameOver(true);
            return;
        }

        // --- shield / invulnerability timers + blink ---
        if (this._shieldTime > 0) { this._shieldTime -= deltaTime; }
        if (this._invulnTime > 0) { this._invulnTime -= deltaTime; }
        if (this._shieldTime > 0 || this._invulnTime > 0) {
            this._blinkTime += deltaTime;
            if (this._blinkTime > 0.15) {
                this._blinkTime = 0;
                this._blinkOn = !this._blinkOn;
                this.playerPlane.node.active = this._blinkOn;
            }
        } else if (!this.playerPlane.node.active) {
            this.playerPlane.node.active = true;
            this._blinkOn = true;
        }

        // --- auto-fire: always on while playing ---
        this._currShootTime += deltaTime;
        if(this._currShootTime > this.shootTime){
            if (this._bulletType === Constant.BulletPropType.BULLET_H) {
                this.createPlayerBulletH();
            } else if (this._bulletType === Constant.BulletPropType.BULLET_S) {
                this.createPlayerBulletS();
            } else {
                this.createPlayerBulletM();
            }

            const name = 'bullet' + (this._bulletType % 2 + 1);
            this.playAudioEffect(name);
            this._currShootTime = 0;
        }

        // --- wave state machine ---
        if (this._waveState === 'banner' || this._waveState === 'clear') {
            this._stateTimer -= deltaTime;
            if (this._stateTimer <= 0) {
                if (this._waveState === 'banner') {
                    if (this._wave === Constant.Wave.BOSS_WAVE) {
                        this._spawnBoss();
                        this._waveState = 'boss';
                    } else {
                        this._waveState = 'fighting';
                    }
                } else {
                    this._startWave(this._wave + 1);
                }
            }
        } else if (this._waveState === 'fighting') {
            this._spawnTimer += deltaTime;
            const waveDef = WAVES[this._wave - 1];
            if (this._spawnTimer > waveDef.interval) {
                this.createEnemyPlane();
                this._spawnTimer = 0;
            }
            this._formationTimer += deltaTime;
            if (this._formationTimer > 9) {
                this._formationTimer = 0;
                if (Math.random() < 0.5) {
                    this.createCombination1();
                } else {
                    this.createCombination2();
                }
            }
            if (this._killsInWave >= waveDef.quota) {
                this._waveClear();
            }
        } else if (this._waveState === 'boss') {
            // occasional dart adds during the boss fight
            this._spawnTimer += deltaTime;
            if (this._spawnTimer > WAVES[4].interval) {
                this._spawnTimer = 0;
                this._spawnEnemyByType(Constant.EnemyType.TYPE4);
            }
        }

        // --- scheduled prop drop (one free bullet prop every 18s) ---
        this._propTimer += deltaTime;
        if (this._propTimer > 18) {
            this._propTimer = 0;
            this.createBulletProp(Constant.PropKind.BULLET);
        }

        // --- banner / toast auto-hide ---
        if (this._bannerTime > 0) {
            this._bannerTime -= deltaTime;
            if (this._bannerTime <= 0 && this._bannerLabel) {
                this._bannerLabel.node.active = false;
            }
        }
        if (this._toastTime > 0) {
            this._toastTime -= deltaTime;
            if (this._toastTime <= 0 && this._toastLabel) {
                this._toastLabel.node.active = false;
            }
        }

        // --- screen shake ---
        if (this._shakeTime > 0 && this._camera) {
            this._shakeTime -= deltaTime;
            const m = this._shakeMag;
            this._camera.setPosition(
                this._cameraBase.x + (Math.random() * 2 - 1) * m,
                this._cameraBase.y + (Math.random() * 2 - 1) * m,
                this._cameraBase.z,
            );
            if (this._shakeTime <= 0) {
                this._camera.setPosition(this._cameraBase);
            }
        }
    }

    public returnMain(){
        this._currShootTime = 0;
        this._bulletType = Constant.BulletPropType.BULLET_M;
        this.playerPlane.node.setPosition(0, 0, 15);
        this.playerPlane.node.active = true;
        this._score = 0;
        this._wave = 0;
        this._waveState = 'idle';
        this._boss = null;
        this._victoryPending = false;
        if (this._bossLabel) { this._bossLabel.node.active = false; }
        if (this._victoryLabel) { this._victoryLabel.node.active = false; }
        if (this._bannerLabel) { this._bannerLabel.node.active = false; }
        if (this._toastLabel) { this._toastLabel.node.active = false; }
        this.playerPlane.init();
        this._refreshBestLabel();
    }

    public gameStart(){
        this.isGameStart = true;
        this._score = 0;
        this.gameScore.string = this._score.toString();
        this._bulletType = Constant.BulletPropType.BULLET_M;
        this._currShootTime = this.shootTime;
        this._lives = 3;
        this._bombs = 1;
        this._shieldTime = 0;
        this._invulnTime = 0;
        this._boss = null;
        this._victoryPending = false;
        this._propTimer = 0;
        this._formationTimer = 0;
        this.playerPlane.gameManager = this;
        this.playerPlane.node.active = true;
        this.playerPlane.node.setPosition(0, 0, 15);
        this.playerPlane.init();
        this._isShooting = true;
        if (this._bossLabel) { this._bossLabel.node.active = false; }
        if (this._victoryLabel) { this._victoryLabel.node.active = false; }
        this._refreshHud();
        this._startWave(1);
    }

    public gameReStart(){
        this._destroyAll();
        this.gameStart();
    }

    public gameOver(victory: boolean){
        if (!this.isGameStart) {
            return;
        }
        this.isGameStart = false;
        this.gamePage.active = false;
        this.gameOverPage.active = true;
        this.gameOverScore.string = this._score.toString();
        if (this._victoryLabel) {
            this._victoryLabel.node.active = victory;
            if (victory) {
                this._victoryLabel.string = '🏆 通关！';
            }
        }
        if (this._bossLabel) { this._bossLabel.node.active = false; }
        // best score
        if (this._score > this._best) {
            this._best = this._score;
            sys.localStorage.setItem(BEST_KEY, String(this._best));
        }
        this.overAnim.play();
        this._isShooting = false;
        this._boss = null;
        this.playerPlane.node.active = true;
        this._destroyAll();
        this._refreshBestLabel();
    }

    // ---------- scoring / kills ----------

    public addScore(points: number){
        this._score += points;
        this.gameScore.string = this._score.toString();
    }

    /** Called by EnemyPlane when it dies (bullet kill or ramming). */
    public onEnemyKilled(type: number, score: number, pos: Vec3, isBoss: boolean){
        this.addScore(score);
        if (isBoss) {
            this._boss = null;
            if (this._bossLabel) { this._bossLabel.node.active = false; }
            this._victoryPending = true;
            return;
        }
        this._killsInWave++;
        // 8% drop chance: mostly bullet upgrades, sometimes shield / bomb
        if (Math.random() < 0.08) {
            const roll = Math.random();
            const kind = roll < 0.55 ? Constant.PropKind.BULLET
                : roll < 0.78 ? Constant.PropKind.SHIELD
                : Constant.PropKind.BOMB;
            this.createBulletProp(kind, pos.x, pos.z);
        }
    }

    /** Boss HP bar update. */
    public onBossDamaged(hp: number, maxHp: number){
        if (!this._bossLabel) { return; }
        const filled = Math.max(0, Math.ceil((hp / maxHp) * 10));
        const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
        this._bossLabel.string = '👹 钢铁巨兽 ' + bar + ' ' + hp + '/' + maxHp;
    }

    /** Called by SelfPlane when an enemy plane / bullet touches the player. */
    public onPlayerHit(){
        if (!this.isGameStart || this.playerPlane.isDie) {
            return;
        }
        if (this._invulnTime > 0) {
            return;
        }
        if (this._shieldTime > 0) {
            // shield absorbs the hit and breaks
            this._shieldTime = 0;
            this._invulnTime = 1.0;
            this._showToast('🛡 护盾挡住了！');
            this._refreshHud();
            return;
        }
        const hpLeft = this.playerPlane.damage();
        this.shake(0.6, 0.35);
        if (hpLeft <= 0) {
            this._lives--;
            this._refreshHud();
            if (this._lives > 0) {
                // respawn with fresh HP + 2s invulnerability, screen cleared of bullets
                this.playerPlane.resetLife();
                this.playerPlane.node.setPosition(0, 0, 15);
                this._invulnTime = 2.0;
                this.clearEnemyBullets();
                this._showToast('还剩 ' + this._lives + ' 条命！');
            } else {
                this.playerPlane.die();
            }
        }
    }

    // ---------- power-ups ----------

    public grantShield(){
        this._shieldTime = SHIELD_SECONDS;
        this._showToast('🛡 护盾 8 秒！');
        this._refreshHud();
    }

    public grantBomb(){
        if (this._bombs < BOMB_MAX) {
            this._bombs++;
            this._showToast('💣 炸弹 +1');
        } else {
            this._showToast('💣 炸弹已满');
        }
        this._refreshHud();
    }

    /** Bomb: clears all on-screen enemies (score kept) + enemy bullets; boss takes 10 damage. */
    public useBomb(){
        if (!this.isGameStart || this.playerPlane.isDie || this._bombs <= 0) {
            return;
        }
        this._bombs--;
        this.clearAllEnemies(true);
        this.clearEnemyBullets();
        if (this._boss) {
            this._boss.damage(10);
        }
        this.createEnemyEffect(this.playerPlane.node.position);
        this.shake(1.2, 0.5);
        this.playAudioEffect('enemy');
        this._showToast('💥 全屏清空！');
        this._refreshHud();
    }

    public clearEnemyBullets(){
        const kids = this.bulletRoot.children.slice();
        for (let i = 0; i < kids.length; i++) {
            const comp = kids[i].getComponent(Bullet);
            if (comp && comp.isEnemyBullet()) {
                PoolManager.instance().putNode(kids[i]);
            }
        }
    }

    public clearAllEnemies(withScore: boolean){
        const kids = this.node.children.slice();
        let cleared = 0;
        for (let i = 0; i < kids.length; i++) {
            const comp = kids[i].getComponent(EnemyPlane);
            if (comp && !comp.isBoss) {
                if (withScore) {
                    this.addScore(Constant.Score.KILL_SMALL);
                    this.createEnemyEffect(kids[i].position);
                }
                cleared++;
                PoolManager.instance().putNode(kids[i]);
            }
        }
        // a screen clear also counts toward the wave quota
        if (withScore && this._waveState === 'fighting') {
            this._killsInWave += cleared;
        }
    }

    // ---------- player bullets ----------

    public createPlayerBulletM(){
        const bullet = PoolManager.instance().getNode(this.bullet01, this.bulletRoot);
        const pos = this.playerPlane.node.position;
        bullet.setPosition(pos.x, pos.y, pos.z - 7);
        const bulletComp = bullet.getComponent(Bullet);
        bulletComp.show(this.bulletSpeed, false);
    }

    public createPlayerBulletH(){
        const pos = this.playerPlane.node.position;
        // left
        // const bullet1 = instantiate(this.bullet03);
        const bullet1 = PoolManager.instance().getNode(this.bullet03, this.bulletRoot);
        // bullet1.setParent(this.bulletRoot);
        bullet1.setPosition(pos.x - 2.5, pos.y, pos.z - 7);
        const bulletComp1 = bullet1.getComponent(Bullet);
        bulletComp1.show(this.bulletSpeed, false);

        // right
        const bullet2 = PoolManager.instance().getNode(this.bullet03, this.bulletRoot);
        // bullet2.setParent(this.bulletRoot);
        bullet2.setPosition(pos.x + 2.5, pos.y, pos.z - 7);
        const bulletComp2 = bullet2.getComponent(Bullet);
        bulletComp2.show(this.bulletSpeed, false);
    }

    public createPlayerBulletS(){
        const pos = this.playerPlane.node.position;
        // middle
        // const bullet = instantiate(this.bullet05);
        const bullet = PoolManager.instance().getNode(this.bullet05, this.bulletRoot);
        // bullet.setParent(this.bulletRoot);
        bullet.setPosition(pos.x, pos.y, pos.z - 7);
        const bulletComp = bullet.getComponent(Bullet);
        bulletComp.show(this.bulletSpeed, false);

        // left
        const bullet1 = PoolManager.instance().getNode(this.bullet05, this.bulletRoot);
        // bullet1.setParent(this.bulletRoot);
        bullet1.setPosition(pos.x - 4, pos.y, pos.z - 7);
        const bulletComp1 = bullet1.getComponent(Bullet);
        bulletComp1.show(this.bulletSpeed, false, Constant.Direction.LEFT);

        // right
        const bullet2 = PoolManager.instance().getNode(this.bullet05, this.bulletRoot);
        // bullet2.setParent(this.bulletRoot);
        bullet2.setPosition(pos.x + 4, pos.y, pos.z - 7);
        const bulletComp2 = bullet2.getComponent(Bullet);
        bulletComp2.show(this.bulletSpeed, false, Constant.Direction.RIGHT);
    }

    // ---------- enemy bullets ----------

    public createEnemyBullet(targetPos: Vec3, direction: number = Constant.Direction.MIDDLE){
        // const bullet = instantiate(this.bullet01);
        const bullet = PoolManager.instance().getNode(this.bullet02, this.bulletRoot);
        // bullet.setParent(this.bulletRoot);
        bullet.setPosition(targetPos.x, targetPos.y, targetPos.z + 6);
        const bulletComp = bullet.getComponent(Bullet);
        bulletComp.show(1, true, direction);

        const colliderComp = bullet.getComponent(BoxCollider);
        colliderComp.setGroup(Constant.CollisionType.ENEMY_BULLET);
        colliderComp.setMask(Constant.CollisionType.SELF_PLANE);
    }

    /** Boss 3-way spread volley. */
    public createBossSpread(targetPos: Vec3){
        const dirs = [Constant.Direction.LEFT, Constant.Direction.MIDDLE, Constant.Direction.RIGHT];
        const offs = [-3, 0, 3];
        for (let i = 0; i < 3; i++) {
            const bullet = PoolManager.instance().getNode(this.bullet02, this.bulletRoot);
            bullet.setPosition(targetPos.x + offs[i], targetPos.y, targetPos.z + 6);
            const bulletComp = bullet.getComponent(Bullet);
            bulletComp.show(1.2, true, dirs[i]);
            const colliderComp = bullet.getComponent(BoxCollider);
            colliderComp.setGroup(Constant.CollisionType.ENEMY_BULLET);
            colliderComp.setMask(Constant.CollisionType.SELF_PLANE);
        }
    }

    /** Boss aimed shot: fires toward the player's current x. */
    public createBossAimed(targetPos: Vec3){
        const playerX = this.playerPlane.node.position.x;
        const dir = playerX < targetPos.x - 1 ? Constant.Direction.LEFT
            : playerX > targetPos.x + 1 ? Constant.Direction.RIGHT
            : Constant.Direction.MIDDLE;
        this.createEnemyBullet(targetPos, dir);
    }

    // ---------- enemies ----------

    public createEnemyPlane(){
        const waveDef = WAVES[this._wave - 1];
        const type = waveDef.types[math.randomRangeInt(0, waveDef.types.length)];
        this._spawnEnemyByType(type);
    }

    private _spawnEnemyByType(type: number){
        const waveDef = WAVES[this._wave - 1];
        const speedMul = waveDef ? waveDef.speedMul : 1;
        const randomPos = math.randomRangeInt(-22, 23);
        let prefab: Prefab = null;
        let speed = 0;
        let hp = 1;
        let moveMode = Constant.MoveMode.STRAIGHT;
        let scale = 1;
        let needBullet = false;
        let score = Constant.Score.KILL_SMALL;

        if (type === Constant.EnemyType.TYPE1) {
            prefab = this.enemy01;
            speed = this.enemy1Speed * speedMul;
            needBullet = true;
        } else if (type === Constant.EnemyType.TYPE2) {
            prefab = this.enemy02;
            speed = this.enemy2Speed * speedMul;
            moveMode = Constant.MoveMode.SINE;
            needBullet = false;
        } else if (type === Constant.EnemyType.TYPE3) {
            prefab = this.enemy01;
            speed = this.enemy1Speed * 0.6 * speedMul;
            hp = 3 + Math.max(0, this._wave - 3);
            scale = 1.6;
            needBullet = true;
            score = Constant.Score.KILL_TANKY;
        } else {
            // TYPE4 dart: fast, small, dives toward the player
            prefab = this.enemy02;
            speed = this.enemy2Speed * 1.8 * speedMul;
            moveMode = Constant.MoveMode.DIVE;
            scale = 0.7;
            needBullet = false;
        }

        const enemy = PoolManager.instance().getNode(prefab, this.node);
        enemy.setPosition(randomPos, 0, -50);
        const enemyComp = enemy.getComponent(EnemyPlane);
        enemyComp.show(this, speed, needBullet, {
            hp: hp, moveMode: moveMode, scale: scale, score: score, type: type,
        });
    }

    private _spawnBoss(){
        const enemy = PoolManager.instance().getNode(this.enemy02, this.node);
        enemy.setPosition(0, 0, -35);
        const enemyComp = enemy.getComponent(EnemyPlane);
        enemyComp.show(this, 0, true, {
            hp: 60, moveMode: Constant.MoveMode.SINE, scale: 3.0,
            isBoss: true, score: Constant.Score.KILL_BOSS, type: Constant.EnemyType.BOSS,
        });
        this._boss = enemyComp;
        this._showBanner('👹 钢铁巨兽出现了！');
        this.onBossDamaged(60, 60);
        if (this._bossLabel) { this._bossLabel.node.active = true; }
    }

    public createCombination1(){
        const enemyArray = new Array<Node>(5);
        for (let i = 0; i < enemyArray.length; i++) {
            // enemyArray[i] = instantiate(this.enemy01);
            enemyArray[i] = PoolManager.instance().getNode(this.enemy01,this.node );
            const element = enemyArray[i];
            // element.parent = this.node;
            element.setPosition(-20 + i * 10, 0, -50);
            const enemyComp = element.getComponent(EnemyPlane);
            enemyComp.show(this, this.enemy1Speed, false, { type: Constant.EnemyType.TYPE1 });
        }
    }

    public createCombination2(){
        const enemyArray = new Array<Node>(7);

        const combinationPos = [
            -21, 0, -60,
            -14, 0, -55,
            -7, 0, -50,
            0, 0, -45,
            7, 0, -50,
            14, 0, -55,
            21, 0, -60,
        ];

        for (let i = 0; i < enemyArray.length; i++) {
            enemyArray[i] = PoolManager.instance().getNode(this.enemy02, this.node);
            // enemyArray[i] = instantiate(this.enemy02);
            const element = enemyArray[i];
            element.parent = this.node;
            const startIndex = i * 3;
            element.setPosition(combinationPos[startIndex], combinationPos[startIndex + 1], combinationPos[startIndex + 2]);
            const enemyComp = element.getComponent(EnemyPlane);
            enemyComp.show(this, this.enemy2Speed, false, { type: Constant.EnemyType.TYPE2 });
        }
    }

    public createEnemyEffect(pos: Vec3){
        const effect = PoolManager.instance().getNode(this.enemyExplode, this.node);
        effect.setPosition(pos);
    }

    public createBulletProp(kind: number = Constant.PropKind.BULLET, x: number = 15, z: number = -50){
        let prefab: Prefab = null;
        if (kind === Constant.PropKind.SHIELD) {
            prefab = this.bulletPropH;
        } else if (kind === Constant.PropKind.BOMB) {
            prefab = this.bulletPropS;
        } else {
            const randomProp = math.randomRangeInt(1, 4);
            if(randomProp === Constant.BulletPropType.BULLET_H){
                prefab = this.bulletPropH;
            } else if(randomProp === Constant.BulletPropType.BULLET_S){
                prefab = this.bulletPropS;
            } else {
                prefab = this.bulletPropM;
            }
        }

        // const prop = instantiate(prefab);
        const prop = PoolManager.instance().getNode(prefab, this.node);
        // prop.setParent(this.node);
        prop.setPosition(x, 0, z);
        const propComp = prop.getComponent(BulletProp);
        // NOTE: negative speed — BulletProp moves toward +z (down-screen, to the
        // player) only when the speed passed here is negative (original quirk).
        propComp.show(this, -this.bulletPropSpeed, kind);
    }

    public isShooting(value: boolean){
        this._isShooting = value;
    }

    public changeBulletType(type: number){
        this._bulletType = type;
        const name = type === Constant.BulletPropType.BULLET_H ? '双发'
            : type === Constant.BulletPropType.BULLET_S ? '散射' : '单发';
        this._showToast('火力提升：' + name + '！');
    }

    public playAudioEffect(name: string){
        this.audioEffect.play(name);
    }

    public shake(mag: number, seconds: number){
        if (!this._camera) { return; }
        this._shakeMag = mag;
        this._shakeTime = seconds;
    }

    // ---------- waves ----------

    private _startWave(wave: number){
        this._wave = wave;
        this._killsInWave = 0;
        this._spawnTimer = 0;
        this._formationTimer = 0;
        this._waveState = 'banner';
        this._stateTimer = 2.0;
        if (wave === Constant.Wave.BOSS_WAVE) {
            this._showBanner('最终决战');
        } else {
            this._showBanner('第 ' + wave + ' 波');
        }
        this._refreshHud();
    }

    private _waveClear(){
        const bonus = 100 * this._wave;
        this.addScore(bonus);
        this._waveState = 'clear';
        this._stateTimer = 2.5;
        this._showBanner('第 ' + this._wave + ' 波 · 已清空！ +' + bonus);
        this.clearAllEnemies(false);
        this.clearEnemyBullets();
    }

    // ---------- HUD (runtime labels) ----------

    private _makeHudLabel(name: string, parent: Node, x: number, y: number, fontSize: number, color: Color): Label {
        const node = new Node(name);
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = fontSize;
        label.color = color;
        label.string = '';
        return label;
    }

    private _refreshHud(){
        if (this._livesLabel) {
            let hearts = '';
            for (let i = 0; i < 3; i++) {
                hearts += i < this._lives ? '❤' : '🤍';
            }
            this._livesLabel.string = hearts + (this._shieldTime > 0 ? ' 🛡' : '');
        }
        if (this._waveLabel) {
            this._waveLabel.string = this._wave > 0 ? '第 ' + this._wave + ' 波' : '';
        }
        if (this._bombLabel) {
            this._bombLabel.string = '💣×' + this._bombs;
        }
    }

    private _refreshBestLabel(){
        if (this._bestLabel) {
            this._bestLabel.string = this._best > 0 ? '最高分 ' + this._best : '最高分 ——';
        }
    }

    private _showBanner(text: string){
        if (!this._bannerLabel) { return; }
        this._bannerLabel.string = text;
        this._bannerLabel.node.active = true;
        this._bannerTime = 2.0;
    }

    private _showToast(text: string){
        if (!this._toastLabel) { return; }
        this._toastLabel.string = text;
        this._toastLabel.node.active = true;
        this._toastTime = 1.5;
    }

    private _init(){
        this._currShootTime = this.shootTime;
        this.playerPlane.init();
        this.playerPlane.gameManager = this;

        // best score
        const saved = sys.localStorage.getItem(BEST_KEY);
        this._best = saved ? parseInt(saved, 10) || 0 : 0;

        // screen shake anchor
        this._camera = find('Main Camera');
        if (this._camera) {
            this._cameraBase.set(this._camera.position);
        }

        // HUD labels (design resolution 720x1280, center-anchored UI)
        const white = new Color(255, 255, 255, 255);
        const gold = new Color(255, 196, 0, 255);
        const red = new Color(255, 90, 90, 255);
        this._livesLabel = this._makeHudLabel('hudLives', this.gamePage, -330, 600, 26, white);
        this._waveLabel = this._makeHudLabel('hudWave', this.gamePage, 0, 600, 26, white);
        this._bombLabel = this._makeHudLabel('hudBomb', this.gamePage, 300, -560, 30, white);
        const bombTransform = this._bombLabel.node.getComponent(UITransform);
        if (bombTransform) { bombTransform.setContentSize(150, 70); }
        this._bombLabel.node.on(Node.EventType.TOUCH_START, this.useBomb, this);
        this._bannerLabel = this._makeHudLabel('hudBanner', this.gamePage, 0, 100, 56, gold);
        this._bannerLabel.node.active = false;
        this._toastLabel = this._makeHudLabel('hudToast', this.gamePage, 0, -100, 28, white);
        this._toastLabel.node.active = false;
        this._bossLabel = this._makeHudLabel('hudBoss', this.gamePage, 0, 560, 24, red);
        this._bossLabel.node.active = false;

        // menu best-score label (gameStart page is the Canvas child named 'gameStart')
        this.gameStartPage = find('Canvas/gameStart');
        if (this.gameStartPage) {
            this._bestLabel = this._makeHudLabel('hudBest', this.gameStartPage, 0, -420, 24, gold);
            this._refreshBestLabel();
        }

        // victory label on the game-over page
        this._victoryLabel = this._makeHudLabel('hudVictory', this.gameOverPage, 0, 220, 44, gold);
        this._victoryLabel.node.active = false;

        this._refreshHud();
    }

    private _destroyAll(){
        let children = this.node.children;
        let length = children.length;
        let i = 0;
        for ( i = length - 1; i >= 0 ; i--) {
            const child = children[i];
            PoolManager.instance().putNode(child);
            // child.destroy();
        }

        children = this.bulletRoot.children;
        length = children.length;
        for (i = length - 1; i >= 0 ; i--) {
            const child = children[i];
            PoolManager.instance().putNode(child);
            // child.destroy();
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
