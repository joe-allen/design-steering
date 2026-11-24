# Design Steering

Pulls the comments on one Figma page and turns them into a markdown design critique with a screenshot of each commented frame. You can use it as a desktop app (Design Steering) or from the command line.

1. `_1-fetch-figma-comments.mjs` downloads the page's comments to JSON and exports the commented frames as PNGs.
2. `_2-generate-design-critique.mjs` builds a markdown critique from that JSON and the PNGs.

The app runs these same two scripts for you and uses a separate internal worker when you explicitly push queued replies or done marks.

## Desktop app

### Install

1. Install **Node.js 22.9 or later** from [nodejs.org](https://nodejs.org). The app does not include Node. Check your version in a terminal (macOS) or Command Prompt (Windows):

   ```sh
   node --version
   ```

   It must print `v22.9.0` or higher. If you install Node while the app is open, use **Detect** in Settings (or restart the app).

2. Download the installer from the project's Releases page:
   - macOS, Apple Silicon (M1 and later): the `aarch64` `.dmg`. Open it and drag **Design Steering** into Applications.
   - macOS, Intel: the `x64` `.dmg`.
   - Windows: the `-setup.exe`. Run it. It installs the Microsoft WebView2 runtime if your PC lacks it.

3. Open the app the first time. The builds are not signed, so your system warns about them once:
   - **macOS:** if Gatekeeper blocks the app, right-click (or Control-click) **Design Steering** in Applications, choose **Open**, then choose **Open** again. Or remove the quarantine flag in a terminal and open the app normally:

     ```sh
     xattr -dr com.apple.quarantine "/Applications/Design Steering.app"
     ```

   - **Windows:** if SmartScreen shows "Windows protected your PC", click **More info**, then **Run anyway**.

### Use

1. Open **Settings** and fill in:

   | Field                       | Meaning                                                                                                                      |
   | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
   | Figma Personal Access Token | A token with `file_content:read` and `file_comments:read`; pushing also needs `file_comments:write` (see Requirements below) |
   | Include frame images        | On by default. Off skips the PNGs, and every comment is listed under "General comments"                                      |
   | Show comment author         | Off by default. On adds each comment's author in parentheses                                                                 |
   | Node path                   | Optional. Leave empty to find Node automatically; set it to force a specific `node` executable                               |

   Click **Save**. The token is stored as plain text in the app's settings file. **Clear token**, followed by **Save**, removes it.

2. Open **Comments**, enter the **Figma Page URL** (the link to the Figma page, or to a top-level frame on it) and an optional **Run name** (names the run folder instead of using the Figma page name), then click **Get comments**. The URL is remembered and pre-fills next time. Progress shows while it runs. If the run fails, its error message replaces the live output; otherwise, the critique appears with these actions:
   - **Pull from Figma** fetches the same page again as a new run, using the page the displayed run came from (also for runs opened from History). It never posts changes or copies the earlier run's queue. It is shown while the critique is locked or there are no updates ready to send.
   - **Unlock critique** enables inline reply and done controls. **Lock critique** returns to the read-only preview without sending pending work.
   - **Save 1 update** or **Save N updates** replaces Sync while unlocked with updates ready to review. Only **Send to Figma** in that review posts them.
   - **Download markdown** copies the fetched markdown, comments JSON, frame images, title and source record to a folder you choose. It excludes local drafts, delivery results and temporary outbox files.
   - **New page** shows the form again to fetch a different page. **Back to Comments** returns to the critique you were reading.
   - **Two-column layout** (the columns icon) toggles between the default single column and a 60/40 image/comments grid. Comments sit at inline-start (left in left-to-right languages) and images at inline-end, so right-to-left reading mirrors the columns. While you scroll past a tall image, its comments stay pinned at the top until the image ends. The grid stacks when the critique content area is 1024px wide or narrower. Your selection is remembered across runs and app restarts, including while stacked; headings and General comments remain full-width. This changes only the preview, not the saved markdown or downloads.
3. **History** lists past runs, newest first. Type in the search box to filter by date or name, and select a run to open it.
4. To remove runs, use **Remove** on a History entry, or **Remove all**. Each asks for confirmation. Removing deletes the run's whole folder, including its private outbox, from the app's data folder and keeps no copy. It does not change anything in Figma. **Remove all** also forgets the remembered page URL. Copies you downloaded to other folders are not removed.

Runs are stored in the app's data folder, in a `runs` folder: `~/Library/Application Support/com.designsteering.desktop/runs` on macOS and `%APPDATA%\com.designsteering.desktop\runs` on Windows. Each run folder also holds a `source.json` with the page URL and run name used (never the token), which is how Sync knows what to fetch, and a `title.txt` used as the critique's heading.

### Reply to feedback

1. A critique opens locked. Select **Unlock critique**, then choose **Reply** beside a thread and type in the field below it, or check that thread's done checkbox. Posted comments and replies remain read-only. A check mark on the root from anyone counts as done; it is separate from Figma's `[Resolved]` status. A mark already present in Figma cannot be removed here.
2. Nonblank replies and pending done marks are saved locally in the run's private outbox. Edit a draft in place, use **Discard reply**, or uncheck an unsent done mark to remove it. Switching layouts or locking preserves the work without contacting Figma; reopen the run from **History** to continue. If a local save fails, the text stays in the editor and can be retried. Older runs without valid thread metadata remain readable and downloadable, but need a fresh fetch before actions can be queued. If saved Markdown cannot be safely matched to a snapshot thread, its original content stays read-only and that validated thread's actions appear separately.
3. While unlocked, choose **Save 1 update** or **Save N updates**. Each reply and done mark counts as one update. Review the destination and exact actions, then select **Send to Figma** or **Cancel**. The saved token's account is used. Pushing requires `file_comments:write` and access to the file; read-only tokens still work for fetching and Sync. A 403 can mean a token, scope, or file-access problem; use **Open Settings** to check the token.
4. Results appear beneath their threads and distinguish **Sent**, **Rejected**, **Already done in Figma**, and **Needs verification in Figma**. Confirmed actions are not resent. For an uncertain action, unlock the critique and use **Open in Figma** to check it, then **Retry after checking** and **I checked Figma; retry** only if it was not sent. Retrying an action that did reach Figma can create a duplicate.

Pushing does not edit the saved critique or refresh it. Lock the critique and use **Pull from Figma** to fetch a new snapshot; unfinished actions remain on the earlier run in History. Download the new run to share the latest Figma state. Use **Download markdown**, rather than copying the app's run folder, to exclude the private outbox.

### Build from source

Needs Node 22.9 or later and Rust 1.89 or later from the [Rust toolchain](https://www.rust-lang.org/tools/install) (Tauri prerequisites: see [tauri.app](https://tauri.app/start/prerequisites/)).

```sh
npm install
npm run tauri dev          # run the app with hot reload (uses the scripts in this folder)
npm run stage              # copy the scripts and production dependencies into src-tauri/resources/scripts
npm run tauri build        # build an installer for this machine (run npm run stage first)
npm test                   # script tests, app tests and Rust tests
```

`npm run stage` accepts a target, for example `node scripts/stage-scripts.mjs darwin-x64`, to bundle the image library for another platform. Pushing a tag that starts with `v` runs the release workflow, which builds the two macOS installers and the Windows installer and attaches them to a draft GitHub release.

The desktop icon uses the bull from [ui-design/logo.svg](ui-design/logo.svg) on a padded white rounded-square tile. Its source is [src-tauri/app-icon.svg](src-tauri/app-icon.svg); regenerate [src-tauri/icons/](src-tauri/icons/) with `npm run tauri -- icon src-tauri/app-icon.svg`. Keep the desktop assets only; the generated `android/` and `ios/` icon folders are not used.

## Contributing

| Goal               | Command                                              |
| ------------------ | ---------------------------------------------------- |
| Validate one spec  | `openspec validate <spec-name> --type spec --strict` |
| Validate all specs | `openspec validate --specs --strict`                 |
| Run the test suite | `npm test`                                           |

OpenSpec validation checks specification structure and formatting; it does not verify that the application implements the spec. Tests check application behavior, but do not validate spec formatting. Run validation when editing specs, tests when changing code, and both when changing both. Add `--no-interactive` when running OpenSpec validation in scripts or CI.

`npm install` also installs a pre-commit hook that formats and lints the staged files with `npx lint-staged`.

## Requirements

- Node.js 22.9 or later (uses the built-in `--env-file-if-exists` and `fetch`).
- A Figma personal access token (PAT) with the `file_content:read` and `file_comments:read` scopes. Desktop pushes additionally need `file_comments:write` and file access for the saved token's account. Create a token in Figma under Settings > Security > Personal access tokens.

The scripts have one runtime dependency, [`sharp`](https://sharp.pixelplumbing.com/), used to draw the pin circles on the frame images. Run `npm install` once after cloning.

## Setup

Run `npm install`, then edit `.env` (it is git-ignored):

```sh
FIGMA_TOKEN=figd_xxx
FIGMA_PAGE_URL=https://www.figma.com/design/<file-key>/<name>?node-id=<page-id>
```

`FIGMA_PAGE_URL` is the link to the Figma page, or to a top-level frame on it. Copy it from Figma with the page selected. Values already exported in your shell take precedence over `.env`.

## Usage

```sh
npm run critique   # fetch, then generate
npm run fetch      # only download comments + frame PNGs into the page's run folder
npm run generate   # only build the markdown inside the most recently fetched run folder
```

Pass options after `--`:

| Command                            | Option                 | Effect                                                                        |
| ---------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `npm run fetch -- "<page url>"`    | page URL               | Use this page instead of `FIGMA_PAGE_URL`                                     |
| `npm run fetch -- --token=<PAT>`   | `--token=`             | Use this token instead of `FIGMA_TOKEN`                                       |
| `npm run fetch -- --images=false`  | `--images=true\|false` | Skip exporting frame PNGs (default `true`)                                    |
| `npm run fetch -- --name=<name>`   | `--name=`              | Use `<name>-design-critique/` instead of the page name                        |
| `npm run fetch -- --out=<dir>`     | `--out=`               | Create the run folder inside `<dir>` instead of next to the scripts           |
| `npm run fetch -- --print-run-dir` | `--print-run-dir`      | Print the absolute run folder path as the last line of output                 |
| `npm run generate -- --user=true`  | `--user=true\|false`   | Append "(user)" to each comment (default `false`)                             |
| `npm run generate -- <folder>`     | run folder or JSON     | Build from this run folder (or comments JSON) instead of the most recent one  |
| `npm run generate -- --out=<dir>`  | `--out=`               | Look for the most recent run folder in `<dir>` instead of next to the scripts |

`npm run critique` does not forward options. Run `fetch` and `generate` separately to use them.

## Output

Each `fetch` creates a run folder next to the scripts, named after the Figma page. If that folder already exists, the new run goes to `<name>-design-critique-1/` (then `-2`, and so on) instead of overwriting it, and its JSON becomes `<page-name>-figma-comments-1.json`. The folder is self-contained and can be moved or shared on its own:

- `<page-name>-design-critique/`
  - `<page-name>-figma-comments.json`: one entry per comment with `frame`, `comment_thread`, `user`, `message`, `reactions`, `link`, `created_at`, and `resolved_at`. New snapshots also record `file_key` (the file or branch key), `id`, `parent_id` (`null` for a root comment), and `has_done_reaction` (whether that comment has a check-mark reaction).
  - `title.txt`: the critique's heading. It is the run name exactly as given with `--name` (or in the app), otherwise the Figma page name. Folders without it get the heading "Design critique".
  - `_frames/<n>-<slug>.png`: one image per commented frame, exported at 2x. Each comment thread is marked with a blue circle containing its pin number, centred on the comment's position.
  - `<run folder name>.md`: the critique, added by `generate`. Each thread in a new snapshot has one checklist item, with the pin number linked to the root comment and replies nested below it. A check-mark reaction on the root checks the item; Figma's separate `[Resolved]` label is preserved. Running `generate` again (for example with `--user=true`) overwrites it.

## How it works and limits

- Figma's comments API returns every comment in the file. The fetch script keeps only comments pinned to a node on the chosen page.
- Comments are grouped by their top-level frame on the page. Frames are numbered by their highest pin number, newest first.
- Replies share their thread's pin number and frame. Only the thread's first comment gets a circle.
- Circle positions come from each comment's offset within the node it is pinned to, converted to the top-level frame. Comments with no usable offset get no circle, and a warning is printed.
- Comments pinned to empty canvas (no node), or to a node that has since been deleted, are skipped.
- Reactions are Figma emoji shortcodes such as `:+1:`.
- Frame numbers change as comments are added, so each fetch gets its own folder (`-1`, `-2`, ...). The generator pairs images to frames by number.

## Troubleshooting

- `Missing Figma PAT` / `Missing page URL`: set them in `.env` or pass them as options.
- `403`: check whether the token is invalid, expired, missing a scope, or belongs to an account without file access.
- `404`: the file key is wrong or the token's account cannot open the file.
- `node-id ... is not a page or a top-level frame`: use the page's own link. The error lists the pages it found.
- `No *-design-critique/ run folder`: run `npm run fetch` first.
- A run without `_frames/` (fetched with `--images=false`) is fine: every comment is listed under "General comments".
- Rate limited (`429`): fetch waits and retries once. A push stops without automatically retrying; review and push the remaining actions later.
- In the app, "Node 22.9 or later is required": install a current Node, then use **Detect** in Settings or restart the app. If Node is installed somewhere unusual, put its full path in the Node path field.
- `npx: command not found` when committing: the Git client ran the pre-commit hook without Node on its `PATH`, which happens with some GUI clients and Node version managers. Commit from a terminal, or set `SIMPLE_GIT_HOOKS_RC` to a shell script that puts Node on the `PATH` (for example `export PATH="/usr/local/bin:$PATH"`, or `. "$HOME/.nvm/nvm.sh"`). The hook runs that script first, so the Git client must see the variable.
