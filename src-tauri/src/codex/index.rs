use serde_json::{json, Value};
use std::collections::HashMap;

#[tauri::command]
pub fn list_threads() -> Result<Value, String> {
    let home = super::paths::codex_home()?;
    let content = std::fs::read_to_string(home.join("session_index.jsonl")).unwrap_or_default();
    let mut found = HashMap::new();
    for line in content.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            if let Some(id) = v["id"].as_str() {
                found.insert(id.to_string(), v);
            }
        }
    }
    let mut threads: Vec<Value> = found.into_values().collect();
    threads.sort_by(|a, b| b["updated_at"].as_str().cmp(&a["updated_at"].as_str()));
    threads.truncate(60);
    let desktop: Value = std::fs::read_to_string(home.join(".codex-global-state.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    for thread in &mut threads {
        let id = thread["id"].as_str().unwrap_or_default().to_string();
        let projectless = desktop["projectless-thread-ids"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|v| v.as_str() == Some(&id)));
        if projectless {
            continue;
        }
        let assignment = &desktop["thread-project-assignments"][&id];
        if assignment["projectKind"] != "local" {
            continue;
        }
        if let Some(project_id) = assignment["projectId"].as_str() {
            let project = &desktop["local-projects"][project_id];
            if let Some(name) = project["name"].as_str() {
                let order = desktop["project-order"]
                    .as_array()
                    .and_then(|ids| ids.iter().position(|v| v.as_str() == Some(project_id)))
                    .unwrap_or(usize::MAX);
                thread["project_id"] = json!(project_id);
                thread["project_name"] = json!(name);
                thread["project_order"] = json!(order);
            }
        }
    }
    let model_cache: Value = std::fs::read_to_string(home.join("models_cache.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let mut model_names = serde_json::Map::new();
    if let Some(models) = model_cache["models"].as_array() {
        for model in models {
            if let (Some(slug), Some(name)) =
                (model["slug"].as_str(), model["display_name"].as_str())
            {
                model_names.insert(slug.to_string(), json!(name));
            }
        }
    }
    Ok(
        json!({"threads":threads,"currentThread":std::env::var("CODEX_THREAD_ID").ok(),"modelNames":model_names}),
    )
}
