import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

export const HEADER_DECORATIVE_WIDTH_MM = 80;
export const FOOTER_DECORATIVE_WIDTH_MM = 100;
export const HEADER_DECORATIVE_MAX_LINES = 2;
export const FOOTER_DECORATIVE_MAX_LINES = 1;

const DECORATIVE_FONT_SIZE_PX = 12;
const CSS_PIXELS_PER_MM = 96 / 25.4;
const DECORATIVE_FONT_FAMILY = 'ACP Sans';
const ELLIPSIS = '…';

GlobalFonts.registerFromPath(
  fileURLToPath(new URL('./assets/NotoSans-Regular.woff2', import.meta.url)),
  DECORATIVE_FONT_FAMILY,
);
GlobalFonts.registerFromPath(
  fileURLToPath(
    new URL('./assets/NotoSans-LatinExt-Regular.woff2', import.meta.url),
  ),
  DECORATIVE_FONT_FAMILY,
);

type DecorativeTextLayout = {
  lines: string[];
  truncated: boolean;
};

export function wrapAndEllipsizeDecorativeText(
  text: string,
  maxWidthMm: number,
  maxLines: number,
): DecorativeTextLayout {
  if (!text) return { lines: [], truncated: false };

  const context = createCanvas(1, 1).getContext('2d');
  context.font = `${DECORATIVE_FONT_SIZE_PX}px "${DECORATIVE_FONT_FAMILY}"`;
  const maxWidthPx = maxWidthMm * CSS_PIXELS_PER_MM;
  const wrappedLines = wrapText(text, maxWidthPx, context);
  const truncated = wrappedLines.length > maxLines;
  const lines = wrappedLines.slice(0, maxLines);

  if (truncated) {
    const lastLineIndex = lines.length - 1;
    lines[lastLineIndex] = appendEllipsis(
      lines[lastLineIndex],
      maxWidthPx,
      context,
    );
  }

  return { lines, truncated };
}

function wrapText(
  text: string,
  maxWidthPx: number,
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidthPx) {
        line = candidate;
        continue;
      }

      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        const partial = line + character;
        if (context.measureText(partial).width > maxWidthPx && line) {
          lines.push(line);
          line = character;
        } else {
          line = partial;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

function appendEllipsis(
  line: string,
  maxWidthPx: number,
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
): string {
  const characters = Array.from(line.trimEnd());
  while (
    characters.length > 0 &&
    context.measureText(`${characters.join('')}${ELLIPSIS}`).width > maxWidthPx
  ) {
    characters.pop();
  }
  return `${characters.join('')}${ELLIPSIS}`;
}
