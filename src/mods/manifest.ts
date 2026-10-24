import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'
import { PluginManifestUserConfigSchema } from '../utils/plugins/schemas.js'

/**
 * Mod manifest (`opencc-mod.json`) schema.
 *
 * Mods are user-authored JavaScript packages that extend OpenCC's behavior,
 * tools and UI at runtime (see docs/mods-plan.md §3.3/§3.4). The manifest is
 * intentionally minimal — everything else is declared programmatically via
 * `register(ctx)`.
 *
 * Zod mirrors the PluginManifestSchema style (src/utils/plugins/schemas.ts).
 * Note: `zod` is currently a phantom dependency (present via transitive
 * resolution, not declared in package.json) — see docs/mods-plan.md §3.4.
 */
export const MOD_MANIFEST_FILE = 'opencc-mod.json'

/**
 * Declarative enablement conditions (`requires`).
 *
 * A mod uses it to say "this mod needs something before it is worth running" —
 * an environment variable that must be present, a `userConfig` option that
 * must hold a particular value.
 *
 * When a condition is unmet the mod is in the DISABLED state: none of its code
 * runs (not even its top level) and the plugin list says WHY it is not enabled.
 *
 * The whole field is optional: a manifest without it behaves exactly as it did
 * before the field existed (backwards compatibility is a hard constraint).
 * `requires: {}` is equally "always satisfied".
 *
 * The evaluation lives in `mods/requires.ts` (`evaluateModRequires` is a pure
 * function).
 */
export const ModRequiresSchema = lazySchema(() =>
  z.object({
    /**
     * Environment variable conditions. A plain name → the variable must be
     * defined and non-empty; a `!` prefix → the variable must be undefined or
     * empty (negated). Every entry must hold.
     */
    env: z.array(z.string().min(1)).optional(),
    /**
     * `userConfig` option conditions. The key is a `userConfig` option name,
     * the value the expected one. Resolution order: the user's saved value →
     * the manifest's `userConfig[key].default` → unresolved, which counts as
     * a mismatch. Comparison is `String(actual) === String(expected)`.
     */
    options: z
      .record(
        z.string().min(1),
        z.union([z.string(), z.number(), z.boolean()]),
      )
      .optional(),
  }),
)

export type ModRequires = z.infer<ReturnType<typeof ModRequiresSchema>>

export const ModManifestSchema = lazySchema(() =>
  z.object({
    /** Mod identifier. Used in tool/command prefixes and error attribution. */
    name: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9_-]{0,63}$/,
        'mod name must be 1-64 chars of [a-z0-9_-], starting with [a-z0-9]',
      ),
    version: z.string().optional(),
    description: z.string().optional(),
    /**
     * Entry file relative to the mod root, e.g. "./mods/register.js".
     * Must be a relative path pointing at a `.js`/`.mjs` file inside the
     * mod root (enforced by validate.ts).
     */
    entry: z
      .string()
      .regex(/^\.{1,2}\//, 'entry must be a relative path starting with ./'),
    /**
     * User-configurable values, surfaced by `/plugins` → Installed as a
     * "Configure options" menu item and read by the mod through
     * `ctx.options`.
     *
     * Same key name and same field schema as a plugin's `manifest.userConfig`
     * — that is deliberate, not an accident of naming: it lets a mod reuse the
     * plugin option storage, the validation and the config dialog unchanged,
     * and keeps a mod's manifest readable by anyone who has written a plugin
     * (upstream's own mods declare it this way too).
     */
    userConfig: PluginManifestUserConfigSchema().shape.userConfig,
    /**
     * Declarative enablement conditions. Absent → always satisfied → exactly
     * the behaviour this field had before it existed.
     */
    requires: ModRequiresSchema().optional(),
  }),
)

export type ModManifest = z.infer<ReturnType<typeof ModManifestSchema>>
