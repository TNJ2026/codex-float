use std::{fs::Metadata, path::Path};

pub(crate) fn is_link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Include junctions and other reparse points, not just symbolic links.
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

pub(crate) fn is_local_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
            if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    }
    #[cfg(not(windows))]
    {
        path.is_absolute()
    }
}

pub(crate) fn is_executable(metadata: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        false
    }
}
