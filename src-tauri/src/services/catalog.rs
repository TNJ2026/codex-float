use super::context::ContextItem;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

struct CatalogProcess(Child);
impl Drop for CatalogProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn read_catalog(cwd: String) -> Result<Value, String> {
    if !cwd.is_empty() {
        super::context::local_path(&cwd)?;
    }
    let mut command = Command::new(crate::platform::process::codex_binary()?);
    crate::platform::process::configure(&mut command);
    let mut process = CatalogProcess(
        command
            .args(["app-server", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?,
    );
    let mut input = process.0.stdin.take().ok_or("无法查询技能和插件")?;
    let output = process.0.stdout.take().ok_or("无法读取技能和插件")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| -> Result<Value, String> {
            let send = |input: &mut std::process::ChildStdin, value: Value| {
                writeln!(input, "{value}")
                    .and_then(|_| input.flush())
                    .map_err(|e| e.to_string())
            };
            send(
                &mut input,
                json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex_float_context","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}),
            )?;
            let mut skills = Vec::new();
            let mut plugins = Vec::new();
            let mut warnings = Vec::new();
            let mut received = 0;
            for line in BufReader::new(output).lines() {
                let Ok(message) = serde_json::from_str::<Value>(&line.map_err(|e| e.to_string())?)
                else {
                    continue;
                };
                if message["id"] == 1 {
                    if !message["error"].is_null() {
                        return Err("无法初始化技能查询".into());
                    }
                    send(&mut input, json!({"method":"initialized","params":{}}))?;
                    let cwds: Vec<_> = if cwd.is_empty() {
                        vec![]
                    } else {
                        vec![cwd.clone()]
                    };
                    send(
                        &mut input,
                        json!({"id":2,"method":"skills/list","params":{"cwds":cwds,"forceReload":false}}),
                    )?;
                    send(
                        &mut input,
                        json!({"id":3,"method":"plugin/installed","params":{"cwds":cwds}}),
                    )?;
                } else if message["id"] == 2 {
                    received += 1;
                    if let Some(entries) = message["result"]["data"].as_array() {
                        for entry in entries {
                            if let Some(list) = entry["skills"].as_array() {
                                for skill in list {
                                    if skill["enabled"] == false {
                                        continue;
                                    }
                                    let name = skill["name"].as_str().unwrap_or("");
                                    let path = skill["path"].as_str().unwrap_or("");
                                    if name.is_empty() || path.is_empty() {
                                        continue;
                                    }
                                    if !skills.iter().any(|item: &ContextItem| item.path == path) {
                                        skills.push(ContextItem {
                                            kind: "skill".into(),
                                            label: name.into(),
                                            path: path.into(),
                                            description: skill["interface"]["shortDescription"]
                                                .as_str()
                                                .or_else(|| skill["shortDescription"].as_str())
                                                .or_else(|| skill["description"].as_str())
                                                .unwrap_or("")
                                                .into(),
                                            source: skill["pluginId"]
                                                .as_str()
                                                .unwrap_or("本地技能")
                                                .into(),
                                            ..Default::default()
                                        });
                                    }
                                }
                            }
                            if let Some(errors) = entry["errors"].as_array() {
                                if !errors.is_empty() {
                                    warnings.push("部分技能无法读取".to_string());
                                }
                            }
                        }
                    } else {
                        warnings.push("技能列表暂不可用".into());
                    }
                } else if message["id"] == 3 {
                    received += 1;
                    if let Some(markets) = message["result"]["marketplaces"].as_array() {
                        for market in markets {
                            if let Some(list) = market["plugins"].as_array() {
                                for plugin in list {
                                    if plugin["installed"] != true || plugin["enabled"] != true {
                                        continue;
                                    }
                                    let id = plugin["id"].as_str().unwrap_or("");
                                    if id.is_empty() {
                                        continue;
                                    }
                                    plugins.push(ContextItem {
                                        kind: "plugin".into(),
                                        label: plugin["interface"]["displayName"]
                                            .as_str()
                                            .or_else(|| plugin["name"].as_str())
                                            .unwrap_or(id)
                                            .into(),
                                        path: format!("plugin://{id}"),
                                        description: plugin["interface"]["shortDescription"]
                                            .as_str()
                                            .unwrap_or("")
                                            .into(),
                                        source: market["name"]
                                            .as_str()
                                            .unwrap_or("已安装插件")
                                            .into(),
                                        ..Default::default()
                                    });
                                }
                            }
                        }
                    } else {
                        warnings.push("插件列表暂不可用".into());
                    }
                }
                if received == 2 {
                    skills.sort_by(|a, b| a.label.cmp(&b.label));
                    plugins.sort_by(|a, b| a.label.cmp(&b.label));
                    return Ok(json!({"skills":skills,"plugins":plugins,"warnings":warnings}));
                }
            }
            Err("技能查询连接已结束".into())
        })();
        let _ = tx.send(result);
    });
    rx.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "查询技能和插件超时，请刷新".to_string())?
}
#[tauri::command]
pub async fn context_catalog(cwd: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_catalog(cwd))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "read-only installed catalog integration check"]
    fn live_context_catalog() {
        let result = super::read_catalog(
            std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
        )
        .unwrap();
        assert!(!result["skills"].as_array().unwrap().is_empty());
        assert!(!result["plugins"].as_array().unwrap().is_empty());
        println!(
            "skills: {}, plugins: {}",
            result["skills"].as_array().unwrap().len(),
            result["plugins"].as_array().unwrap().len()
        );
    }
}
