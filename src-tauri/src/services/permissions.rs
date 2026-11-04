use serde_json::{json, Value};

// Snapshot fields contain both representations; the update API accepts only one.
pub(super) fn wire_patch(mut patch: Value) -> Value {
    if patch
        .get("sandboxPolicy")
        .is_some_and(|value| !value.is_null())
    {
        if let Some(fields) = patch.as_object_mut() {
            fields.remove("permissions");
        }
    } else if patch.get("permissions").is_none_or(Value::is_null) {
        if let Some(profile) = patch["activePermissionProfile"]["id"].as_str() {
            patch["permissions"] = json!(profile);
        }
    }
    if let Some(fields) = patch.as_object_mut() {
        fields.remove("activePermissionProfile");
    }
    patch
}

fn permission_patch(preset: &str, cwd: Option<&str>) -> Result<Value, String> {
    let (profile, approval, sandbox) = match preset {
        "read-only" => (
            ":read-only",
            "on-request",
            json!({"type":"readOnly","networkAccess":false}),
        ),
        "auto" => {
            let root = cwd
                .filter(|path| !path.is_empty())
                .ok_or("当前聊天缺少工作目录，无法设置默认权限")?;
            if !std::path::Path::new(root).is_absolute() || !std::path::Path::new(root).is_dir() {
                return Err("聊天工作目录不可用，请先在主窗口确认目录".into());
            }
            (
                ":workspace",
                "on-request",
                json!({"type":"workspaceWrite","writableRoots":[root],"networkAccess":false,"excludeSlashTmp":false,"excludeTmpdirEnvVar":false}),
            )
        }
        "full-access" => (
            ":danger-full-access",
            "never",
            json!({"type":"dangerFullAccess"}),
        ),
        _ => return Err("不支持的权限选项".into()),
    };
    Ok(
        json!({"approvalPolicy":approval,"approvalsReviewer":"user","permissions":profile,"activePermissionProfile":{"id":profile,"extends":null},"sandboxPolicy":sandbox}),
    )
}

#[tauri::command]
pub async fn update_permission_settings(
    app: tauri::AppHandle,
    thread_id: String,
    preset: String,
    cwd: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let patch = permission_patch(&preset, cwd.as_deref())?;
        let client = crate::codex::get_client(&app)?;
        let binding = client
            .binding
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .clone()
            .ok_or("请先连接聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，未更新权限".into());
        }
        let response = client.rpc(
            "thread-follower-update-thread-settings",
            json!({"conversationId":thread_id,"threadSettings":wire_patch(patch.clone())}),
            2,
            Some(&binding.1),
        )?;
        if response["result"]["applied"] != true {
            return Err("权限未应用，请刷新后重试".into());
        }
        Ok(json!({"threadSettings":patch}))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wire_permissions_are_mutually_exclusive_and_keep_exact_policy() {
        let policy = json!({"type":"workspaceWrite","writableRoots":["D:/repo","D:/extra"],"networkAccess":false});
        let wire = wire_patch(
            json!({"model":"test","approvalPolicy":"on-request","permissions":":workspace","activePermissionProfile":{"id":":workspace"},"sandboxPolicy":policy}),
        );
        assert_eq!(wire["sandboxPolicy"], policy);
        assert_eq!(wire["approvalPolicy"], "on-request");
        assert_eq!(wire["model"], "test");
        assert!(wire.get("permissions").is_none());
        assert!(wire.get("activePermissionProfile").is_none());
        let wire = wire_patch(json!({"activePermissionProfile":{"id":"custom-profile"}}));
        assert_eq!(wire["permissions"], "custom-profile");
        assert!(wire.get("sandboxPolicy").is_none());
        assert!(wire.get("activePermissionProfile").is_none());
    }
    #[test]
    fn permission_presets_only_patch_permissions() {
        let full = permission_patch("full-access", None).unwrap();
        assert_eq!(full["approvalPolicy"], "never");
        assert_eq!(full["sandboxPolicy"]["type"], "dangerFullAccess");
        assert!(full.get("model").is_none());
        assert!(full.get("activeTurnId").is_none());
        let read = permission_patch("read-only", None).unwrap();
        assert_eq!(read["approvalPolicy"], "on-request");
        assert_eq!(read["permissions"], ":read-only");
        assert!(permission_patch("auto", None).is_err());
        assert!(permission_patch("invalid", None).is_err());
        let dir = std::env::current_dir().unwrap();
        let default = permission_patch("auto", dir.to_str()).unwrap();
        assert_eq!(default["sandboxPolicy"]["writableRoots"], json!([dir]));
        assert_eq!(default["sandboxPolicy"]["networkAccess"], false);
    }
}
