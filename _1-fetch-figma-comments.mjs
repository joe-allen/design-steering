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
 *   --desktop-partial                 # recover isolated layer errors for the desktop app
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
  'Usage: npm run fetch -- [figma-page-url] [--token=<PAT>] [--images=true|false] [--name=<name>] [--out=<dir>] [--print-run-dir] [--desktop-partial]';

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
  let desktopPartial = false;
  let urlFromArg = false;
  for (const arg of argv) {
    const flag = /^--(token|images|name|out)=(.*)$/.exec(arg);
    if (arg === '--print-run-dir') printRunDir = true;
    else if (arg === '--desktop-partial') desktopPartial = true;
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
  return { url, token, images, name, title, outDir, printRunDir, desktopPartial };
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
  desktopPartial,
} = parseArgs(process.argv.slice(2));
const { fileKey, nodeId } = parseFigmaUrl(rawUrl);

class FigmaServerError extends Error {
  constructor(status, operation, endpoint) {
    super(`Figma returned ${status} while ${operation} (${endpoint}). Try again later.`);
    this.status = status;
  }
}

class RecoveryBudgetError extends Error {}

const RECOVERY_REQUEST_BUDGET = 64;

async function figma(path, operation, retried = false, recoverServerErrors = false, recoveryBudget = null) {
  if (recoveryBudget) {
    if (recoveryBudget.used >= RECOVERY_REQUEST_BUDGET) throw new RecoveryBudgetError();
    recoveryBudget.used++;
  }
  const res = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': token } });
  const endpoint = path.split('?')[0];
  const serverError = [500, 502, 503, 504].includes(res.status);
  if (!retried && (res.status === 429 || serverError)) {
    const wait = Number(res.headers.get('retry-after')) || (res.status === 429 ? 5 : 1);
    const reason =
      res.status === 429 ? 'Rate limited' : `Figma returned ${res.status} while ${operation} (${endpoint})`;
    console.error(`${reason}, retrying in ${wait}s...`);
    await res.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return figma(path, operation, true, recoverServerErrors, recoveryBudget);
  }
  if (res.status === 403) fail('Figma returned 403: the token is invalid, expired, or missing a required scope.');
  if (res.status === 404) fail('Figma returned 404: file or node not found (or the token cannot access it).');
  if (recoverServerErrors && serverError) throw new FigmaServerError(res.status, operation, endpoint);
  if (!res.ok)
    fail(`Figma returned ${res.status} while ${operation} (${endpoint}).${serverError ? ' Try again later.' : ''}`);
  return res.json();
}

const NODE_BATCH = 8;
async function readNodes(ids, depth, operation, { recoverServerErrors = false, recoveryBudget = null } = {}) {
  const query = ids.map(encodeURIComponent).join(',');
  const { nodes } = await figma(
    `/files/${fileKey}/nodes?ids=${query}&depth=${depth}`,
    operation,
    false,
    recoverServerErrors,
    recoveryBudget,
  );
  return ids.map((id) => {
    const node = nodes[id]?.document;
    if (!node) fail(`A Figma layer could not be found while ${operation}. Fetch the page again.`);
    return node;
  });
}

// 1. Resolve the page that the URL's node-id belongs to.
const file = await figma(`/files/${fileKey}?depth=1`, 'listing pages');
const pages = file.document.children;
let page;
if (pages.some((p) => p.id === nodeId)) {
  [page] = await readNodes([nodeId], 1, 'reading the selected page');
} else {
  for (let i = 0; i < pages.length && !page; i += NODE_BATCH) {
    const ids = pages.slice(i, i + NODE_BATCH).map((p) => p.id);
    const outlines = await readNodes(ids, 1, 'locating the linked frame');
    page = outlines.find((p) => p.children?.some((frame) => frame.id === nodeId));
  }
}
if (!page) {
  const choices = pages.map((p) => `  ${p.id}  ${p.name}`).join('\n');
  fail(`node-id ${nodeId} is not a page or a top-level frame. Use a page URL. Pages:\n${choices}`);
}
console.error(`Page: "${page.name}" (${page.id})`);

// 2. Resolve pins inside the selected page, never by looking up file-wide comment anchors.
const { comments } = await figma(`/files/${fileKey}/comments?as_md=true`, 'fetching comments');
const byId = new Map(comments.map((c) => [c.id, c]));
const remaining = new Set(
  comments
    .filter((c) => !c.parent_id)
    .map((c) => c.client_meta?.node_id)
    .filter(Boolean),
);
const pinsByNode = new Map();
const pending = [];
const unreadableBranches = [];
const unexaminedBranches = [];
function index(node, frame, depthLeft, path = []) {
  const nodePath = [...path, { id: node.id, name: node.name || node.id }];
  if (remaining.delete(node.id)) {
    pinsByNode.set(node.id, { frame, box: node.absoluteBoundingBox });
  }
  if (depthLeft === 0) {
    // At the depth cutoff even a non-empty frame can have no children in the response.
    pending.push({ id: node.id, frame, path: nodePath });
  } else {
    for (const child of node.children ?? []) index(child, frame, depthLeft - 1, nodePath);
  }
}
remaining.delete(file.document.id);
for (const p of pages) remaining.delete(p.id);
for (const top of page.children ?? []) {
  index(top, { id: top.id, name: top.name, box: top.absoluteBoundingBox }, 0);
}

const NODE_DEPTH = 3;
const recoveryBudget = { used: 0 };
function recordBranches(entries, collection) {
  for (const entry of entries) collection.push({ id: entry.id, path: entry.path });
}
async function readAndIndex(entries, depth, budget = null) {
  try {
    const trees = await readNodes(
      entries.map((entry) => entry.id),
      depth,
      'matching pins to frames on the selected page',
      { recoverServerErrors: desktopPartial, recoveryBudget: budget },
    );
    trees.forEach((tree, i) => index(tree, entries[i].frame, depth, entries[i].path.slice(0, -1)));
  } catch (error) {
    if (desktopPartial && error instanceof RecoveryBudgetError) {
      recordBranches(entries, unexaminedBranches);
      return;
    }
    if (!desktopPartial || !(error instanceof FigmaServerError)) throw error;
    if (entries.length > 1) {
      console.error(`Layer batch failed; retrying its branches individually.`);
      const middle = Math.ceil(entries.length / 2);
      await readAndIndex(entries.slice(0, middle), depth, recoveryBudget);
      await readAndIndex(entries.slice(middle), depth, recoveryBudget);
      return;
    }
    if (depth > 1) {
      try {
        console.error(
          `Layer "${entries[0].path.map((part) => part.name).join(' / ')}" failed; retrying at a shallower depth.`,
        );
        const [tree] = await readNodes([entries[0].id], depth - 1, 'matching pins to frames on the selected page', {
          recoverServerErrors: true,
          recoveryBudget,
        });
        index(tree, entries[0].frame, depth - 1, entries[0].path.slice(0, -1));
        return;
      } catch (shallowError) {
        if (shallowError instanceof RecoveryBudgetError) {
          recordBranches(entries, unexaminedBranches);
          return;
        }
        if (!(shallowError instanceof FigmaServerError)) throw shallowError;
      }
    }
    recordBranches(entries, unreadableBranches);
  }
}
while (pending.length && remaining.size) {
  const batch = pending.splice(-NODE_BATCH);
  await readAndIndex(batch, NODE_DEPTH);
}

// 3. Group matching comments and replies by their top-level frame.
const frames = new Map();
for (const comment of comments) {
  const rootComment = comment.parent_id ? byId.get(comment.parent_id) : comment;
  const pin = pinsByNode.get(rootComment?.client_meta?.node_id);
  if (!pin) continue;
  const { frame, box: nodeBox } = pin;
  const thread = Number(rootComment.order_id);
  if (!frames.has(frame.id)) frames.set(frame.id, { ...frame, maxThread: 0, items: [], pins: [] });
  const entry = frames.get(frame.id);
  entry.maxThread = Math.max(entry.maxThread, thread);
  entry.items.push({ comment, thread });

  // One pin per thread, positioned in top-level-frame coordinates (design units).
  if (!comment.parent_id) {
    const offset = comment.client_meta.node_offset;
    if (nodeBox && offset && frame.box) {
      entry.pins.push({ thread, x: nodeBox.x + offset.x - frame.box.x, y: nodeBox.y + offset.y - frame.box.y });
    } else {
      console.error(`No position for pin ${thread}; skipping its circle.`);
    }
  }
}

const scanIncomplete = unreadableBranches.length > 0 || unexaminedBranches.length > 0;
if (frames.size === 0) {
  if (desktopPartial && scanIncomplete) {
    fail(
      `The layer scan was incomplete on page "${page.name}"; no comments could be confirmed, so nothing can be saved.`,
    );
  }
  fail(`No comments found on page "${page.name}".`);
}
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
const confirmedThreads = output.filter((comment) => !comment.parent_id).length;

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
if (scanIncomplete) {
  const report = {
    version: 1,
    confirmed_threads: confirmedThreads,
    recovery_requests: recoveryBudget.used,
    unreadable: unreadableBranches,
    unexamined: unexaminedBranches,
  };
  writeFileSync(join(runDir, 'partial-report.json'), `${JSON.stringify(report, null, '\t')}\n`);
}
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
    const { images } = await figma(`/images/${fileKey}?ids=${ids}&format=png&scale=2`, 'requesting frame images');
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
