use crate::platform::process;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

struct UsageProcess(Child);
impl Drop for UsageProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
pub fn read_account_usage() -> Result<Value, String> {
    // Separate read-only app-server client; no chat, turn or prompt is created.
    let mut command = Command::new(process::codex_binary()?);
    process::configure(&mut command);
    let child = command
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动额度查询".to_string())?;
    let mut process = UsageProcess(child);
    let mut input = process.0.stdin.take().ok_or("无法打开额度查询输入")?;
    let output = process.0.stdout.take().ok_or("无法打开额度查询输出")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| -> Result<Value, String> {
            let send =
                |input: &mut std::process::ChildStdin, message: Value| -> Result<(), String> {
                    writeln!(input, "{message}")
                        .and_then(|_| input.flush())
                        .map_err(|_| "额度查询连接已断开".into())
                };
            send(
                &mut input,
                json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex_float_demo","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}),
            )?;
            for line in BufReader::new(output).lines() {
                let line = line.map_err(|_| "读取额度响应失败")?;
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if message["id"] != 1 && message["id"] != 2 {
                    continue;
                }
                if !message["error"].is_null() {
                    return Err("账号额度暂不可用，请确认 Codex 已登录".into());
                }
                if message["id"] == 1 {
                    send(&mut input, json!({"method":"initialized","params":{}}))?;
                    send(
                        &mut input,
                        json!({"id":2,"method":"account/rateLimits/read","params":{}}),
                    )?;
                } else {
                    let result = &message["result"];
                    return Ok(
                        json!({"rateLimits":result["rateLimits"],"rateLimitsByLimitId":result["rateLimitsByLimitId"]}),
                    );
                }
            }
            Err("额度查询连接已关闭".into())
        })();
        let _ = tx.send(result);
    });
    rx.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "读取账号额度超时，请点击重试".to_string())?
}

#[tauri::command]
pub async fn read_usage() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(read_account_usage)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "read-only live account request"]
    fn live_account_usage() {
        let value = super::read_account_usage().expect("account quota query");
        assert!(value["rateLimits"].is_object() || value["rateLimitsByLimitId"].is_object());
    }
}
