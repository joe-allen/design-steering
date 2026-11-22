/**
 * Pulls the comments for ONE Figma page into a JSON file with one entry per comment.
 *
 * Run (from this folder):
 *   npm run fetch                      # reads FIGMA_TOKEN and FIGMA_PAGE_URL from .env
 *   npm run fetch -- "<figma page url>" # overrides FIGMA_PAGE_URL
 *   npm run fetch -- --images=false    # skip frame PNGs
 *   npm run fetch -- --name=checkout   # folder becomes checkout-design-critique instead of <page-name>-design-critique
 *   node _1-fetch-figma-comments.mjs "<figma page url>" --token=figd_xxx   # without .env
 *   npm run fetch -- --out=<dir>       # create the run folder inside <dir> instead of next to this script
 *   npm run fetch -- --print-run-dir   # print the absolute run folder path as the last line of stdout
 *
 * Output: <page-name>-design-critique/ next to this script (or inside --out), holding <page-name>-figma-comments.json,
 * title.txt (the --name as given, else the page name; _2 uses it as the markdown heading)
 * and _frames/<n>-<slug>.png. _2-generate-design-critique.mjs adds the markdown to the same folder.
 *
 * Notes:
 * - Token scopes: file_content:read and file_comments:read.
 * - The comments API has no page filter, so comments are fetched for the whole file and
 *   kept only when their node_id belongs to the page's node tree.
 * - The URL's node-id may be a page or a top-level frame; either resolves to its page.
 * - `frame` is the top-level frame on the page, prefixed "N. ". Frames are ordered by their
 *   highest comment_thread (pin number), descending, matching the existing export.
 * - Replies reuse the root comment's order_id as `comment_thread` and inherit its frame.
 * - Comments pinned to empty canvas (no node_id) or to deleted nodes are skipped.
 * - Reactions are Figma emoji shortcodes (e.g. ":+1:"), not rendered emoji.
 * - Existing folders are never overwritten: if <name>-design-critique/ exists, the run goes to
 *   <name>-design-critique-1/ (JSON: <name>-figma-comments-1.json), then -2, and so on.
 * - Each frame PNG gets a blue numbered circle (the thread's pin number) centred on every thread's
 *   x/y position. The position is the pin's node_offset, converted from the commented node to
 *   the top-level frame using absoluteBoundingBox. Needs `sharp` (npm install).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const TITLE_FILE = 'title.txt';
const API = 'https://api.figma.com/v1';
const USAGE =
  'Usage: npm run fetch -- [figma-page-url] [--token=<PAT>] [--images=true|false] [--name=<name>] [--out=<dir>] [--print-run-dir]';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();
const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');

function parseArgs(argv) {
  let url = process.env.FIGMA_PAGE_URL;
  let token = process.env.FIGMA_TOKEN;
  let images = true;
  let name = '';
  let title = '';
  let outDir = root;
  let printRunDir = false;
  let urlFromArg = false;
  for (const arg of argv) {
    const flag = /^--(token|images|name|out)=(.*)$/.exec(arg);
    if (arg === '--print-run-dir') printRunDir = true;
    else if (flag?.[1] === 'out') {
      if (!flag[2]) fail(`--out must not be empty.\n${USAGE}`);
      outDir = resolve(flag[2]);
    } else if (flag?.[1] === 'token') token = flag[2];
    else if (flag?.[1] === 'name') {
      name = slugify(flag[2]);
      title = oneLine(flag[2]);
      if (!name) fail(`--name must contain letters or numbers.\n${USAGE}`);
    } else if (flag?.[1] === 'images' && ['true', 'false'].includes(flag[2])) images = flag[2] === 'true';
    else if (!arg.startsWith('--') && !urlFromArg) {
      url = arg;
      urlFromArg = true;
    } else fail(`Invalid argument "${arg}".\n${USAGE}`);
  }
  if (!url) fail(`Missing page URL. Set FIGMA_PAGE_URL in .env or pass it as an argument.\n${USAGE}`);
  if (!token) fail('Missing Figma PAT. Set FIGMA_TOKEN in .env or pass --token=<PAT>.');
  return { url, token, images, name, title, outDir, printRunDir };
}

function parseFigmaUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`Not a valid URL: ${raw}`);
  }
  const branch = /\/branch\/([^/]+)/.exec(url.pathname);
  const file = /^\/(?:design|file|board)\/([^/]+)/.exec(url.pathname);
  if (!file) fail('URL must look like https://www.figma.com/design/<file-key>/...?node-id=<page-id>');
  const nodeId = url.searchParams.get('node-id');
  if (!nodeId) fail('URL has no node-id. Open the page in Figma and copy its link.');
  return { fileKey: branch ? branch[1] : file[1], nodeId: nodeId.replace('-', ':') };
}

const {
  url: rawUrl,
  token,
  images: wantImages,
  name: runName,
  title: runTitle,
  outDir,
  printRunDir,
} = parseArgs(process.argv.slice(2));
const { fileKey, nodeId } = parseFigmaUrl(rawUrl);

async function figma(path, retried = false) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': token } });
  if (res.status === 429 && !retried) {
    const wait = Number(res.headers.get('retry-after')) || 5;
    console.error(`Rate limited, retrying in ${wait}s...`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return figma(path, true);
  }
  if (res.status === 403) fail('Figma returned 403: the token is invalid, expired, or missing a required scope.');
  if (res.status === 404) fail('Figma returned 404: file or node not found (or the token cannot access it).');
  if (!res.ok) fail(`Figma returned ${res.status} for ${path.split('?')[0]}.`);
  return res.json();
}

// 1. Resolve the page that the URL's node-id belongs to.
const file = await figma(`/files/${fileKey}?depth=2`);
const page = file.document.children.find((p) => p.id === nodeId || p.children?.some((frame) => frame.id === nodeId));
if (!page) {
  const pages = file.document.children.map((p) => `  ${p.id}  ${p.name}`).join('\n');
  fail(`node-id ${nodeId} is not a page or a top-level frame. Use a page URL. Pages:\n${pages}`);
}
console.error(`Page: "${page.name}" (${page.id})`);

// 2. Map every node on the page to its top-level frame.
const pageNodes = await figma(`/files/${fileKey}/nodes?ids=${encodeURIComponent(page.id)}`);
const frameByNode = new Map();
const boxByNode = new Map();
function index(node, frame) {
  frameByNode.set(node.id, frame);
  if (node.absoluteBoundingBox) boxByNode.set(node.id, node.absoluteBoundingBox);
  for (const child of node.children ?? []) index(child, frame);
}
for (const top of pageNodes.nodes[page.id].document.children ?? []) {
  index(top, { id: top.id, name: top.name, box: top.absoluteBoundingBox });
}

// 3. Fetch all file comments and keep those on this page.
const { comments } = await figma(`/files/${fileKey}/comments?as_md=true`);
const byId = new Map(comments.map((c) => [c.id, c]));

const frames = new Map();
for (const comment of comments) {
  const rootComment = comment.parent_id ? byId.get(comment.parent_id) : comment;
  const frame = frameByNode.get(rootComment?.client_meta?.node_id);
  if (!frame) continue;
  const thread = Number(rootComment.order_id);
  if (!frames.has(frame.id)) frames.set(frame.id, { ...frame, maxThread: 0, items: [], pins: [] });
  const entry = frames.get(frame.id);
  entry.maxThread = Math.max(entry.maxThread, thread);
  entry.items.push({ comment, thread });

  // One pin per thread, positioned in top-level-frame coordinates (design units).
  if (!comment.parent_id) {
    const nodeBox = boxByNode.get(comment.client_meta.node_id);
    const offset = comment.client_meta.node_offset;
    if (nodeBox && offset && frame.box) {
      entry.pins.push({ thread, x: nodeBox.x + offset.x - frame.box.x, y: nodeBox.y + offset.y - frame.box.y });
    } else {
      console.error(`No position for pin ${thread}; skipping its circle.`);
    }
  }
}

if (frames.size === 0) fail(`No comments found on page "${page.name}".`);

// 4. Order frames by highest pin number (desc), threads asc, then by time.
const ordered = [...frames.values()].sort((a, b) => b.maxThread - a.maxThread);
const output = [];
const framesToExport = [];

ordered.forEach((frame, i) => {
  const label = `${i + 1}. ${frame.name}`;
  framesToExport.push({ id: frame.id, label, number: i + 1, box: frame.box, pins: frame.pins });
  frame.items.sort((a, b) => a.thread - b.thread || a.comment.created_at.localeCompare(b.comment.created_at));
  for (const { comment, thread } of frame.items) {
    output.push({
      file_key: fileKey,
      id: comment.id,
      parent_id: comment.parent_id || null,
      has_done_reaction: (comment.reactions ?? []).some((reaction) => reaction.emoji === ':white_check_mark:'),
      frame: label,
      comment_thread: String(thread),
      user: comment.user.handle,
      message: comment.message,
      reactions: (comment.reactions ?? []).map((r) => `${r.emoji} (${r.user.handle})`).join(', '),
      link: `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(frame.id)}#${comment.id}`,
      created_at: comment.created_at,
      resolved_at: comment.resolved_at ?? null,
    });
  }
});

// Never overwrite an earlier run: if the folder exists, append -1, -2, ... to the folder and JSON names.
const baseName = runName || slugify(page.name) || 'figma-page';
const folderName = `${baseName}-design-critique`;
let runDir = join(outDir, folderName);
let suffix = '';
for (let n = 1; existsSync(runDir); n++) {
  suffix = `-${n}`;
  runDir = join(outDir, `${folderName}${suffix}`);
}
if (suffix) console.error(`"${folderName}" already exists; using "${basename(runDir)}".`);
mkdirSync(runDir, { recursive: true });
// The generate script uses this as the critique's heading: the name as given, else the page name.
writeFileSync(join(runDir, TITLE_FILE), `${runTitle || oneLine(page.name) || 'Design critique'}\n`);
const outPath = join(runDir, `${baseName}-figma-comments${suffix}.json`);
writeFileSync(outPath, `${JSON.stringify(output, null, '\t')}\n`);
console.log(`Wrote ${outPath} (${output.length} comments across ${framesToExport.length} frames)`);

// 5. Export frame PNGs named like the ones generate-design-critique.mjs looks up.
if (wantImages) {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    fail('Drawing pins needs the "sharp" package. Run `npm install`, or use --images=false.');
  }

  const PIN_SIZE = 28; // diameter in Figma design units; scaled with the export
  const PIN_COLOR = '#2EA5F7';

  async function drawPins(png, frame) {
    if (frame.pins.length === 0 || !frame.box) return png;
    const { width, height } = await sharp(png).metadata();
    const ratio = width / frame.box.width; // actual export scale (Figma may downscale large frames)
    const d = PIN_SIZE * ratio;
    const r = d / 2;
    const stroke = Math.max(1, ratio);
    const circles = frame.pins
      .map(({ thread, x, y }) => {
        const cx = Math.min(Math.max(x * ratio, r), width - r);
        const cy = Math.min(Math.max(y * ratio, r), height - r);
        const fontSize = d * (String(thread).length > 2 ? 0.38 : 0.48);
        return (
          `<circle cx="${cx}" cy="${cy}" r="${r - stroke / 2}" fill="${PIN_COLOR}" stroke="#fff" stroke-width="${stroke}"/>` +
          `<text x="${cx}" y="${cy + fontSize * 0.35}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ` +
          `font-weight="700" font-size="${fontSize}" fill="#fff">${thread}</text>`
        );
      })
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`;
    return sharp(png)
      .composite([{ input: Buffer.from(svg) }])
      .png()
      .toBuffer();
  }

  const framesDir = join(runDir, '_frames');
  mkdirSync(framesDir, { recursive: true });
  const slug = slugify;
  const BATCH = 50;
  let saved = 0;

  for (let i = 0; i < framesToExport.length; i += BATCH) {
    const batch = framesToExport.slice(i, i + BATCH);
    const ids = batch.map((f) => encodeURIComponent(f.id)).join(',');
    const { images } = await figma(`/images/${fileKey}?ids=${ids}&format=png&scale=2`);
    for (const frame of batch) {
      const imageUrl = images[frame.id];
      if (!imageUrl) {
        console.error(`No image rendered for "${frame.label}"`);
        continue;
      }
      const res = await fetch(imageUrl);
      if (!res.ok) {
        console.error(`Download failed (${res.status}) for "${frame.label}"`);
        continue;
      }
      const png = await drawPins(Buffer.from(await res.arrayBuffer()), frame);
      writeFileSync(join(framesDir, `${slug(frame.label)}.png`), png);
      saved++;
    }
  }
  console.log(`Saved ${saved}/${framesToExport.length} PNGs to ${framesDir}`);
}

if (printRunDir) console.log(runDir);
