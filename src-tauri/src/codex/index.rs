use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

fn is_internal_source(source: &str) -> bool {
    source == "subagent"
        || serde_json::from_str::<Value>(source)
            .ok()
            .is_some_and(|value| value.get("subagent").is_some())
}

fn internal_thread_ids(home: &Path) -> rusqlite::Result<HashSet<String>> {
    let db = Connection::open_with_flags(
        home.join("state_5.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    db.busy_timeout(std::time::Duration::from_millis(200))?;
    let mut query = db.prepare("SELECT id, source FROM threads")?;
    let rows = query.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut internal = HashSet::new();
    for row in rows {
        let (id, source) = row?;
        if is_internal_source(&source) {
            internal.insert(id);
        }
    }
    Ok(internal)
}

pub(crate) fn indexed_threads(limit: usize) -> Result<Vec<Value>, String> {
    let home = super::paths::codex_home()?;
    read_indexed_threads(&home, limit)
}

fn read_indexed_threads(home: &Path, limit: usize) -> Result<Vec<Value>, String> {
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
    // The session index includes internal reviews and spawned agents that are not
    // user chats. Filter by source, never by the user-editable title, before limiting.
    // Keep the legacy index available if the desktop database cannot be read.
    if let Ok(internal) = internal_thread_ids(home) {
        threads.retain(|thread| {
            !thread["id"]
                .as_str()
                .is_some_and(|id| internal.contains(id))
        });
    }
    threads.sort_by(|a, b| b["updated_at"].as_str().cmp(&a["updated_at"].as_str()));
    threads.truncate(limit);
    let desktop: Value = std::fs::read_to_string(home.join(".codex-global-state.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    super::projects::enrich_threads(&mut threads, &desktop, home);
    Ok(threads)
}

#[tauri::command]
pub async fn list_threads() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(read_threads)
        .await
        .map_err(|error| error.to_string())?
}

fn read_threads() -> Result<Value, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_sources_are_identified_without_using_titles() {
        for source in [
            "subagent",
            r#"{"subagent":{"other":"guardian"}}"#,
            r#"{"subagent":"review"}"#,
            r#"{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}"#,
        ] {
            assert!(is_internal_source(source), "{source}");
        }
        for source in ["cli", "exec", "vscode", "unknown", "", "invalid json"] {
            assert!(!is_internal_source(source), "{source}");
        }
    }

    #[test]
    fn picker_and_context_index_exclude_internal_threads_before_applying_limit() {
        let home = std::env::temp_dir().join(format!("codex-float-index-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).unwrap();
        let db_path = home.join("state_5.sqlite");
        {
            let db = Connection::open(&db_path).unwrap();
            db.execute_batch("CREATE TABLE threads(id TEXT, source TEXT);")
                .unwrap();
            for (id, source) in [
                ("guardian", r#"{"subagent":{"other":"guardian"}}"#),
                ("spawn", r#"{"subagent":{"thread_spawn":{}}}"#),
                ("named", "cli"),
                ("normal", "vscode"),
            ] {
                db.execute("INSERT INTO threads VALUES(?1, ?2)", [id, source])
                    .unwrap();
            }
        }
        let entries = [
            json!({"id":"normal","thread_name":"Chat","updated_at":"2026-01-01"}),
            json!({"id":"named","thread_name":"Guardian review","updated_at":"2026-01-02"}),
            json!({"id":"spawn","thread_name":"Agent","updated_at":"2026-01-03"}),
            json!({"id":"guardian","thread_name":"Guardian review","updated_at":"2026-01-04"}),
        ];
        std::fs::write(
            home.join("session_index.jsonl"),
            entries
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let before = std::fs::read(&db_path).unwrap();
        for limit in [2, usize::MAX] {
            let threads = read_indexed_threads(&home, limit).unwrap();
            assert_eq!(
                threads
                    .iter()
                    .map(|t| t["id"].as_str().unwrap())
                    .collect::<Vec<_>>(),
                ["named", "normal"]
            );
        }
        assert_eq!(read_indexed_threads(&home, 1).unwrap()[0]["id"], "named");
        assert_eq!(std::fs::read(&db_path).unwrap(), before);

        // Missing databases preserve the old index path and are never created.
        std::fs::remove_file(&db_path).unwrap();
        assert_eq!(read_indexed_threads(&home, usize::MAX).unwrap().len(), 4);
        assert!(!db_path.exists());
        std::fs::remove_dir_all(home).unwrap();
    }
}
