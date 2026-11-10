use crate::platform::files::is_link;
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::{Duration, SystemTime},
};
use tauri::Manager;

const MAX_CACHE_BYTES: u64 = 512 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);

struct Saved {
    generation: u64,
    bytes: u64,
}
#[derive(Default)]
struct CacheState {
    generation: u64,
    active: HashMap<PathBuf, Saved>,
}
// The lock protects quota commits and individual deletions, never a root scan.
static CACHE: LazyLock<Mutex<CacheState>> = LazyLock::new(|| Mutex::new(CacheState::default()));

struct CachedFile {
    path: PathBuf,
    bytes: u64,
    modified: SystemTime,
}
struct Directory {
    path: PathBuf,
    files: Vec<CachedFile>,
    modified: SystemTime,
    bytes: u64,
    readable: bool,
}
struct Scan {
    root: PathBuf,
    directories: Vec<Directory>,
    unknown_bytes: u64,
}
struct Snapshot {
    generation: u64,
    scanned: Scan,
}
impl Scan {
    fn bytes(&self) -> u64 {
        self.directories
            .iter()
            .fold(self.unknown_bytes, |sum, entry| {
                sum.saturating_add(entry.bytes)
            })
    }
}

fn log_skip(path: &Path, error: &io::Error) {
    eprintln!(
        "Attachment cache cleanup skipped {}: {error}",
        path.display()
    );
}

pub(super) fn initialize(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(data) = app.path().app_data_dir() else {
            return;
        };
        let mut roots = vec![data.join("attachments")];
        if data
            .file_name()
            .is_some_and(|name| name == "local.codex.float")
        {
            roots.push(
                data.with_file_name("local.codex.float.demo")
                    .join("attachments"),
            );
        }
        for root in roots {
            if let Err(error) = cleanup(&root, &CACHE, SystemTime::now()) {
                log_skip(&root, &error);
            }
        }
    });
}

fn scan(root: &Path) -> io::Result<Scan> {
    scan_with(root, inspect_directory)
}

fn scan_with(
    root: &Path,
    mut inspect: impl FnMut(&Path, &Path) -> io::Result<Option<Directory>>,
) -> io::Result<Scan> {
    let metadata = match root.symlink_metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Scan {
                root: root.to_owned(),
                directories: Vec::new(),
                unknown_bytes: 0,
            });
        }
        Err(error) => return Err(error),
    };
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(io::Error::other("附件缓存目录不能是链接"));
    }
    let root = root.canonicalize()?;
    let mut result = Scan {
        root: root.clone(),
        directories: Vec::new(),
        unknown_bytes: 0,
    };
    for entry in fs::read_dir(&root)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                log_skip(&root, &error);
                result.unknown_bytes = result
                    .unknown_bytes
                    .saturating_add(super::attachments::MAX_ATTACHMENT_BYTES);
                continue;
            }
        };
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !uuid::Uuid::parse_str(name)
            .is_ok_and(|id| id.to_string() == name && id.get_version_num() == 4)
        {
            continue;
        }
        match inspect(&root, &entry.path()) {
            Ok(Some(directory)) => result.directories.push(directory),
            Ok(None) => {}
            Err(error) => {
                log_skip(&entry.path(), &error);
                if error.kind() != io::ErrorKind::NotFound {
                    // Each app-created directory contains one attachment of at most 25 MB.
                    // Reserve that much for unreadable entries instead of assuming zero.
                    result.directories.push(Directory {
                        path: root.join(name),
                        files: Vec::new(),
                        modified: SystemTime::now(),
                        bytes: super::attachments::MAX_ATTACHMENT_BYTES,
                        readable: false,
                    });
                }
            }
        }
    }
    Ok(result)
}

// Only flat UUID directories owned by this cache are eligible for cleanup.
fn inspect_directory(root: &Path, path: &Path) -> io::Result<Option<Directory>> {
    let metadata = path.symlink_metadata()?;
    if !metadata.is_dir() || is_link(&metadata) {
        return Ok(None);
    }
    let path = path.canonicalize()?;
    if path.parent() != Some(root) {
        return Ok(None);
    }
    let mut files = Vec::new();
    let mut modified = None;
    let mut bytes = 0_u64;
    for entry in fs::read_dir(&path)? {
        let entry = entry?;
        let metadata = entry.path().symlink_metadata()?;
        if !metadata.is_file() || is_link(&metadata) {
            return Ok(None);
        }
        let file = entry.path().canonicalize()?;
        if file.parent() != Some(path.as_path()) {
            return Ok(None);
        }
        let time = metadata.modified()?;
        modified = Some(modified.map_or(time, |previous: SystemTime| previous.max(time)));
        bytes = bytes.saturating_add(metadata.len());
        files.push(CachedFile {
            path: file,
            bytes: metadata.len(),
            modified: time,
        });
    }
    Ok(Some(Directory {
        path,
        files,
        modified: modified.unwrap_or(metadata.modified()?),
        bytes,
        readable: true,
    }))
}

fn remove_directory(entry: &Directory) -> io::Result<()> {
    let parent = entry
        .path
        .parent()
        .ok_or_else(|| io::Error::other("Invalid cache directory"))?;
    if is_link(&parent.symlink_metadata()?) || parent.canonicalize()? != parent {
        return Err(io::Error::other(
            "Attachment cache root changed during cleanup",
        ));
    }
    if is_link(&entry.path.symlink_metadata()?) {
        return Err(io::Error::other(
            "Attachment cache directory changed during cleanup",
        ));
    }
    // Recheck scanned files before deleting; a stale scan must not remove a changed file.
    for file in &entry.files {
        let metadata = file.path.symlink_metadata()?;
        if !metadata.is_file()
            || is_link(&metadata)
            || metadata.len() != file.bytes
            || metadata.modified()? != file.modified
        {
            return Err(io::Error::other(
                "Attachment cache file changed during cleanup",
            ));
        }
    }
    for file in &entry.files {
        fs::remove_file(&file.path)?;
    }
    fs::remove_dir(&entry.path)
}

fn prune(scanned: &mut Scan, cache: &Mutex<CacheState>, now: SystemTime) {
    let root = &scanned.root;
    scanned.directories.retain_mut(|entry| {
        if !entry.readable || now.duration_since(entry.modified).unwrap_or_default() < RETENTION {
            return true;
        }
        // Release between directories so a large startup scan cannot monopolize saves.
        let Ok(state) = cache.lock() else {
            return true;
        };
        if state.active.contains_key(&entry.path) {
            return true;
        }
        let removed = remove_directory(entry);
        drop(state);
        match removed {
            Ok(()) => false,
            Err(error) => {
                log_skip(&entry.path, &error);
                // The directory may have disappeared, or deletion may have
                // partially succeeded. Refresh its charge without holding the lock.
                match inspect_directory(root, &entry.path) {
                    Ok(Some(current)) => {
                        *entry = current;
                        true
                    }
                    Ok(None) => false,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => false,
                    Err(_) => true,
                }
            }
        }
    });
}

fn cleanup(root: &Path, cache: &Mutex<CacheState>, now: SystemTime) -> io::Result<()> {
    let mut scanned = scan(root)?;
    prune(&mut scanned, cache, now);
    Ok(())
}

pub(super) fn save(root: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    save_with(
        root,
        filename,
        bytes,
        &CACHE,
        SystemTime::now(),
        MAX_CACHE_BYTES,
    )
}

fn save_with(
    root: &Path,
    filename: &str,
    bytes: &[u8],
    cache: &Mutex<CacheState>,
    now: SystemTime,
    limit: u64,
) -> Result<PathBuf, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let generation = cache.lock().map_err(|_| "附件缓存不可用")?.generation;
    let scanned = scan(root).map_err(|error| error.to_string())?;
    save_scanned(
        root,
        filename,
        bytes,
        cache,
        now,
        limit,
        Snapshot {
            generation,
            scanned,
        },
    )
}

fn save_scanned(
    root: &Path,
    filename: &str,
    bytes: &[u8],
    cache: &Mutex<CacheState>,
    now: SystemTime,
    limit: u64,
    snapshot: Snapshot,
) -> Result<PathBuf, String> {
    let Snapshot {
        generation,
        mut scanned,
    } = snapshot;
    prune(&mut scanned, cache, now);
    let mut state = cache.lock().map_err(|_| "附件缓存不可用")?;
    let seen: HashSet<_> = scanned
        .directories
        .iter()
        .map(|entry| &entry.path)
        .collect();
    let mut used = scanned.bytes();
    // Scans can overlap. Include writes committed since this scan began unless
    // that directory was already observed, so concurrent saves cannot overfill.
    for (path, saved) in &state.active {
        if saved.generation > generation
            && path.parent() == Some(scanned.root.as_path())
            && !seen.contains(path)
        {
            used = used.saturating_add(saved.bytes);
        }
    }
    if used.saturating_add(bytes.len() as u64) > limit {
        return Err("附件缓存已达 512 MiB 上限，请在设置中打开缓存文件夹并清理后重试".into());
    }
    let directory = root.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(filename);
    if let Err(error) = fs::write(&path, bytes) {
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&directory);
        return Err(error.to_string());
    }
    let canonical = directory
        .canonicalize()
        .map_err(|error| error.to_string())?;
    state.generation += 1;
    let generation = state.generation;
    state.active.insert(
        canonical,
        Saved {
            generation,
            bytes: bytes.len() as u64,
        },
    );
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("codex-float-cache-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root.canonicalize().unwrap())
        }
        fn file(&self, name: &str, modified: SystemTime) -> PathBuf {
            let directory = self.0.join(name);
            fs::create_dir(&directory).unwrap();
            let path = directory.join("image.png");
            fs::write(&path, b"image").unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(fs::FileTimes::new().set_modified(modified))
                .unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert!(self
                .0
                .starts_with(std::env::temp_dir().canonicalize().unwrap()));
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("codex-float-cache-"));
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    #[test]
    fn failed_writes_do_not_leave_empty_cache_directories() {
        let fixture = Fixture::new();
        let cache = Mutex::new(CacheState::default());
        assert!(save_with(
            &fixture.0,
            "bad\0name",
            b"data",
            &cache,
            SystemTime::now(),
            8
        )
        .is_err());
        assert!(cache.lock().unwrap().active.is_empty());
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
    }
    #[test]
    fn expiration_preserves_recent_active_and_non_cache_files() {
        let fixture = Fixture::new();
        let now = SystemTime::now();
        let old = now - RETENTION - Duration::from_secs(60);
        let expired = fixture.file(&uuid::Uuid::new_v4().to_string(), old);
        let recent = fixture.file(&uuid::Uuid::new_v4().to_string(), now);
        let active = fixture.file(&uuid::Uuid::new_v4().to_string(), old);
        let unrelated = fixture.file("user-folder", old);
        let mut state = CacheState::default();
        state.active.insert(
            active.parent().unwrap().to_path_buf(),
            Saved {
                generation: 0,
                bytes: 5,
            },
        );
        let cache = Mutex::new(state);
        cleanup(&fixture.0, &cache, now).unwrap();
        assert_eq!(scan(&fixture.0).unwrap().bytes(), 10);
        assert!(!expired.exists());
        assert!(recent.exists() && active.exists() && unrelated.exists());
    }
    #[test]
    fn unreadable_or_disappearing_entries_do_not_block_cleanup_or_saves() {
        for kind in [io::ErrorKind::PermissionDenied, io::ErrorKind::NotFound] {
            let fixture = Fixture::new();
            let now = SystemTime::now();
            let locked = fixture.file(&uuid::Uuid::new_v4().to_string(), now - RETENTION);
            let expired = fixture.file(&uuid::Uuid::new_v4().to_string(), now - RETENTION);
            let scanned = scan_with(&fixture.0, |root, path| {
                if path == locked.parent().unwrap() {
                    Err(io::Error::from(kind))
                } else {
                    inspect_directory(root, path)
                }
            })
            .unwrap();
            let cache = Mutex::new(CacheState::default());
            let saved = save_scanned(
                &fixture.0,
                "new.png",
                b"new",
                &cache,
                now,
                MAX_CACHE_BYTES,
                Snapshot {
                    generation: 0,
                    scanned,
                },
            )
            .unwrap();
            assert!(saved.exists() && locked.exists());
            assert!(!expired.exists());
        }
    }
    #[test]
    fn deletion_failures_are_skipped_and_other_directories_are_still_cleaned() {
        let fixture = Fixture::new();
        let now = SystemTime::now();
        let changed = fixture.file(&uuid::Uuid::new_v4().to_string(), now - RETENTION);
        let expired = fixture.file(&uuid::Uuid::new_v4().to_string(), now - RETENTION);
        let mut scanned = scan(&fixture.0).unwrap();
        // Simulate an entry changing after the scan, before deletion.
        fs::write(&changed, b"changed-content").unwrap();
        prune(&mut scanned, &Mutex::new(CacheState::default()), now);
        assert!(changed.exists());
        assert!(!expired.exists());
    }
    #[test]
    fn overlapping_scans_respect_quota_and_manual_deletion_restores_space_without_restart() {
        let fixture = Fixture::new();
        let cache = Mutex::new(CacheState::default());
        let now = SystemTime::now();
        let first_scan = scan(&fixture.0).unwrap();
        let second_scan = scan(&fixture.0).unwrap();
        let first = save_scanned(
            &fixture.0,
            "first.png",
            b"data",
            &cache,
            now,
            4,
            Snapshot {
                generation: 0,
                scanned: first_scan,
            },
        )
        .unwrap();
        assert!(save_scanned(
            &fixture.0,
            "second.png",
            b"data",
            &cache,
            now,
            4,
            Snapshot {
                generation: 0,
                scanned: second_scan
            }
        )
        .is_err());
        fs::remove_file(&first).unwrap();
        fs::remove_dir(first.parent().unwrap()).unwrap();
        assert!(save_with(&fixture.0, "next.png", b"data", &cache, now, 4).is_ok());
    }
    #[test]
    fn already_observed_concurrent_writes_are_not_charged_twice() {
        let fixture = Fixture::new();
        let cache = Mutex::new(CacheState::default());
        let now = SystemTime::now();
        save_with(&fixture.0, "first.png", b"data", &cache, now, 8).unwrap();
        let scanned = scan(&fixture.0).unwrap();
        assert!(save_scanned(
            &fixture.0,
            "second.png",
            b"data",
            &cache,
            now,
            8,
            Snapshot {
                generation: 0,
                scanned
            }
        )
        .is_ok());
        assert_eq!(scan(&fixture.0).unwrap().bytes(), 8);
    }
    #[test]
    fn entries_removed_during_cleanup_do_not_keep_the_quota_full() {
        let fixture = Fixture::new();
        let cache = Mutex::new(CacheState::default());
        let now = SystemTime::now();
        let missing = fixture.file(&uuid::Uuid::new_v4().to_string(), now - RETENTION);
        let scanned = scan(&fixture.0).unwrap();
        fs::remove_file(missing).unwrap();
        assert!(save_scanned(
            &fixture.0,
            "new.png",
            b"data",
            &cache,
            now,
            4,
            Snapshot {
                generation: 0,
                scanned
            }
        )
        .is_ok());
    }
    #[test]
    fn paused_startup_scans_do_not_block_saves_or_delete_new_files() {
        let fixture = Fixture::new();
        let cache = Mutex::new(CacheState::default());
        let now = SystemTime::now();
        fixture.file(&uuid::Uuid::new_v4().to_string(), now - RETENTION);
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            let root = &fixture.0;
            let cache_ref = &cache;
            let startup = scope.spawn(move || {
                let mut first = true;
                let mut scanned = scan_with(root, |root, path| {
                    if first {
                        first = false;
                        started_tx.send(()).unwrap();
                        release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    }
                    inspect_directory(root, path)
                })
                .unwrap();
                prune(&mut scanned, cache_ref, now);
            });
            started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let (saved_tx, saved_rx) = std::sync::mpsc::channel();
            scope.spawn(move || {
                saved_tx
                    .send(save_with(root, "paste.png", b"new", cache_ref, now, 8))
                    .unwrap();
            });
            let saved = saved_rx.recv_timeout(Duration::from_secs(2));
            release_tx.send(()).unwrap();
            let saved = saved.unwrap().unwrap();
            startup.join().unwrap();
            assert!(saved.exists());
        });
    }
    #[cfg(unix)]
    #[test]
    fn cleanup_does_not_follow_links_outside_the_cache() {
        let fixture = Fixture::new();
        let outside = Fixture::new();
        let target = outside.file("user-folder", SystemTime::now() - RETENTION);
        std::os::unix::fs::symlink(
            target.parent().unwrap(),
            fixture.0.join(uuid::Uuid::new_v4().to_string()),
        )
        .unwrap();
        cleanup(
            &fixture.0,
            &Mutex::new(CacheState::default()),
            SystemTime::now(),
        )
        .unwrap();
        assert!(target.exists());
    }
}
