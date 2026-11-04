use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Default)]
pub struct ForkState(Mutex<HashMap<String, (String, String, Option<Result<Value, String>>)>>);
struct ForkProcess(Child);
impl Drop for ForkProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
struct Rpc {
    _child: ForkProcess,
    input: ChildStdin,
    rx: mpsc::Receiver<Value>,
    id: u64,
}
impl Rpc {
    fn open() -> Result<Self, String> {
        let mut command = Command::new(crate::platform::process::codex_binary()?);
        crate::platform::process::configure(&mut command);
        let mut child = ForkProcess(
            command
                .args(["app-server", "--stdio"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?,
        );
        let input = child.0.stdin.take().ok_or("分叉连接不可用")?;
        let output = child.0.stdout.take().ok_or("分叉连接不可用")?;
        let (tx, rx) = mpsc::sync_channel(8);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = String::new();
                let Ok(n) = std::io::Read::by_ref(&mut reader)
                    .take(16_000_001)
                    .read_line(&mut line)
                else {
                    break;
                };
                if n == 0 || n > 16_000_000 {
                    break;
                }
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if v.get("id").is_some() && tx.send(v).is_err() {
                        break;
                    }
                }
            }
        });
        let mut rpc = Self {
            _child: child,
            input,
            rx,
            id: 0,
        };
        rpc.request("initialize",json!({"clientInfo":{"name":"codex_float_fork","version":"0.1.0"},"capabilities":{"experimentalApi":true}}),15)?;
        writeln!(rpc.input, "{}", json!({"method":"initialized","params":{}}))
            .and_then(|_| rpc.input.flush())
            .map_err(|e| e.to_string())?;
        Ok(rpc)
    }
    fn request(&mut self, method: &str, params: Value, seconds: u64) -> Result<Value, String> {
        self.id += 1;
        let id = self.id;
        writeln!(
            self.input,
            "{}",
            json!({"id":id,"method":method,"params":params})
        )
        .and_then(|_| self.input.flush())
        .map_err(|error| {
            if method == "thread/fork" {
                format!("分叉结果尚未确认，请先检查主 App 会话列表，避免重复创建：{error}")
            } else {
                error.to_string()
            }
        })?;
        let deadline = Instant::now() + Duration::from_secs(seconds);
        loop {
            let response = self
                .rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| {
                    if method == "thread/fork" {
                        "分叉结果尚未确认，请先检查主 App 会话列表，避免重复创建".to_owned()
                    } else {
                        "分叉连接超时，请重新连接后重试".to_owned()
                    }
                })?;
            if response["id"] != id {
                continue;
            }
            if !response["error"].is_null() {
                return Err(response["error"]["message"]
                    .as_str()
                    .unwrap_or("分叉请求失败")
                    .into());
            }
            return Ok(response["result"].clone());
        }
    }
}
fn validate(thread: &str, turn: &str, request: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(thread).map_err(|_| "聊天 ID 无效")?;
    uuid::Uuid::parse_str(request).map_err(|_| "分叉请求 ID 无效")?;
    if turn.trim().is_empty() || turn.len() > 256 || turn.chars().any(char::is_control) {
        return Err("消息轮次无效".into());
    }
    Ok(())
}
fn fork_params(thread: &str, turn: &str, settings: &Value) -> Result<Value, String> {
    let mut params = json!({"threadId":thread,"lastTurnId":turn,"excludeTurns":true,"deferGoalContinuation":true});
    for key in [
        "model",
        "cwd",
        "approvalPolicy",
        "approvalsReviewer",
        "serviceTier",
    ] {
        if let Some(value) = settings.get(key).filter(|v| !v.is_null()) {
            params[key] = value.clone();
        }
    }
    if let Some(effort) = settings["reasoningEffort"].as_str() {
        params["config"] = json!({"model_reasoning_effort":effort});
    }
    let profile = settings["permissions"]
        .as_str()
        .or_else(|| settings["activePermissionProfile"]["id"].as_str());
    if let Some(profile) = profile {
        params["permissions"] = json!(profile);
    } else {
        let sandbox = match settings["sandboxPolicy"]["type"].as_str() {
            Some("readOnly") => "read-only",
            Some("workspaceWrite") => "workspace-write",
            Some("dangerFullAccess") => "danger-full-access",
            _ => return Err("无法读取当前权限，请同步聊天后再分叉".into()),
        };
        params["sandbox"] = json!(sandbox);
    }
    if settings["approvalPolicy"].is_null() {
        return Err("无法读取当前审批设置，请同步聊天后再分叉".into());
    }
    Ok(params)
}
fn ensure_turn(rpc: &mut Rpc, thread: &str, turn: &str) -> Result<(), String> {
    let mut cursor = Value::Null;
    for _ in 0..200 {
        let result=rpc.request("thread/turns/list",json!({"threadId":thread,"limit":100,"sortDirection":"desc","itemsView":"summary","cursor":cursor}),20)?;
        let entries = result["data"].as_array().ok_or("无法读取聊天轮次")?;
        if let Some(found) = entries
            .iter()
            .find(|entry| entry["id"] == turn || entry["turnId"] == turn)
        {
            return if found["status"] == "completed" {
                Ok(())
            } else {
                Err("只能从已完成的轮次分叉".into())
            };
        }
        cursor = result["nextCursor"].clone();
        if cursor.is_null() {
            return Err("消息轮次已变化或尚未保存，请同步后重试".into());
        }
    }
    Err("聊天历史过长，无法定位分叉位置".into())
}
fn create_fork(thread: &str, turn: &str, name: &str, settings: Value) -> Result<Value, String> {
    let params = fork_params(thread, turn, &settings)?;
    let patch = restore_patch(&settings)?;
    let mut rpc = Rpc::open()?;
    ensure_turn(&mut rpc, thread, turn)?;
    let response = rpc.request("thread/fork", params, 60)?;
    let child = response["thread"]["id"]
        .as_str()
        .filter(|id| uuid::Uuid::parse_str(id).is_ok() && *id != thread)
        .ok_or("分叉结果尚未确认，请检查主 App 会话列表，避免重复创建")?
        .to_owned();
    let mut warnings = Vec::new();
    if let Err(error) = rpc.request("thread/name/set", json!({"threadId":child,"name":name}), 10) {
        warnings.push(format!("分叉已创建，名称未设置：{error}"));
    }
    if let Err(error) = rpc.request("thread/unload", json!({"threadId":child}), 10) {
        warnings.push(format!("分叉已创建，释放连接未确认：{error}"));
    }
    Ok(json!({"threadId":child,"name":name,"warnings":warnings,"threadSettings":patch}))
}
fn restore_patch(settings: &Value) -> Result<Value, String> {
    let model = settings["model"].as_str().ok_or("当前模型设置不可用")?;
    let mut patch = json!({"model":model,"effort":settings["reasoningEffort"]});
    for key in [
        "approvalPolicy",
        "approvalsReviewer",
        "sandboxPolicy",
        "permissions",
        "activePermissionProfile",
        "serviceTier",
    ] {
        if let Some(value) = settings.get(key).filter(|value| !value.is_null()) {
            patch[key] = value.clone();
        }
    }
    let mode = if settings["collaborationMode"]["mode"] == "plan" {
        "plan"
    } else {
        "default"
    };
    patch["collaborationMode"] = json!({"mode":mode,"settings":{"model":model,"reasoning_effort":settings["reasoningEffort"],"developer_instructions":settings["collaborationMode"]["settings"]["developer_instructions"]}});
    Ok(patch)
}
#[tauri::command]
pub async fn fork_message(
    app: tauri::AppHandle,
    thread_id: String,
    turn_id: String,
    request_id: String,
    name: String,
    settings: Value,
) -> Result<Value, String> {
    validate(&thread_id, &turn_id, &request_id)?;
    if !settings.is_object() {
        return Err("当前聊天设置无效".into());
    }
    if name.trim().is_empty() || name.len() > 500 {
        return Err("分叉名称不能为空或超过 500 字节".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::codex::get_client(&app)?;
        let binding = client
            .binding
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .clone()
            .ok_or("请先连接聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，未创建分叉".into());
        }
        let state = app.state::<ForkState>();
        {
            let mut requests = state.0.lock().map_err(|_| "分叉状态不可用")?;
            if let Some((thread, turn, result)) = requests.get(&request_id) {
                if *thread != thread_id || *turn != turn_id {
                    return Err("分叉请求与消息不匹配".into());
                }
                return result
                    .clone()
                    .unwrap_or_else(|| Err("分叉正在创建，请稍候".into()));
            }
            if requests.len() >= 128 {
                requests.retain(|_, (_, _, result)| result.is_none());
            }
            requests.insert(
                request_id.clone(),
                (thread_id.clone(), turn_id.clone(), None),
            );
        }
        let result = (|| {
            let verified = client.rpc(
                "thread-follower-read-model-settings",
                json!({"conversationId":thread_id}),
                1,
                Some(&binding.1),
            )?;
            let mut settings = settings;
            let model = verified["result"]["settings"]["model"]
                .as_str()
                .ok_or("当前模型设置不可用")?;
            settings["model"] = json!(model);
            settings["reasoningEffort"] = verified["result"]["settings"]["reasoningEffort"].clone();
            create_fork(&thread_id, &turn_id, name.trim(), settings)
        })();
        if let Ok(mut requests) = state.0.lock() {
            if result.is_ok()
                || result
                    .as_ref()
                    .is_err_and(|error| error.contains("分叉结果尚未确认"))
            {
                requests.insert(request_id, (thread_id, turn_id, Some(result.clone())));
            } else {
                requests.remove(&request_id);
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn restore_fork_settings(
    app: tauri::AppHandle,
    thread_id: String,
    request_id: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ForkState>();
        let patch = {
            let requests = state.0.lock().map_err(|_| "分叉状态不可用")?;
            let (_, _, result) = requests
                .get(&request_id)
                .ok_or("分叉记录不可用，请在主 App 检查设置")?;
            let result = result
                .as_ref()
                .and_then(|result| result.as_ref().ok())
                .ok_or("分叉尚未创建")?;
            if result["threadId"] != thread_id {
                return Err("分叉聊天不匹配".into());
            }
            result["threadSettings"].clone()
        };
        let client = crate::codex::get_client(&app)?;
        let binding = client
            .binding
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .clone()
            .ok_or("请先连接分叉聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，未还原分叉设置".into());
        }
        let result = client.rpc(
            "thread-follower-update-thread-settings",
            json!({"conversationId":thread_id,"threadSettings":super::permissions::wire_patch(patch.clone())}),
            2,
            Some(&binding.1),
        )?;
        if result["result"]["applied"] != true {
            return Err("分叉已创建，但设置未还原，请重新连接或在主 App 检查".into());
        }
        Ok(json!({"threadSettings":patch}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "live ephemeral fork only; no stored conversation or model turn is created"]
    fn live_ephemeral_fork() {
        let source = std::env::var("CODEX_THREAD_ID").expect("source thread");
        let mut rpc = Rpc::open().unwrap();
        let before = rpc
            .request(
                "thread/turns/list",
                json!({"threadId":source,"limit":50,"sortDirection":"desc","itemsView":"summary"}),
                20,
            )
            .unwrap();
        let turn = before["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|turn| turn["status"] == "completed")
            .and_then(|turn| turn["id"].as_str())
            .expect("completed turn")
            .to_owned();
        ensure_turn(&mut rpc, &source, &turn).unwrap();
        let goal = rpc
            .request("thread/goal/get", json!({"threadId":source}), 15)
            .unwrap();
        assert_ne!(goal["goal"]["status"], "active");
        let result=rpc.request("thread/fork",json!({"threadId":source,"lastTurnId":turn,"ephemeral":true,"excludeTurns":true,"permissions":":read-only","approvalPolicy":"never"}),60).unwrap();
        let child = result["thread"]["id"].as_str().unwrap();
        assert_ne!(child, source);
        assert_eq!(result["thread"]["ephemeral"], true);
        assert_eq!(result["thread"]["forkedFromId"], source);
        let after = rpc
            .request(
                "thread/turns/list",
                json!({"threadId":source,"limit":50,"sortDirection":"desc","itemsView":"summary"}),
                20,
            )
            .unwrap();
        assert_eq!(
            before["data"]
                .as_array()
                .unwrap()
                .iter()
                .map(|turn| turn["id"].clone())
                .collect::<Vec<_>>(),
            after["data"]
                .as_array()
                .unwrap()
                .iter()
                .map(|turn| turn["id"].clone())
                .collect::<Vec<_>>()
        );
    }
    #[test]
    fn fork_is_persisted_and_bounded_without_escalating_permissions() {
        let p=fork_params("thread","turn",&json!({"model":"test","reasoningEffort":"high","approvalPolicy":"on-request","sandboxPolicy":{"type":"readOnly"}})).unwrap();
        assert_eq!(p["lastTurnId"], "turn");
        assert_eq!(p["sandbox"], "read-only");
        assert_eq!(p["approvalPolicy"], "on-request");
        assert_eq!(p["deferGoalContinuation"], true);
        assert!(p.get("ephemeral").is_none());
        assert!(p.get("beforeTurnId").is_none());
        assert!(fork_params("t", "turn", &json!({})).is_err());
        let p = fork_params(
            "thread",
            "turn",
            &json!({"permissions":":workspace","approvalPolicy":"on-request"}),
        )
        .unwrap();
        assert_eq!(p["permissions"], ":workspace");
        assert!(p.get("sandbox").is_none());
        let source = json!({"model":"test","reasoningEffort":"high","approvalPolicy":"on-request","sandboxPolicy":{"type":"workspaceWrite","networkAccess":false,"writableRoots":["D:/repo"]},"collaborationMode":{"mode":"plan"}});
        let patch = restore_patch(&source).unwrap();
        assert_eq!(patch["sandboxPolicy"], source["sandboxPolicy"]);
        assert_eq!(patch["collaborationMode"]["mode"], "plan");
        assert_eq!(patch["effort"], "high");
        let source = json!({"model":"test","permissions":":workspace","activePermissionProfile":{"id":":workspace"},"sandboxPolicy":{"type":"workspaceWrite","writableRoots":["D:/repo"],"networkAccess":false},"collaborationMode":{"mode":"plan"}});
        let patch = super::super::permissions::wire_patch(restore_patch(&source).unwrap());
        assert!(patch.get("permissions").is_none());
        assert!(patch.get("activePermissionProfile").is_none());
        assert_eq!(patch["sandboxPolicy"], source["sandboxPolicy"]);
        assert_eq!(patch["collaborationMode"]["mode"], "plan");
    }
}
