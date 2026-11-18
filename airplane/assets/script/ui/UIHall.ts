import { _decorator, Component, director, Label, Node, sys } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Predefined variables
 * Name = UIHall
 * DateTime = Tue Nov 17 2026 16:30:00 GMT+0800 (China Standard Time)
 * Author = Muse
 * FileBasename = UIHall.ts
 * FileBasenameNoExtension = UIHall
 * URL = db://assets/script/ui/UIHall.ts
 * ManualUrl = https://docs.cocos.com/creator/3.3/manual/en/
 *
 * Hall / menu scene for the Star Fighter game hall (v1.0.9).
 * The hall is the entry scene: it shows the game list and the plane
 * game's best score, and routes into the games. The plane game keeps
 * its own in-scene menu (UIMain "滑动开始游戏"); the hall only loads
 * the plane scene — it does not start gameplay itself.
 * - 星空战机: director.loadScene the airplane scene.
 * - 飞车: director.loadScene the kart scene (its menu picks 正赛 / 逆向）.
 * Best score is read from the same localStorage key the plane game
 * writes ('starfighter_best', see GameManager.BEST_KEY).
 */

const BEST_KEY = 'starfighter_best';
// director.loadScene takes the scene NAME (it looks it up in the build
// settings); the scene UUID does NOT resolve (Error 1209 "not in the
// build settings"). The plane scene's name is 'airplane', the kart
// scene's is 'kart' (both are listed in build-configs/wechatgame.json).
const PLANE_SCENE_NAME = 'airplane';
const KART_SCENE_NAME = 'kart';
const HALL_VERSION = 'v1.0.9';

@ccclass('UIHall')
export class UIHall extends Component {
    @property(Node)
    public planeButton: Node = null;
    @property(Node)
    public kartButton: Node = null;
    @property(Label)
    public bestLabel: Label = null;
    @property(Label)
    public toastLabel: Label = null;
    @property(Label)
    public versionLabel: Label = null;

    start () {
        if (this.versionLabel) {
            this.versionLabel.string = HALL_VERSION;
        }
        if (this.toastLabel) {
            this.toastLabel.node.active = false;
        }
        this._refreshBest();
        console.log('[Star Fighter] hall ' + HALL_VERSION);
    }

    /** Entry 1: load the plane game scene (its own menu starts the run). */
    public onPlayPlane () {
        director.loadScene(PLANE_SCENE_NAME);
    }

    /** Entry 2: load the kart game scene (its own menu picks 正赛 / 逆向）. */
    public onPlayKart () {
        director.loadScene(KART_SCENE_NAME);
    }

    private _refreshBest () {
        if (!this.bestLabel) {
            return;
        }
        const saved = sys.localStorage.getItem(BEST_KEY);
        const best = saved ? parseInt(saved, 10) || 0 : 0;
        this.bestLabel.string = best > 0 ? '最高分 ' + best : '最高分 ——';
    }

    private _showToast (text: string) {
        if (!this.toastLabel) {
            return;
        }
        this.toastLabel.string = text;
        this.toastLabel.node.active = true;
        this.unschedule(this._hideToast);
        this.scheduleOnce(this._hideToast, 2.0);
    }

    private _hideToast () {
        if (this.toastLabel) {
            this.toastLabel.node.active = false;
        }
    }
}
