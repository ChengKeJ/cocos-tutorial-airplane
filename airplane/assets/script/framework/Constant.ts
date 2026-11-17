
import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Predefined variables
 * Name = Constant
 * DateTime = Mon Nov 15 2021 18:26:06 GMT+0800 (China Standard Time)
 * Author = mywayday
 * FileBasename = Constant.ts
 * FileBasenameNoExtension = Constant
 * URL = db://assets/script/framework/Constant.ts
 * ManualUrl = https://docs.cocos.com/creator/3.3/manual/en/
 *
 * Upgraded for Star Fighter v1.0.0 (2026-11-17):
 * - 4 enemy types + boss, 3 movement modes, 3 prop kinds, 5 waves.
 */

export class Constant{
    public static EnemyType = {
        TYPE1: 1, // straight diver (plane02 model)
        TYPE2: 2, // sine-wave mover (plane03 model)
        TYPE3: 3, // tanky slow (plane02 model, big scale, multi HP)
        TYPE4: 4, // fast small dart (plane03 model, small scale)
        BOSS: 5,  // wave-5 boss (plane03 model, huge scale)
    };

    public static MoveMode = {
        STRAIGHT: 1,
        SINE: 2,
        DIVE: 3, // drifts toward the player's x while advancing
    };

    public static Combination = {
        PLAN1: 1,
        PLAN2: 2,
        PLAN3: 3,
    };

    public static CollisionType = {
        SELF_PLANE: 1 << 1,
        ENEMY_PLANE: 1 << 2,
        SELF_BULLET: 1 << 3,
        ENEMY_BULLET: 1 << 4,
        BULLET_PROP: 1 << 5,
    };

    public static BulletPropType = {
        BULLET_M: 1,
        BULLET_H: 2,
        BULLET_S: 3,
    }

    public static PropKind = {
        BULLET: 1, // random M/H/S bullet upgrade
        SHIELD: 2, // 8s invulnerability
        BOMB: 3,   // +1 bomb stock (clears the screen)
    }

    public static Direction = {
        LEFT: 1,
        MIDDLE: 2,
        RIGHT: 3,
    }

    public static Wave = {
        COUNT: 5,
        BOSS_WAVE: 5,
    }

    public static Score = {
        KILL_SMALL: 10,
        KILL_TANKY: 30,
        KILL_BOSS: 500,
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
