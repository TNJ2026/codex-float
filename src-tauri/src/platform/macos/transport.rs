use std::{
    ffi::OsString,
    os::unix::fs::{FileTypeExt, MetadataExt},
    path::{Path, PathBuf},
};
pub type Stream = tokio::net::UnixStream;

fn socket_paths(
    configured: Option<OsString>,
    home: &Path,
    temporary: &Path,
    uid: u32,
) -> Result<Vec<PathBuf>, String> {
    if let Some(value) = configured {
        let path = PathBuf::from(value);
        if !path.is_absolute() {
            return Err("CODEX_FLOAT_IPC_PATH 必须为本地 Unix socket 的绝对路径".into());
        }
        return Ok(vec![path]);
    }
    // Observed in the installed desktop app's shared IPC module; never create or remove sockets.
    let legacy_name = if uid == 0 {
        "ipc.sock".into()
    } else {
        format!("ipc-{uid}.sock")
    };
    Ok(vec![
        home.join("ipc/ipc.sock"),
        temporary.join("codex-ipc").join(legacy_name),
    ])
}
fn validate_socket(path: &Path, uid: u32) -> Result<(), String> {
    let socket = path.symlink_metadata().map_err(|_| "IPC socket 不存在")?;
    let parent = path
        .parent()
        .ok_or("IPC socket 路径无效")?
        .symlink_metadata()
        .map_err(|_| "IPC 目录不存在")?;
    if !socket.file_type().is_socket()
        || socket.uid() != uid
        || !parent.is_dir()
        || parent.uid() != uid
        || parent.mode() & 0o022 != 0
    {
        return Err("IPC socket 必须由当前用户拥有，且所在目录不可被其他用户写入".into());
    }
    Ok(())
}
pub async fn connect() -> Result<Stream, String> {
    let uid = unsafe { libc::getuid() };
    let home = crate::codex::paths::codex_home()?;
    let candidates = socket_paths(
        std::env::var_os("CODEX_FLOAT_IPC_PATH"),
        &home,
        &std::env::temp_dir(),
        uid,
    )?;
    let mut error = String::new();
    for path in candidates {
        if let Err(reason) = validate_socket(&path, uid) {
            error = reason;
            continue;
        }
        match Stream::connect(&path).await {
            Ok(stream) => return Ok(stream),
            Err(reason) => error = reason.to_string(),
        }
    }
    Err(format!(
        "无法连接 Codex 的 macOS IPC，请先运行桌面端；也可设置 CODEX_FLOAT_IPC_PATH。{error}"
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints_follow_desktop_home_and_uid_with_an_explicit_override() {
        assert_eq!(
            socket_paths(
                None,
                Path::new("/Users/test/.codex"),
                Path::new("/tmp"),
                501
            )
            .unwrap(),
            vec![
                PathBuf::from("/Users/test/.codex/ipc/ipc.sock"),
                PathBuf::from("/tmp/codex-ipc/ipc-501.sock")
            ]
        );
        assert_eq!(
            socket_paths(
                Some("/tmp/override.sock".into()),
                Path::new("/ignored"),
                Path::new("/tmp"),
                501
            )
            .unwrap(),
            vec![PathBuf::from("/tmp/override.sock")]
        );
        assert!(socket_paths(
            Some("relative.sock".into()),
            Path::new("/home"),
            Path::new("/tmp"),
            501
        )
        .is_err());
    }
    #[test]
    fn rejects_non_socket_files_and_accepts_owned_private_sockets() {
        use std::os::unix::fs::PermissionsExt;
        // Keep the test socket below Darwin's sockaddr_un path length limit.
        let root = Path::new("/tmp").join(format!("cfs-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = root.join("ipc.sock");
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        let uid = unsafe { libc::getuid() };
        assert!(validate_socket(&path, uid).is_ok());
        assert!(validate_socket(&path, uid + 1).is_err());
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert!(validate_socket(&path, uid).is_err());
        drop(listener);
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, "ordinary file").unwrap();
        assert!(validate_socket(&path, uid).is_err());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
