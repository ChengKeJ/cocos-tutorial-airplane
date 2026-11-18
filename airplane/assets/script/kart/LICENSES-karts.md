# Kart model assets — licenses & attribution

The 8 karts in `KartModelsData.ts` are baked from these licensed 3D
assets. Every kart is a licensed asset (no kart is purely procedural);
the driver figures are procedural (built in `KartModel.ts`), except
kart 2's built-in driver, which is part of its licensed model.

Baking (see `kart-aaa/glb2kart.py` in the ops workspace) normalises
each model (2.1 m long, ground at y 0, forward +Z), extracts the 4
wheels into separate spin/steer meshes, and bucketizes the body by
colour — the largest view-weighted bucket is the "paint" bucket and
is recoloured at runtime to the kart / paint-scheme colour. No
PopKart or other game's assets, names, or textures are used anywhere.

## Poly Pizza (CC-BY 3.0 unless noted)

Models from https://poly.pizza — each is licensed CC-BY 3.0
(attribution required; kept here and in the game credits) or CC0 1.0
(public domain). GLB files are the ones served by Poly Pizza's static
host at the time of baking.

| Kart | Model | Author | License | Source |
|---|---|---|---|---|
| 0 凌风 | "Go kart" | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/3hkutVs0AAV |
| 1 海蓝 | "Go Kart" | Zsky | CC-BY 3.0 | https://poly.pizza/m/MkByxZCSMA |
| 2 闪电 | "Racing car" | scaranto | CC0 1.0 | https://poly.pizza/m/EMcTJiXibv |
| 3 青竹 | "Kart" | scaranto | CC0 1.0 | https://poly.pizza/m/fLovOv3TAH |
| 5 橙光 | "Buggy" | Nick Slough | CC-BY 3.0 | https://poly.pizza/m/eZ_13w7qZh7 |
| 7 绯焰 | "Kart" | Ben Harrison | CC-BY 3.0 | https://poly.pizza/m/bKDlM4mH7rg |

## Kenney (CC0 1.0)

| Kart | Model | Pack | License | Source |
|---|---|---|---|---|
| 4 紫曜 | race-future.glb | Car Kit | CC0 1.0 | https://kenney.nl/assets/car-kit |
| 6 雪驰 | race.glb | Car Kit | CC0 1.0 | https://kenney.nl/assets/car-kit |

Kenney assets are public domain (CC0 1.0); credit is given here as a
courtesy, not a license requirement.

## Attribution (CC-BY 3.0)

The CC-BY models above are used under the Creative Commons
Attribution 3.0 Unported license (https://creativecommons.org/licenses/by/3.0/):
"Go kart" by Poly by Google, "Go Kart" by Zsky, "Buggy" by Nick
Slough, "Kart" by Ben Harrison — all via Poly Pizza (https://poly.pizza).
No endorsement by the authors is implied; the models were adapted
(rescaled, recoloured, wheels separated) for this game.

## Notes

- The "Racing car" (kart 2) includes a built-in driver figure; it is
  recoloured to the kart accent colour at runtime.
- Kenney models use an external palette texture (`colormap.png`);
  colours were sampled from it at bake time, so no texture is shipped.
- No other external assets are used for the karts. Tracks, UI, and
  effects are original procedural work in the same art direction.
