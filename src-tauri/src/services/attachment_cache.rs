use crate::platform::files::is_link;
use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::{Duration, SystemTime},
};
use tauri::Manager;

const MAX_CACHE_BYTES: u64 = 512 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
// Serialize cleanup and writes; never expire files created in this process.
static ACTIVE: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub(super) fn initialize(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(data) = app.path().app_data_dir() else {
            return;
        };
        let mut roots = vec![data.join("attachments")];
        // The permanent identifier uses a new data directory. Existing attachment
        // references remain valid, and the old cache still receives age cleanup.
        if data
            .file_name()
            .is_some_and(|name| name == "local.codex.float")
        {
            roots.push(
                data.with_file_name("local.codex.float.demo")
                    .join("attachments"),
            );
        }
        let active = ACTIVE.lock().unwrap();
        for root in roots {
            if let Err(error) = prune(&root, &active, SystemTime::now()) {
                eprintln!("Attachment cache cleanup failed: {error}");
            }
        }
    });
}

// Only inspect flat UUID directories produced by save_attachment. Never recurse
// through symlinks, junctions, unknown directories or user-selected attachments.
fn prune(root: &Path, active: &HashSet<PathBuf>, now: SystemTime) -> io::Result<u64> {
    match root.symlink_metadata() {
        Ok(metadata) if is_link(&metadata) => {
            return Err(io::Error::other("附件缓存目录不能是链接"))
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    };
    let root = root.canonicalize()?;
    let mut total = 0_u64;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !uuid::Uuid::parse_str(name)
            .is_ok_and(|id| id.to_string() == name && id.get_version_num() == 4)
        {
            continue;
        }
        let metadata = entry.path().symlink_metadata()?;
        if !metadata.is_dir() || is_link(&metadata) {
            continue;
        }
        let directory = entry.path().canonicalize()?;
        if directory.parent() != Some(root.as_path()) {
            continue;
        }
        let mut files = Vec::new();
        let mut modified = None;
        let mut size = 0_u64;
        let mut owned = true;
        for file in fs::read_dir(&directory)? {
            let file = file?;
            let metadata = file.path().symlink_metadata()?;
            if !metadata.is_file() || is_link(&metadata) {
                owned = false;
                break;
            }
            let path = file.path().canonicalize()?;
            if path.parent() != Some(directory.as_path()) {
                owned = false;
                break;
            }
            let file_modified = metadata.modified()?;
            modified =
                Some(modified.map_or(file_modified, |time: SystemTime| time.max(file_modified)));
            size = size.saturating_add(metadata.len());
            files.push(path);
        }
        if !owned {
            continue;
        }
        let modified = modified.unwrap_or(fs::metadata(&directory)?.modified()?);
        if !active.contains(&directory)
            && now.duration_since(modified).unwrap_or_default() >= RETENTION
        {
            for file in files {
                fs::remove_file(file)?;
            }
            fs::remove_dir(&directory)?;
        } else {
            total = total.saturating_add(size);
        }
    }
    Ok(total)
}

pub(super) fn save(root: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let mut active = ACTIVE.lock().map_err(|_| "附件缓存不可用")?;
    write(
        root,
        filename,
        bytes,
        &mut active,
        SystemTime::now(),
        MAX_CACHE_BYTES,
    )
}

fn write(
    root: &Path,
    filename: &str,
    bytes: &[u8],
    active: &mut HashSet<PathBuf>,
    now: SystemTime,
    limit: u64,
) -> Result<PathBuf, String> {
    let used = prune(root, active, now).map_err(|error| error.to_string())?;
    if used.saturating_add(bytes.len() as u64) > limit {
        return Err("附件缓存已达 512 MiB 上限，请清理旧缓存后重试".into());
    }
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let directory = root.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(filename);
    if let Err(error) = fs::write(&path, bytes) {
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&directory);
        return Err(error.to_string());
    }
    active.insert(
        directory
            .canonicalize()
            .map_err(|error| error.to_string())?,
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
        let mut active = HashSet::new();
        assert!(write(
            &fixture.0,
            "bad\0name",
            b"data",
            &mut active,
            SystemTime::now(),
            8
        )
        .is_err());
        assert!(active.is_empty());
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
        let protected = HashSet::from([active.parent().unwrap().to_path_buf()]);
        assert_eq!(prune(&fixture.0, &protected, now).unwrap(), 10);
        assert!(!expired.exists());
        assert!(recent.exists());
        assert!(active.exists());
        assert!(unrelated.exists());
    }
    #[test]
    fn concurrent_saves_respect_quota_and_old_sessions_can_be_reclaimed() {
        let fixture = Fixture::new();
        let active = Mutex::new(HashSet::new());
        let now = SystemTime::now();
        std::thread::scope(|scope| {
            let workers: Vec<_> = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        write(
                            &fixture.0,
                            "paste.png",
                            b"data",
                            &mut active.lock().unwrap(),
                            now,
                            8,
                        )
                    })
                })
                .collect();
            assert_eq!(
                workers
                    .into_iter()
                    .map(|worker| worker.join().unwrap())
                    .filter(Result::is_ok)
                    .count(),
                2
            );
        });
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
        let future = now + RETENTION + Duration::from_secs(60);
        assert_eq!(
            prune(&fixture.0, &active.lock().unwrap(), future).unwrap(),
            8
        );
        assert_eq!(prune(&fixture.0, &HashSet::new(), future).unwrap(), 0);
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
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
        assert_eq!(
            prune(&fixture.0, &HashSet::new(), SystemTime::now()).unwrap(),
            0
        );
        assert!(target.exists());
    }
}
