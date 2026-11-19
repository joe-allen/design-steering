use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub type Version = (u32, u32, u32);

pub const MIN_VERSION: Version = (22, 9, 0);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct NodeInfo {
    pub path: String,
    pub version: String,
}

pub fn parse_version(text: &str) -> Option<Version> {
    let mut parts = text.trim().strip_prefix('v')?.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts
        .next()?
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()?;
    Some((major, minor, patch))
}

fn format_version(version: Version) -> String {
    format!("{}.{}.{}", version.0, version.1, version.2)
}

fn requirement_message(found: Option<Version>) -> String {
    let found = match found {
        Some(version) => format!("Found Node {}.", format_version(version)),
        None => "No Node was found.".to_string(),
    };
    format!(
        "Node 22.9 or later is required. {found} Install a current Node from https://nodejs.org, then use Detect in Settings (or restart the app). See the README for details."
    )
}

#[cfg(windows)]
pub fn hide_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_window(_command: &mut Command) {}

fn probe_node(path: &Path) -> Option<Version> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version(&String::from_utf8_lossy(&output.stdout))
}

/// Picks the Node to use: an explicit path wins and is never silently replaced; otherwise the
/// first candidate that runs and meets the minimum version is used.
pub fn select(
    explicit: Option<&str>,
    candidates: Vec<PathBuf>,
    probe: &dyn Fn(&Path) -> Option<Version>,
) -> Result<NodeInfo, String> {
    let info = |path: &Path, version: Version| NodeInfo {
        path: path.display().to_string(),
        version: format_version(version),
    };

    if let Some(explicit) = explicit.map(str::trim).filter(|path| !path.is_empty()) {
        let path = PathBuf::from(explicit);
        return match probe(&path) {
            None => Err(format!(
                "The Node path in Settings ({explicit}) could not be run. Fix it, or clear it to detect Node automatically."
            )),
            Some(version) if version < MIN_VERSION => Err(requirement_message(Some(version))),
            Some(version) => Ok(info(&path, version)),
        };
    }

    let mut first_found = None;
    let mut tried: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        if tried.contains(&candidate) {
            continue;
        }
        tried.push(candidate.clone());
        if let Some(version) = probe(&candidate) {
            if version >= MIN_VERSION {
                return Ok(info(&candidate, version));
            }
            first_found.get_or_insert(version);
        }
    }
    Err(requirement_message(first_found))
}

pub fn detect(explicit: Option<&str>) -> Result<NodeInfo, String> {
    let explicit_set = explicit.is_some_and(|path| !path.trim().is_empty());
    let candidates = if explicit_set {
        Vec::new()
    } else {
        candidates()
    };
    select(explicit, candidates, &probe_node)
}

fn candidates() -> Vec<PathBuf> {
    let mut found = Vec::new();
    #[cfg(unix)]
    found.extend(login_shell_node());
    found.extend(standard_locations());
    // Works when the app was started from a terminal and inherited its PATH.
    found.push(PathBuf::from("node"));
    found
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Directories like `v22.9.0` under `base`, newest first, each joined with `relative`.
fn version_dirs(base: &Path, relative: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(base) else {
        return Vec::new();
    };
    let mut versions: Vec<(Version, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let version = parse_version(&entry.file_name().to_string_lossy())?;
            Some((version, entry.path().join(relative)))
        })
        .collect();
    versions.sort_by_key(|(version, _)| std::cmp::Reverse(*version));
    versions.into_iter().map(|(_, path)| path).collect()
}

#[cfg(not(windows))]
fn standard_locations() -> Vec<PathBuf> {
    let mut found = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ];
    if let Some(home) = env_path("HOME") {
        found.push(home.join(".volta/bin/node"));
        found.extend(version_dirs(&home.join(".nvm/versions/node"), "bin/node"));
        found.extend(version_dirs(
            &home.join(".local/share/fnm/node-versions"),
            "installation/bin/node",
        ));
        found.extend(version_dirs(
            &home.join("Library/Application Support/fnm/node-versions"),
            "installation/bin/node",
        ));
    }
    found
}

#[cfg(windows)]
fn standard_locations() -> Vec<PathBuf> {
    let mut found = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(dir) = env_path(variable) {
            found.push(dir.join("nodejs").join("node.exe"));
        }
    }
    if let Some(dir) = env_path("LOCALAPPDATA") {
        found.push(dir.join("Programs").join("nodejs").join("node.exe"));
        found.push(dir.join("Volta").join("bin").join("node.exe"));
    }
    if let Some(dir) = env_path("NVM_SYMLINK") {
        found.push(dir.join("node.exe"));
    }
    found
}

/// Asks the user's login shell, because version managers are usually set up in its rc files and
/// apps started from Finder do not inherit that PATH.
#[cfg(unix)]
fn login_shell_node() -> Option<PathBuf> {
    use std::io::Read;
    use std::sync::mpsc;
    use std::time::Duration;

    let shell = env_path("SHELL").unwrap_or_else(|| PathBuf::from("/bin/zsh"));
    let mut child = Command::new(shell)
        .args(["-l", "-i", "-c", "command -v node"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        let _ = sender.send(text);
    });

    match receiver.recv_timeout(Duration::from_secs(5)) {
        Ok(text) => {
            let _ = child.wait();
            text.lines()
                .rev()
                .map(|line| PathBuf::from(line.trim()))
                .find(|path| path.is_absolute() && path.exists())
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe_table(
        table: &'static [(&'static str, Option<Version>)],
    ) -> impl Fn(&Path) -> Option<Version> {
        move |path| {
            table
                .iter()
                .find(|(name, _)| Path::new(name) == path)
                .and_then(|(_, version)| *version)
        }
    }

    #[test]
    fn parses_node_version_output() {
        assert_eq!(parse_version("v22.9.0\n"), Some((22, 9, 0)));
        assert_eq!(parse_version("v24.18.1"), Some((24, 18, 1)));
        assert_eq!(parse_version("v23.0.0-nightly2024"), Some((23, 0, 0)));
        assert_eq!(parse_version("22.9.0"), None);
        assert_eq!(parse_version("not node"), None);
    }

    #[test]
    fn version_minimum_is_inclusive() {
        assert!((22, 9, 0) >= MIN_VERSION);
        assert!((22, 8, 9) < MIN_VERSION);
        assert!((24, 0, 0) >= MIN_VERSION);
    }

    #[test]
    fn explicit_path_wins_over_discovered_ones() {
        let probe = probe_table(&[
            ("/mine/node", Some((22, 9, 0))),
            ("/other/node", Some((24, 0, 0))),
        ]);
        let chosen = select(
            Some("/mine/node"),
            vec![PathBuf::from("/other/node")],
            &probe,
        )
        .unwrap();
        assert_eq!(chosen.path, "/mine/node");
        assert_eq!(chosen.version, "22.9.0");
    }

    #[test]
    fn broken_or_old_explicit_path_is_an_error_not_a_fallback() {
        let probe = probe_table(&[
            ("/old/node", Some((20, 11, 0))),
            ("/other/node", Some((24, 0, 0))),
        ]);
        let old = select(
            Some("/old/node"),
            vec![PathBuf::from("/other/node")],
            &probe,
        )
        .unwrap_err();
        assert!(
            old.contains("22.9 or later") && old.contains("20.11.0"),
            "{old}"
        );
        let missing =
            select(Some("/nope"), vec![PathBuf::from("/other/node")], &probe).unwrap_err();
        assert!(missing.contains("/nope"), "{missing}");
    }

    #[test]
    fn first_acceptable_candidate_is_used_skipping_old_ones() {
        let probe = probe_table(&[
            ("/a/node", Some((20, 0, 0))),
            ("/b/node", None),
            ("/c/node", Some((22, 12, 0))),
        ]);
        let candidates = ["/a/node", "/b/node", "/c/node"]
            .map(PathBuf::from)
            .to_vec();
        assert_eq!(select(None, candidates, &probe).unwrap().path, "/c/node");
    }

    #[test]
    fn too_old_reports_the_version_found() {
        let probe = probe_table(&[("/a/node", Some((20, 11, 1)))]);
        let error = select(None, vec![PathBuf::from("/a/node")], &probe).unwrap_err();
        assert!(
            error.contains("22.9 or later") && error.contains("Found Node 20.11.1"),
            "{error}"
        );
    }

    #[test]
    fn detects_the_real_node_on_this_machine() {
        let on_path = Command::new("node")
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| parse_version(&String::from_utf8_lossy(&o.stdout)));
        if on_path.is_some_and(|version| version >= MIN_VERSION) {
            let info = detect(None).expect("node on PATH is detected");
            assert!(parse_version(&format!("v{}", info.version)).unwrap() >= MIN_VERSION);
        }
    }

    #[test]
    fn none_found_says_node_is_required() {
        let probe = probe_table(&[]);
        let error = select(None, vec![PathBuf::from("/a/node")], &probe).unwrap_err();
        assert!(
            error.contains("22.9 or later") && error.contains("No Node was found"),
            "{error}"
        );
        assert!(
            error.contains("Detect") && error.contains("README"),
            "{error}"
        );
    }
}
