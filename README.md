# 星空战机 (Star Fighter)

A WeChat mini-game plane shooter, built with **Cocos Creator 3.8.8**.

Forked from [cocos/cocos-tutorial-airplane](https://github.com/cocos/cocos-tutorial-airplane)
(MIT) — the official Cocos video-tutorial project — and upgraded from a tutorial
demo into a complete game.

## The game

- **5 waves** with rising enemy count, speed and HP; a wave-clear banner + bonus
  between waves, and a **Boss** (钢铁巨兽) at the end of wave 5 with a HP bar,
  3-way spread volleys and aimed shots.
- **4 enemy types**: straight diver, sine-wave mover, tanky slow (multi-HP),
  fast small dart that dives toward the player.
- **Power-ups**: bullet upgrades (single / double / spread), shield (8s
  invulnerability), bomb (clears the screen, max 3 in stock).
- **3 lives** per run, respawn with 2s invulnerability, best score saved locally.
- **Feel**: explosion particles, screen shake on player hit, hit flash on
  damaged enemies, synthesized + bundled sound effects, auto-fire always on.
- **Controls**: touch-drag to move (primary); keyboard arrows/WASD to move,
  Space for bomb, Enter/Space to start.
- Fully offline, no IAP, no ads yet. Cartoon explosions only (8+ friendly).

## Project layout

```
airplane/                  Cocos Creator project (upgraded 3.3.2 -> 3.8.8)
  assets/scene/            main scene (airplane.scene)
  assets/script/           TypeScript game code (11 scripts)
  build-configs/           wechatgame build config (AppID wx259411cbfcbbaa3f)
.github/workflows/         CI: macOS build -> wechatgame artifact
```

## Build

Cocos Creator has no Linux editor, so the build runs in GitHub Actions on a
`macos-14` runner: it downloads Creator 3.8.8 from the official Cocos CDN
(SHA-256 pinned), builds the `wechatgame` target with the committed build
config, and uploads `airplane/build/wechatgame` as an artifact.

Push to `master` (or dispatch the workflow manually) to build. The WeChat
mini-game main package must stay under 4 MB — the build uses engine
separation (`separateEngine`), so the Cocos engine is loaded from WeChat's
servers instead of being packaged.

## Upload to the WeChat platform

The CI artifact is uploaded to mp.weixin.qq.com with `miniprogram-ci`
(AppID `wx259411cbfcbbaa3f`, version `1.0.0`) and set as the trial version.
The upload private key is **never** in this repo (see `.gitignore`).

## License

MIT (see `LICENSE`). Original tutorial code © 2021 Cocos.
