/**
 * Inline SVG icons for the mermaid block header.
 *
 * The package ships no icon font and no Tailwind/iconify pipeline, so every
 * icon is inline markup like the "open in new window" and "copy" glyphs
 * that were already here. All share one 24x24 stroke geometry (2px round
 * strokes, the tabler shape) so the header reads as one set, and all are
 * `aria-hidden`: the accessible name belongs to the button, not the glyph.
 */
import type { SVGProps } from 'react';

type IconProps = { size?: number };

const svgProps = (size: number): SVGProps<SVGSVGElement> => ({
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  strokeWidth: 2,
  stroke: 'currentColor',
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  width: `${size}px`,
  height: `${size}px`,
  'aria-hidden': true,
});

/** Angle brackets: "show the source". */
export function CodeIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M7 8l-4 4l4 4" />
      <path d="M17 8l4 4l-4 4" />
      <path d="M14 4l-4 16" />
    </svg>
  );
}

/** Check mark: "copied". */
export function CheckIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M5 12l5 5l10 -10" />
    </svg>
  );
}

/** Two nodes joined by an edge: "render the diagram". */
export function DiagramIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="4" width="7" height="6" rx="1" />
      <rect x="14" y="14" width="7" height="6" rx="1" />
      <path d="M10 7h4v10" />
    </svg>
  );
}
