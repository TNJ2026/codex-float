pub fn file_paths() -> Result<Vec<String>, String> {
    // JXA reads Finder's file URLs without changing the clipboard or activating an app.
    let output = std::process::Command::new("/usr/bin/osascript").args(["-l", "JavaScript", "-e", "ObjC.import('AppKit'); var urls = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions([$.NSURL], $()); var paths = []; if (urls) { for (var i = 0; i < urls.count; i++) { var url = urls.objectAtIndex(i); if (url.isFileURL) paths.push(ObjC.unwrap(url.path)); } } JSON.stringify(paths);"]).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("无法读取剪贴板文件".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}
pub fn write_text(text: &str, _owner: isize) -> Result<(), String> {
    use std::io::Write;
    let mut child = std::process::Command::new("/usr/bin/pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    child
        .stdin
        .take()
        .ok_or("无法打开剪贴板")?
        .write_all(text.as_bytes())
        .map_err(|error| error.to_string())?;
    if !child.wait().map_err(|error| error.to_string())?.success() {
        return Err("无法写入剪贴板".into());
    }
    Ok(())
}
