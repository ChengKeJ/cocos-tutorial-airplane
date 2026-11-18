/**
 * Shared runtime materials for the kart game (fix130 re-run 2).
 *
 * WHY THIS EXISTS — the drive130 re-test proved, twice, that
 * `new Material(); mat.initialize({ effectName: 'builtin-standard' })`
 * does NOT resolve at runtime: `EffectAsset.get(name)` only finds effects
 * that are already LOADED, and bundling an anchor .mtl that references
 * builtin-standard never loads the effect (resources-bundle assets load
 * on demand). The material comes out with a null effect and 0 passes.
 * That is not just a flat look — it is fatal:
 *   - SubModel.initialize() reads passes[0].localSetLayout and throws,
 *     leaving the SubModel half-initialised (null _descriptorSet /
 *     _inputAssembler / _passes);
 *   - on scene teardown SubModel.destroy() calls
 *     this._descriptorSet.destroy() on null and throws, which aborts
 *     Director.runSceneImmediate mid-switch: _scene stays null, the
 *     deferred-destroy queue never drains, and the engine floods
 *     destroy-null + Error 5000 every frame (drive130d/f).
 *
 * THE FIX — load the anchor MATERIAL ASSET at runtime:
 * assets/resources/kart-std-anchor.mtl embeds the full builtin-standard
 * EffectAsset in its import JSON, so `resources.load('kart-std-anchor')`
 * brings the live effect with it. Every std material is then created
 * with `initialize({ effectAsset: <the loaded effect> })` — no name
 * lookup, no unresolved effect, ever. If the anchor load fails for any
 * reason we fall back to builtin-unlit, which DOES resolve at runtime
 * (drive130: 60 track nodes rendered on it) — the game runs flat
 * instead of not running at all.
 *
 * INVARIANT: no code path in the kart game may create a Material whose
 * effect did not resolve. stdMaterial() below enforces it (real effect
 * or unlit fallback, never a null-effect material).
 */

import { assetManager, Color, EffectAsset, Material } from 'cc';

/** The live builtin-standard effect, once the anchor asset has loaded. */
let _stdEffect: EffectAsset | null = null;
/** True once the anchor load has settled (success or failure). */
let _effectSettled = false;
let _effectPromise: Promise<EffectAsset | null> | null = null;

/** Load assets/resources/kart-std-anchor.mtl and return its live effect. */
function _loadAnchor(): Promise<EffectAsset | null> {
    return new Promise<EffectAsset | null>((resolve) => {
        const done = (mat: Material | null): void => {
            if (mat) {
                const eff = (mat as any).effectAsset as EffectAsset | null;
                const passes = (mat as any).passes as any[];
                if (eff && passes && passes.length > 0) {
                    _stdEffect = eff;
                    console.log('[Star Kart] PBR ready: builtin-standard loaded from kart-std-anchor (' + passes.length + ' passes)');
                    resolve(eff);
                    return;
                }
            }
            console.warn('[Star Kart] PBR anchor did not resolve (null effect / 0 passes) — using builtin-unlit fallback');
            resolve(null);
        };
        try {
            const bundles: any = (assetManager as any).bundles;
            const resBundle = bundles ? bundles.get('resources') : null;
            const loadFrom = (b: any): void => {
                b.load('kart-std-anchor', Material, (err: any, m: any) => {
                    if (err) {
                        console.warn('[Star Kart] resources.load kart-std-anchor failed: ' + err);
                        done(null);
                    } else {
                        done(m as Material);
                    }
                });
            };
            if (resBundle) {
                loadFrom(resBundle);
            } else {
                // resources bundle not in the map yet (cold start) — load
                // the bundle first; loadBundle calls back immediately when
                // it is already loaded.
                assetManager.loadBundle('resources', (err: any, b: any) => {
                    if (err || !b) {
                        console.warn('[Star Kart] loadBundle resources failed: ' + err);
                        done(null);
                    } else {
                        loadFrom(b);
                    }
                });
            }
        } catch (e) {
            console.warn('[Star Kart] PBR anchor load threw: ' + e);
            done(null);
        }
    });
}

/** Load the anchor once (shared promise); resolves to the live standard
 * effect, or null when only the unlit fallback is available. */
export function ensureStdEffect(): Promise<EffectAsset | null> {
    if (_stdEffect) { return Promise.resolve(_stdEffect); }
    if (_effectSettled) { return Promise.resolve(null); }
    if (!_effectPromise) {
        _effectPromise = _loadAnchor().then((eff) => {
            _effectSettled = true;
            return eff;
        });
    }
    return _effectPromise;
}

/** True once the anchor load has settled (either way). */
export function stdEffectSettled(): boolean { return _effectSettled; }

/** True when the real builtin-standard effect is available. */
export function stdEffectReady(): boolean { return _stdEffect !== null; }

const _mats = new Map<string, Material>();

/** PBR material (cached by colour + finish), or the builtin-unlit
 * fallback when the standard effect is unavailable. The returned
 * material ALWAYS has a resolved effect and >= 1 pass — it can never
 * half-initialise a SubModel. While the anchor is still loading, the
 * fallback material is NOT cached, so a later rebuild picks up the
 * real PBR material once the load completes. */
export function stdMaterial(hex: number, metallic: number, roughness: number, emissiveHex: number = 0): Material {
    const key = hex.toString(16) + '_' + metallic + '_' + roughness + '_' + emissiveHex.toString(16);
    const cached = _mats.get(key);
    if (cached) { return cached; }
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    const mat = new Material();
    if (_stdEffect) {
        mat.initialize({ effectAsset: _stdEffect });
        mat.setProperty('mainColor', new Color(r, g, b, 255));
        mat.setProperty('metallic', metallic);
        mat.setProperty('roughness', roughness);
        if (emissiveHex !== 0) {
            mat.setProperty('emissive', new Color((emissiveHex >> 16) & 0xff, (emissiveHex >> 8) & 0xff, emissiveHex & 0xff, 255));
        }
    } else {
        mat.initialize({ effectName: 'builtin-unlit' });
        mat.setProperty('mainColor', new Color(r, g, b, 255));
    }
    if (_effectSettled || _stdEffect) { _mats.set(key, mat); }
    return mat;
}
