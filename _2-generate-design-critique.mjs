/**
 * Builds a markdown design critique from the exported Figma comments.
 *
 * Run (from this folder):
 *   node _2-generate-design-critique.mjs                    # most recently fetched run folder (<page-name>-design-critique), omits the user
 *   node _2-generate-design-critique.mjs --user=true        # appends "(user)" to each comment
 *   node _2-generate-design-critique.mjs <run folder | comments.json>   # explicit input
 *   node _2-generate-design-critique.mjs --out=<dir>        # look for the newest run folder in <dir> instead of next to this script
 *
 * Output: <run folder>/<run folder name>.md, next to the run's figma-comments JSON and _frames/.
 *   Re-running overwrites that .md.
 *
 * Notes:
 * - A run folder is created by _1-fetch-figma-comments.mjs and holds the JSON, title.txt and _frames/.
 * - The heading is the run name as given to fetch, else the Figma page name (from title.txt), else "Design critique".
 * - Comments are grouped by `frame`, in first-seen order.
 * - Each frame is matched to ./_frames/<n>-*.png by its leading number, because slugs repeat (81/82/83).
 * - A run folder without _frames/ (fetched with --images=false) lists every comment under "## General comments".
 * - Resolved comments (resolved_at set) get a "[Resolved]" suffix.
 * - Each bullet starts with its `comment_thread` ID, which is the pin number shown on the Figma image.
 * - Replies in the same thread repeat the same ID.
 * - Frame names are not rendered as headings; each image starts a new frame.
 * - Frames with no image (the "Outside Figma Frames" entries) are listed last under "## General comments".
 * - Only `message`, `user` and `comment_thread` are rendered; link, dates and reactions are dropped.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const USAGE =
  'Usage: node _2-generate-design-critique.mjs [run-folder | comments.json] [--user=true|false] [--out=<dir>]';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  let showUser = false;
  let input;
  let outDir = root;
  for (const arg of argv) {
    const user = /^--user=(.*)$/.exec(arg);
    const out = /^--out=(.+)$/.exec(arg);
    if (user && ['true', 'false'].includes(user[1])) showUser = user[1] === 'true';
    else if (out) outDir = resolve(out[1]);
    else if (!user && !arg.startsWith('--') && !input) input = resolve(arg);
    else fail(`Invalid argument "${arg}".\n${USAGE}`);
  }
  return { showUser, input, outDir };
}

const commentsFileIn = (dir) => readdirSync(dir).find((f) => /^.+-figma-comments(-\d+)?\.json$/.test(f));

function newestRunDir(dir) {
  const latest = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /-design-critique(-\d+)?$/.test(e.name) && commentsFileIn(join(dir, e.name)))
    .map((e) => ({ name: e.name, mtime: statSync(join(dir, e.name)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime)
    .at(-1)?.name;
  if (!latest)
    fail(`No *-design-critique/ run folder with a *-figma-comments.json in ${dir}. Run npm run fetch first.`);
  return join(dir, latest);
}

function resolveInput(path) {
  if (!existsSync(path)) fail(`Not found: ${path}`);
  if (!statSync(path).isDirectory()) return { runDir: dirname(path), jsonPath: path };
  const file = commentsFileIn(path);
  if (!file) fail(`No *-figma-comments.json in ${path}.`);
  return { runDir: path, jsonPath: join(path, file) };
}

const { showUser, input, outDir } = parseArgs(process.argv.slice(2));
const { runDir, jsonPath } = resolveInput(input ?? newestRunDir(outDir));
console.log(`Reading ${jsonPath}`);

const comments = JSON.parse(readFileSync(jsonPath, 'utf8'));

function partialReportFor(dir) {
  const path = join(dir, 'partial-report.json');
  if (!existsSync(path)) return null;
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`The partial report in ${dir} is invalid.`);
  }
  const validBranch = (branch) =>
    branch &&
    typeof branch.id === 'string' &&
    branch.id.length > 0 &&
    Array.isArray(branch.path) &&
    branch.path.length > 0 &&
    branch.path.at(-1)?.id === branch.id &&
    branch.path.every(
      (part) =>
        typeof part.id === 'string' && part.id.length > 0 && typeof part.name === 'string' && part.name.length > 0,
    );
  if (
    report.version !== 1 ||
    !Number.isInteger(report.confirmed_threads) ||
    report.confirmed_threads < 1 ||
    !Array.isArray(report.unreadable) ||
    !Array.isArray(report.unexamined) ||
    (!report.unreadable.length && !report.unexamined.length) ||
    ![...report.unreadable, ...report.unexamined].every(validBranch)
  ) {
    fail(`The partial report in ${dir} has unsupported or inconsistent contents.`);
  }
  return report;
}

function codeSpan(value) {
  const text = String(value).replace(/\s+/g, ' ');
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(([ticks]) => ticks.length));
  const fence = '`'.repeat(longest + 1);
  const padding = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ')) ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

const partialReport = partialReportFor(runDir);
function renderPartialWarning(report) {
  const sections = [
    '## Partial export\n\n' +
      `The scan confirmed ${report.confirmed_threads} thread${report.confirmed_threads === 1 ? '' : 's'}, but could not check the whole page. Additional comments may be missing.`,
  ];
  for (const [label, branches] of [
    ['Unreadable branches', report.unreadable],
    ['Not examined', report.unexamined],
  ]) {
    if (!branches.length) continue;
    sections.push(
      `### ${label}\n\n${branches
        .map(({ path }) => `- ${path.map(({ name, id }) => `${codeSpan(name)} (${codeSpan(id)})`).join(' / ')}`)
        .join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

const imagesByNumber = new Map();
const framesDir = join(runDir, '_frames');
if (existsSync(framesDir)) {
  for (const file of readdirSync(framesDir)) {
    const match = /^(\d+)-.+\.png$/i.exec(file);
    if (match) imagesByNumber.set(Number(match[1]), file);
  }
}

const frames = new Map();
for (const comment of comments) {
  if (!frames.has(comment.frame)) frames.set(comment.frame, []);
  frames.get(comment.frame).push(comment);
}

function renderComment(
  { message, user, resolved_at, comment_thread },
  prefix = `- [ ] **${comment_thread}**: `,
  indent = '  ',
) {
  const lines = message.split('\n');
  const last = lines.length - 1;
  if (showUser) lines[last] += ` (${user})`;
  if (resolved_at) lines[last] += ' [Resolved]';
  return lines.map((line, i) => (i === 0 ? `${prefix}${line}` : line === '' ? '' : `${indent}${line}`)).join('\n');
}

function renderThreads(items) {
  const replies = new Map();
  const roots = new Set(items.filter((item) => item.id && item.parent_id === null).map((item) => item.id));
  for (const item of items) {
    if (!item.id || !roots.has(item.parent_id)) continue;
    if (!replies.has(item.parent_id)) replies.set(item.parent_id, []);
    replies.get(item.parent_id).push(item);
  }
  return items
    .flatMap((item) => {
      if (item.id && roots.has(item.parent_id)) return [];
      if (!roots.has(item.id)) return [renderComment(item)];
      const pin = /^\d+$/.test(item.comment_thread) ? item.comment_thread : '?';
      const link = /^https:\/\/www\.figma\.com\/file\/[A-Za-z0-9_-]+\?node-id=[A-Za-z0-9%:_-]+#[A-Za-z0-9_-]+$/.test(
        item.link,
      )
        ? `[${pin}](${item.link})`
        : pin;
      return [
        renderComment(item, `- [${item.has_done_reaction === true ? 'x' : ' '}] **${link}**: `),
        ...(replies.get(item.id) ?? []).map((reply) => renderComment(reply, '  - ', '    ')),
      ];
    })
    .join('\n');
}

const withImage = [];
const general = [];

for (const [frame, items] of frames) {
  const number = Number(/^(\d+)\./.exec(frame)?.[1]);
  const image = imagesByNumber.get(number);
  const body = renderThreads(items);
  if (image) {
    withImage.push(
      `<a href="./_frames/${image}"><img src="./_frames/${image}" alt="Frame ${number}" style="max-width: 400px;"></a>\n\n${body}\n`,
    );
  } else {
    general.push(body);
  }
}

// title.txt is written by fetch: the run name as given, else the page name. Older run folders have none.
const titleFile = join(runDir, 'title.txt');
const title =
  (existsSync(titleFile) && readFileSync(titleFile, 'utf8').replace(/\s+/g, ' ').trim()) || 'Design critique';

const sections = [`# ${title}\n`];
if (partialReport) sections.push(renderPartialWarning(partialReport));
sections.push(withImage.join('\n'));
if (general.length) sections.push('## General comments\n', `${general.join('\n')}\n`);

const outPath = join(runDir, `${basename(runDir)}.md`);

writeFileSync(outPath, sections.join('\n'));
console.log(`Wrote ${outPath}`);
