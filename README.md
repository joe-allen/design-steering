# Design Steering

Pulls the comments on one Figma page and turns them into a markdown design critique with a screenshot of each commented frame. You can use it as a desktop app (Design Steering) or from the command line.

1. `_1-fetch-figma-comments.mjs` downloads the page's comments to JSON and exports the commented frames as PNGs.
2. `_2-generate-design-critique.mjs` builds a markdown critique from that JSON and the PNGs.

The app runs these same two scripts for you.

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
   - Windows: the `-setup.exe`. Run it. It installs the Microsoft WebView2 runtime if your PC lacks it. The Windows installer is built and checked automatically, but has not yet been tested on a Windows PC.

3. Open the app the first time. The builds are not signed with an Apple or Microsoft developer certificate, so your system warns about them once:
   - **macOS:** opening the app shows "Design Steering Not Opened" because Apple could not verify it. Click **Done**, open **System Settings > Privacy & Security**, scroll to **Security**, click **Open Anyway** next to Design Steering, and confirm with your password or Touch ID. Or remove the quarantine flag in a terminal and open the app normally:

     ```sh
     xattr -dr com.apple.quarantine "/Applications/Design Steering.app"
     ```

     Version 0.1.0 is reported as "damaged and can't be opened" instead. Use the command above for it, or install a later version.

   - **Windows:** if SmartScreen shows "Windows protected your PC", click **More info**, then **Run anyway**.

### Use

1. Open **Settings** and fill in:

   | Field                       | Meaning                                                                                        |
   | --------------------------- | ---------------------------------------------------------------------------------------------- |
   | Figma Personal Access Token | A token with the `file_content:read` and `file_comments:read` scopes (see Requirements below)  |
   | Include frame images        | On by default. Off skips the PNGs, and every comment is listed under "General comments"        |
   | Show comment author         | Off by default. On adds each comment's author in parentheses                                   |
   | Node path                   | Optional. Leave empty to find Node automatically; set it to force a specific `node` executable |

   Click **Save**. The token is stored as plain text in the app's settings file. **Clear token** removes it.

   The bottom of Settings shows the installed app's version, for example "Version 0.1.0". Include it when you report a bug.

2. Open **Comments**, enter the **Figma Page URL** (the link to the Figma page, or to a top-level frame on it) and an optional **Run name** (names the run folder instead of using the Figma page name), then click **Get comments**. The URL is remembered and pre-fills next time. Progress shows while it runs. If the run fails, its error message replaces the live output; otherwise, the critique appears with these actions:
   - **Sync comments** fetches the same page again as a new run, using the page the displayed run came from (also for runs opened from History).
   - **Download markdown** copies the whole run folder (markdown, JSON, images and `source.json`) to a folder you choose.
   - **New page** shows the form again to fetch a different page. **Back to Comments** returns to the critique you were reading.
   - **Two-column layout** (the columns icon) toggles between the default single column and a 60/40 image/comments grid. Comments sit at inline-start (left in left-to-right languages) and images at inline-end, so right-to-left reading mirrors the columns. While you scroll past a tall image, its comments stay pinned at the top until the image ends. The grid stacks when the critique content area is 1024px wide or narrower. Your selection is remembered across runs and app restarts, including while stacked; headings and General comments remain full-width. This changes only the preview, not the saved markdown or downloads.
3. **History** lists past runs, newest first. Type in the search box to filter by date or name, and select a run to open it.
4. To remove runs, use **Remove** on a History entry, or **Remove all**. Each asks for confirmation. Removing deletes the run's whole folder (comments, images, markdown and `source.json`) from the app's data folder and keeps no copy. **Remove all** also forgets the remembered page URL. Copies you downloaded to other folders are not removed.

Runs are stored in the app's data folder, in a `runs` folder: `~/Library/Application Support/com.designsteering.desktop/runs` on macOS and `%APPDATA%\com.designsteering.desktop\runs` on Windows. Each run folder also holds a `source.json` with the page URL and run name used (never the token), which is how Sync knows what to fetch, and a `title.txt` used as the critique's heading.

### Build from source

Development needs Node 22.12 or later (the build tools require it; the app and the scripts still run on Node 22.9) and the [Rust toolchain](https://www.rust-lang.org/tools/install) (Tauri prerequisites: see [tauri.app](https://tauri.app/start/prerequisites/)).

```sh
npm install                # install dependencies and the pre-commit hook
npm run tauri dev          # run the app with hot reload (uses the scripts in this folder)
npm run stage              # copy the scripts and production dependencies into src-tauri/resources/scripts
npm run tauri build        # build an installer for this machine (run npm run stage first)
npm test                   # script tests, app tests and Rust tests
npm run format             # format the code (Prettier and rustfmt)
npm run lint               # lint JavaScript and Svelte (ESLint)
npm run check              # check the Svelte components (svelte-check, warnings fail)
npm run lint:rust          # lint the Rust code (clippy, warnings fail)
```

`npm run stage` accepts a target, for example `node scripts/stage-scripts.mjs darwin-x64`, to bundle the image library for another platform. Installers for releases are built by GitHub Actions; see [Pull requests and releases](#pull-requests-and-releases).

The desktop icon uses the bull from [ui-design/logo.svg](ui-design/logo.svg) on a padded white rounded-square tile. Its source is [src-tauri/app-icon.svg](src-tauri/app-icon.svg); regenerate [src-tauri/icons/](src-tauri/icons/) with `npm run tauri -- icon src-tauri/app-icon.svg`. Keep the desktop assets only; the generated `android/` and `ios/` icon folders are not used.

## Contributing

Development needs Node 22.12 or later and the Rust toolchain (see [Build from source](#build-from-source)).

| Goal                                    | Command                                              |
| --------------------------------------- | ---------------------------------------------------- |
| Validate one spec                       | `openspec validate <spec-name> --type spec --strict` |
| Validate all specs                      | `openspec validate --specs --strict`                 |
| Run the test suite                      | `npm test`                                           |
| Format all files                        | `npm run format`                                     |
| Check formatting without changing files | `npm run format:check`                               |
| Lint JavaScript and Svelte              | `npm run lint`                                       |
| Check the Svelte components             | `npm run check`                                      |
| Lint the Rust code                      | `npm run lint:rust`                                  |

OpenSpec validation checks specification structure and formatting; it does not verify that the application implements the spec. Tests check application behavior, but do not validate spec formatting. Run validation when editing specs, tests when changing code, and both when changing both. Add `--no-interactive` when running OpenSpec validation in scripts or CI.

`npm install` also installs a pre-commit hook. When you commit, it fixes and formats only the files you staged: ESLint and Prettier for JavaScript and Svelte, Prettier for CSS, JSON, Markdown, YAML and HTML, and rustfmt for Rust. The commit then contains the fixed files. If ESLint finds a problem it cannot fix, such as an undefined variable, the commit stops and shows the error. Files you have not staged are left alone. The hook does not run the tests or clippy, so run `npm test` and `npm run lint:rust` before pushing.

### Pull requests and releases

Changes reach `main` only through pull requests, which are squash-merged. The pull request title becomes the commit message on `main`, decides the next version and is the line in the changelog, so it must follow the [Conventional Commits](https://www.conventionalcommits.org/) format `type(scope): summary`:

- **type:** `feat`, `fix`, `perf` or `revert` for changes users notice; these appear in the changelog. `docs`, `style`, `refactor`, `test`, `build`, `ci` and `chore` do not appear and do not cause a release.
- **scope** (optional): `runner`, `viewer`, `settings`, `packaging`, `release`, `deps` or `ci`.
- **`!`** before the colon marks a breaking change, for example `feat(runner)!: new run folder format`. Use `!` rather than a `BREAKING CHANGE:` footer, which the squash merge drops.

Write the summary for users of the app: `fix(runner): find Node installed with fnm`, not `fix: update node.rs`. A `fix` or `perf` bumps the patch version, a `feat` the minor version, and a breaking change the major version (the minor version before 1.0).

Each pull request must pass three checks from the **CI** workflow before it can be merged:

- **PR title** checks the title format.
- **Checks** runs `format:check`, `lint`, `check`, the script and app tests, `check:config` and `check:version`.
- **Windows installer** runs clippy and the Rust tests on Windows and builds the `-setup.exe`. The installer can be downloaded from the run's artifacts for 7 days.

The **Release** workflow keeps one release pull request open, titled `chore(release): release X.Y.Z`. It collects the `feat`, `fix`, `perf` and `revert` changes merged since the last release, sets the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, and adds the `CHANGELOG.md` entry. Merging it creates the tag `vX.Y.Z` and a draft release, builds the two macOS installers and the Windows installer, attaches them, and publishes the release only when all three are attached.

Just before merging the release pull request, after the last change for that release has merged, reword its `CHANGELOG.md` entry on the release branch and its description to match: the description becomes the release notes. Edit only at that point, because the release pull request is rewritten whenever another releasable change merges.

Pull requests do not build the macOS installers. To build them for a branch, open the repository's **Actions** tab, choose **Build installers**, click **Run workflow**, and pick the branch and `macos` (or `all`). The installers are attached to that run as artifacts for 7 days.

## Requirements

- Node.js 22.9 or later (uses the built-in `--env-file-if-exists` and `fetch`).
- A Figma personal access token (PAT) with the `file_content:read` and `file_comments:read` scopes. Create one in Figma under Settings > Security > Personal access tokens.

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
  - `<page-name>-figma-comments.json`: the source of truth. One entry per comment with `frame`, `comment_thread`, `user`, `message`, `reactions`, `link`, `created_at` and `resolved_at`.
  - `title.txt`: the critique's heading. It is the run name exactly as given with `--name` (or in the app), otherwise the Figma page name. Folders without it get the heading "Design critique".
  - `_frames/<n>-<slug>.png`: one image per commented frame, exported at 2x. Each comment thread is marked with a blue circle containing its pin number, centred on the comment's position.
  - `<run folder name>.md`: the critique, added by `generate`. Each frame image is followed by its comments, prefixed with the pin number shown in Figma. Resolved comments are marked `[Resolved]`. Running `generate` again (for example with `--user=true`) overwrites it.

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
- `403`: the token is invalid, expired or missing a scope.
- `404`: the file key is wrong or the token's account cannot open the file.
- `node-id ... is not a page or a top-level frame`: use the page's own link. The error lists the pages it found.
- `No *-design-critique/ run folder`: run `npm run fetch` first.
- A run without `_frames/` (fetched with `--images=false`) is fine: every comment is listed under "General comments".
- Rate limited (`429`): the script waits and retries once. Re-run later if it still fails.
- In the app, "Node 22.9 or later is required": install a current Node, then use **Detect** in Settings or restart the app. If Node is installed somewhere unusual, put its full path in the Node path field.

## License

Design Steering is MIT licensed. See [LICENSE](LICENSE).
