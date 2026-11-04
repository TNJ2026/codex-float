use base64::Engine;
use serde_json::{json, Value};
use std::{fs, path::Path};
use tauri::Manager;

pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_ATTACHMENTS: usize = 20;

#[derive(Clone, Debug, serde::Serialize)]
pub struct Attachment {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub image: bool,
}

fn inspect(path: &str) -> Result<Attachment, String> {
    let file = Path::new(path);
    if !file.is_absolute() || path.starts_with(r"\\") || path.starts_with("//") || path.contains('\0') {
        return Err("附件需要是本地文件的绝对路径".into());
    }
    let metadata = fs::metadata(file).map_err(|e| format!("无法读取附件 {path}：{e}"))?;
    if !metadata.is_file() { return Err("请添加文件，暂不支持文件夹".into()); }
    if metadata.len() > MAX_ATTACHMENT_BYTES { return Err("单个附件不能超过 25 MB".into()); }
    let name = file.file_name().and_then(|n| n.to_str()).ok_or("附件文件名无效")?.to_string();
    let extension = file.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase();
    Ok(Attachment { path: path.to_string(), name, size: metadata.len(), image: matches!(extension.as_str(), "png"|"jpg"|"jpeg"|"webp"|"gif"|"bmp"|"avif"|"ico") })
}

#[tauri::command]
pub fn inspect_attachments(paths: Vec<String>) -> Result<Vec<Attachment>, String> {
    if paths.len() > MAX_ATTACHMENTS { return Err("一次最多添加 20 个附件".into()); }
    paths.iter().map(|path| inspect(path)).collect()
}

#[tauri::command]
pub async fn pick_attachments(window: tauri::WebviewWindow) -> Result<Vec<Attachment>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = rfd::FileDialog::new().set_parent(&window).set_title("添加附件").pick_files().unwrap_or_default();
        inspect_attachments(paths.iter().map(|p| p.to_string_lossy().into_owned()).collect())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_attachment(app: tauri::AppHandle, name: String, data: String) -> Result<Attachment, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if data.len() as u64 > MAX_ATTACHMENT_BYTES.div_ceil(3) * 4 { return Err("单个附件不能超过 25 MB".into()); }
        let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| "附件数据无效")?;
        if bytes.len() as u64 > MAX_ATTACHMENT_BYTES { return Err("单个附件不能超过 25 MB".into()); }
        // A dedicated directory prevents collisions and preserves clipboard images after sending.
        let directory = app.path().app_data_dir().map_err(|e| e.to_string())?.join("attachments").join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let filename: String = name.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).take(180).collect();
        let filename = filename.trim_matches([' ', '.']);
        let path = directory.join(if filename.is_empty() { "attachment" } else { filename });
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        inspect(&path.to_string_lossy())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn clipboard_attachment_paths() -> Result<Vec<String>, String> {
    crate::platform::clipboard::file_paths()
}

pub fn prompt_parts(text: &str, paths: Vec<String>) -> Result<(Value, Value, Value), String> {
    let files = inspect_attachments(paths)?;
    if text.trim().is_empty() && files.is_empty() { return Err("请输入提示词或添加附件".into()); }
    let mut prompt = text.trim().to_string();
    let mut metadata = Vec::new();
    let mut images = Vec::new();
    let mut inputs = Vec::new();
    for file in &files {
        let path = file.path.replace('\\', "/");
        metadata.push(json!({"label":file.name,"path":path,"fsPath":path,"isImageAttachment":file.image}));
        if file.image {
            inputs.push(json!({"type":"localImage","path":file.path}));
            images.push(json!({"id":uuid::Uuid::new_v4().to_string(),"src":path,"localPath":path,"filename":file.name}));
        } else {
            let label = file.name.replace('\\', "\\\\").replace('[', "\\[").replace(']', "\\]");
            let target = path.replace('%', "%25").replace('<', "%3C").replace('>', "%3E").replace('\n', "%0A").replace('\r', "%0D");
            prompt.push_str(&format!("\n\n[附件：{label}](<{target}>)"));
        }
    }
    inputs.insert(0, json!({"type":"text","text":prompt,"text_elements":[]}));
    let file_attachments: Vec<_> = metadata.iter().filter(|file| file["isImageAttachment"] != true).cloned().collect();
    Ok((json!(inputs), json!(metadata), json!({"prompt":text,"addedFiles":[],"fileAttachments":file_attachments,"imageAttachments":images,"commentAttachments":[],"attachments":metadata})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachments_are_validated_and_images_are_inputs() {
        let directory = std::env::temp_dir().join(format!("codex-float-attachments-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let image = directory.join("截图.png");
        let document = directory.join("test [1].txt");
        fs::write(&image, b"image").unwrap();
        fs::write(&document, b"document").unwrap();
        let (input, metadata, context) = prompt_parts("检查附件", vec![image.to_string_lossy().into_owned(),document.to_string_lossy().into_owned()]).unwrap();
        assert_eq!(input[1]["type"], "localImage");
        assert!(input[0]["text"].as_str().unwrap().contains("附件：test \\[1\\].txt"));
        assert_eq!(metadata.as_array().unwrap().len(),2);
        assert_eq!(context["imageAttachments"].as_array().unwrap().len(),1);
        assert_eq!(context["fileAttachments"].as_array().unwrap().len(),1);
        assert!(prompt_parts("",vec![image.to_string_lossy().into_owned()]).is_ok());
        assert!(inspect_attachments(vec![directory.to_string_lossy().into_owned()]).is_err());
        assert!(inspect_attachments(vec!["relative.txt".into()]).is_err());
        assert!(inspect_attachments(vec!["/missing-attachment-file".into()]).is_err());
        assert!(prompt_parts("",vec![]).is_err());
        fs::remove_file(image).unwrap();
        fs::remove_file(document).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
