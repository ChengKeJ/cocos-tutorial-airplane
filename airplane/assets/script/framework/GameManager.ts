
import { _decorator, Component, Node, Prefab, math, Vec3, BoxCollider, Label, Animation, sys, find, UITransform, Color, assetManager, director, Touch, Layers } from 'cc';
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
 *
 * v1.0.7 depth pass (2026-11-17):
 * - Combo multiplier x1-x8: kills without taking a hit raise the score
 *   multiplier (every 4 kills +1 step); a real hit resets it, a
 *   shield-absorbed hit does not. HUD shows the live multiplier.
 * - New enemy flavours: elite variants (bigger, 3x HP, guaranteed prop
 *   drop), fast "charger" dives and "weaver" sine runs; regular enemies
 *   fire aimed shots and occasional 3-way aimed fans.
 * - Wave-clear choice: after each wave (1-4) pick 1 of 3 upgrades
 *   (bomb / fire-rate / shield / life / score) before the next wave.
 * - Game feel: combo milestone toasts, elite-kill double explosion,
 *   boss-kill flash + shake + brief slow-mo before the victory screen.
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
const COMBO_KILLS_PER_STEP = 4; // every 4 kills without a hit: +1 multiplier step
const COMBO_MAX_MULT = 8;
const ELITE_CHANCE = 0.12; // waves 2+: share of spawns rolled as an elite variant
const ELITE_TYPE_OFFSET = 10; // elite of base type N reports as type N+10

// Build version, stamped to the console at startup (nothing on screen)
// so a playtest report can be tied to a build at a glance. Bump on
// every upload; the upload --uv version number must match.
const GAME_VERSION = 'v1.0.9';
// The hall scene's name (director.loadScene takes the scene NAME, not UUID
// — see UIHall.ts; the plane scene's name is 'airplane', the hall's 'hall').
const HALL_SCENE_NAME = 'hall';

@ccclass('GameManager')
export class GameManager extends Component {
    // The player plane is NOT wired in the scene (playerPlane: null there);
    // it is resolved from the scene in _init(). Kept public: EnemyPlane
    // reads gameManager.playerPlane during gameplay.
    public playerPlane: SelfPlane = null;
    // Gameplay prefabs live in the "heavy" Asset Bundle (WeChat subpackage).
    // They are NOT scene references any more — the scene cannot reference
    // subpackage assets — they are loaded from the bundle at menu time.
    // bullet
    private bullet01: Prefab = null;
    private bullet02: Prefab = null;
    private bullet03: Prefab = null;
    private bullet04: Prefab = null;
    private bullet05: Prefab = null;
    @property
    public shootTime = 0.3;
    @property
    public bulletSpeed = 1;
    @property(Node)
    public bulletRoot: Node = null;

    // enemy
    private enemy01: Prefab = null;
    private enemy02: Prefab = null;
    @property
    public createEnemyTime = 1;
    @property
    public enemy1Speed = 0.5;
    @property
    public enemy2Speed = 0.7;
    private enemyExplode: Prefab = null;

    // prop
    private bulletPropM: Prefab = null;
    private bulletPropH: Prefab = null;
    private bulletPropS: Prefab = null;
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
    // Weapon level 1-3 (v1.0.6 stacking): picking up the same bullet prop
    // type again raises the level; a different type switches at level 1.
    private _weaponLevel = 1;
    private _score = 0;
    private _best = 0;

    // combo multiplier (v1.0.7): kills without taking a hit raise the
    // score multiplier; a real hit resets it, a shield block does not.
    private _combo = 0;
    private _comboMult = 1;
    // fire-rate upgrades from wave choices (v1.0.7): 0-3, each -0.05s/shot
    private _fireRateLevel = 0;
    // boss-kill feel (v1.0.7): victory waits out a short celebration
    private _victoryDelay = 0;

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
    // Hall buttons (v1.0.9): HUD corner button (in-game) + menu button
    // (gameStart page). The plane scene previously had NO way back to
    // the hall — returnMain() only resets the plane to its own menu.
    private _hallHudBtn: Node | null = null;
    private _hallMenuBtn: Node | null = null;
    private _bannerLabel: Label = null;
    private _toastLabel: Label = null;
    private _bossLabel: Label = null;
    private _comboLabel: Label = null;
    // wave-choice screen (v1.0.7): panel + 3 tappable options
    private _choicePanel: Node = null;
    private _choiceOptionLabels: Label[] = [];
    private _choiceOptions: Array<{ label: string; run: () => void }> = [];
    private _bestLabel: Label = null;
    private _victoryLabel: Label = null;
    private _bannerTime = 0;
    private _toastTime = 0;

    // screen shake (Main Camera)
    private _camera: Node = null;
    private _cameraBase = new Vec3();
    private _shakeTime = 0;
    private _shakeMag = 0;

    // "heavy" subpackage bundle state (WeChat subpackage, loaded at menu time)
    private _heavyReady = false;
    private _heavyLoading = false;
    private _heavyFailed = false;
    private _heavyWaiters: Array<() => void> = [];


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

        // victory is deferred so the boss-kill celebration (flash, shake,
        // slow-mo, explosions) plays before the victory screen appears
        if (this._victoryPending) {
            this._victoryDelay -= deltaTime;
            if (this._victoryDelay <= 0) {
                this._victoryPending = false;
                this.gameOver(true);
            }
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
        if(this._currShootTime > this._effectiveShootTime()){
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
        if (this._waveState === 'banner') {
            this._stateTimer -= deltaTime;
            if (this._stateTimer <= 0) {
                if (this._wave === Constant.Wave.BOSS_WAVE) {
                    this._spawnBoss();
                    this._waveState = 'boss';
                } else {
                    this._waveState = 'fighting';
                }
            }
        } else if (this._waveState === 'choice') {
            // wave-clear upgrade screen: the player picks 1 of 3, then
            // _applyChoice resumes into the next wave. Nothing spawns here.
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

        // --- scheduled prop drop (one free bullet prop every 12s) ---
        this._propTimer += deltaTime;
        if (this._propTimer > 12) {
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
        this._resetWeapon();
        if (this.playerPlane) {
            this.playerPlane.node.setPosition(0, 0, 15);
            this.playerPlane.node.active = true;
        }
        this._score = 0;
        this._wave = 0;
        this._waveState = 'idle';
        this._boss = null;
        this._victoryPending = false;
        this._victoryDelay = 0;
        this._setTimeScale(1);
        this._resetCombo();
        this._fireRateLevel = 0;
        if (this._choicePanel) { this._choicePanel.active = false; }
        this._choiceOptions = [];
        if (this._bossLabel) { this._bossLabel.node.active = false; }
        if (this._victoryLabel) { this._victoryLabel.node.active = false; }
        if (this._bannerLabel) { this._bannerLabel.node.active = false; }
        if (this._toastLabel) { this._toastLabel.node.active = false; }
        if (this.playerPlane) { this.playerPlane.init(); }
        this._refreshBestLabel();
    }

    public gameStart(){
        // Gameplay prefabs live in the "heavy" subpackage bundle. Never
        // start before they are loaded — starting would instantiate null
        // prefabs. If the player tapped Start early, wait for the bundle
        // and start automatically when it arrives.
        if (!this._heavyReady) {
            this._showToast('加载中，请稍候…');
            this.loadHeavyPrefabs(() => { this.gameStart(); });
            return;
        }
        if (!this.playerPlane) {
            this._showToast('初始化失败，请重试');
            return;
        }
        this.isGameStart = true;
        this._score = 0;
        this.gameScore.string = this._score.toString();
        this._resetWeapon();
        this._currShootTime = this._effectiveShootTime();
        this._resetCombo();
        this._fireRateLevel = 0;
        this._victoryDelay = 0;
        this._setTimeScale(1);
        if (this._choicePanel) { this._choicePanel.active = false; }
        this._choiceOptions = [];
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
        this._setTimeScale(1);
        if (this._choicePanel) { this._choicePanel.active = false; }
        this._choiceOptions = [];
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
        if (isBoss) {
            // the boss score also rides the combo multiplier, then the
            // kill celebration plays before the victory screen
            this.addScore(score * this._comboMult);
            this._boss = null;
            if (this._bossLabel) { this._bossLabel.node.active = false; }
            this._startBossKillFeel(pos);
            return;
        }
        // combo: every COMBO_KILLS_PER_STEP clean kills raise the multiplier
        this._combo++;
        const newMult = Math.min(COMBO_MAX_MULT, 1 + Math.floor(this._combo / COMBO_KILLS_PER_STEP));
        if (newMult > this._comboMult) {
            this._comboMult = newMult;
            if (newMult === COMBO_MAX_MULT) {
                this._showToast('🔥🔥🔥 连击 x8 MAX！');
            } else if (newMult === 4) {
                this._showToast('🔥🔥 连击 x4！');
            } else if (newMult === 2) {
                this._showToast('🔥 连击 x2！');
            }
        }
        this.addScore(score * this._comboMult);
        this._refreshComboHud();
        this._killsInWave++;
        const isElite = type >= ELITE_TYPE_OFFSET;
        if (isElite) {
            // elites always drop a prop, explode bigger, and shake the screen
            this._dropProp(pos);
            this.createEnemyEffect(new Vec3(pos.x + 4, pos.y, pos.z));
            this.shake(0.5, 0.25);
            this._showToast('👑 精英敌机击落！');
        } else if (Math.random() < 0.08) {
            // 8% drop chance: mostly bullet upgrades, sometimes shield / bomb
            this._dropProp(pos);
        }
    }

    /** Roll one prop drop at a position (bullet / shield / bomb). */
    private _dropProp(pos: Vec3){
        const roll = Math.random();
        const kind = roll < 0.55 ? Constant.PropKind.BULLET
            : roll < 0.78 ? Constant.PropKind.SHIELD
            : Constant.PropKind.BOMB;
        this.createBulletProp(kind, pos.x, pos.z);
    }

    /** Boss-kill celebration: multi-explosion + flash + shake + brief
     * slow-mo; the victory screen follows after _victoryDelay. */
    private _startBossKillFeel(pos: Vec3){
        this.createEnemyEffect(pos);
        this.createEnemyEffect(new Vec3(pos.x - 6, pos.y, pos.z + 4));
        this.createEnemyEffect(new Vec3(pos.x + 6, pos.y, pos.z - 4));
        this.shake(2.0, 0.8);
        this._showBanner('👹 钢铁巨兽被击沉！');
        this._setTimeScale(0.35);
        this._victoryPending = true;
        // deltaTime is scaled by the slow-mo, so 0.5s of scaled time
        // reads as ~1.4s of real time on screen
        this._victoryDelay = 0.5;
    }

    /** Slow-mo via the engine scheduler; guarded — if the API is absent
     * the game just plays at normal speed. Always restored in gameOver. */
    private _setTimeScale(scale: number){
        try {
            const scheduler = (director as any).getScheduler();
            if (scheduler && typeof scheduler.setTimeScale === 'function') {
                scheduler.setTimeScale(scale);
            }
        } catch (e) {
            // no slow-mo on this runtime; the flash + shake still play
        }
    }

    private _resetCombo(){
        this._combo = 0;
        this._comboMult = 1;
        this._refreshComboHud();
    }

    private _refreshComboHud(){
        if (!this._comboLabel) {
            return;
        }
        if (this._combo <= 0) {
            this._comboLabel.string = '';
            return;
        }
        this._comboLabel.string = this._comboMult > 1
            ? '🔥 连击 x' + this._comboMult + ' · ' + this._combo + '连杀'
            : '连击 ' + this._combo;
        this._comboLabel.color = this._comboMult > 1
            ? new Color(255, 196, 0, 255)
            : new Color(255, 255, 255, 255);
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
        // a real hit breaks the combo (a shield-absorbed hit does not)
        this._resetCombo();
        const hpLeft = this.playerPlane.damage();
        this.shake(0.6, 0.35);
        if (hpLeft <= 0) {
            this._lives--;
            this._resetWeapon();
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
        } else {
            // survived the hit — weapon drops one level
            this._weaponLevel = Math.max(1, this._weaponLevel - 1);
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

    private _spawnPlayerBullet(prefab: Prefab, offsetX: number, direction: number = Constant.Direction.MIDDLE){
        const bullet = PoolManager.instance().getNode(prefab, this.bulletRoot);
        const pos = this.playerPlane.node.position;
        bullet.setPosition(pos.x + offsetX, pos.y, pos.z - 7);
        bullet.getComponent(Bullet).show(this.bulletSpeed, false, direction);
    }

    public createPlayerBulletM(){
        // Lv1: 1 shot; Lv2: 2 parallel; Lv3: 3 parallel.
        const offs = this._weaponLevel >= 3 ? [-5, 0, 5]
            : this._weaponLevel >= 2 ? [-2.5, 2.5] : [0];
        for (const off of offs) {
            this._spawnPlayerBullet(this.bullet01, off);
        }
    }

    public createPlayerBulletH(){
        // Lv1: 2 shots; Lv2: 3 shots; Lv3: 4 shots, outer pair angled out.
        if (this._weaponLevel >= 3) {
            this._spawnPlayerBullet(this.bullet03, -7.5, Constant.Direction.LEFT);
            this._spawnPlayerBullet(this.bullet03, -2.5);
            this._spawnPlayerBullet(this.bullet03, 2.5);
            this._spawnPlayerBullet(this.bullet03, 7.5, Constant.Direction.RIGHT);
        } else if (this._weaponLevel >= 2) {
            this._spawnPlayerBullet(this.bullet03, -5);
            this._spawnPlayerBullet(this.bullet03, 0);
            this._spawnPlayerBullet(this.bullet03, 5);
        } else {
            this._spawnPlayerBullet(this.bullet03, -2.5);
            this._spawnPlayerBullet(this.bullet03, 2.5);
        }
    }

    public createPlayerBulletS(){
        // Lv1: 3-way fan; Lv2: 5-way; Lv3: 7-way.
        const lanes: Array<[number, number]> = this._weaponLevel >= 3
            ? [[-12, Constant.Direction.LEFT], [-8, Constant.Direction.LEFT], [-4, Constant.Direction.LEFT], [0, Constant.Direction.MIDDLE], [4, Constant.Direction.RIGHT], [8, Constant.Direction.RIGHT], [12, Constant.Direction.RIGHT]]
            : this._weaponLevel >= 2
            ? [[-8, Constant.Direction.LEFT], [-4, Constant.Direction.LEFT], [0, Constant.Direction.MIDDLE], [4, Constant.Direction.RIGHT], [8, Constant.Direction.RIGHT]]
            : [[-4, Constant.Direction.LEFT], [0, Constant.Direction.MIDDLE], [4, Constant.Direction.RIGHT]];
        for (const [off, dir] of lanes) {
            this._spawnPlayerBullet(this.bullet05, off, dir);
        }
    }

    // ---------- enemy bullets ----------

    public createEnemyBullet(targetPos: Vec3, direction: number = Constant.Direction.MIDDLE, fan: boolean = false){
        // v1.0.7: regular enemies aim at the player. A bare MIDDLE call
        // (the EnemyPlane default) steers toward the player's x; an
        // explicit direction (the boss aimed shot) is kept as-is.
        let centre = direction;
        if (direction === Constant.Direction.MIDDLE) {
            const playerX = this.playerPlane ? this.playerPlane.node.position.x : targetPos.x;
            centre = playerX < targetPos.x - 1 ? Constant.Direction.LEFT
                : playerX > targetPos.x + 1 ? Constant.Direction.RIGHT
                : Constant.Direction.MIDDLE;
        }
        // occasional aimed fan: the centre shot plus its neighbour lane(s)
        const doFan = fan || (direction === Constant.Direction.MIDDLE && Math.random() < 0.35);
        const dirs = doFan
            ? centre === Constant.Direction.LEFT ? [Constant.Direction.LEFT, Constant.Direction.MIDDLE]
            : centre === Constant.Direction.RIGHT ? [Constant.Direction.MIDDLE, Constant.Direction.RIGHT]
            : [Constant.Direction.LEFT, Constant.Direction.MIDDLE, Constant.Direction.RIGHT]
            : [centre];
        // Direction values are 1/2/3 (LEFT/MIDDLE/RIGHT)
        const offs = [0, -3, 0, 3];
        for (const dir of dirs) {
            const bullet = PoolManager.instance().getNode(this.bullet02, this.bulletRoot);
            bullet.setPosition(targetPos.x + offs[dir], targetPos.y, targetPos.z + 6);
            const bulletComp = bullet.getComponent(Bullet);
            bulletComp.show(1, true, dir);
            const colliderComp = bullet.getComponent(BoxCollider);
            colliderComp.setGroup(Constant.CollisionType.ENEMY_BULLET);
            colliderComp.setMask(Constant.CollisionType.SELF_PLANE);
        }
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

        // v1.0.7 flavours, built only from the existing movement modes:
        // - "charger": a fast TYPE4 that dives at the player (waves 3+)
        // - "weaver": a fast sine-wave TYPE2 (waves 3+)
        // - "elite": any type, waves 2+, bigger + 3x HP, type+10, and a
        //   guaranteed prop drop on kill (see onEnemyKilled)
        if (type === Constant.EnemyType.TYPE4 && this._wave >= 3 && Math.random() < 0.25) {
            speed = this.enemy2Speed * 2.6 * speedMul;
            hp = 2;
            scale = 0.9;
            score = 20;
        } else if (type === Constant.EnemyType.TYPE2 && this._wave >= 3 && Math.random() < 0.3) {
            speed = this.enemy2Speed * 1.35 * speedMul;
            hp = 2;
            score = 20;
        }
        if (this._wave >= 2 && Math.random() < ELITE_CHANCE) {
            hp = Math.max(2, hp * 3);
            scale = scale * 1.5;
            score = score * 2 + 10;
            type = type + ELITE_TYPE_OFFSET;
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
        if (type === this._bulletType) {
            this._weaponLevel = Math.min(3, this._weaponLevel + 1);
        } else {
            this._bulletType = type;
            this._weaponLevel = 1;
        }
        const name = type === Constant.BulletPropType.BULLET_H ? '双发'
            : type === Constant.BulletPropType.BULLET_S ? '散射' : '单发';
        this._showToast('火力提升：' + name + ' Lv.' + this._weaponLevel + '！');
    }

    /** Back to single-shot Lv.1 (life lost / new run). */
    private _resetWeapon(){
        this._bulletType = Constant.BulletPropType.BULLET_M;
        this._weaponLevel = 1;
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
        this._waveState = 'choice';
        this._showBanner('第 ' + this._wave + ' 波 · 已清空！ +' + bonus);
        this.clearAllEnemies(false);
        this.clearEnemyBullets();
        this._showChoice();
    }

    // ---------- wave-clear choices (v1.0.7) ----------

    /** True while the wave-clear upgrade screen is open (UIMain freezes
     * plane movement so a choice tap does not yank the plane). */
    public isChoiceOpen(): boolean {
        return this._waveState === 'choice';
    }

    /** Pick option i (0-2). Called by the option nodes and by UIMain keys. */
    public applyChoice(index: number){
        if (this._waveState !== 'choice') {
            return;
        }
        const choice = this._choiceOptions[index];
        if (!choice) {
            return;
        }
        if (this._choicePanel) {
            this._choicePanel.active = false;
        }
        this._choiceOptions = [];
        choice.run();
        this._refreshHud();
        this._startWave(this._wave + 1);
    }

    private _showChoice(){
        this._choiceOptions = this._buildChoices();
        for (let i = 0; i < 3; i++) {
            const label = this._choiceOptionLabels[i];
            if (label) {
                label.string = this._choiceOptions[i] ? this._choiceOptions[i].label : '';
            }
        }
        if (this._choicePanel) {
            this._choicePanel.active = true;
        }
    }

    private _buildChoices(): Array<{ label: string; run: () => void }>{
        const pool: Array<{ label: string; run: () => void }> = [];
        pool.push({ label: '🛡 护盾 8 秒', run: () => { this.grantShield(); } });
        const bonus = 150 * this._wave;
        pool.push({ label: '⭐ 积分 +' + bonus, run: () => { this.addScore(bonus); this._showToast('⭐ 积分 +' + bonus + '！'); } });
        if (this._bombs < BOMB_MAX) {
            pool.push({ label: '💣 炸弹 +1', run: () => { this.grantBomb(); } });
        }
        if (this._lives < 3) {
            pool.push({ label: '❤ 生命 +1', run: () => {
                this._lives = Math.min(3, this._lives + 1);
                this._refreshHud();
                this._showToast('❤ 生命 +1！');
            } });
        }
        if (this._fireRateLevel < 3) {
            pool.push({ label: '⚡ 射速提升', run: () => {
                this._fireRateLevel++;
                this._showToast('⚡ 射速提升 Lv.' + this._fireRateLevel + '！');
            } });
        }
        // shuffle and take 3; score bonuses pad the list when maxed-out
        // options (bomb / life / fire-rate) shrink the pool below 3
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = pool[i];
            pool[i] = pool[j];
            pool[j] = tmp;
        }
        const picked = pool.slice(0, 3);
        let pad = 1;
        while (picked.length < 3) {
            const extra = bonus + 100 * pad;
            picked.push({ label: '⭐ 积分 +' + extra, run: () => { this.addScore(extra); this._showToast('⭐ 积分 +' + extra + '！'); } });
            pad++;
        }
        return picked;
    }

    /** Seconds between player shots, after fire-rate upgrades. */
    private _effectiveShootTime(): number {
        return Math.max(0.15, this.shootTime - 0.05 * this._fireRateLevel);
    }

    // ---------- HUD (runtime labels) ----------

    private _makeHudLabel(name: string, parent: Node, x: number, y: number, fontSize: number, color: Color): Label {
        const node = new Node(name);
        // Runtime-created nodes default to the DEFAULT layer, which the UI
        // camera never renders (it only sees UI_2D/UI_3D, visibility
        // 41943040) — every runtime HUD label since v1.0.0 was invisible
        // and untappable for this reason. Scene-wired labels carry UI_2D
        // in the scene file.
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = fontSize;
        label.color = color;
        label.string = '';
        return label;
    }

    /**
     * A tappable text button on a HUD page — same shape as the bomb button
     * (Node + UITransform + Label, touch handled on the node itself).
     * Tapping it loads the hall scene.
     */
    private _makeHallButton(parent: Node, name: string, x: number, y: number, label: string): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(150, 70);
        const lab = node.addComponent(Label);
        lab.fontSize = 30;
        lab.color = new Color(255, 255, 255, 255);
        lab.string = label;
        node.on(Node.EventType.TOUCH_START, this._goToHall, this);
        return node;
    }

    /** Leave the plane scene for the game hall. */
    private _goToHall() {
        director.loadScene(HALL_SCENE_NAME);
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

    /** True when the touch lands on the bomb button (so a tap there must not also move the plane). */
    public isBombTouch(touch: Touch): boolean {
        return this._hitTestNode(touch, this._bombLabel ? this._bombLabel.node : null);
    }

    /** True when the touch lands on either hall button (HUD or menu page). */
    public isHallTouch(touch: Touch): boolean {
        return this._hitTestNode(touch, this._hallHudBtn)
            || this._hitTestNode(touch, this._hallMenuBtn);
    }

    /**
     * UI-space hit test of one node. A node whose page is hidden never
     * matches: its parent page (game / gameStart) is inactive then, so
     * the button must not swallow taps meant for the other page.
     */
    private _hitTestNode(touch: Touch, node: Node | null): boolean {
        if (!node || !node.active || !node.parent || !node.parent.active) {
            return false;
        }
        const t = node.getComponent(UITransform);
        if (!t) {
            return false;
        }
        const loc = touch.getUILocation();
        const rect = t.getBoundingBoxToWorld();
        return rect.x <= loc.x && loc.x <= rect.x + rect.width
            && rect.y <= loc.y && loc.y <= rect.y + rect.height;
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

    /**
     * Load the "heavy" Asset Bundle (WeChat subpackage) and all gameplay
     * prefabs inside it. Safe to call repeatedly: while a load is in
     * flight the callback is queued; once loaded it fires immediately.
     * On failure the waiters are dropped (the player taps Start again to
     * retry) and a toast explains — the game never starts with null
     * prefabs and never hangs on a slow bundle.
     */
    public loadHeavyPrefabs(onDone?: () => void): void {
        if (this._heavyReady) {
            if (onDone) { onDone(); }
            return;
        }
        if (onDone) { this._heavyWaiters.push(onDone); }
        if (this._heavyLoading) { return; }
        this._heavyLoading = true;
        this._heavyFailed = false;
        assetManager.loadBundle('heavy', (err, bundle) => {
            if (err || !bundle) {
                this._heavyLoading = false;
                this._heavyFailed = true;
                this._heavyWaiters = [];
                this._showToast('资源加载失败，请重试');
                return;
            }
            const jobs: Array<[string, (p: Prefab) => void]> = [
                ['bullet01', (p) => { this.bullet01 = p; }],
                ['bullet02', (p) => { this.bullet02 = p; }],
                ['bullet03', (p) => { this.bullet03 = p; }],
                ['bullet04', (p) => { this.bullet04 = p; }],
                ['bullet05', (p) => { this.bullet05 = p; }],
                ['plane02', (p) => { this.enemy01 = p; }],
                ['plane03', (p) => { this.enemy02 = p; }],
                ['explodeSmall', (p) => { this.enemyExplode = p; }],
                ['bulletM', (p) => { this.bulletPropM = p; }],
                ['bulletH', (p) => { this.bulletPropH = p; }],
                ['bulletS', (p) => { this.bulletPropS = p; }],
            ];
            let pending = jobs.length;
            let failed = false;
            for (const [path, assign] of jobs) {
                bundle.load(path, Prefab, (err2, prefab) => {
                    if (err2 || !prefab) { failed = true; }
                    else { assign(prefab as Prefab); }
                    if (--pending === 0) {
                        this._heavyLoading = false;
                        if (failed) {
                            this._heavyFailed = true;
                            this._heavyWaiters = [];
                            this._showToast('资源加载失败，请重试');
                            return;
                        }
                        this._heavyReady = true;
                        this._heavyFailed = false;
                        const waiters = this._heavyWaiters;
                        this._heavyWaiters = [];
                        for (const w of waiters) { w(); }
                    }
                });
            }
        });
    }

    private _init(){
        this._currShootTime = this.shootTime;
        // The scene leaves playerPlane unwired (null); resolve it from the
        // scene — the player plane node is a PrefabInstance in the scene.
        // (Found while splitting the package: the shipped v1.0.0 would have
        // crashed on playerPlane.init() at scene start.)
        if (!this.playerPlane) {
            const scene = director.getScene();
            if (scene) {
                const planes = scene.getComponentsInChildren(SelfPlane);
                if (planes.length > 0) {
                    this.playerPlane = planes[0];
                }
            }
        }
        if (this.playerPlane) {
            this.playerPlane.init();
            this.playerPlane.gameManager = this;
        }

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
        // Hall button, bottom-left (mirrors the bomb button bottom-right).
        this._hallHudBtn = this._makeHallButton(this.gamePage, 'hudHall', -300, -560, '🏠 大厅');
        this._bannerLabel = this._makeHudLabel('hudBanner', this.gamePage, 0, 100, 56, gold);
        this._bannerLabel.node.active = false;
        this._toastLabel = this._makeHudLabel('hudToast', this.gamePage, 0, -100, 28, white);
        this._toastLabel.node.active = false;
        this._bossLabel = this._makeHudLabel('hudBoss', this.gamePage, 0, 560, 24, red);
        this._bossLabel.node.active = false;
        this._comboLabel = this._makeHudLabel('hudCombo', this.gamePage, 0, 520, 28, gold);
        this._refreshComboHud();

        // wave-clear choice panel (hidden until a wave clears)
        this._choicePanel = new Node('choicePanel');
        this._choicePanel.layer = Layers.Enum.UI_2D;
        this._choicePanel.setParent(this.gamePage);
        this._choicePanel.setPosition(0, 0, 0);
        const choiceTitle = new Node('choiceTitle');
        choiceTitle.layer = Layers.Enum.UI_2D;
        choiceTitle.setParent(this._choicePanel);
        choiceTitle.setPosition(0, 180, 0);
        const choiceTitleLabel = choiceTitle.addComponent(Label);
        choiceTitleLabel.fontSize = 40;
        choiceTitleLabel.color = gold;
        choiceTitleLabel.string = '🎁 选择一个强化！';
        this._choiceOptionLabels = [];
        for (let i = 0; i < 3; i++) {
            const opt = new Node('choiceOpt' + i);
            opt.layer = Layers.Enum.UI_2D;
            opt.setParent(this._choicePanel);
            opt.setPosition(0, 60 - i * 110, 0);
            const transform = opt.addComponent(UITransform);
            transform.setContentSize(560, 90);
            const label = opt.addComponent(Label);
            label.fontSize = 32;
            label.color = white;
            label.string = '';
            this._choiceOptionLabels.push(label);
            opt.on(Node.EventType.TOUCH_START, () => { this.applyChoice(i); }, this);
        }
        this._choicePanel.active = false;

        // menu best-score label (gameStart page is the Canvas child named 'gameStart')
        this.gameStartPage = find('Canvas/gameStart');
        if (this.gameStartPage) {
            this._bestLabel = this._makeHudLabel('hudBest', this.gameStartPage, 0, -420, 24, gold);
            this._refreshBestLabel();
            // Hall button on the menu page, below the best-score label.
            this._hallMenuBtn = this._makeHallButton(this.gameStartPage, 'menuHall', 0, -520, '🏠 回大厅');
        }

        // victory label on the game-over page
        this._victoryLabel = this._makeHudLabel('hudVictory', this.gameOverPage, 0, 220, 44, gold);
        this._victoryLabel.node.active = false;

        this._refreshHud();

        // Version stamp (console only — nothing on screen).
        console.log('[Star Fighter] ' + GAME_VERSION);

        // Gameplay prefabs live in the "heavy" subpackage bundle; start
        // loading them now (menu time) so they are ready when play starts.
        this.loadHeavyPrefabs();
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
