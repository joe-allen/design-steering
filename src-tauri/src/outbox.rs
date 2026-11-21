use crate::runs::{self, RunSource};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const FRESH_RUN: &str = "Fetch a fresh run to queue actions.";
const OUTBOX_FILE: &str = "outbox.json";
const OUTBOX_VERSION: u32 = 1;
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

pub struct AppLock {
    file: fs::File,
}

impl AppLock {
    pub fn acquire(app_data: &Path) -> Result<Self, String> {
        fs::create_dir_all(app_data)
            .map_err(|error| format!("Could not create the app data folder: {error}"))?;
        let path = app_data.join("outbox.lock");
        match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.file_type().is_file() => {
                return Err("The app data lock is not a regular file.".into());
            }
            Err(error) if error.kind() != io::ErrorKind::NotFound => {
                return Err(format!("Could not inspect the app data lock: {error}"));
            }
            _ => {}
        }
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(&path)
            .map_err(|error| format!("Could not open the app data lock: {error}"))?;
        match file.try_lock() {
            Ok(()) => Ok(Self { file }),
            Err(fs::TryLockError::WouldBlock) => {
                Err("Another Design Steering instance is busy. Try again when it finishes.".into())
            }
            Err(fs::TryLockError::Error(error)) => {
                Err(format!("Could not acquire the app data lock: {error}"))
            }
        }
    }

    pub fn child_handle(&self) -> Result<fs::File, String> {
        self.file
            .try_clone()
            .map_err(|error| format!("Could not pass the app data lock to the worker: {error}"))
    }
}

pub fn with_lock<T>(app_data: &Path, job: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _lock = AppLock::acquire(app_data)?;
    job()
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub root_id: String,
    pub frame: String,
    pub pin: String,
    pub message: String,
    pub user: String,
    pub done: bool,
    pub resolved: bool,
    pub link: String,
    pub replies: Vec<ThreadReply>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReply {
    pub id: String,
    pub message: String,
    pub user: String,
    pub resolved: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    pub destination: String,
    pub file_key: String,
    pub threads: Vec<Thread>,
}

#[derive(Deserialize)]
struct SnapshotComment {
    file_key: String,
    id: String,
    parent_id: serde_json::Value,
    has_done_reaction: bool,
    frame: String,
    comment_thread: String,
    message: String,
    user: String,
    #[serde(default)]
    link: Option<String>,
    #[serde(default)]
    resolved_at: Option<String>,
}

fn regular_file(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| format!("The run is missing a required snapshot file. {FRESH_RUN}"))?;
    if !metadata.file_type().is_file() {
        return Err(format!(
            "A run snapshot file is not a regular file. {FRESH_RUN}"
        ));
    }
    Ok(())
}

pub fn resolve_writable_run(runs_dir: &Path, id: &str) -> Result<PathBuf, String> {
    let dir = runs_dir.join(id);
    let metadata =
        fs::symlink_metadata(&dir).map_err(|_| format!("Run \"{id}\" was not found."))?;
    if !metadata.file_type().is_dir() {
        return Err(format!(
            "The run folder is not a regular directory. {FRESH_RUN}"
        ));
    }
    let dir = runs::resolve_run(runs_dir, id)?;
    regular_file(&dir.join(format!("{id}.md")))?;
    Ok(dir)
}

fn source_file_key(source: &RunSource) -> Result<String, String> {
    let url = tauri::Url::parse(&source.page_url)
        .map_err(|_| format!("The recorded Figma destination is invalid. {FRESH_RUN}"))?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("figma.com" | "www.figma.com"))
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || !url
            .query_pairs()
            .any(|(key, value)| key == "node-id" && !value.is_empty())
    {
        return Err(format!(
            "The recorded Figma destination is invalid. {FRESH_RUN}"
        ));
    }
    let segments: Vec<&str> = url
        .path_segments()
        .ok_or_else(|| format!("The recorded Figma destination is invalid. {FRESH_RUN}"))?
        .collect();
    if segments.len() < 2
        || !matches!(segments[0], "design" | "file" | "board")
        || segments[1].is_empty()
    {
        return Err(format!(
            "The recorded Figma destination is invalid. {FRESH_RUN}"
        ));
    }
    let key = segments
        .windows(2)
        .find(|parts| parts[0] == "branch" && !parts[1].is_empty())
        .map_or(segments[1], |parts| parts[1]);
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "The recorded Figma destination is invalid. {FRESH_RUN}"
        ));
    }
    Ok(key.to_string())
}

fn comments_file_name(id: &str) -> Result<String, String> {
    let name = runs::parse_run_folder(id).ok_or("Invalid run folder.")?;
    let suffix = &id[name.len() + "-design-critique".len()..];
    Ok(format!("{name}-figma-comments{suffix}.json"))
}

pub fn read_thread_info(runs_dir: &Path, id: &str) -> Result<ThreadInfo, String> {
    let dir = resolve_writable_run(runs_dir, id)?;
    let source_path = dir.join(runs::SOURCE_FILE);
    let comments_path = dir.join(comments_file_name(id)?);
    regular_file(&source_path)?;
    regular_file(&comments_path)?;
    let source: RunSource = serde_json::from_slice(
        &fs::read(&source_path)
            .map_err(|error| format!("Could not read the run source: {error}"))?,
    )
    .map_err(|_| format!("The run source is invalid. {FRESH_RUN}"))?;
    let file_key = source_file_key(&source)?;
    let comments: Vec<SnapshotComment> = serde_json::from_slice(
        &fs::read(&comments_path)
            .map_err(|error| format!("Could not read the comments snapshot: {error}"))?,
    )
    .map_err(|_| format!("The run has invalid Figma thread metadata. {FRESH_RUN}"))?;
    let invalid = || format!("The run has invalid Figma thread metadata. {FRESH_RUN}");
    let mut ids = HashSet::new();
    let mut roots = HashMap::new();
    let mut root_indices = HashMap::new();
    let mut threads = Vec::new();
    for comment in &comments {
        if comment.file_key != file_key
            || comment.id.trim().is_empty()
            || matches!(comment.id.as_str(), "." | "..")
            || comment.frame.trim().is_empty()
            || comment.comment_thread.trim().is_empty()
            || !ids.insert(comment.id.as_str())
        {
            return Err(invalid());
        }
        if comment.parent_id.is_null() {
            roots.insert(comment.id.as_str(), comment);
            root_indices.insert(comment.id.as_str(), threads.len());
            threads.push(Thread {
                root_id: comment.id.clone(),
                frame: comment.frame.clone(),
                pin: comment.comment_thread.clone(),
                message: comment.message.clone(),
                user: comment.user.clone(),
                done: comment.has_done_reaction,
                resolved: comment
                    .resolved_at
                    .as_ref()
                    .is_some_and(|value| !value.is_empty()),
                link: comment.link.clone().unwrap_or_default(),
                replies: Vec::new(),
            });
        }
    }
    if threads.is_empty() {
        return Err(invalid());
    }
    for comment in &comments {
        if !comment.parent_id.is_null() {
            let parent = comment.parent_id.as_str().ok_or_else(invalid)?;
            let root = roots.get(parent).ok_or_else(invalid)?;
            if comment.frame != root.frame || comment.comment_thread != root.comment_thread {
                return Err(invalid());
            }
            let index = root_indices[parent];
            threads[index].replies.push(ThreadReply {
                id: comment.id.clone(),
                message: comment.message.clone(),
                user: comment.user.clone(),
                resolved: comment
                    .resolved_at
                    .as_ref()
                    .is_some_and(|value| !value.is_empty()),
            });
        }
    }
    Ok(ThreadInfo {
        destination: source.page_url,
        file_key,
        threads,
    })
}

impl ThreadInfo {
    pub fn root(&self, id: &str) -> Result<&Thread, String> {
        self.threads
            .iter()
            .find(|thread| thread.root_id == id)
            .ok_or_else(|| "The selected comment is not a root thread in this run.".to_string())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActionKind {
    Reply,
    Done,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActionStatus {
    Pending,
    InFlight,
    Confirmed,
    Rejected,
    Uncertain,
    AlreadyDone,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Action {
    pub id: String,
    pub root_id: String,
    pub kind: ActionKind,
    pub status: ActionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub figma_reply_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Outbox {
    pub version: u32,
    pub revision: u64,
    pub actions: Vec<Action>,
}

impl Default for Outbox {
    fn default() -> Self {
        Self {
            version: OUTBOX_VERSION,
            revision: 0,
            actions: Vec::new(),
        }
    }
}

pub fn check_revision(outbox: &Outbox, reviewed_revision: u64) -> Result<(), String> {
    if outbox.revision != reviewed_revision {
        return Err("The queue changed after review. Review the current batch again.".into());
    }
    Ok(())
}

fn load(dir: &Path, info: &ThreadInfo) -> Result<Outbox, String> {
    let path = dir.join(OUTBOX_FILE);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Outbox::default()),
        Err(error) => return Err(format!("Could not inspect the outbox: {error}")),
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err("The outbox is not a regular file.".into());
        }
        Ok(_) => {}
    }
    let data = fs::read(&path).map_err(|error| format!("Could not read the outbox: {error}"))?;
    let outbox: Outbox = serde_json::from_slice(&data)
        .map_err(|_| "The outbox is malformed and was not changed.".to_string())?;
    if outbox.version != OUTBOX_VERSION {
        return Err("The outbox version is not supported and was not changed.".into());
    }
    let mut ids = HashSet::new();
    let mut done_roots = HashSet::new();
    for action in &outbox.actions {
        let sequence = action
            .id
            .strip_prefix("action-")
            .and_then(|value| value.parse::<u64>().ok());
        if !sequence.is_some_and(|value| value > 0 && value <= outbox.revision)
            || !ids.insert(&action.id)
            || info.root(&action.root_id).is_err()
            || match action.kind {
                ActionKind::Reply => action
                    .text
                    .as_ref()
                    .is_none_or(|text| text.trim().is_empty()),
                ActionKind::Done => action.text.is_some() || !done_roots.insert(&action.root_id),
            }
        {
            return Err("The outbox is malformed and was not changed.".into());
        }
    }
    Ok(outbox)
}

pub fn read(runs_dir: &Path, id: &str) -> Result<Outbox, String> {
    let info = read_thread_info(runs_dir, id)?;
    let dir = resolve_writable_run(runs_dir, id)?;
    load(&dir, &info)
}

fn save(dir: &Path, outbox: &Outbox) -> Result<(), String> {
    let name = format!(
        ".outbox-{}-{}.tmp",
        std::process::id(),
        TEMP_ID.fetch_add(1, Ordering::Relaxed)
    );
    let temporary = dir.join(name);
    let target = dir.join(OUTBOX_FILE);
    let text = serde_json::to_vec_pretty(outbox).map_err(|error| error.to_string())?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("Could not save the outbox: {error}"))?;
    let result = (|| -> io::Result<()> {
        file.write_all(&text)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        fs::rename(&temporary, &target)?;
        #[cfg(unix)]
        fs::File::open(dir)?.sync_all()?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not save the outbox: {error}"));
    }
    Ok(())
}

fn mutate(
    runs_dir: &Path,
    id: &str,
    revision: u64,
    change: impl FnOnce(&ThreadInfo, &mut Outbox) -> Result<(), String>,
) -> Result<Outbox, String> {
    let info = read_thread_info(runs_dir, id)?;
    let dir = resolve_writable_run(runs_dir, id)?;
    let mut outbox = load(&dir, &info)?;
    check_revision(&outbox, revision)?;
    let next_revision = outbox
        .revision
        .checked_add(1)
        .ok_or("The outbox revision is exhausted.")?;
    change(&info, &mut outbox)?;
    outbox.revision = next_revision;
    save(&dir, &outbox)?;
    Ok(outbox)
}

pub fn queue_reply(
    runs_dir: &Path,
    id: &str,
    revision: u64,
    root_id: &str,
    text: &str,
) -> Result<Outbox, String> {
    if text.trim().is_empty() {
        return Err("Enter a reply before queueing it.".into());
    }
    mutate(runs_dir, id, revision, |info, outbox| {
        info.root(root_id)?;
        outbox.actions.push(Action {
            id: format!("action-{}", outbox.revision + 1),
            root_id: root_id.to_string(),
            kind: ActionKind::Reply,
            status: ActionStatus::Pending,
            text: Some(text.to_string()),
            error: None,
            figma_reply_id: None,
            updated_at: None,
        });
        Ok(())
    })
}

pub fn queue_done(
    runs_dir: &Path,
    id: &str,
    revision: u64,
    root_id: &str,
) -> Result<Outbox, String> {
    mutate(runs_dir, id, revision, |info, outbox| {
        if info.root(root_id)?.done
            || outbox
                .actions
                .iter()
                .any(|action| action.root_id == root_id && action.kind == ActionKind::Done)
        {
            return Err("This thread is already marked or has a pending done-mark.".into());
        }
        outbox.actions.push(Action {
            id: format!("action-{}", outbox.revision + 1),
            root_id: root_id.to_string(),
            kind: ActionKind::Done,
            status: ActionStatus::Pending,
            text: None,
            error: None,
            figma_reply_id: None,
            updated_at: None,
        });
        Ok(())
    })
}

pub fn edit_reply(
    runs_dir: &Path,
    id: &str,
    revision: u64,
    action_id: &str,
    text: &str,
) -> Result<Outbox, String> {
    if text.trim().is_empty() {
        return Err("Enter a reply before saving it.".into());
    }
    mutate(runs_dir, id, revision, |_, outbox| {
        let action = outbox
            .actions
            .iter_mut()
            .find(|action| action.id == action_id)
            .ok_or("The queued action was not found.")?;
        if action.kind != ActionKind::Reply
            || !matches!(
                action.status,
                ActionStatus::Pending | ActionStatus::Rejected
            )
        {
            return Err("Only an unsent reply can be edited.".into());
        }
        action.text = Some(text.to_string());
        action.status = ActionStatus::Pending;
        action.error = None;
        Ok(())
    })
}

pub fn discard(
    runs_dir: &Path,
    id: &str,
    revision: u64,
    action_id: &str,
) -> Result<Outbox, String> {
    mutate(runs_dir, id, revision, |_, outbox| {
        let index = outbox
            .actions
            .iter()
            .position(|action| action.id == action_id)
            .ok_or("The queued action was not found.")?;
        if !matches!(
            outbox.actions[index].status,
            ActionStatus::Pending | ActionStatus::Rejected
        ) {
            return Err("Only an action known not to have been sent can be discarded.".into());
        }
        outbox.actions.remove(index);
        Ok(())
    })
}

pub fn retry_uncertain(
    runs_dir: &Path,
    id: &str,
    revision: u64,
    action_id: &str,
    verified: bool,
) -> Result<Outbox, String> {
    if !verified {
        return Err("Check the thread in Figma before retrying this action.".into());
    }
    mutate(runs_dir, id, revision, |_, outbox| {
        let action = outbox
            .actions
            .iter_mut()
            .find(|action| action.id == action_id)
            .ok_or("The queued action was not found.")?;
        if !matches!(
            action.status,
            ActionStatus::InFlight | ActionStatus::Uncertain
        ) {
            return Err("This action does not need verification.".into());
        }
        action.status = ActionStatus::Pending;
        action.error = None;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    fn fixture(label: &str) -> (PathBuf, String) {
        let runs = std::env::temp_dir().join(format!("ds-threads-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&runs);
        let id = "checkout-design-critique-1".to_string();
        let dir = runs.join(&id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{id}.md")), "# Critique").unwrap();
        runs::write_source(
            &dir,
            &RunSource {
                page_url: "https://www.figma.com/design/FILE/branch/BRANCH/page?node-id=1-1".into(),
                run_name: "checkout".into(),
            },
        )
        .unwrap();
        fs::write(
            dir.join("checkout-figma-comments-1.json"),
            serde_json::to_string(&json!([
                {"file_key":"BRANCH", "id":"root", "parent_id":null,
                 "has_done_reaction":true, "frame":"1. Home", "comment_thread":"2",
                 "message":"Make this bigger", "user":"ada", "resolved_at":"2026-01-01",
                 "link":"https://www.figma.com/file/BRANCH?node-id=1-1#root"},
                {"file_key":"BRANCH", "id":"reply", "parent_id":"root",
                 "has_done_reaction":false, "frame":"1. Home", "comment_thread":"2",
                 "message":"Agreed", "user":"grace"},
                {"file_key":"BRANCH", "id":"other-root", "parent_id":null,
                 "has_done_reaction":false, "frame":"1. Home", "comment_thread":"2",
                 "message":"Another thread with the same pin", "user":"lee"}
            ]))
            .unwrap(),
        )
        .unwrap();
        (runs, id)
    }

    #[test]
    fn exposes_only_validated_roots_and_preserves_branch_identity() {
        let (runs, id) = fixture("valid");
        let info = read_thread_info(&runs, &id).unwrap();
        assert_eq!(info.file_key, "BRANCH");
        assert_eq!(info.threads.len(), 2);
        assert_eq!(info.threads[0].root_id, "root");
        assert_eq!(info.threads[0].pin, "2");
        assert!(info.threads[0].done);
        assert!(info.threads[0].resolved);
        assert_eq!(info.threads[0].replies[0].id, "reply");
        assert_eq!(info.threads[0].replies[0].message, "Agreed");
        assert_eq!(info.threads[1].root_id, "other-root");
        assert_eq!(info.threads[1].pin, "2");
        assert!(info.threads[1].replies.is_empty());
        assert!(info.root("root").is_ok());
        assert!(info.root("reply").unwrap_err().contains("not a root"));
        let _ = fs::remove_dir_all(runs);
    }

    #[test]
    fn incomplete_or_mismatched_runs_are_read_only() {
        let (runs, id) = fixture("invalid");
        let dir = runs.join(&id);
        fs::remove_file(dir.join(format!("{id}.md"))).unwrap();
        assert!(read_thread_info(&runs, &id).is_err());
        fs::write(dir.join(format!("{id}.md")), "# Critique").unwrap();
        runs::write_source(
            &dir,
            &RunSource {
                page_url: "https://www.figma.com/design/OTHER/page?node-id=1-1".into(),
                run_name: "".into(),
            },
        )
        .unwrap();
        assert!(read_thread_info(&runs, &id)
            .unwrap_err()
            .contains(FRESH_RUN));
        assert!(runs::read_run_in(&runs, &id).is_ok());
        runs::write_source(
            &dir,
            &RunSource {
                page_url: "https://not-figma.example/design/BRANCH/page?node-id=1-1".into(),
                run_name: "".into(),
            },
        )
        .unwrap();
        assert!(read_thread_info(&runs, &id).is_err());
        fs::write(dir.join("checkout-figma-comments-1.json"), "[]").unwrap();
        assert!(runs::read_run_in(&runs, &id).is_ok());
        let _ = fs::remove_dir_all(runs);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_run_and_snapshot_files() {
        use std::os::unix::fs::symlink;
        let (runs, id) = fixture("symlink");
        let dir = runs.join(&id);
        let source = dir.join(runs::SOURCE_FILE);
        let real_source = dir.join("real-source.json");
        fs::rename(&source, &real_source).unwrap();
        symlink(&real_source, &source).unwrap();
        assert!(read_thread_info(&runs, &id).is_err());
        assert!(runs::read_run_in(&runs, &id).is_ok());
        fs::remove_file(&source).unwrap();
        fs::rename(&real_source, &source).unwrap();
        let alias = "alias-design-critique";
        symlink(&dir, runs.join(alias)).unwrap();
        assert!(resolve_writable_run(&runs, alias).is_err());
        let _ = fs::remove_dir_all(runs);
    }

    #[test]
    fn queue_persists_edits_and_rejects_stale_reviews() {
        let (runs, id) = fixture("queue");
        assert_eq!(read(&runs, &id).unwrap(), Outbox::default());
        let queued = queue_reply(&runs, &id, 0, "root", "Hello").unwrap();
        assert_eq!(queued.revision, 1);
        assert_eq!(read(&runs, &id).unwrap(), queued);
        assert!(queue_reply(&runs, &id, 1, "reply", "Not a root").is_err());
        assert!(check_revision(&queued, 0).unwrap_err().contains("review"));
        assert!(edit_reply(&runs, &id, 0, &queued.actions[0].id, "Stale").is_err());
        let edited = edit_reply(&runs, &id, 1, &queued.actions[0].id, "Updated").unwrap();
        assert_eq!(edited.actions[0].text.as_deref(), Some("Updated"));
        let discarded = discard(&runs, &id, 2, &queued.actions[0].id).unwrap();
        assert!(discarded.actions.is_empty());
        assert_eq!(discarded.revision, 3);
        let _ = fs::remove_dir_all(runs);
    }

    #[test]
    fn rejects_duplicate_done_marks_and_malformed_outboxes_without_overwriting() {
        let (runs, id) = fixture("malformed");
        let path = runs.join(&id).join("checkout-figma-comments-1.json");
        let mut comments: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        comments[0]["has_done_reaction"] = json!(false);
        fs::write(&path, serde_json::to_vec(&comments).unwrap()).unwrap();
        let queued = queue_done(&runs, &id, 0, "root").unwrap();
        assert!(queue_done(&runs, &id, queued.revision, "root").is_err());
        let outbox_path = runs.join(&id).join(OUTBOX_FILE);
        fs::write(&outbox_path, b"{not valid").unwrap();
        assert!(queue_reply(&runs, &id, 0, "root", "Hello").is_err());
        assert_eq!(fs::read(&outbox_path).unwrap(), b"{not valid");
        fs::write(&outbox_path, br#"{"version":2,"revision":0,"actions":[]}"#).unwrap();
        assert!(read(&runs, &id).unwrap_err().contains("version"));
        let _ = fs::remove_dir_all(runs);
    }

    #[test]
    fn uncertain_actions_require_explicit_verification() {
        let (runs, id) = fixture("uncertain");
        let mut queued = queue_reply(&runs, &id, 0, "root", "Hello").unwrap();
        queued.actions[0].status = ActionStatus::InFlight;
        save(&runs.join(&id), &queued).unwrap();
        assert!(discard(&runs, &id, 1, &queued.actions[0].id).is_err());
        assert!(retry_uncertain(&runs, &id, 1, &queued.actions[0].id, false).is_err());
        let retried = retry_uncertain(&runs, &id, 1, &queued.actions[0].id, true).unwrap();
        assert_eq!(retried.actions[0].status, ActionStatus::Pending);
        let _ = fs::remove_dir_all(runs);
    }

    #[test]
    fn lock_holder() {
        let Ok(path) = std::env::var("DESIGN_STEERING_TEST_LOCK_DIR") else {
            return;
        };
        let app_data = Path::new(&path);
        let _lock = AppLock::acquire(app_data).unwrap();
        fs::write(app_data.join("holder-ready"), b"ready").unwrap();
        let mut input = String::new();
        std::io::Read::read_to_string(&mut std::io::stdin(), &mut input).unwrap();
    }

    #[test]
    fn another_process_blocks_queue_changes_and_removals_until_it_exits() {
        let (runs, id) = fixture("lock-contention");
        let app_data = runs.join("app-data");
        fs::create_dir_all(&app_data).unwrap();
        let mut holder = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "outbox::tests::lock_holder", "--nocapture"])
            .env("DESIGN_STEERING_TEST_LOCK_DIR", &app_data)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !app_data.join("holder-ready").exists() {
            assert!(
                holder.try_wait().unwrap().is_none(),
                "lock holder exited early"
            );
            assert!(Instant::now() < deadline, "lock holder did not start");
            std::thread::sleep(Duration::from_millis(10));
        }

        let error =
            with_lock(&app_data, || queue_reply(&runs, &id, 0, "root", "Hello")).unwrap_err();
        assert!(error.contains("Another"), "{error}");
        assert!(!runs.join(&id).join(OUTBOX_FILE).exists());
        assert!(with_lock(&app_data, || runs::delete_run_in(&runs, &id)).is_err());
        assert!(runs.join(&id).is_dir());

        holder.kill().unwrap();
        holder.wait().unwrap();
        let queued = with_lock(&app_data, || queue_reply(&runs, &id, 0, "root", "Hello")).unwrap();
        assert_eq!(queued.actions.len(), 1);
        with_lock(&app_data, || runs::delete_run_in(&runs, &id)).unwrap();
        assert!(!runs.join(&id).exists());
        let _ = fs::remove_dir_all(runs);
    }
}
