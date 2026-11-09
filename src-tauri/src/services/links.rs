use std::{fs::File, io::Read, path::Path};

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if url.starts_with("codex:") {
        super::context::thread_reference_id(&url)?;
        return crate::platform::shell::open_url(&url);
    }
    let parsed = tauri::Url::parse(&url).map_err(|_| "链接地址无效")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("仅支持 HTTP/HTTPS 网页链接".into());
    }
    crate::platform::shell::open_url(parsed.as_str())
}

const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FilePreview {
    Text { text: String },
    Folder,
}

fn local_path(path: &str) -> Result<&Path, String> {
    if !Path::new(path).is_absolute()
        || path.starts_with(r"\\")
        || path.starts_with("//")
        || path.contains('\0')
    {
        return Err("需要本地文件的绝对路径".into());
    }
    Ok(Path::new(path))
}

fn binary_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "pdf"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "odt"
            | "ods"
            | "odp"
            | "zip"
            | "7z"
            | "rar"
            | "gz"
            | "tar"
            | "bz2"
            | "xz"
            | "exe"
            | "dll"
            | "msi"
            | "lnk"
            | "mp3"
            | "mp4"
            | "wav"
            | "flac"
            | "ogg"
            | "webm"
            | "mkv"
            | "avi"
            | "mov"
            | "ttf"
            | "otf"
            | "woff"
            | "woff2"
            | "db"
            | "sqlite"
            | "sqlite3"
    )
}

fn decode_text(bytes: &[u8]) -> Result<String, String> {
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if bytes.len() % 2 != 0 {
            return Err("文本编码不完整".into());
        }
        let little = bytes[0] == 0xff;
        let words: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|v| {
                if little {
                    u16::from_le_bytes([v[0], v[1]])
                } else {
                    u16::from_be_bytes([v[0], v[1]])
                }
            })
            .collect();
        String::from_utf16(&words).map_err(|_| "无法解码 UTF-16 文本")?
    } else {
        let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
        std::str::from_utf8(bytes)
            .map_err(|_| "此文件不是 UTF-8/UTF-16 纯文本，暂不支持预览")?
            .to_owned()
    };
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("此文件包含二进制内容，暂不支持预览".into());
    }
    Ok(text)
}

fn inspect_file(path: &str) -> Result<FilePreview, String> {
    let path = local_path(path)?;
    let metadata = path
        .metadata()
        .map_err(|_| "无法访问文件，文件可能已移动或删除")?;
    if !metadata.is_file() || binary_extension(path) || metadata.len() > MAX_TEXT_BYTES as u64 {
        return Ok(FilePreview::Folder);
    }
    let Ok(file) = File::open(path) else {
        return Ok(FilePreview::Folder);
    };
    let mut bytes = Vec::new();
    if file
        .take((MAX_TEXT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > MAX_TEXT_BYTES
    {
        return Ok(FilePreview::Folder);
    }
    Ok(match decode_text(&bytes) {
        Ok(text) => FilePreview::Text { text },
        Err(_) => FilePreview::Folder,
    })
}

#[tauri::command]
pub async fn read_file_preview(path: String) -> Result<FilePreview, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_file(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = local_path(&path)?;
        let path = path.canonicalize().map_err(|_| "文件不存在或无法访问")?;
        crate::platform::shell::open_file(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn reveal_file(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = local_path(&path)?;
        path.metadata().map_err(|_| "文件不存在或无法访问")?;
        crate::platform::shell::reveal_file(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_file_actions_require_local_absolute_paths() {
        for path in [
            "relative.txt",
            "https://example.com/file.pdf",
            "//server/share/file.pdf",
            r"\\server\share\file.pdf",
            "bad\0path",
        ] {
            assert!(local_path(path).is_err(), "accepted {path:?}");
        }
        let path = std::env::temp_dir().join("中文 文件.pdf");
        assert_eq!(local_path(path.to_str().unwrap()).unwrap(), path);
    }
    #[test]
    fn accepts_text_and_rejects_binary() {
        assert_eq!(
            decode_text("中文\n<script>text</script>".as_bytes()).unwrap(),
            "中文\n<script>text</script>"
        );
        assert_eq!(decode_text(&[0xff, 0xfe, 0x2d, 0x4e]).unwrap(), "中");
        assert_eq!(decode_text(&[0xfe, 0xff, 0x4e, 0x2d]).unwrap(), "中");
        assert!(decode_text(b"MZ\0binary").is_err());
        assert!(decode_text(&[0xff, 0xfe, 0x00]).is_err());
        assert!(decode_text(&[0x80, 0x81]).is_err());
    }
    #[test]
    fn previews_readable_files_and_routes_other_files_to_the_file_manager() {
        let root =
            std::env::temp_dir().join(format!("codex-float-preview-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        for (name, bytes, expected) in [
            (
                "README.md",
                "# 中文".as_bytes(),
                FilePreview::Text {
                    text: "# 中文".into(),
                },
            ),
            (
                "settings.custom",
                b"key=value\n".as_slice(),
                FilePreview::Text {
                    text: "key=value\n".into(),
                },
            ),
            ("ascii.pdf", b"%PDF-1.7".as_slice(), FilePreview::Folder),
            ("binary.dat", b"MZ\0binary".as_slice(), FilePreview::Folder),
            ("old-encoding.txt", &[0x80, 0x81], FilePreview::Folder),
        ] {
            let file = root.join(name);
            std::fs::write(&file, bytes).unwrap();
            assert_eq!(inspect_file(file.to_str().unwrap()).unwrap(), expected);
            std::fs::remove_file(file).unwrap();
        }
        assert_eq!(
            inspect_file(root.to_str().unwrap()).unwrap(),
            FilePreview::Folder
        );
        assert!(inspect_file(root.join("missing.txt").to_str().unwrap()).is_err());
        assert!(inspect_file("relative.txt").is_err());
        std::fs::remove_dir(root).unwrap();
    }
}
