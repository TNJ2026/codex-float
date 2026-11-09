use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(crate) struct Client {
    writer: tokio::sync::mpsc::UnboundedSender<Value>,
    pending: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    id: Mutex<String>,
    pub(crate) binding: Mutex<Option<(String, String)>>,
    snapshots: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    alive: std::sync::atomic::AtomicBool,
}
impl Client {
    fn open(app: tauri::AppHandle) -> Result<Arc<Self>, String> {
        let (outgoing, mut outgoing_rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
        let (ready_tx, ready_rx) = mpsc::channel();
        let client = Arc::new(Self {
            writer: outgoing,
            pending: Mutex::new(HashMap::new()),
            id: Mutex::new("initializing-client".into()),
            binding: Mutex::new(None),
            snapshots: Mutex::new(HashMap::new()),
            alive: std::sync::atomic::AtomicBool::new(true),
        });
        let c = client.clone();
        tauri::async_runtime::spawn(async move {
            let pipe = match crate::platform::transport::connect().await {
                Ok(pipe) => pipe,
                Err(error) => {
                    let _ = ready_tx.send(Err(format!("无法连接 Codex，请先打开桌面端：{error}")));
                    return;
                }
            };
            let (mut reader, mut writer) = tokio::io::split(pipe);
            let writer_task = tauri::async_runtime::spawn(async move {
                while let Some(message) = outgoing_rx.recv().await {
                    let Ok(data) = serde_json::to_vec(&message) else {
                        break;
                    };
                    if writer
                        .write_all(&(data.len() as u32).to_le_bytes())
                        .await
                        .is_err()
                        || writer.write_all(&data).await.is_err()
                    {
                        break;
                    }
                }
            });
            let _ = ready_tx.send(Ok::<(), String>(()));
            loop {
                let mut header = [0; 4];
                if reader.read_exact(&mut header).await.is_err() {
                    break;
                }
                let size = u32::from_le_bytes(header) as usize;
                if size == 0 || size > 64 * 1024 * 1024 {
                    break;
                }
                let mut data = vec![0; size];
                if reader.read_exact(&mut data).await.is_err() {
                    break;
                }
                let Ok(msg) = serde_json::from_slice::<Value>(&data) else {
                    break;
                };
                match msg["type"].as_str() {
                    Some("response") => {
                        if let Some(id) = msg["requestId"].as_str() {
                            if let Some(tx) = c.pending.lock().unwrap().remove(id) {
                                let _ = tx.send(msg);
                            }
                        }
                    }
                    Some("client-discovery-request") => {
                        let _ = c.write(json!({"type":"client-discovery-response","requestId":msg["requestId"],"response":{"canHandle":false}}));
                    }
                    Some("broadcast") if msg["method"] == "thread-stream-state-changed" => {
                        if msg["params"]["change"]["type"] == "snapshot" {
                            if let Some(id) = msg["params"]["conversationId"].as_str() {
                                if let Some(tx) = c.snapshots.lock().unwrap().get(id) {
                                    let _ = tx
                                        .send(msg["params"]["change"]["conversationState"].clone());
                                }
                            }
                        }
                        let selected = c.binding.lock().unwrap().as_ref().map(|b| b.0.clone());
                        if selected.as_deref() == msg["params"]["conversationId"].as_str() {
                            let _ = app.emit("codex-stream", &msg["params"]);
                        }
                    }
                    Some("broadcast")
                        if msg["method"] == "client-status-changed"
                            && msg["params"]["status"] == "disconnected" =>
                    {
                        let owner = c.binding.lock().unwrap().as_ref().map(|b| b.1.clone());
                        if owner.as_deref() == msg["params"]["clientId"].as_str() {
                            let _ = app.emit(
                                "codex-disconnected",
                                "聊天运行实例已关闭，请在主窗口打开聊天后重新连接",
                            );
                        }
                    }
                    _ => {}
                }
            }
            writer_task.abort();
            c.alive.store(false, std::sync::atomic::Ordering::SeqCst);
            c.pending.lock().unwrap().clear();
            let _ = app.emit("codex-disconnected", "Codex 连接已断开，请重新连接");
        });
        ready_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "连接 Codex 超时".to_string())??;
        let response = client.rpc("initialize", json!({"clientType":"codex-float"}), 0, None)?;
        *client.id.lock().unwrap() = response["result"]["clientId"]
            .as_str()
            .ok_or("初始化未返回客户端 ID")?
            .into();
        Ok(client)
    }
    fn write(&self, message: Value) -> Result<(), String> {
        self.writer
            .send(message)
            .map_err(|_| "Codex 管道已关闭".to_string())
    }
    pub(crate) fn rpc(
        &self,
        method: &str,
        params: Value,
        version: u32,
        target: Option<&str>,
    ) -> Result<Value, String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(request_id.clone(), tx);
        let send = self.write(json!({"type":"request","requestId":request_id,"sourceClientId":*self.id.lock().unwrap(),"method":method,"params":params,"version":version,"targetClientId":target,"timeoutMs":15000}));
        if let Err(e) = send {
            self.pending.lock().unwrap().remove(&request_id);
            return Err(e);
        }
        let received = rx.recv_timeout(Duration::from_secs(16));
        self.pending.lock().unwrap().remove(&request_id);
        let response =
            received.map_err(|_| "Codex 请求超时或连接已关闭，请重新连接".to_string())?;
        if response["resultType"] != "success" {
            return Err(response["error"]
                .as_str()
                .unwrap_or("Codex 请求失败")
                .into());
        }
        Ok(response)
    }
    pub(crate) fn follow(&self, thread: &str, owner: &str, following: bool) -> Result<(), String> {
        self.write(json!({"type":"broadcast","sourceClientId":*self.id.lock().unwrap(),"version":1,"method":"thread-stream-following-changed","params":{"conversationId":thread,"hostId":"local","following":following},"targetClientIds":[owner]}))
    }
    pub(crate) fn unbind(&self) {
        let binding = self.binding.lock().unwrap().take();
        if let Some((thread, owner)) = binding {
            let _ = self.follow(&thread, &owner, false);
        }
    }
    pub(crate) fn load_history(
        &self,
        thread: &str,
        owner: &str,
        require_snapshot: bool,
    ) -> Result<Option<Value>, String> {
        let (tx, rx) = mpsc::channel();
        {
            let mut slots = self.snapshots.lock().map_err(|_| "子代理连接不可用")?;
            if slots.contains_key(thread) {
                return Err("该聊天正在同步，请稍后重试".into());
            }
            slots.insert(thread.into(), tx);
        }
        let result = (|| {
            self.follow(thread, owner, true)?;
            let history = self.rpc(
                "thread-follower-load-complete-history",
                json!({"conversationId":thread}),
                1,
                Some(owner),
            );
            let cursor_error = match history {
                Ok(_) if !require_snapshot => return Ok(None),
                Ok(_) => None,
                Err(error)
                    if error.contains(
                        "cursor.itemId does not identify an item in the requested history scope",
                    ) =>
                {
                    Some(error)
                }
                Err(error) => return Err(error),
            };
            rx.recv_timeout(Duration::from_secs(5))
                .map(Some)
                .map_err(|_| cursor_error.unwrap_or_else(|| "尚未收到聊天状态，请刷新重试".into()))
        })();
        // A confirmation snapshot for the selected chat must retain its live subscription.
        let is_bound = self.binding.lock().unwrap().as_ref()
            .is_some_and(|binding| binding.0 == thread && binding.1 == owner);
        if require_snapshot && !is_bound {
            let _ = self.follow(thread, owner, false);
        }
        self.snapshots.lock().unwrap().remove(thread);
        result
    }

    pub(crate) fn inspect_thread(&self, thread: &str, owner: &str) -> Result<Value, String> {
        self.load_history(thread, owner, true)?
            .ok_or_else(|| "尚未收到聊天状态，请刷新重试".into())
    }
}
#[derive(Default)]
pub(crate) struct Bridge(Mutex<Option<Arc<Client>>>);
pub(crate) fn get_client(app: &tauri::AppHandle) -> Result<Arc<Client>, String> {
    let state = app.state::<Bridge>();
    let mut slot = state.0.lock().unwrap();
    if slot
        .as_ref()
        .is_none_or(|c| !c.alive.load(std::sync::atomic::Ordering::SeqCst))
    {
        *slot = Some(Client::open(app.clone())?);
    }
    Ok(slot.as_ref().unwrap().clone())
}

pub(crate) fn shutdown(app: &tauri::AppHandle) {
    if let Some(client) = app.state::<Bridge>().0.lock().unwrap().as_ref() {
        client.unbind();
    }
}

#[cfg(test)]
mod history_tests {
    use super::*;

    #[test]
    fn confirmation_snapshots_preserve_only_the_selected_chat_subscription() {
        for bound in [true, false] {
            let (writer, mut outgoing) = tokio::sync::mpsc::unbounded_channel();
            let client = Client {
                writer,
                pending: Mutex::new(HashMap::new()),
                id: Mutex::new("test-client".into()),
                binding: Mutex::new(bound.then(|| ("thread".into(), "owner".into()))),
                snapshots: Mutex::new(HashMap::new()),
                alive: std::sync::atomic::AtomicBool::new(true),
            };
            std::thread::scope(|scope| {
                let worker = scope.spawn(|| client.inspect_thread("thread", "owner"));
                assert_eq!(outgoing.blocking_recv().unwrap()["params"]["following"], true);
                let request = outgoing.blocking_recv().unwrap();
                client.snapshots.lock().unwrap()["thread"]
                    .send(json!({"latestThreadSettings":{"permissions":":read-only"}})).unwrap();
                client.pending.lock().unwrap()[request["requestId"].as_str().unwrap()]
                    .send(json!({"resultType":"success","result":{}})).unwrap();
                assert_eq!(worker.join().unwrap().unwrap()["latestThreadSettings"]["permissions"], ":read-only");
                if bound {
                    assert!(outgoing.try_recv().is_err());
                } else {
                    assert_eq!(outgoing.try_recv().unwrap()["params"]["following"], false);
                }
                assert!(client.snapshots.lock().unwrap().is_empty());
            });
        }
    }

    #[test]
    fn cursor_error_only_recovers_when_a_snapshot_arrives() {
        const CURSOR_ERROR: &str =
            "cursor.itemId does not identify an item in the requested history scope";
        for (snapshot, error) in [
            (Some(json!({"turns": []})), CURSOR_ERROR),
            (None, CURSOR_ERROR),
            (Some(json!({"turns": []})), "owner unavailable"),
        ] {
            let (writer, mut outgoing) = tokio::sync::mpsc::unbounded_channel();
            let client = Client {
                writer,
                pending: Mutex::new(HashMap::new()),
                id: Mutex::new("test-client".into()),
                binding: Mutex::new(None),
                snapshots: Mutex::new(HashMap::new()),
                alive: std::sync::atomic::AtomicBool::new(true),
            };
            std::thread::scope(|scope| {
                let reply = snapshot.clone();
                let worker = scope.spawn(|| client.load_history("thread", "owner", false));
                let follow = outgoing.blocking_recv().unwrap();
                let request = outgoing.blocking_recv().unwrap();
                if let Some(state) = reply {
                    client.snapshots.lock().unwrap()["thread"]
                        .send(state)
                        .unwrap();
                }
                let request_id = request["requestId"].as_str().unwrap();
                client.pending.lock().unwrap()[request_id]
                    .send(json!({"resultType": "error", "error": error}))
                    .unwrap();
                let result = worker.join().unwrap();
                assert_eq!(follow["params"]["following"], true);
                assert_eq!(request["method"], "thread-follower-load-complete-history");
                if error == CURSOR_ERROR && snapshot.is_some() {
                    assert_eq!(result, Ok(snapshot));
                } else {
                    assert_eq!(result, Err(error.into()));
                }
                assert!(client.snapshots.lock().unwrap().is_empty());
                assert!(outgoing.try_recv().is_err());
            });
        }
    }
}
