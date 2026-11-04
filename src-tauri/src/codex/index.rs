use serde_json::{json, Value};
use std::collections::HashMap;

pub(crate) fn indexed_threads(limit: usize) -> Result<Vec<Value>, String> {
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
    threads.truncate(limit);
    let desktop: Value = std::fs::read_to_string(home.join(".codex-global-state.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    super::projects::enrich_threads(&mut threads, &desktop, &home);
    Ok(threads)
}

#[tauri::command]
pub fn list_threads() -> Result<Value, String> {
    let home = super::paths::codex_home()?;
    let threads = indexed_threads(60)?;
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
