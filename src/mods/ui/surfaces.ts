/**
 * Which elements each surface may draw — upstream `jq` @3696079.
 *
 * Verbatim, including the parts that look arbitrary: `Svg` is absent from
 * `terminal`, `Raster` and `Image` exist only on `terminal`, and `mobile` is
 * the only surface with no `Input`/`Select`/`Client`. Those asymmetries are
 * the surface contract, not an oversight, and a renderer that assumes one
 * element set everywhere is wrong on at least one surface.
 */

export const SURFACES = {
  terminal: [
    'Box',
    'Text',
    'Button',
    'Input',
    'Select',
    'Link',
    'Code',
    'Markdown',
    'Client',
    'Raster',
    'Image',
  ],
  desktop: [
    'Box',
    'Text',
    'Button',
    'Input',
    'Select',
    'Svg',
    'Link',
    'Code',
    'Markdown',
    'Client',
  ],
  mobile: ['Box', 'Text', 'Button', 'Svg', 'Link', 'Code', 'Markdown'],
  vscode: [
    'Box',
    'Text',
    'Button',
    'Input',
    'Select',
    'Svg',
    'Link',
    'Code',
    'Markdown',
  ],
} as const

export type Surface = keyof typeof SURFACES

export type ElementName =
  (typeof SURFACES)[Surface][number] | (typeof SURFACES)[Surface][number]

const SURFACE_NAMES = Object.keys(SURFACES) as Surface[]

/** Every element any surface can draw — upstream `ct` @3696085. */
export const ALL_ELEMENTS: readonly string[] = [
  ...new Set(SURFACE_NAMES.flatMap(name => SURFACES[name])),
]

export function isSurface(value: unknown): value is Surface {
  return typeof value === 'string' && SURFACE_NAMES.includes(value as Surface)
}

export function elementsFor(surface: Surface | undefined): readonly string[] {
  return surface === undefined ? ALL_ELEMENTS : SURFACES[surface]
}

/** Upstream `oZe` @6854200 — block elements cannot nest inside inline ones. */
export const ELEMENT_KINDS: Readonly<Record<string, 'block' | 'inline'>> = {
  Box: 'block',
  Button: 'block',
  Input: 'block',
  Select: 'block',
  Svg: 'block',
  Code: 'block',
  Markdown: 'block',
  Client: 'block',
  Raster: 'block',
  Image: 'block',
  Text: 'inline',
  Link: 'inline',
}

export function isElementName(
  value: unknown,
  surface?: Surface,
): value is ElementName {
  if (typeof value !== 'string') return false
  return elementsFor(surface).includes(value)
}