import { convertFileSrc } from '@tauri-apps/api/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'input',
  'a',
  'img',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'span',
];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'type', 'checked', 'disabled', 'title'];

// The only images a critique may show: the run's own frame PNGs, referenced relatively.
const FRAME_SRC = /^\.\/_frames\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.png)$/i;
const EXTERNAL_HREF = /^https?:\/\//i;

/**
 * Wraps each frame's image paragraph and the comment list that follows it in `div.frame`, so the
 * pair can be laid out (and its comments made sticky) as one unit.
 */
function groupFrames(fragment) {
  for (const image of [...fragment.children]) {
    const comments = image.nextElementSibling;
    if (image.tagName !== 'P' || !image.querySelector('img') || comments?.tagName !== 'UL') continue;
    const frame = fragment.ownerDocument.createElement('div');
    frame.className = 'frame';
    image.before(frame);
    frame.append(image, comments);
  }
}

/**
 * Renders untrusted critique markdown to safe HTML. Scripts, event handlers, styles, forms and
 * frames are removed; images are kept only when they point at the run's `_frames/*.png` and are
 * rewritten to that file; links are kept only when they are http(s). Each image paragraph and its
 * comment list are grouped in `div.frame`.
 */
export function renderCritique(markdown, { runDir, toUrl = convertFileSrc }) {
  const dirty = marked.parse(markdown, { async: false, gfm: true });

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      const match = FRAME_SRC.exec(node.getAttribute('src') ?? '');
      if (match) node.setAttribute('src', toUrl(`${runDir}/_frames/${match[1]}`));
      else node.remove();
    } else if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (EXTERNAL_HREF.test(href)) node.setAttribute('rel', 'noopener noreferrer');
      else node.removeAttribute('href');
    }
  });
  let fragment;
  try {
    fragment = DOMPurify.sanitize(dirty, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
  groupFrames(fragment);
  const container = fragment.ownerDocument.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

/** Link clicks never navigate the app; external links go to the system browser. */
export function handleCritiqueClick(event, openExternal) {
  const link = event.target.closest?.('a');
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href');
  if (href && EXTERNAL_HREF.test(href)) openExternal(href);
}
