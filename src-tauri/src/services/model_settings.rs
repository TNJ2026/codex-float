use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Default)]
pub struct ModelSettingsState(Mutex<Option<(Instant, Vec<Value>)>>);
struct ModelProcess(Child);
impl Drop for ModelProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn read_models() -> Result<Vec<Value>, String> {
    let mut command = Command::new(crate::platform::process::codex_binary()?);
    crate::platform::process::configure(&mut command);
    let mut process = ModelProcess(
        command
            .args(["app-server", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?,
    );
    let mut input = process.0.stdin.take().ok_or("无法查询模型")?;
    let output = process.0.stdout.take().ok_or("无法读取模型列表")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| -> Result<Vec<Value>, String> {
            let send = |input: &mut std::process::ChildStdin, message: Value| {
                writeln!(input, "{message}")
                    .and_then(|_| input.flush())
                    .map_err(|e| e.to_string())
            };
            send(
                &mut input,
                json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex_float_models","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}),
            )?;
            let mut models = Vec::new();
            let mut id = 2;
            for line in BufReader::new(output).lines() {
                let Ok(message) = serde_json::from_str::<Value>(&line.map_err(|e| e.to_string())?)
                else {
                    continue;
                };
                if message["id"] != 1 && message["id"] != id {
                    continue;
                }
                if !message["error"].is_null() {
                    return Err("无法读取可用模型，请确认主 App 已登录后重试".into());
                }
                if message["id"] == 1 {
                    send(&mut input, json!({"method":"initialized","params":{}}))?;
                    send(
                        &mut input,
                        json!({"id":id,"method":"model/list","params":{"includeHidden":false,"limit":100}}),
                    )?;
                } else {
                    let data = message["result"]["data"]
                        .as_array()
                        .ok_or("模型列表格式无效")?;
                    for model in data.iter().filter(|model| model["hidden"] != true) {
                        let Some(name) = model["model"].as_str().filter(|name| !name.is_empty())
                        else {
                            continue;
                        };
                        if models.iter().any(|entry: &Value| entry["model"] == name) {
                            continue;
                        }
                        // Keep only picker metadata; model instructions are never returned to the UI.
                        models.push(json!({"model":name,"displayName":model["displayName"],"description":model["description"],"defaultReasoningEffort":model["defaultReasoningEffort"],"supportedReasoningEfforts":model["supportedReasoningEfforts"],"serviceTiers":model["serviceTiers"],"additionalSpeedTiers":model["additionalSpeedTiers"],"defaultServiceTier":model["defaultServiceTier"]}));
                    }
                    if let Some(cursor) = message["result"]["nextCursor"]
                        .as_str()
                        .filter(|cursor| !cursor.is_empty())
                    {
                        if id >= 10 {
                            return Err("模型列表分页过多，请重试".into());
                        }
                        id += 1;
                        send(
                            &mut input,
                            json!({"id":id,"method":"model/list","params":{"includeHidden":false,"limit":100,"cursor":cursor}}),
                        )?;
                    } else {
                        return if models.is_empty() {
                            Err("账号暂未返回可用模型，请刷新重试".into())
                        } else {
                            Ok(models)
                        };
                    }
                }
            }
            Err("模型查询连接已结束".into())
        })();
        let _ = tx.send(result);
    });
    rx.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "读取模型列表超时，请刷新重试".to_string())?
}
pub(super) fn model_catalog(app: &tauri::AppHandle, force: bool) -> Result<Vec<Value>, String> {
    let state = app.state::<ModelSettingsState>();
    if !force {
        if let Some((time, models)) = state.0.lock().map_err(|_| "模型缓存不可用")?.as_ref()
        {
            if time.elapsed() < Duration::from_secs(60) {
                return Ok(models.clone());
            }
        }
    }
    let models = read_models()?;
    *state.0.lock().map_err(|_| "模型缓存不可用")? = Some((Instant::now(), models.clone()));
    Ok(models)
}
fn validate_selection(models: &[Value], model: &str, effort: Option<&str>) -> Result<(), String> {
    let entry = models
        .iter()
        .find(|entry| entry["model"] == model)
        .ok_or("所选模型已不可用，请刷新模型列表")?;
    if let Some(effort) = effort {
        if !entry["supportedReasoningEfforts"]
            .as_array()
            .is_some_and(|options| {
                options
                    .iter()
                    .any(|option| option["reasoningEffort"] == effort)
            })
        {
            return Err("所选模型不支持该推理强度，请重新选择".into());
        }
    }
    Ok(())
}
fn settings_of(response: &Value) -> Result<Value, String> {
    let settings = &response["result"]["settings"];
    if settings["model"]
        .as_str()
        .filter(|model| !model.is_empty())
        .is_none()
    {
        return Err("当前聊天尚未提供模型设置，请重新同步聊天".into());
    }
    let mut result = json!({"model":settings["model"]});
    if let Some(effort) = settings.get("reasoningEffort") {
        result["reasoningEffort"] = effort.clone();
    }
    Ok(result)
}
fn update_params(
    thread_id: &str,
    model: &str,
    effort: Option<&str>,
    expected_model: &str,
    expected_effort: Option<&str>,
    current: &Value,
) -> Result<Value, String> {
    if current["model"] != expected_model || current["reasoningEffort"].as_str() != expected_effort
    {
        return Err("模型设置已在主窗口变化，请刷新后重试".into());
    }
    let mut params = json!({"conversationId":thread_id,"threadSettings":{"model":model,"effort":effort},"condition":{"ifModelEquals":expected_model}});
    if let Some(effort) = current.get("reasoningEffort") {
        params["condition"]["ifEffortEquals"] = effort.clone();
    }
    Ok(params)
}

#[tauri::command]
pub async fn read_model_options(
    app: tauri::AppHandle,
    thread_id: String,
    force_reload: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::codex::get_client(&app)?;
        let binding = client
            .binding
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .clone()
            .ok_or("请先连接聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，请重新打开模型设置".into());
        }
        let settings = settings_of(&client.rpc(
            "thread-follower-read-model-settings",
            json!({"conversationId":thread_id}),
            1,
            Some(&binding.1),
        )?)?;
        let models = model_catalog(&app, force_reload.unwrap_or(false))?;
        Ok(json!({"settings":settings,"models":models}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn update_model_settings(
    app: tauri::AppHandle,
    thread_id: String,
    model: String,
    effort: Option<String>,
    expected_model: String,
    expected_effort: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let models = model_catalog(&app, false)?;
        validate_selection(&models, &model, effort.as_deref())?;
        let client = crate::codex::get_client(&app)?;
        let binding = client
            .binding
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .clone()
            .ok_or("请先连接聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，未更新模型设置".into());
        }
        let current = settings_of(&client.rpc(
            "thread-follower-read-model-settings",
            json!({"conversationId":thread_id}),
            1,
            Some(&binding.1),
        )?)?;
        let params = update_params(
            &thread_id,
            &model,
            effort.as_deref(),
            &expected_model,
            expected_effort.as_deref(),
            &current,
        )?;
        let response = client.rpc(
            "thread-follower-update-thread-settings",
            params,
            2,
            Some(&binding.1),
        )?;
        if response["result"]["applied"] != true {
            return Err("设置未应用，主窗口可能已更新设置，请刷新重试".into());
        }
        let settings = settings_of(&client.rpc(
            "thread-follower-read-model-settings",
            json!({"conversationId":thread_id}),
            1,
            Some(&binding.1),
        )?)?;
        if settings["model"] != model
            || effort
                .as_deref()
                .is_some_and(|effort| settings["reasoningEffort"] != effort)
        {
            return Err("主窗口返回的模型设置与选择不一致，请刷新确认".into());
        }
        Ok(json!({"settings":settings}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supported_efforts_and_minimal_patch_are_validated() {
        let models = vec![
            json!({"model":"test-model","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"high"}]}),
        ];
        assert!(validate_selection(&models, "test-model", Some("high")).is_ok());
        assert!(validate_selection(&models, "test-model", None).is_ok());
        assert!(validate_selection(&models, "test-model", Some("ultra")).is_err());
        assert!(validate_selection(&models, "unknown", None).is_err());
        let current = json!({"model":"old","reasoningEffort":"low"});
        let params = update_params(
            "thread",
            "test-model",
            Some("high"),
            "old",
            Some("low"),
            &current,
        )
        .unwrap();
        assert_eq!(
            params["threadSettings"],
            json!({"model":"test-model","effort":"high"})
        );
        assert!(params.get("activeTurnId").is_none());
        assert_eq!(params["condition"]["ifModelEquals"], "old");
        assert!(
            update_params("thread", "test-model", None, "stale", Some("low"), &current).is_err()
        );
        assert!(update_params("thread", "test-model", None, "old", None, &current).is_err());
        let absent = update_params(
            "thread",
            "test-model",
            None,
            "old",
            None,
            &json!({"model":"old"}),
        )
        .unwrap();
        assert!(absent["condition"].get("ifEffortEquals").is_none());
        let default = update_params(
            "thread",
            "test-model",
            None,
            "old",
            None,
            &json!({"model":"old","reasoningEffort":null}),
        )
        .unwrap();
        assert_eq!(
            default["condition"].get("ifEffortEquals"),
            Some(&Value::Null)
        );
    }
    #[test]
    #[ignore = "read-only account model catalog integration check"]
    fn live_model_catalog() {
        let models = read_models().unwrap();
        println!("available models: {}", models.len());
        assert!(!models.is_empty());
        assert!(models.iter().any(|model| model["supportedReasoningEfforts"]
            .as_array()
            .is_some_and(|efforts| !efforts.is_empty())));
    }
}
