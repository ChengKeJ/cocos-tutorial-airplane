import { _decorator, Color, Component, director, Graphics, Label, Layers, Node, sys, UITransform } from 'cc';
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
 * Hall / menu scene for the Star Fighter game hall (v1.0.12).
 * The hall is the entry scene: it shows the game list and the plane
 * game's best score, and routes into the games. The plane game keeps
 * its own in-scene menu (UIMain "滑动开始游戏"); the hall only loads
 * the plane scene — it does not start gameplay itself.
 * - 星空战机: director.loadScene the airplane scene.
 * - 飞车: director.loadScene the kart scene (its menu picks 正赛 / 逆向）.
 * Best score is read from the same localStorage key the plane game
 * writes ('starfighter_best', see GameManager.BEST_KEY).
 *
 * VISUAL REWORK (hall AAA, v1.0.10): the whole look is built in code
 * below — original vector art only (Graphics shapes + Labels, no
 * copied assets, no new textures). One art direction with the kart
 * rework: cute chunky low-poly + glossy candy colours on a deep
 * arcade night sky. Function is unchanged: same two entries, same
 * scene names, same version string, same best-score key.
 */

const BEST_KEY = 'starfighter_best';
// director.loadScene takes the scene NAME (it looks it up in the build
// settings); the scene UUID does NOT resolve (Error 1209 "not in the
// build settings"). The plane scene's name is 'airplane', the kart
// scene's is 'kart' (both are listed in build-configs/wechatgame.json).
const PLANE_SCENE_NAME = 'airplane';
const KART_SCENE_NAME = 'kart';
const HALL_VERSION = 'v1.0.12';

/** Design space of the hall scene (Canvas 720x1280, centre origin). */
const DESIGN_W = 720;
const DESIGN_H = 1280;

/** Fresh colour each call — Cocos colour slots must not share instances. */
function col (r: number, g: number, b: number, a: number = 255): Color {
    return new Color(r, g, b, a);
}

/** Deterministic PRNG so the star field is identical every launch. */
function mulberry32 (seed: number): () => number {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

interface StarDot { node: Node; phase: number; base: number; }

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

    private _built: boolean = false;
    private _time: number = 0;
    private _stars: StarDot[] = [];
    private _planeIcon: Node = null;
    private _kartIcon: Node = null;
    private _badgeNode: Node = null;
    private _badgeBg: Node = null;
    private _toastBg: Node = null;

    start () {
        if (this.versionLabel) {
            this.versionLabel.string = HALL_VERSION;
        }
        if (this.toastLabel) {
            this.toastLabel.node.active = false;
        }
        this._refreshBest();
        // Look only — a visual failure must never break entering a game.
        try {
            this._buildVisuals();
            this._built = true;
        } catch (err) {
            console.warn('[Star Fighter] hall visuals skipped: ' + err);
        }
        console.log('[Star Fighter] hall ' + HALL_VERSION);
    }

    update (dt: number) {
        if (!this._built) {
            return;
        }
        this._time += dt;
        const t = this._time;
        for (const s of this._stars) {
            const k = 0.72 + 0.38 * (0.5 + 0.5 * Math.sin(t * 1.6 + s.phase));
            s.node.setScale(s.base * k, s.base * k, 1);
        }
        if (this._planeIcon) {
            this._planeIcon.setPosition(-190, 4 * Math.sin(t * 1.8), 0);
        }
        if (this._kartIcon) {
            this._kartIcon.setPosition(-190, 4 * Math.sin(t * 1.8 + 1.6), 0);
        }
        if (this._badgeNode) {
            const k = 1 + 0.05 * Math.sin(t * 3.2);
            this._badgeNode.setScale(k, k, 1);
            if (this._badgeBg) {
                this._badgeBg.setScale(k, k, 1);
            }
        }
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
        if (this._toastBg) {
            this._toastBg.active = true;
        }
        this.unschedule(this._hideToast);
        this.scheduleOnce(this._hideToast, 2.0);
    }

    private _hideToast () {
        if (this.toastLabel) {
            this.toastLabel.node.active = false;
        }
        if (this._toastBg) {
            this._toastBg.active = false;
        }
    }

    // ---- visual rework: everything below is look-only ----

    private _buildVisuals () {
        const hall = this.node.getChildByName('hall');
        if (!hall) {
            return;
        }
        this._buildBackdrop(hall);
        this._buildTitleBlock(hall);
        if (this.planeButton) {
            this._buildCard(this.planeButton, hall, true);
        }
        if (this.kartButton) {
            this._buildCard(this.kartButton, hall, false);
        }
        this._buildBestPill(hall);
        this._buildToastBg(hall);
        if (this.versionLabel) {
            this.versionLabel.color = col(126, 136, 168, 255);
        }
    }

    // -- small builders --

    /** A UI node with a Graphics canvas, inserted before `before` (or appended). */
    private _gfxNode (parent: Node, name: string, x: number, y: number,
        w: number, h: number, before: Node | null): Graphics {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const t = node.addComponent(UITransform);
        t.setContentSize(w, h);
        if (before) {
            const idx = parent.children.indexOf(before);
            if (idx >= 0) {
                node.setSiblingIndex(idx);
            }
        }
        return node.addComponent(Graphics);
    }

    private _label (parent: Node, name: string, x: number, y: number,
        size: number, color: Color, text: string, bold: boolean = false): Label {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.color = color;
        label.string = text;
        if (bold) {
            (label as any).isBold = true;
        }
        return label;
    }

    /** Diamond (rotated square) — the hall's star / sparkle shape. */
    private _diamond (g: Graphics, x: number, y: number, s: number, color: Color) {
        g.fillColor = color;
        g.moveTo(x, y + s);
        g.lineTo(x + s, y);
        g.lineTo(x, y - s);
        g.lineTo(x - s, y);
        g.close();
        g.fill();
    }

    private _roundRect (g: Graphics, x: number, y: number, w: number, h: number,
        r: number, color: Color) {
        g.fillColor = color;
        g.roundRect(x, y, w, h, r);
        g.fill();
    }

    // -- backdrop: night-sky gradient bands, neon horizon, star field --

    private _buildBackdrop (hall: Node) {
        const first = hall.children.length > 0 ? hall.children[0] : null;
        // Vertical gradient, painted as stacked bands (Graphics has no gradients).
        const g = this._gfxNode(hall, 'bgGradient', 0, 0, DESIGN_W, DESIGN_H, first);
        const bands: Array<[number, number, Color]> = [
            [320, 640, col(28, 23, 71, 255)],
            [0, 320, col(21, 26, 62, 255)],
            [-320, 0, col(16, 23, 54, 255)],
            [-640, -320, col(11, 16, 48, 255)],
        ];
        for (const [y0, y1, c] of bands) {
            g.fillColor = c;
            g.rect(-DESIGN_W / 2, y0, DESIGN_W, y1 - y0);
            g.fill();
        }
        // Neon horizon glow behind the cards: warm sunset bands, low alpha.
        const glow = this._gfxNode(hall, 'bgGlow', 0, 0, DESIGN_W, DESIGN_H, first);
        const glowBands: Array<[number, number, Color]> = [
            [60, 160, col(255, 122, 69, 30)],
            [-40, 60, col(255, 90, 122, 26)],
            [-140, -40, col(122, 77, 255, 24)],
        ];
        for (const [y0, y1, c] of glowBands) {
            glow.fillColor = c;
            glow.rect(-DESIGN_W / 2, y0, DESIGN_W, y1 - y0);
            glow.fill();
        }
        // Star field: chunky diamonds, upper two-thirds of the screen.
        const rnd = mulberry32(1337);
        const starCols = [col(255, 255, 255, 255), col(255, 215, 94, 255), col(143, 227, 255, 255)];
        for (let i = 0; i < 34; i++) {
            const x = -330 + rnd() * 660;
            const y = -60 + rnd() * 680;
            const s = 3 + rnd() * 6;
            const node = new Node('star' + i);
            node.layer = Layers.Enum.UI_2D;
            node.setParent(hall);
            node.setPosition(x, y, 0);
            const t = node.addComponent(UITransform);
            t.setContentSize(s * 2 + 2, s * 2 + 2);
            const sg = node.addComponent(Graphics);
            this._diamond(sg, 0, 0, s, starCols[i % starCols.length]);
            node.setSiblingIndex(2);
            this._stars.push({ node: node, phase: rnd() * Math.PI * 2, base: 1 });
        }
    }

    // -- title block: eyebrow, chunky gold title + drop shadow, underline, subtitle --

    private _buildTitleBlock (hall: Node) {
        const title = hall.getChildByName('title');
        const subtitle = hall.getChildByName('subtitle');
        this._label(hall, 'eyebrow', 0, 508, 22, col(127, 227, 255, 255), '★ GAME HALL ★', true);
        if (title) {
            // Chunky drop shadow: same text, dark, offset down-right behind.
            const shadow = this._label(hall, 'titleShadow', 4, 422, 66, col(26, 10, 52, 255), '星空游戏厅', true);
            shadow.node.setSiblingIndex(hall.children.indexOf(title));
            title.setPosition(0, 430, 0);
            const tl = title.getComponent(Label);
            if (tl) {
                tl.fontSize = 66;
                tl.color = col(255, 196, 0, 255);
                (tl as any).isBold = true;
            }
            const tt = title.getComponent(UITransform);
            if (tt) {
                tt.setContentSize(560, 100);
            }
        }
        // Gold marquee underline with a diamond at each end.
        const ug = this._gfxNode(hall, 'titleUnderline', 0, 372, 460, 16, subtitle);
        this._roundRect(ug, -210, -5, 420, 10, 5, col(255, 196, 0, 255));
        this._diamond(ug, -232, 0, 9, col(255, 196, 0, 255));
        this._diamond(ug, 232, 0, 9, col(255, 196, 0, 255));
        if (subtitle) {
            subtitle.setPosition(0, 322, 0);
            const sl = subtitle.getComponent(Label);
            if (sl) {
                sl.color = col(199, 210, 255, 255);
            }
        }
    }

    // -- showcase cards: shadow + neon frame + glossy face + icon + CTA pill --

    private _buildCard (btn: Node, hall: Node, isPlane: boolean) {
        const face = isPlane ? col(43, 127, 255, 255) : col(255, 90, 38, 255);
        const frame = isPlane ? col(156, 208, 255, 255) : col(255, 196, 107, 255);
        const subColor = isPlane ? col(220, 234, 255, 255) : col(255, 227, 214, 255);
        const y = isPlane ? 168 : -112;
        const W = 580;
        const H = 224;
        btn.setPosition(0, y, 0);
        const bt = btn.getComponent(UITransform);
        if (bt) {
            bt.setContentSize(W, H);
        }
        // The scene Sprite is a plain square fill: tint it to the face
        // colour so its corners (behind the rounded Graphics face) vanish.
        const spr = btn.getComponent('Sprite' as any) as any;
        if (spr) {
            spr.color = face;
        }
        // Drop shadow + neon frame, both behind the button in the hall.
        const sh = this._gfxNode(hall, isPlane ? 'planeShadow' : 'kartShadow',
            0, y - 12, W, H, btn);
        this._roundRect(sh, -W / 2, -H / 2, W, H, 30, col(4, 6, 24, 150));
        const fr = this._gfxNode(hall, isPlane ? 'planeFrame' : 'kartFrame',
            0, y, W + 16, H + 16, btn);
        fr.strokeColor = frame;
        fr.lineWidth = 5;
        fr.roundRect(-(W + 16) / 2, -(H + 16) / 2, W + 16, H + 16, 34);
        fr.stroke();
        // Rounded glossy face on top of the plain Sprite.
        const faceG = this._gfxNode(btn, 'cardFace', 0, 0, W, H, null);
        this._roundRect(faceG, -W / 2, -H / 2, W, H, 28, face);
        faceG.node.setSiblingIndex(0);
        // Top gloss strip (white, translucent) — shine on the candy face.
        const gloss = this._gfxNode(btn, 'cardGloss', 0, 62, W - 24, 64, null);
        this._roundRect(gloss, -(W - 24) / 2, -32, W - 24, 64, 22, col(255, 255, 255, 46));
        gloss.node.setSiblingIndex(1);
        // Chunky pictogram (original vector art, left side of the card).
        const icon = new Node(isPlane ? 'planeIcon' : 'kartIcon');
        icon.layer = Layers.Enum.UI_2D;
        icon.setParent(btn);
        icon.setPosition(-190, 0, 0);
        const it = icon.addComponent(UITransform);
        it.setContentSize(150, 130);
        const ig = icon.addComponent(Graphics);
        if (isPlane) {
            this._drawPlaneIcon(ig);
            this._planeIcon = icon;
        } else {
            this._drawKartIcon(ig);
            this._kartIcon = icon;
        }
        // Title (the scene's own Label child) + tagline + CTA pill.
        const titleNode = btn.getChildByName('Label');
        if (titleNode) {
            titleNode.setPosition(58, 58, 0);
            const tl = titleNode.getComponent(Label);
            if (tl) {
                // drive130: the scene's kart title was only "飞车" — set
                // the full name here so it reads "飞车狂飙" in full.
                tl.string = isPlane ? '星空战机' : '飞车狂飙';
                tl.fontSize = 50;
                tl.color = col(255, 255, 255, 255);
                (tl as any).isBold = true;
            }
            const tt = titleNode.getComponent(UITransform);
            if (tt) {
                tt.setContentSize(360, 70);
            }
        }
        this._label(btn, 'cardSub', 58, -6, 24, subColor,
            isPlane ? '太空射击 · 挑战最高分' : '卡丁车竞速 · 8 辆赛车');
        const pill = new Node('playPill');
        pill.layer = Layers.Enum.UI_2D;
        pill.setParent(btn);
        pill.setPosition(58, -72, 0);
        const pt = pill.addComponent(UITransform);
        pt.setContentSize(210, 58);
        const pg = pill.addComponent(Graphics);
        this._roundRect(pg, -105, -29, 210, 58, 29, col(255, 196, 0, 255));
        pg.strokeColor = col(255, 255, 255, 220);
        pg.lineWidth = 2;
        pg.roundRect(-105, -29, 210, 58, 29);
        pg.stroke();
        this._label(pill, 'pillLabel', 0, 0, 28, col(74, 36, 0, 255), '▶ 开始游戏', true);
        if (!isPlane) {
            this._buildKartBadge(btn);
        }
    }

    /** Top-down chunky plane: fuselage + wings + tail + gold cockpit + jet flame. */
    private _drawPlaneIcon (g: Graphics) {
        const W = col(255, 255, 255, 255);
        this._roundRect(g, -13, -48, 26, 96, 10, W);
        this._roundRect(g, -58, -18, 116, 24, 8, W);
        this._roundRect(g, -32, -46, 64, 18, 6, W);
        g.fillColor = col(255, 196, 0, 255);
        g.circle(0, 22, 9);
        g.fill();
        g.fillColor = col(127, 227, 255, 255);
        g.moveTo(-8, -48);
        g.lineTo(8, -48);
        g.lineTo(0, -68);
        g.close();
        g.fill();
    }

    /** Side-view racing kart, same chunky vector style as the plane icon:
     * white body + gold helmet/accents + light-blue speed streaks.
     * Sleek nose (right), seat back, rear wing (left), driver with visor,
     * gold racing stripe, two detailed wheels. */
    private _drawKartIcon (g: Graphics) {
        const W = col(255, 255, 255, 255);
        const DARK = col(32, 36, 58, 255);
        const GOLD = col(255, 196, 0, 255);
        const SKY = col(127, 227, 255, 220);
        // Speed streaks trailing behind the kart (left).
        this._roundRect(g, -84, -16, 18, 4, 2, SKY);
        this._roundRect(g, -78, -4, 14, 4, 2, SKY);
        // Rear wing: gold top plane + white endplate (left = rear).
        this._roundRect(g, -70, 36, 30, 8, 4, GOLD);
        this._roundRect(g, -66, 6, 7, 34, 3, W);
        // Seat back rising behind the driver.
        this._roundRect(g, -48, 14, 24, 16, 6, W);
        // Driver: light-blue shoulders + gold helmet + dark visor.
        this._roundRect(g, -26, 12, 26, 12, 6, SKY);
        g.fillColor = GOLD;
        g.circle(-12, 30, 11);
        g.fill();
        this._roundRect(g, -14, 28, 14, 6, 3, DARK);
        // Sleek body tub + tapered nose (right).
        this._roundRect(g, -52, -4, 96, 22, 10, W);
        g.fillColor = W;
        g.moveTo(44, -2);
        g.lineTo(64, 3);
        g.lineTo(44, 12);
        g.close();
        g.fill();
        // Gold racing stripe along the body.
        this._roundRect(g, -50, 2, 90, 5, 2, GOLD);
        // Two wheels: dark tyre + white hub + gold centre.
        for (const wx of [-38, 38]) {
            g.fillColor = DARK;
            g.circle(wx, -14, 13);
            g.fill();
            g.fillColor = W;
            g.circle(wx, -14, 5.5);
            g.fill();
            g.fillColor = GOLD;
            g.circle(wx, -14, 2.5);
            g.fill();
        }
    }

    /** The kart's stale "即将上线" badge becomes a live "★ 新上线" pill.
     * drive130: the badge sat at top-right (196, 88) on top of the
     * title — moved to the top-LEFT corner so "飞车狂飙" reads in full. */
    private _buildKartBadge (btn: Node) {
        const badge = btn.getChildByName('badge');
        if (!badge) {
            return;
        }
        this._badgeNode = badge;
        badge.setPosition(-205, 88, 0);
        const bt = badge.getComponent(UITransform);
        if (bt) {
            bt.setContentSize(170, 44);
        }
        const bg = this._gfxNode(btn, 'badgeBg', -205, 88, 170, 44, badge);
        this._badgeBg = bg.node;
        this._roundRect(bg, -85, -22, 170, 44, 22, col(255, 196, 0, 255));
        bg.strokeColor = col(255, 255, 255, 230);
        bg.lineWidth = 2;
        bg.roundRect(-85, -22, 170, 44, 22);
        bg.stroke();
        const bl = badge.getComponent(Label);
        if (bl) {
            bl.string = '★ 新上线';
            bl.fontSize = 24;
            bl.color = col(122, 36, 0, 255);
            (bl as any).isBold = true;
        }
        badge.active = true;
    }

    // -- best-score pill + toast backing --

    private _buildBestPill (hall: Node) {
        if (!this.bestLabel) {
            return;
        }
        this.bestLabel.node.setPosition(0, -292, 0);
        const bl = this.bestLabel;
        bl.fontSize = 32;
        bl.color = col(255, 196, 0, 255);
        (bl as any).isBold = true;
        const bg = this._gfxNode(hall, 'bestBg', 0, -292, 460, 60, this.bestLabel.node);
        this._roundRect(bg, -230, -30, 460, 60, 30, col(8, 12, 36, 200));
        bg.strokeColor = col(255, 196, 0, 110);
        bg.lineWidth = 2;
        bg.roundRect(-230, -30, 460, 60, 30);
        bg.stroke();
    }

    private _buildToastBg (hall: Node) {
        if (!this.toastLabel) {
            return;
        }
        this.toastLabel.node.setPosition(0, -380, 0);
        const bg = this._gfxNode(hall, 'toastBg', 0, -380, 560, 56, this.toastLabel.node);
        this._roundRect(bg, -280, -28, 560, 56, 28, col(8, 12, 36, 220));
        bg.strokeColor = col(255, 255, 255, 90);
        bg.lineWidth = 2;
        bg.roundRect(-280, -28, 560, 56, 28);
        bg.stroke();
        this._toastBg = bg.node;
        this._toastBg.active = false;
    }
}
