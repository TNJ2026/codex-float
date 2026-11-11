use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// Dropping a JoinHandle detaches it. Keep cancellation ownership until initialization succeeds,
// and nest the writer guard inside the reader so cancellation closes both transport halves.
struct TaskGuard(Option<tauri::async_runtime::JoinHandle<()>>);
impl TaskGuard {
    fn detach(mut self) {
        self.0.take();
    }
}
impl Drop for TaskGuard {
    fn drop(&mut self) {
        if let Some(task) = self.0.take() {
            task.abort();
        }
    }
}

pub(crate) struct Client {
    writer: tokio::sync::mpsc::UnboundedSender<Value>,
    pending: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    id: Mutex<String>,
    pub(crate) binding: Mutex<Option<(String, String)>>,
    pub(crate) connecting: Mutex<()>,
    snapshots: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    alive: std::sync::atomic::AtomicBool,
}
impl Client {
    fn open(app: tauri::AppHandle) -> Result<(Arc<Self>, TaskGuard), String> {
        let (outgoing, mut outgoing_rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
        let (ready_tx, ready_rx) = mpsc::channel();
        let client = Arc::new(Self {
            writer: outgoing,
            pending: Mutex::new(HashMap::new()),
            id: Mutex::new("initializing-client".into()),
            binding: Mutex::new(None),
            connecting: Mutex::new(()),
            snapshots: Mutex::new(HashMap::new()),
            alive: std::sync::atomic::AtomicBool::new(true),
        });
        let c = client.clone();
        let connection_task = TaskGuard(Some(tauri::async_runtime::spawn(async move {
            let pipe = match crate::platform::transport::connect().await {
                Ok(pipe) => pipe,
                Err(error) => {
                    let _ = ready_tx.send(Err(format!("无法连接 Codex，请先打开桌面端：{error}")));
                    return;
                }
            };
            let (mut reader, mut writer) = tokio::io::split(pipe);
            let writer_task = TaskGuard(Some(tauri::async_runtime::spawn(async move {
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
            })));
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
                            let Ok(mut pending) = c.pending.lock() else {
                                break;
                            };
                            if let Some(tx) = pending.remove(id) {
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
                                let Ok(snapshots) = c.snapshots.lock() else {
                                    break;
                                };
                                if let Some(tx) = snapshots.get(id) {
                                    let _ = tx
                                        .send(msg["params"]["change"]["conversationState"].clone());
                                }
                            }
                        }
                        let Ok(binding) = c.bound() else {
                            break;
                        };
                        let selected = binding.map(|b| b.0);
                        if selected.as_deref() == msg["params"]["conversationId"].as_str() {
                            let _ = app.emit("codex-stream", &msg["params"]);
                        }
                    }
                    Some("broadcast")
                        if msg["method"] == "client-status-changed"
                            && msg["params"]["status"] == "disconnected" =>
                    {
                        let Ok(binding) = c.bound() else {
                            break;
                        };
                        let owner = binding.map(|b| b.1);
                        if owner.as_deref() == msg["params"]["clientId"].as_str() {
                            let _ = app.emit(
                                "codex-disconnected",
                                "聊天连接已关闭，请先在 Codex App 打开该对话，再点击同步。",
                            );
                        }
                    }
                    _ => {}
                }
            }
            drop(writer_task);
            c.alive.store(false, std::sync::atomic::Ordering::SeqCst);
            // Pending senders can always be dropped during teardown, even if poisoned.
            c.pending
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clear();
            let _ = app.emit("codex-disconnected", "Codex 连接已断开，请重新连接");
        })));
        ready_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "连接 Codex 超时".to_string())??;
        let response = client.rpc("initialize", json!({"clientType":"codex-float"}), 0, None)?;
        *client.id.lock().map_err(|_| "聊天连接不可用")? = response["result"]["clientId"]
            .as_str()
            .ok_or("初始化未返回客户端 ID")?
            .into();
        // Bridge owns cancellation until the initialized client is published.
        Ok((client, connection_task))
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
        let source = self.id.lock().map_err(|_| "聊天连接不可用")?.clone();
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .insert(request_id.clone(), tx);
        let send = self.write(json!({"type":"request","requestId":request_id,"sourceClientId":source,"method":method,"params":params,"version":version,"targetClientId":target,"timeoutMs":15000}));
        if let Err(e) = send {
            self.pending
                .lock()
                .map_err(|_| "聊天连接不可用")?
                .remove(&request_id);
            return Err(e);
        }
        let received = rx.recv_timeout(Duration::from_secs(16));
        self.pending
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .remove(&request_id);
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
        let source = self.id.lock().map_err(|_| "聊天连接不可用")?.clone();
        self.write(json!({"type":"broadcast","sourceClientId":source,"version":1,"method":"thread-stream-following-changed","params":{"conversationId":thread,"hostId":"local","following":following},"targetClientIds":[owner]}))
    }
    pub(crate) fn bound(&self) -> Result<Option<(String, String)>, String> {
        Ok(self.binding.lock().map_err(|_| "聊天连接不可用")?.clone())
    }
    pub(crate) fn unbind(&self) -> Result<(), String> {
        let binding = self.binding.lock().map_err(|_| "聊天连接不可用")?.take();
        if let Some((thread, owner)) = binding {
            let _ = self.follow(&thread, &owner, false);
        }
        Ok(())
    }
    pub(crate) fn load_history(
        &self,
        thread: &str,
        owner: &str,
        require_snapshot: bool,
    ) -> Result<Option<Value>, String> {
        let (tx, rx) = mpsc::channel();
        {
            let mut slots = self.snapshots.lock().map_err(|_| "聊天连接不可用")?;
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
        let binding = self.bound();
        let is_bound = binding.as_ref().is_ok_and(|binding| {
            binding
                .as_ref()
                .is_some_and(|binding| binding.0 == thread && binding.1 == owner)
        });
        if (require_snapshot && !is_bound) || binding.is_err() {
            let _ = self.follow(thread, owner, false);
        }
        // Always release the snapshot slot before reporting a binding error.
        self.snapshots
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .remove(thread);
        let _ = binding?;
        result
    }

    pub(crate) fn inspect_thread(&self, thread: &str, owner: &str) -> Result<Value, String> {
        self.load_history(thread, owner, true)?
            .ok_or_else(|| "尚未收到聊天状态，请刷新重试".into())
    }
}
#[derive(Default)]
struct BridgeSlot {
    client: Option<Arc<Client>>,
    closed: bool,
}

#[derive(Default)]
pub(crate) struct Bridge {
    slot: Mutex<BridgeSlot>,
    opening: Mutex<()>,
}
impl Bridge {
    fn current(&self) -> Result<Option<Arc<Client>>, String> {
        let slot = self.slot.lock().map_err(|_| "聊天连接不可用")?;
        if slot.closed {
            return Err("Codex 连接已关闭".into());
        }
        Ok(slot
            .client
            .as_ref()
            .filter(|client| client.alive.load(std::sync::atomic::Ordering::SeqCst))
            .cloned())
    }

    fn get_or_open(
        &self,
        open: impl FnOnce() -> Result<(Arc<Client>, TaskGuard), String>,
    ) -> Result<Arc<Client>, String> {
        if let Some(client) = self.current()? {
            return Ok(client);
        }
        // Serialize initializers without holding the slot needed by shutdown.
        let _opening = self.opening.lock().map_err(|_| "聊天连接不可用")?;
        if let Some(client) = self.current()? {
            return Ok(client);
        }
        let (client, task) = open()?;
        let mut slot = self.slot.lock().map_err(|_| "聊天连接不可用")?;
        if slot.closed {
            return Err("Codex 连接已关闭".into());
        }
        slot.client = Some(client.clone());
        task.detach();
        Ok(client)
    }

    fn shutdown(&self) {
        let client = {
            let mut slot = self.slot.lock().unwrap_or_else(|error| error.into_inner());
            slot.closed = true;
            slot.client.take()
        };
        if let Some(client) = client {
            let _ = client.unbind();
        }
    }
}

pub(crate) fn get_client(app: &tauri::AppHandle) -> Result<Arc<Client>, String> {
    app.state::<Bridge>()
        .get_or_open(|| Client::open(app.clone()))
}

pub(crate) fn shutdown(app: &tauri::AppHandle) {
    app.state::<Bridge>().shutdown();
}

#[cfg(test)]
mod history_tests {
    use super::*;

    #[test]
    fn unloaded_chat_reports_manual_open_instruction_without_retrying_or_rebinding() {
        let (client, mut outgoing) = test_client();
        *client.binding.lock().unwrap() = Some(("previous".into(), "owner".into()));
        std::thread::scope(|scope| {
            let worker =
                scope.spawn(|| super::super::commands::connect_client(&client, "unloaded"));
            let discovery = outgoing.blocking_recv().unwrap();
            assert_eq!(discovery["method"], "thread-owner-discovery");
            reply(
                &client,
                &discovery,
                json!({"resultType":"error","error":"no-client-found"}),
            );
            let error = worker.join().unwrap().unwrap_err();
            assert_eq!(error, "chat-not-loaded");
        });
        assert!(
            outgoing.try_recv().is_err(),
            "no retries, history loads or follow changes for an unloaded chat"
        );
        assert_eq!(
            *client.binding.lock().unwrap(),
            Some(("previous".into(), "owner".into()))
        );
    }

    fn poison<T: Send>(mutex: &Mutex<T>) {
        std::thread::scope(|scope| {
            assert!(scope
                .spawn(|| {
                    let _guard = mutex.lock().unwrap();
                    panic!("simulate a panic while holding a client lock");
                })
                .join()
                .is_err());
        });
    }

    #[test]
    fn poisoned_connection_and_binding_locks_return_errors_without_poisoning_other_locks() {
        let (client, mut outgoing) = test_client();
        poison(&client.connecting);
        assert_eq!(
            super::super::commands::connect_client(&client, "thread"),
            Err("聊天连接不可用".into())
        );
        assert!(outgoing.try_recv().is_err());

        let (client, mut outgoing) = test_client();
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| super::super::commands::connect_client(&client, "thread"));
            let discovery = outgoing.blocking_recv().unwrap();
            poison(&client.binding);
            reply(
                &client,
                &discovery,
                json!({"resultType":"success","handledByClientId":"owner"}),
            );
            assert_eq!(worker.join().unwrap(), Err("聊天连接不可用".into()));
        });
        assert!(!client.connecting.is_poisoned());
        assert_eq!(client.unbind(), Err("聊天连接不可用".into()));
        assert!(outgoing.try_recv().is_err());
    }

    #[test]
    fn poisoned_rpc_and_snapshot_locks_return_errors_without_sending_requests() {
        for lock in ["id", "pending", "snapshots"] {
            let (client, mut outgoing) = test_client();
            let result = match lock {
                "id" => {
                    poison(&client.id);
                    client.rpc("test", json!({}), 0, None).map(|_| ())
                }
                "pending" => {
                    poison(&client.pending);
                    client.rpc("test", json!({}), 0, None).map(|_| ())
                }
                _ => {
                    poison(&client.snapshots);
                    client.load_history("thread", "owner", false).map(|_| ())
                }
            };
            assert_eq!(result, Err("聊天连接不可用".into()));
            assert!(outgoing.try_recv().is_err());
            assert!(client
                .pending
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .is_empty());
        }
    }

    #[test]
    fn poisoned_binding_during_history_loading_still_releases_the_snapshot_and_subscription() {
        for require_snapshot in [false, true] {
            let (client, mut outgoing) = test_client();
            std::thread::scope(|scope| {
                let worker =
                    scope.spawn(|| client.load_history("thread", "owner", require_snapshot));
                assert_eq!(
                    outgoing.blocking_recv().unwrap()["params"]["following"],
                    true
                );
                let history = outgoing.blocking_recv().unwrap();
                client.snapshots.lock().unwrap()["thread"]
                    .send(json!({"turns":[]}))
                    .unwrap();
                poison(&client.binding);
                reply(&client, &history, json!({"resultType":"success"}));
                assert_eq!(worker.join().unwrap(), Err("聊天连接不可用".into()));
            });
            assert!(client.snapshots.lock().unwrap().is_empty());
            assert_eq!(outgoing.try_recv().unwrap()["params"]["following"], false);
        }
    }

    #[test]
    fn shutdown_remains_best_effort_when_binding_or_bridge_state_is_poisoned() {
        let bridge = Bridge::default();
        let (client, _outgoing) = test_client();
        bridge
            .get_or_open(|| Ok((client.clone(), TaskGuard(None))))
            .unwrap();
        poison(&client.binding);
        bridge.shutdown();
        assert!(bridge.slot.lock().unwrap().client.is_none());

        let bridge = Bridge::default();
        poison(&bridge.slot);
        assert!(bridge.current().is_err());
        bridge.shutdown();
        assert!(
            bridge
                .slot
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .closed
        );
    }

    fn test_client() -> (Arc<Client>, tokio::sync::mpsc::UnboundedReceiver<Value>) {
        let (writer, outgoing) = tokio::sync::mpsc::unbounded_channel();
        (
            Arc::new(Client {
                writer,
                pending: Mutex::new(HashMap::new()),
                id: Mutex::new("test-client".into()),
                binding: Mutex::new(None),
                connecting: Mutex::new(()),
                snapshots: Mutex::new(HashMap::new()),
                alive: std::sync::atomic::AtomicBool::new(true),
            }),
            outgoing,
        )
    }

    fn reply(client: &Client, request: &Value, response: Value) {
        client.pending.lock().unwrap()[request["requestId"].as_str().unwrap()]
            .send(response)
            .unwrap();
    }

    #[test]
    fn concurrent_initializers_share_one_client() {
        let bridge = Bridge::default();
        let (client, _outgoing) = test_client();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        std::thread::scope(|scope| {
            let bridge_ref = &bridge;
            let first = scope.spawn(move || {
                bridge_ref.get_or_open(|| {
                    started_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok((client, TaskGuard(None)))
                })
            });
            started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            // The slot stays available while transport initialization blocks.
            assert!(bridge.slot.try_lock().is_ok());
            let second = scope.spawn(|| bridge.get_or_open(|| panic!("duplicate initializer")));
            release_tx.send(()).unwrap();
            let first = first.join().unwrap().unwrap();
            let second = second.join().unwrap().unwrap();
            assert!(Arc::ptr_eq(&first, &second));
        });
    }

    #[test]
    fn failed_initialization_can_be_retried() {
        let bridge = Bridge::default();
        assert!(bridge
            .get_or_open(|| Err("initialization failed".into()))
            .is_err());
        let (client, _outgoing) = test_client();
        assert!(bridge.get_or_open(|| Ok((client, TaskGuard(None)))).is_ok());
    }

    #[test]
    fn shutdown_during_initialization_does_not_wait_or_publish_and_cancels_transport() {
        let bridge = Bridge::default();
        let (client, _outgoing) = test_client();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (released_tx, released_rx) = mpsc::channel();
        std::thread::scope(|scope| {
            let bridge_ref = &bridge;
            let worker = scope.spawn(move || {
                bridge_ref.get_or_open(|| {
                    let resource = Released(released_tx, "transport");
                    let task = TaskGuard(Some(tauri::async_runtime::spawn(async move {
                        let _resource = resource;
                        started_tx.send(()).unwrap();
                        std::future::pending::<()>().await;
                    })));
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok((client, task))
                })
            });
            started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let (stopped_tx, stopped_rx) = mpsc::channel();
            scope.spawn(move || {
                bridge_ref.shutdown();
                stopped_tx.send(()).unwrap();
            });
            let stopped = stopped_rx.recv_timeout(Duration::from_secs(2));
            // Release even on failure so a lock regression cannot deadlock the test.
            release_tx.send(()).unwrap();
            stopped.unwrap();
            assert!(worker.join().unwrap().is_err());
            assert!(bridge.slot.lock().unwrap().client.is_none());
            assert!(bridge
                .get_or_open(|| panic!("opened after shutdown"))
                .is_err());
        });
        assert_eq!(
            released_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            "transport"
        );
    }

    #[test]
    fn concurrent_chat_connections_serialize_binding_and_failure_cleanup() {
        for second_thread in ["first", "second"] {
            for second_succeeds in [true, false] {
                let (client, mut outgoing) = test_client();
                // Forward transport messages to a channel with bounded test waits.
                let (messages_tx, messages_rx) = mpsc::channel();
                let forwarder = tauri::async_runtime::spawn(async move {
                    while let Some(message) = outgoing.recv().await {
                        if messages_tx.send(message).is_err() {
                            break;
                        }
                    }
                });
                let next = || messages_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                std::thread::scope(|scope| {
                    let first =
                        scope.spawn(|| super::super::commands::connect_client(&client, "first"));
                    let discovery = next();
                    assert_eq!(discovery["method"], "thread-owner-discovery");
                    reply(
                        &client,
                        &discovery,
                        json!({"resultType":"success","handledByClientId":"owner"}),
                    );
                    assert_eq!(next()["params"]["following"], true);
                    let history = next();
                    assert_eq!(history["method"], "thread-follower-load-complete-history");
                    assert!(client.connecting.try_lock().is_err());
                    let (started_tx, started_rx) = mpsc::channel();
                    let client_ref = &client;
                    let second = scope.spawn(move || {
                        started_tx.send(()).unwrap();
                        super::super::commands::connect_client(client_ref, second_thread)
                    });
                    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    assert!(messages_rx
                        .recv_timeout(Duration::from_millis(100))
                        .is_err());
                    reply(&client, &history, json!({"resultType":"success"}));
                    assert_eq!(first.join().unwrap().unwrap()["connected"], true);
                    let discovery = next();
                    assert_eq!(discovery["method"], "thread-owner-discovery");
                    reply(
                        &client,
                        &discovery,
                        json!({"resultType":"success","handledByClientId":"owner"}),
                    );
                    assert_eq!(next()["params"]["following"], false);
                    assert_eq!(next()["params"]["following"], true);
                    let history = next();
                    reply(
                        &client,
                        &history,
                        if second_succeeds {
                            json!({"resultType":"success"})
                        } else {
                            json!({"resultType":"error","error":"history unavailable"})
                        },
                    );
                    let result = second.join().unwrap();
                    if second_succeeds {
                        assert_eq!(result.unwrap()["connected"], true);
                        assert_eq!(
                            *client.binding.lock().unwrap(),
                            Some((second_thread.into(), "owner".into()))
                        );
                    } else {
                        assert_eq!(result, Err("history unavailable".into()));
                        assert_eq!(next()["params"]["following"], false);
                        assert!(client.binding.lock().unwrap().is_none());
                    }
                    assert!(client.snapshots.lock().unwrap().is_empty());
                });
                forwarder.abort();
            }
        }
    }

    struct Released(mpsc::Sender<&'static str>, &'static str);
    impl Drop for Released {
        fn drop(&mut self) {
            let _ = self.0.send(self.1);
        }
    }

    #[test]
    fn failed_initialization_cancels_reader_and_nested_writer() {
        let (released_tx, released_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let reader = TaskGuard(Some(tauri::async_runtime::spawn(async move {
            let _reader_resource = Released(released_tx.clone(), "reader");
            let writer_resource = Released(released_tx, "writer");
            let _writer = TaskGuard(Some(tauri::async_runtime::spawn(async move {
                let _resource = writer_resource;
                std::future::pending::<()>().await;
            })));
            ready_tx.send(()).unwrap();
            std::future::pending::<()>().await;
        })));
        ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        // The same guard drop runs on every early return from Client::open.
        drop(reader);
        let mut released = vec![
            released_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            released_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        ];
        released.sort();
        assert_eq!(released, ["reader", "writer"]);
    }

    #[test]
    fn successful_initialization_keeps_connection_task_running() {
        let (finish_tx, finish_rx) = tokio::sync::oneshot::channel::<()>();
        let (done_tx, done_rx) = mpsc::channel();
        let task = TaskGuard(Some(tauri::async_runtime::spawn(async move {
            finish_rx.await.unwrap();
            done_tx.send(()).unwrap();
        })));
        task.detach();
        finish_tx.send(()).unwrap();
        done_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    }

    #[test]
    fn confirmation_snapshots_preserve_only_the_selected_chat_subscription() {
        for bound in [true, false] {
            let (writer, mut outgoing) = tokio::sync::mpsc::unbounded_channel();
            let client = Client {
                writer,
                pending: Mutex::new(HashMap::new()),
                id: Mutex::new("test-client".into()),
                binding: Mutex::new(bound.then(|| ("thread".into(), "owner".into()))),
                connecting: Mutex::new(()),
                snapshots: Mutex::new(HashMap::new()),
                alive: std::sync::atomic::AtomicBool::new(true),
            };
            std::thread::scope(|scope| {
                let worker = scope.spawn(|| client.inspect_thread("thread", "owner"));
                assert_eq!(
                    outgoing.blocking_recv().unwrap()["params"]["following"],
                    true
                );
                let request = outgoing.blocking_recv().unwrap();
                client.snapshots.lock().unwrap()["thread"]
                    .send(json!({"latestThreadSettings":{"permissions":":read-only"}}))
                    .unwrap();
                client.pending.lock().unwrap()[request["requestId"].as_str().unwrap()]
                    .send(json!({"resultType":"success","result":{}}))
                    .unwrap();
                assert_eq!(
                    worker.join().unwrap().unwrap()["latestThreadSettings"]["permissions"],
                    ":read-only"
                );
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
                connecting: Mutex::new(()),
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
