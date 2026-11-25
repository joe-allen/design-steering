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
const FIGMA_COMMENT_LINK = /^https:\/\/www\.figma\.com\/file\/[A-Za-z0-9_-]+\?node-id=[A-Za-z0-9%:_-]+#[A-Za-z0-9_-]+$/;

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
function sanitize(dirty, { runDir, toUrl = convertFileSrc, onFrame }) {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      const match = FRAME_SRC.exec(node.getAttribute('src') ?? '');
      if (match) {
        onFrame?.(node, match[1]);
        node.setAttribute('src', toUrl(`${runDir}/_frames/${match[1]}`));
      } else node.remove();
    } else if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (EXTERNAL_HREF.test(href)) node.setAttribute('rel', 'noopener noreferrer');
      else node.removeAttribute('href');
    } else if (node.tagName === 'INPUT') {
      if (node.getAttribute('type')?.toLowerCase() === 'checkbox') node.setAttribute('disabled', '');
      else node.remove();
    }
  });
  try {
    return DOMPurify.sanitize(dirty, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}

/** Makes each frame image a button that opens the full-size viewer; linked images stay links. */
function zoomableImages(fragment) {
  for (const image of fragment.querySelectorAll('img')) {
    if (image.closest('a[href]')) continue;
    const anchor = image.parentElement?.tagName === 'A' ? image.parentElement : null;
    const button = fragment.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'image-zoom';
    button.setAttribute('aria-label', `View ${image.alt || 'image'} full size`);
    (anchor ?? image).replaceWith(button);
    button.append(image);
  }
}

function fragmentHtml(fragment) {
  const container = fragment.ownerDocument.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

function critiqueFragment(markdown, options) {
  const dirty = marked.parse(markdown, { async: false, gfm: true });
  const fragment = sanitize(dirty, options);
  zoomableImages(fragment);
  groupFrames(fragment);
  return fragment;
}

export function renderCritique(markdown, options) {
  return fragmentHtml(critiqueFragment(markdown, options));
}

function generatedComment(comment, prefix, indent, showAuthor) {
  const lines = comment.message.replace(/\r\n/g, '\n').split('\n');
  const last = lines.length - 1;
  if (showAuthor) lines[last] += ` (${comment.user})`;
  if (comment.resolved) lines[last] += ' [Resolved]';
  return lines
    .map((line, index) => (index === 0 ? `${prefix}${line}` : line === '' ? '' : `${indent}${line}`))
    .join('\n');
}

export function renderThreadText(message, options, { root = false } = {}) {
  const prefix = root ? '- [ ] **ThreadPinPlaceholder**: ' : '- ';
  const markdown = generatedComment({ message }, prefix, '  ', false);
  const fragment = sanitize(marked.parse(markdown, { async: false, gfm: true }), options);
  const list = fragment.firstElementChild;
  const item = list?.firstElementChild;
  if (list?.tagName !== 'UL' || item?.tagName !== 'LI') {
    throw new Error('Could not render the comment thread.');
  }
  if (root) {
    const pin = item.querySelector('strong');
    const checkbox = item.querySelector('input[type=checkbox]');
    if (pin?.textContent !== 'ThreadPinPlaceholder' || !checkbox) {
      throw new Error('Could not render the comment thread.');
    }
    const before = pin.previousSibling;
    const after = pin.nextSibling;
    checkbox.remove();
    if (before?.nodeType === 3 && before.textContent === ' ') before.remove();
    if (after?.nodeType === 3) after.textContent = after.textContent.replace(/^: ?/, '');
    pin.remove();
  }
  const content = fragment.ownerDocument.createDocumentFragment();
  content.append(...item.childNodes);
  item.remove();
  if (list.textContent.trim() || list.querySelector('*')) content.append(list);
  else list.remove();
  content.append(...fragment.childNodes);
  return fragmentHtml(content);
}

function threadPrefix(thread) {
  const pin = /^\d+$/.test(thread.pin) ? thread.pin : '?';
  const link = FIGMA_COMMENT_LINK.test(thread.link) ? `[${pin}](${thread.link})` : pin;
  return `- [${thread.done ? 'x' : ' '}] **${link}**: `;
}

function generatedThread(thread, showAuthors) {
  return [
    generatedComment(thread, threadPrefix(thread), '  ', showAuthors),
    ...(thread.replies ?? []).map((reply) => generatedComment(reply, '  - ', '    ', showAuthors)),
  ].join('\n');
}

// The generator's author option belongs to the saved preview, not today's Settings.
function showsAuthors(markdown, threads) {
  const text = `\n${markdown.replace(/\r\n/g, '\n')}\n`;
  for (const thread of threads) {
    const entries = [
      [thread, threadPrefix(thread), '  '],
      ...(thread.replies ?? []).map((reply) => [reply, '  - ', '    ']),
    ];
    for (const [comment, prefix, indent] of entries) {
      const withAuthor = text.includes(`\n${generatedComment(comment, prefix, indent, true)}\n`);
      const withoutAuthor = text.includes(`\n${generatedComment(comment, prefix, indent, false)}\n`);
      if (withAuthor !== withoutAuthor) return withAuthor;
    }
  }
  return false;
}

export function threadLink(destination, fileKey, thread) {
  if (FIGMA_COMMENT_LINK.test(thread.link)) {
    const link = new URL(thread.link);
    if (link.pathname === `/file/${fileKey}` && link.hash === `#${thread.rootId}`) return link.href;
  }
  const link = new URL(destination);
  link.hash = thread.rootId;
  return link.href;
}

function nodeHtml(node) {
  const container = node.ownerDocument.createElement('div');
  container.append(node.cloneNode(true));
  return container.innerHTML;
}

function listBlock(list, slots) {
  return {
    attributes: Object.fromEntries([...list.attributes].map(({ name, value }) => [name, value])),
    items: [...list.childNodes].map((node) =>
      slots.has(node) ? { thread: slots.get(node) } : { html: nodeHtml(node) },
    ),
  };
}

/** Replaces uniquely matching generated threads with controls bound to the validated snapshot. */
export function prepareThreadCritique(markdown, options, threads) {
  const text = markdown.replace(/\r\n/g, '\n');
  const padded = `\n${text}\n`;
  const showAuthors = showsAuthors(text, threads);
  let markerPrefix = 'DesignSteeringThreadSlot';
  while (text.includes(markerPrefix)) markerPrefix += 'X';

  const matches = [];
  threads.forEach((thread, index) => {
    const body = generatedThread(thread, showAuthors);
    const needle = `\n${body}\n`;
    const start = padded.indexOf(needle);
    if (start >= 0 && padded.indexOf(needle, start + 1) === -1) {
      matches.push({ thread, start, end: start + body.length, marker: `${markerPrefix}${index}End` });
    }
  });
  matches.sort((a, b) => a.start - b.start);
  const overlapping = new Set();
  let furthest = null;
  for (const match of matches) {
    if (furthest && match.start < furthest.end) {
      overlapping.add(furthest);
      overlapping.add(match);
    }
    if (!furthest || match.end > furthest.end) furthest = match;
  }
  const candidates = matches.filter((match) => !overlapping.has(match)).sort((a, b) => b.start - a.start);
  let source = text;
  for (const { start, end, marker } of candidates) {
    source = `${source.slice(0, start)}- ${marker}${source.slice(end)}`;
  }

  const frameFiles = new WeakMap();
  let fragment = critiqueFragment(source, {
    ...options,
    onFrame: (image, filename) => frameFiles.set(image, filename),
  });
  const markers = new Map(candidates.map((candidate) => [candidate.marker, candidate.thread]));
  const slots = new Map();
  const seen = new Set();
  let duplicate = false;
  for (const item of fragment.querySelectorAll('li')) {
    const marker = item.textContent.trim();
    const thread = markers.get(marker);
    if (!thread) continue;
    const list = item.parentElement;
    const parent = list?.parentNode;
    const inFrame = parent?.className === 'frame' && parent.parentNode === fragment;
    const topLevel = parent === fragment || inFrame;
    const frameNumber = /^(\d+)\./.exec(thread.frame)?.[1];
    const imageName = inFrame ? frameFiles.get(parent.querySelector('img')) : null;
    const imageNumber = /^(\d+)-.+\.png$/i.exec(imageName ?? '')?.[1];
    const sameFrame =
      !inFrame ||
      (frameNumber && imageNumber && frameNumber.replace(/^0+(?=\d)/, '') === imageNumber.replace(/^0+(?=\d)/, ''));
    const simple =
      item.children.length === 0 ||
      (item.children.length === 1 &&
        item.firstElementChild.tagName === 'P' &&
        item.firstElementChild.children.length === 0);
    if (list?.tagName === 'UL' && topLevel && sameFrame && simple) {
      if (seen.has(marker)) duplicate = true;
      seen.add(marker);
      slots.set(item, thread);
    }
  }

  if (duplicate || seen.size !== candidates.length) {
    fragment = critiqueFragment(text, options);
    slots.clear();
  }

  const blocks = [...fragment.childNodes].map((node) => {
    if (node.nodeType === 1 && node.className === 'frame') {
      const [image, list] = node.children;
      if ([...list.childNodes].some((item) => slots.has(item))) {
        return { kind: 'frame', image: nodeHtml(image), list: listBlock(list, slots) };
      }
    }
    if (node.nodeType === 1 && node.tagName === 'UL' && [...node.childNodes].some((item) => slots.has(item))) {
      return { kind: 'list', list: listBlock(node, slots) };
    }
    return { kind: 'html', html: nodeHtml(node) };
  });
  const placed = new Set(slots.values());
  const unmatched = threads.filter((thread) => !placed.has(thread));
  if (unmatched.length) {
    blocks.push({
      kind: 'unmatched',
      list: { attributes: {}, items: unmatched.map((thread) => ({ thread })) },
    });
  }
  return { blocks, showAuthors };
}

/** Link clicks never navigate the app; external links go to the system browser. */
export function handleCritiqueClick(event, openExternal, openImage) {
  const opener = event.target.closest?.('button.image-zoom');
  const image = opener?.querySelector('img');
  if (image) {
    openImage?.({ src: image.getAttribute('src'), alt: image.getAttribute('alt') ?? '', opener });
    return;
  }
  const link = event.target.closest?.('a');
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href');
  if (href && EXTERNAL_HREF.test(href)) openExternal(href);
}
