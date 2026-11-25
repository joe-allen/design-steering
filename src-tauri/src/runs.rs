use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const SUFFIX: &str = "-design-critique";
pub const SOURCE_FILE: &str = "source.json";

/// The page a run was fetched from, so the run can be synced later. Never holds the token.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSource {
    pub page_url: String,
    pub run_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayerPathPart {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartialBranch {
    pub id: String,
    pub path: Vec<LayerPathPart>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PartialReport {
    pub version: u32,
    #[serde(rename = "confirmed_threads")]
    pub confirmed_threads: usize,
    #[serde(rename = "recovery_requests")]
    pub recovery_requests: usize,
    pub unreadable: Vec<PartialBranch>,
    pub unexamined: Vec<PartialBranch>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartialSummary {
    pub confirmed_threads: usize,
    pub unreadable: Vec<PartialBranch>,
    pub unexamined: Vec<PartialBranch>,
}

impl PartialReport {
    fn validate(&self) -> Result<(), String> {
        let valid_branches = self
            .unreadable
            .iter()
            .chain(&self.unexamined)
            .all(|branch| {
                !branch.id.is_empty()
                    && !branch.path.is_empty()
                    && branch.path.last().is_some_and(|part| {
                        part.id == branch.id && !part.id.is_empty() && !part.name.is_empty()
                    })
            });
        if self.version != 1
            || self.confirmed_threads == 0
            || (self.unreadable.is_empty() && self.unexamined.is_empty())
            || !valid_branches
        {
            return Err("The partial report has unsupported or inconsistent contents.".into());
        }
        Ok(())
    }
}

pub fn read_partial_report(run_dir: &Path) -> Result<Option<PartialReport>, String> {
    let path = run_dir.join("partial-report.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Could not read the partial report: {error}"))?;
    let report: PartialReport = serde_json::from_str(&text)
        .map_err(|error| format!("The partial report is invalid: {error}"))?;
    report.validate()?;
    Ok(Some(report))
}

pub fn write_source(run_dir: &Path, source: &RunSource) -> Result<(), String> {
    let text = serde_json::to_string_pretty(source).map_err(|error| error.to_string())?;
    fs::write(run_dir.join(SOURCE_FILE), text)
        .map_err(|error| format!("Could not record the page for this run: {error}"))
}

/// A missing or malformed record is not an error; the run just cannot be synced.
fn read_source(run_dir: &Path) -> Option<RunSource> {
    serde_json::from_str(&fs::read_to_string(run_dir.join(SOURCE_FILE)).ok()?).ok()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    /// Folder name, used to refer to the run in other commands.
    pub id: String,
    /// Run name shown in History.
    pub name: String,
    pub modified_ms: u64,
    pub partial: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunContent {
    pub id: String,
    pub markdown: String,
    /// Absolute path of the run folder, for building asset URLs of its frame images.
    pub dir: String,
    /// Where the run came from; `None` when the record is missing or unreadable.
    pub source: Option<RunSource>,
    pub partial: bool,
    pub partial_report: Option<PartialReport>,
}

/// `<name>-design-critique` or `<name>-design-critique-<n>` with only letters, digits and dashes.
/// Returns the run name for valid folder names.
pub fn parse_run_folder(folder: &str) -> Option<&str> {
    if !folder
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    let index = folder.rfind(SUFFIX)?;
    let tail = &folder[index + SUFFIX.len()..];
    let counter_ok = tail.is_empty()
        || tail
            .strip_prefix('-')
            .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
    let name = &folder[..index];
    (counter_ok && !name.is_empty()).then_some(name)
}

fn modified_ms(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// A run is complete when its folder holds the generated `<folder>.md`.
pub fn list_runs_in(runs_dir: &Path) -> Vec<RunSummary> {
    let Ok(entries) = fs::read_dir(runs_dir) else {
        return Vec::new();
    };
    let mut runs: Vec<RunSummary> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_string();
            let name = parse_run_folder(&id)?.to_string();
            let modified_ms = modified_ms(&entry.path().join(format!("{id}.md")))?;
            let partial = entry.path().join("partial-report.json").exists();
            Some(RunSummary {
                id,
                name,
                modified_ms,
                partial,
            })
        })
        .collect();
    runs.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| b.id.cmp(&a.id))
    });
    runs
}

/// Resolves a run id to its folder, accepting only a real direct child of the runs folder.
pub fn resolve_run(runs_dir: &Path, id: &str) -> Result<PathBuf, String> {
    if parse_run_folder(id).is_none() {
        return Err(format!("\"{id}\" is not a run folder name."));
    }
    let dir = runs_dir.join(id);
    let canonical =
        dunce::canonicalize(&dir).map_err(|_| format!("Run \"{id}\" was not found."))?;
    let root =
        dunce::canonicalize(runs_dir).map_err(|_| "The runs folder does not exist.".to_string())?;
    if canonical.parent() != Some(root.as_path()) || !canonical.is_dir() {
        return Err(format!("Run \"{id}\" was not found."));
    }
    Ok(canonical)
}

pub fn read_run_in(runs_dir: &Path, id: &str) -> Result<RunContent, String> {
    let dir = resolve_run(runs_dir, id)?;
    let partial_report = read_partial_report(&dir)?;
    let markdown = fs::read_to_string(dir.join(format!("{id}.md")))
        .map_err(|error| format!("Could not read the critique for \"{id}\": {error}"))?;
    Ok(RunContent {
        id: id.to_string(),
        markdown,
        dir: dir.display().to_string(),
        source: read_source(&dir),
        partial: partial_report.is_some(),
        partial_report,
    })
}

/// Deletes one run's whole folder (markdown, JSON, images and source record).
pub fn delete_run_in(runs_dir: &Path, id: &str) -> Result<(), String> {
    let dir = resolve_run(runs_dir, id)?;
    fs::remove_dir_all(&dir).map_err(|error| format!("Could not remove run \"{id}\": {error}"))
}

/// Deletes every run folder, including ones left by failed runs that History does not list.
/// Keeps going after a failure and names the folders that remain. Entries that are not real
/// run folders are left alone.
pub fn delete_all_runs_in(runs_dir: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(runs_dir) else {
        return Ok(());
    };
    let mut remaining = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
        if parse_run_folder(&id).is_none() || !is_dir {
            continue;
        }
        if fs::remove_dir_all(entry.path()).is_err() {
            remaining.push(id);
        }
    }
    if remaining.is_empty() {
        Ok(())
    } else {
        Err(format!("Could not remove: {}", remaining.join(", ")))
    }
}

fn is_comments_snapshot(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".json") else {
        return false;
    };
    let Some((prefix, suffix)) = stem.rsplit_once("-figma-comments") else {
        return false;
    };
    !prefix.is_empty()
        && (suffix.is_empty()
            || suffix.strip_prefix('-').is_some_and(|number| {
                !number.is_empty() && number.chars().all(|c| c.is_ascii_digit())
            }))
}

fn copy_snapshot(from: &Path, to: &Path, id: &str) -> io::Result<()> {
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if kind.is_dir() && name == "_frames" {
            let target = to.join(name);
            fs::create_dir(&target)?;
            for frame in fs::read_dir(entry.path())? {
                let frame = frame?;
                let is_png = frame
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("png"));
                if frame.file_type()?.is_file() && is_png {
                    fs::copy(frame.path(), target.join(frame.file_name()))?;
                }
            }
        } else if kind.is_file()
            && (name == format!("{id}.md")
                || name == SOURCE_FILE
                || name == "partial-report.json"
                || name == "title.txt"
                || is_comments_snapshot(name))
        {
            fs::copy(entry.path(), to.join(name))?;
        }
    }
    Ok(())
}

/// Copies shareable snapshot files using the next free folder suffix without overwriting.
pub fn copy_run_to(runs_dir: &Path, id: &str, dest: &Path) -> Result<PathBuf, String> {
    let source = resolve_run(runs_dir, id)?;
    read_partial_report(&source)?;
    if !dest.is_dir() {
        return Err(format!("{} is not a folder.", dest.display()));
    }
    let mut attempt = 0u32;
    let target = loop {
        let name = if attempt == 0 {
            id.to_string()
        } else {
            format!("{id}-{attempt}")
        };
        let target = dest.join(name);
        match fs::create_dir(&target) {
            Ok(()) => break target,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => attempt += 1,
            Err(error) => return Err(format!("Could not create {}: {error}", target.display())),
        }
    };
    if let Err(error) = copy_snapshot(&source, &target, id) {
        let _ = fs::remove_dir_all(&target);
        return Err(format!("Could not copy the run: {error}"));
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ds-runs-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_run(runs: &Path, id: &str, age_secs: u64, complete: bool) {
        let dir = runs.join(id);
        fs::create_dir_all(dir.join("_frames")).unwrap();
        fs::write(dir.join("_frames/1-a.png"), b"png").unwrap();
        fs::write(dir.join("x-figma-comments.json"), b"[]").unwrap();
        if complete {
            let path = dir.join(format!("{id}.md"));
            fs::write(&path, b"# Design critique\n").unwrap();
            let md = fs::OpenOptions::new().write(true).open(&path).unwrap();
            md.set_modified(SystemTime::now() - Duration::from_secs(age_secs))
                .unwrap();
        }
    }

    #[test]
    fn parses_run_names() {
        assert_eq!(
            parse_run_folder("checkout-design-critique"),
            Some("checkout")
        );
        assert_eq!(
            parse_run_folder("checkout-design-critique-12"),
            Some("checkout")
        );
        assert_eq!(parse_run_folder("a-b-design-critique-1"), Some("a-b"));
        assert_eq!(parse_run_folder("-design-critique"), None);
        assert_eq!(parse_run_folder("checkout-design-critique-x"), None);
        assert_eq!(parse_run_folder("checkout"), None);
        assert_eq!(parse_run_folder("../checkout-design-critique"), None);
        assert_eq!(parse_run_folder("c:\\x-design-critique"), None);
    }

    #[test]
    fn lists_only_completed_runs_newest_first() {
        let runs = temp_dir("list");
        make_run(&runs, "old-design-critique", 300, true);
        make_run(&runs, "new-design-critique", 10, true);
        make_run(&runs, "mid-design-critique-1", 100, true);
        make_run(&runs, "failed-design-critique", 5, false);
        fs::create_dir_all(runs.join("not-a-run")).unwrap();

        let listed = list_runs_in(&runs);
        let ids: Vec<&str> = listed.iter().map(|run| run.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "new-design-critique",
                "mid-design-critique-1",
                "old-design-critique"
            ]
        );
        assert_eq!(listed[1].name, "mid");
        assert!(listed[0].modified_ms > listed[2].modified_ms);
        let _ = fs::remove_dir_all(&runs);
    }

    #[test]
    fn partial_metadata_is_read_and_copied_without_private_outbox_files() {
        let runs = temp_dir("partial-metadata");
        let dest = temp_dir("partial-download");
        make_run(&runs, "partial-design-critique", 1, true);
        let run_dir = runs.join("partial-design-critique");
        fs::write(
            run_dir.join("partial-report.json"),
            serde_json::to_vec(&PartialReport {
                version: 1,
                confirmed_threads: 2,
                recovery_requests: 4,
                unreadable: vec![PartialBranch {
                    id: "bad-node".into(),
                    path: vec![LayerPathPart {
                        id: "bad-node".into(),
                        name: "Unreadable layer".into(),
                    }],
                }],
                unexamined: vec![],
            })
            .unwrap(),
        )
        .unwrap();
        fs::write(
            run_dir.join("partial-design-critique.md"),
            "# Partial export",
        )
        .unwrap();
        fs::write(run_dir.join("outbox.json"), "private outbox").unwrap();

        assert!(list_runs_in(&runs)[0].partial);
        let content = read_run_in(&runs, "partial-design-critique").unwrap();
        assert!(content.partial);
        assert_eq!(content.partial_report.unwrap().confirmed_threads, 2);
        let downloaded = copy_run_to(&runs, "partial-design-critique", &dest).unwrap();
        assert!(downloaded.join("partial-report.json").is_file());
        assert!(downloaded.join("partial-design-critique.md").is_file());
        assert!(!downloaded.join("outbox.json").exists());
        assert!(!downloaded.join("partial-staging").exists());

        let _ = fs::remove_dir_all(&runs);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn malformed_partial_metadata_is_not_treated_as_a_complete_run() {
        let runs = temp_dir("invalid-partial-metadata");
        make_run(&runs, "partial-design-critique", 1, true);
        let report = runs
            .join("partial-design-critique")
            .join("partial-report.json");
        fs::write(&report, "{\"version\":99}").unwrap();

        assert!(list_runs_in(&runs)[0].partial);
        assert!(read_run_in(&runs, "partial-design-critique")
            .unwrap_err()
            .contains("partial report"));
        let _ = fs::remove_dir_all(&runs);
    }

    #[test]
    fn empty_or_missing_runs_folder_lists_nothing() {
        assert!(list_runs_in(&temp_dir("empty")).is_empty());
        assert!(list_runs_in(Path::new("/definitely/not/here")).is_empty());
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let runs = temp_dir("traversal");
        make_run(&runs, "ok-design-critique", 1, true);
        for bad in [
            "..",
            "../ok-design-critique",
            "/etc",
            "ok-design-critique/..",
            "a/b-design-critique",
        ] {
            assert!(resolve_run(&runs, bad).is_err(), "{bad} should be rejected");
            assert!(read_run_in(&runs, bad).is_err());
        }
        assert!(read_run_in(&runs, "ok-design-critique").is_ok());
        let _ = fs::remove_dir_all(&runs);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_run_folder_pointing_outside() {
        let runs = temp_dir("symlink");
        let outside = temp_dir("symlink-outside");
        std::os::unix::fs::symlink(&outside, runs.join("evil-design-critique")).unwrap();
        assert!(resolve_run(&runs, "evil-design-critique").is_err());
        let _ = fs::remove_dir_all(&runs);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn copy_uses_next_free_suffix_and_leaves_existing_folder_alone() {
        let runs = temp_dir("copy-src");
        let dest = temp_dir("copy-dest");
        make_run(&runs, "home-design-critique", 1, true);
        let source_dir = runs.join("home-design-critique");
        fs::write(source_dir.join("title.txt"), "Home").unwrap();
        write_source(
            &source_dir,
            &source("https://www.figma.com/design/KEY/page?node-id=1-1", "home"),
        )
        .unwrap();
        fs::write(
            source_dir.join("outbox.json"),
            r#"{"pending":"private","posted":"private"}"#,
        )
        .unwrap();
        fs::write(source_dir.join(".outbox-1.tmp"), "private").unwrap();
        fs::write(source_dir.join("_frames/private.txt"), "private").unwrap();

        let first = copy_run_to(&runs, "home-design-critique", &dest).unwrap();
        assert_eq!(first, dest.join("home-design-critique"));
        assert!(first.join("_frames/1-a.png").is_file());
        assert!(first.join("home-design-critique.md").is_file());
        assert!(first.join("x-figma-comments.json").is_file());
        assert_eq!(fs::read_to_string(first.join("title.txt")).unwrap(), "Home");
        assert!(first.join(SOURCE_FILE).is_file());
        assert!(!first.join("outbox.json").exists());
        assert!(!first.join(".outbox-1.tmp").exists());
        assert!(!first.join("_frames/private.txt").exists());

        fs::write(first.join("marker"), b"keep").unwrap();
        let second = copy_run_to(&runs, "home-design-critique", &dest).unwrap();
        let third = copy_run_to(&runs, "home-design-critique", &dest).unwrap();
        assert_eq!(second, dest.join("home-design-critique-1"));
        assert_eq!(third, dest.join("home-design-critique-2"));
        assert_eq!(fs::read(first.join("marker")).unwrap(), b"keep");
        assert!(!second.join("marker").exists());

        let _ = fs::remove_dir_all(&runs);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn copy_requires_an_existing_destination_folder() {
        let runs = temp_dir("copy-nodest");
        make_run(&runs, "home-design-critique", 1, true);
        assert!(copy_run_to(&runs, "home-design-critique", &runs.join("missing")).is_err());
        let _ = fs::remove_dir_all(&runs);
    }

    fn source(url: &str, name: &str) -> RunSource {
        RunSource {
            page_url: url.into(),
            run_name: name.into(),
        }
    }

    #[test]
    fn read_run_returns_the_recorded_source() {
        let runs = temp_dir("source");
        make_run(&runs, "a-design-critique", 1, true);
        write_source(
            &runs.join("a-design-critique"),
            &source("https://figma.test/p?node-id=1-1", "checkout"),
        )
        .unwrap();
        let content = read_run_in(&runs, "a-design-critique").unwrap();
        assert_eq!(
            content.source,
            Some(source("https://figma.test/p?node-id=1-1", "checkout"))
        );
        let json = fs::read_to_string(runs.join("a-design-critique").join(SOURCE_FILE)).unwrap();
        assert!(
            json.contains("\"pageUrl\"") && json.contains("\"runName\""),
            "{json}"
        );
        let _ = fs::remove_dir_all(&runs);
    }

    #[test]
    fn a_missing_or_malformed_record_still_opens_with_no_source() {
        let runs = temp_dir("nosource");
        make_run(&runs, "a-design-critique", 1, true);
        assert_eq!(
            read_run_in(&runs, "a-design-critique").unwrap().source,
            None
        );
        fs::write(
            runs.join("a-design-critique").join(SOURCE_FILE),
            b"{not json",
        )
        .unwrap();
        assert_eq!(
            read_run_in(&runs, "a-design-critique").unwrap().source,
            None
        );
        assert_eq!(list_runs_in(&runs).len(), 1);
        let _ = fs::remove_dir_all(&runs);
    }

    #[test]
    fn listing_is_the_same_with_or_without_a_record() {
        let runs = temp_dir("list-source");
        make_run(&runs, "a-design-critique", 20, true);
        make_run(&runs, "b-design-critique", 10, true);
        write_source(&runs.join("b-design-critique"), &source("https://x", "")).unwrap();
        let ids: Vec<String> = list_runs_in(&runs).into_iter().map(|run| run.id).collect();
        assert_eq!(ids, ["b-design-critique", "a-design-critique"]);
        let _ = fs::remove_dir_all(&runs);
    }

    #[test]
    fn delete_run_removes_everything_and_nothing_else() {
        let runs = temp_dir("del-one");
        let downloads = temp_dir("del-one-downloads");
        make_run(&runs, "a-design-critique", 1, true);
        make_run(&runs, "b-design-critique", 2, true);
        write_source(
            &runs.join("a-design-critique"),
            &source("https://secret.figma.test/p", "private"),
        )
        .unwrap();
        fs::write(runs.join("a-design-critique/outbox.json"), "private").unwrap();
        fs::write(runs.join("a-design-critique/.outbox-1.tmp"), "private").unwrap();
        let copy = copy_run_to(&runs, "a-design-critique", &downloads).unwrap();

        delete_run_in(&runs, "a-design-critique").unwrap();

        assert!(!runs.join("a-design-critique").exists());
        assert!(runs
            .join("b-design-critique/b-design-critique.md")
            .is_file());
        assert!(
            copy.join(SOURCE_FILE).is_file(),
            "downloaded copies are not touched"
        );
        let leftovers: Vec<_> = fs::read_dir(&runs)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name())
            .collect();
        assert_eq!(leftovers, ["b-design-critique"]);
        let _ = fs::remove_dir_all(&runs);
        let _ = fs::remove_dir_all(&downloads);
    }

    #[test]
    fn delete_run_rejects_bad_names_and_unknown_runs() {
        let runs = temp_dir("del-bad");
        let outside = temp_dir("del-bad-outside");
        make_run(&runs, "ok-design-critique", 1, true);
        fs::write(outside.join("keep.txt"), b"keep").unwrap();
        for bad in [
            "..",
            "../x-design-critique",
            "/etc",
            "ok-design-critique/..",
            "missing-design-critique",
        ] {
            assert!(delete_run_in(&runs, bad).is_err(), "{bad} must be rejected");
        }
        assert!(runs.join("ok-design-critique").is_dir());
        assert!(outside.join("keep.txt").is_file());
        let _ = fs::remove_dir_all(&runs);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn delete_run_refuses_a_symlink_pointing_outside() {
        let runs = temp_dir("del-link");
        let outside = temp_dir("del-link-outside");
        fs::write(outside.join("keep.txt"), b"keep").unwrap();
        std::os::unix::fs::symlink(&outside, runs.join("evil-design-critique")).unwrap();
        assert!(delete_run_in(&runs, "evil-design-critique").is_err());
        assert!(delete_all_runs_in(&runs).is_ok());
        assert!(
            outside.join("keep.txt").is_file(),
            "nothing outside the runs folder is deleted"
        );
        let _ = fs::remove_dir_all(&runs);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn delete_all_removes_listed_and_incomplete_runs_but_not_other_entries() {
        let runs = temp_dir("del-all");
        make_run(&runs, "a-design-critique", 1, true);
        make_run(&runs, "b-design-critique-1", 2, true);
        make_run(&runs, "failed-design-critique", 3, false);
        fs::write(runs.join("a-design-critique/outbox.json"), "private").unwrap();
        fs::write(runs.join("b-design-critique-1/.outbox-1.tmp"), "private").unwrap();
        fs::create_dir_all(runs.join("notes")).unwrap();
        fs::write(runs.join("stray.txt"), b"x").unwrap();

        delete_all_runs_in(&runs).unwrap();

        let mut left: Vec<String> = fs::read_dir(&runs)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["notes", "stray.txt"]);
        assert!(list_runs_in(&runs).is_empty());
        let _ = fs::remove_dir_all(&runs);
    }

    #[test]
    fn delete_all_with_no_runs_folder_is_fine() {
        assert!(delete_all_runs_in(Path::new("/definitely/not/here")).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn delete_all_continues_past_a_failure_and_names_the_run_left() {
        use std::os::unix::fs::PermissionsExt;
        let runs = temp_dir("del-partial");
        make_run(&runs, "a-design-critique", 1, true);
        make_run(&runs, "stuck-design-critique", 2, true);
        make_run(&runs, "z-design-critique", 3, true);
        // A folder that cannot be emptied: its parent directory is read-only.
        let frames = runs.join("stuck-design-critique/_frames");
        fs::set_permissions(&frames, fs::Permissions::from_mode(0o555)).unwrap();

        let error = delete_all_runs_in(&runs).unwrap_err();
        fs::set_permissions(&frames, fs::Permissions::from_mode(0o755)).unwrap();

        assert!(error.contains("stuck-design-critique"), "{error}");
        assert!(
            !error.contains("a-design-critique") && !error.contains("z-design-critique"),
            "{error}"
        );
        assert!(
            !runs.join("a-design-critique").exists() && !runs.join("z-design-critique").exists()
        );
        let _ = fs::remove_dir_all(&runs);
    }
}
