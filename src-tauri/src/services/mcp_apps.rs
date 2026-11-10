use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;

const MAX_HTML: usize = 8 * 1024 * 1024;

fn frame_ancestors(development: bool) -> &'static str {
    if development {
        "http://tauri.localhost https://tauri.localhost tauri://localhost http://127.0.0.1:1420"
    } else {
        "http://tauri.localhost https://tauri.localhost tauri://localhost"
    }
}
#[derive(Clone)]
struct Page {
    html: String,
    csp: String,
    scope: Option<AppResource>,
}
#[derive(Default)]
pub struct McpAppsState {
    pages: Arc<Mutex<HashMap<String, Page>>>,
    address: Mutex<Option<SocketAddr>>,
    stopped: Arc<AtomicBool>,
    readers: Mutex<HashMap<String, Arc<Mutex<ResourceReader>>>>,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppResource {
    pub(super) thread_id: String,
    call_id: String,
    pub(super) server: String,
    resource_uri: String,
    pub(super) connector_id: Option<String>,
    pub(super) target: Option<Value>,
    cwd: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedApp {
    token: String,
    url: String,
}
struct ResourceProcess(Child);
impl Drop for ResourceProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn resource_params(resource: &AppResource) -> Result<Value, String> {
    uuid::Uuid::parse_str(&resource.thread_id).map_err(|_| "聊天 ID 无效")?;
    if resource.server.is_empty()
        || resource.server.len() > 256
        || resource.call_id.is_empty()
        || resource.call_id.len() > 512
        || resource.resource_uri.len() > 4096
        || !resource.resource_uri.contains("://")
        || [&resource.server, &resource.call_id, &resource.resource_uri]
            .iter()
            .any(|s| s.chars().any(char::is_control))
    {
        return Err("卡片资源信息无效".into());
    }
    // A separate read-only connection must not resume or take ownership of the user's chat.
    // originCallId requires a loaded thread. Preserve the explicit app/account target instead.
    let mut params = json!({"server":resource.server,"uri":resource.resource_uri});
    if let Some(connector) = &resource.connector_id {
        params["connectorId"] = json!(connector);
    }
    if let Some(target) = &resource.target {
        if !target["connectorId"].is_string()
            || !(target["linkId"].is_string() || target["linkId"].is_null())
            || target.get("linkId").is_none()
        {
            return Err("卡片账号范围无效".into());
        }
        params["target"] = target.clone();
    }
    Ok(params)
}

pub(super) struct ResourceReader {
    _process: ResourceProcess,
    input: std::process::ChildStdin,
    messages: mpsc::Receiver<Value>,
    next_id: u64,
    thread: Option<String>,
}
impl ResourceReader {
    pub(super) fn open(cwd: Option<&str>) -> Result<Self, String> {
        let mut command = Command::new(crate::platform::process::codex_binary()?);
        crate::platform::process::configure(&mut command);
        if let Some(cwd) = cwd.filter(|s| !s.is_empty()) {
            let path = super::context::local_path(cwd)?;
            if !path.is_dir() {
                return Err("卡片工作目录已不可用".into());
            }
            command.current_dir(path);
        }
        Self::from_command(command)
    }
    pub(super) fn from_command(mut command: Command) -> Result<Self, String> {
        let mut process = ResourceProcess(
            command
                .args(["app-server", "--stdio"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?,
        );
        let input = process.0.stdin.take().ok_or("卡片资源连接不可用")?;
        let output = process.0.stdout.take().ok_or("卡片资源连接不可用")?;
        let (tx, rx) = mpsc::sync_channel(8);
        std::thread::spawn(move || {
            let mut output = BufReader::new(output);
            loop {
                let mut line = String::new();
                let Ok(bytes) = output
                    .by_ref()
                    .take((MAX_HTML * 4 + 1) as u64)
                    .read_line(&mut line)
                else {
                    break;
                };
                if bytes == 0 || bytes > MAX_HTML * 4 {
                    break;
                }
                if let Ok(message) = serde_json::from_str::<Value>(&line) {
                    if message.get("id").is_some() && tx.send(message).is_err() {
                        break;
                    }
                }
            }
        });
        let mut reader = Self {
            _process: process,
            input,
            messages: rx,
            next_id: 0,
            thread: None,
        };
        reader.request("initialize",json!({"clientInfo":{"name":"codex_float_mcp_apps","version":"0.1.0"},"capabilities":{"experimentalApi":true}}))?;
        writeln!(
            reader.input,
            "{}",
            json!({"method":"initialized","params":{}})
        )
        .and_then(|_| reader.input.flush())
        .map_err(|e| e.to_string())?;
        Ok(reader)
    }
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.request_guarded(
            method,
            params,
            Duration::from_secs(25),
            &|| Ok(()),
            &mut |_| Err("此连接不支持该交互请求".into()),
        )
    }
    pub(super) fn thread(&mut self) -> Result<String, String> {
        if let Some(thread) = &self.thread {
            return Ok(thread.clone());
        }
        let result = self.request("thread/start", json!({"ephemeral":true,"permissions":":read-only","approvalPolicy":"on-request","approvalsReviewer":"user","threadSource":"mcp_extension_host"}))?;
        let id = result["thread"]["id"]
            .as_str()
            .ok_or("卡片工具连接未返回临时线程")?
            .to_string();
        self.thread = Some(id.clone());
        Ok(id)
    }
    pub(super) fn request_guarded(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
        guard: &dyn Fn() -> Result<(), String>,
        on_request: &mut dyn FnMut(&Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        guard()?;
        self.next_id += 1;
        let id = self.next_id;
        writeln!(
            self.input,
            "{}",
            json!({"id":id,"method":method,"params":params})
        )
        .and_then(|_| self.input.flush())
        .map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + timeout;
        loop {
            guard()?;
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err("卡片请求等待超时，执行结果待确认，请检查状态，避免重复操作".into());
            }
            let message = match self
                .messages
                .recv_timeout(remaining.min(Duration::from_millis(100)))
            {
                Ok(message) => message,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => {
                    return Err("卡片连接已关闭，执行结果待确认，请检查状态，避免重复操作".into())
                }
            };
            if message["method"].is_string() && message.get("id").is_some() {
                let response = match on_request(&message) {
                    Ok(result) => json!({"id":message["id"],"result":result}),
                    Err(error) => {
                        json!({"id":message["id"],"error":{"code":-32601,"message":error}})
                    }
                };
                writeln!(self.input, "{response}")
                    .and_then(|_| self.input.flush())
                    .map_err(|e| e.to_string())?;
                continue;
            }
            if message["id"] != id {
                continue;
            }
            if !message["error"].is_null() {
                return Err(format!(
                    "卡片请求失败：{}",
                    message["error"]["message"].as_str().unwrap_or("接口不可用")
                ));
            }
            return Ok(message["result"].clone());
        }
    }
}
#[cfg(test)]
fn read_resource(resource: &AppResource) -> Result<Value, String> {
    McpAppsState::default().read(resource)
}

fn domains(meta: &Value, key: &str, websocket: bool) -> Vec<String> {
    meta[key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|domain| {
            if domain
                .chars()
                .any(|c| c.is_whitespace() || matches!(c, '\'' | '"' | ';' | ','))
            {
                return None;
            }
            let parsed = tauri::Url::parse(&domain.replace("://*.", "://wildcard.")).ok()?;
            if !matches!(parsed.scheme(), "https" | "http")
                && !(websocket && matches!(parsed.scheme(), "wss" | "ws"))
            {
                return None;
            }
            let host = parsed.host_str()?;
            if host.contains("*")
                || ["ipc.localhost", "tauri.localhost", "localhost"].contains(&host)
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || parsed.path() != "/"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
            {
                return None;
            }
            Some(domain.trim_end_matches('/').to_owned())
        })
        .collect()
}
fn page_from_resource(result: &Value, uri: &str) -> Result<Page, String> {
    let content = result["contents"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["uri"] == uri))
        .ok_or("插件未返回所请求的卡片资源")?;
    let mime = content["mimeType"].as_str().unwrap_or("");
    if !mime.starts_with("text/html") {
        return Err("此卡片使用主 App 专用格式，请在主 App 打开".into());
    }
    let html = if let Some(text) = content["text"].as_str() {
        text.to_owned()
    } else if let Some(blob) = content["blob"].as_str() {
        use base64::Engine;
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(blob)
                .map_err(|_| "卡片资源编码无效")?,
        )
        .map_err(|_| "卡片资源不是 UTF-8")?
    } else {
        return Err("卡片资源没有 HTML 内容".into());
    };
    if html.len() > MAX_HTML {
        return Err("卡片 HTML 超过 8 MB".into());
    }
    let meta = &content["_meta"];
    let ui_csp = &meta["ui"]["csp"];
    let legacy = &meta["openai/widgetCSP"];
    let csp = if ui_csp.is_object() {
        ui_csp.clone()
    } else {
        json!({"connectDomains":legacy["connect_domains"],"resourceDomains":legacy["resource_domains"],"frameDomains":legacy["frame_domains"]})
    };
    let resources = domains(&csp, "resourceDomains", false).join(" ");
    let connect = domains(&csp, "connectDomains", true).join(" ");
    let frames = domains(&csp, "frameDomains", false).join(" ");
    let ancestors = frame_ancestors(tauri::is_dev());
    let policy=format!("default-src 'none'; script-src 'unsafe-inline' {resources}; style-src 'unsafe-inline' {resources}; img-src data: blob: {resources}; font-src data: {resources}; media-src data: blob: {resources}; connect-src {}; frame-src {}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors {ancestors}",if connect.is_empty(){"'none'"}else{&connect},if frames.is_empty(){"'none'"}else{&frames});
    let shim = format!(
        "<script>{}</script>",
        include_str!("../../../src/mcp-app-compat.js")
    );
    let html = if let Some(index) = html.to_ascii_lowercase().find("<head>") {
        let split = index + 6;
        format!("{}{}{}", &html[..split], shim, &html[split..])
    } else {
        format!("<!doctype html><head>{shim}</head>{html}")
    };
    Ok(Page {
        html,
        csp: policy,
        scope: None,
    })
}

fn asset(path: &str) -> Option<&'static [u8]> {
    match path {
        "/rich-assets/mermaid.js" => Some(include_bytes!(
            "../../../node_modules/mermaid/dist/mermaid.min.js"
        )),
        "/rich-assets/echarts.js" => Some(include_bytes!(
            "../../../node_modules/echarts/dist/echarts.min.js"
        )),
        _ => None,
    }
}
fn serve(mut stream: TcpStream, address: SocketAddr, pages: &Mutex<HashMap<String, Page>>) {
    // Darwin can inherit the listener's nonblocking mode on accepted sockets.
    // Serve each response on its worker with bounded blocking reads and writes.
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut request = String::new();
    let mut reader = BufReader::new(&mut stream).take(8192);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            _ => {
                let end = line == "\r\n" || line == "\n";
                request.push_str(&line);
                if end {
                    break;
                }
            }
        }
    }
    let mut lines = request.lines();
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next();
    let path = parts.next().unwrap_or("");
    let host = lines.find_map(|line| {
        line.split_once(':')
            .filter(|(key, _)| key.eq_ignore_ascii_case("host"))
            .map(|(_, v)| v.trim())
    });

    if method == Some("GET") && host == Some(address.to_string().as_str()) {
        if let Some(bytes) = asset(path) {
            let header=format!("HTTP/1.1 200 OK\r\nContent-Type: application/javascript; charset=utf-8\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: public, max-age=86400\r\nConnection: close\r\n\r\n",bytes.len());
            let _ = stream
                .write_all(header.as_bytes())
                .and_then(|_| stream.write_all(bytes));
            return;
        }
    }
    let token = path
        .strip_prefix("/mcp-app/")
        .and_then(|p| p.strip_suffix("/index.html"));
    let page = if method == Some("GET") && host == Some(address.to_string().as_str()) {
        token.and_then(|token| pages.lock().ok()?.get(token).cloned())
    } else {
        None
    };
    let (status, body, csp) = if let Some(page) = page {
        ("200 OK", page.html, page.csp)
    } else {
        (
            "404 Not Found",
            "Not found".into(),
            "default-src 'none'".into(),
        )
    };
    let header=format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nContent-Security-Policy: {csp}\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",body.len());
    let _ = stream
        .write_all(header.as_bytes())
        .and_then(|_| stream.write_all(body.as_bytes()));
}
impl McpAppsState {
    pub(super) fn scope(&self, token: &str) -> Result<AppResource, String> {
        self.pages
            .lock()
            .map_err(|_| "卡片服务不可用")?
            .get(token)
            .and_then(|page| page.scope.clone())
            .ok_or_else(|| "卡片已关闭，请重新打开".into())
    }
    pub(super) fn connection(
        &self,
        resource: &AppResource,
    ) -> Result<Arc<Mutex<ResourceReader>>, String> {
        let key = serde_json::to_string(&(&resource.thread_id, &resource.cwd))
            .map_err(|e| e.to_string())?;
        let mut readers = self.readers.lock().map_err(|_| "卡片资源连接不可用")?;
        if !readers.contains_key(&key) {
            if readers.len() >= 4 {
                readers.clear();
            }
            readers.insert(
                key.clone(),
                Arc::new(Mutex::new(ResourceReader::open(resource.cwd.as_deref())?)),
            );
        }
        readers
            .get(&key)
            .cloned()
            .ok_or_else(|| "卡片资源连接不可用".into())
    }
    pub(super) fn discard_connection(
        &self,
        resource: &AppResource,
        connection: &Arc<Mutex<ResourceReader>>,
    ) {
        if let Ok(mut readers) = self.readers.lock() {
            let key =
                serde_json::to_string(&(&resource.thread_id, &resource.cwd)).unwrap_or_default();
            if readers
                .get(&key)
                .is_some_and(|reader| Arc::ptr_eq(reader, connection))
            {
                readers.remove(&key);
            }
        }
    }
    fn read(&self, resource: &AppResource) -> Result<Value, String> {
        let mut params = resource_params(resource)?;
        let connection = self.connection(resource)?;
        let mut reader = connection.lock().map_err(|_| "卡片资源连接不可用")?;
        params["threadId"] = json!(reader.thread()?);
        let result = reader.request("mcpServer/resource/read", params);
        if result.is_err() {
            self.discard_connection(resource, &connection);
        }
        result
    }
    fn address(&self) -> Result<SocketAddr, String> {
        let mut slot = self.address.lock().map_err(|_| "卡片服务不可用")?;
        if let Some(address) = *slot {
            return Ok(address);
        }
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let pages = self.pages.clone();
        let stopped = self.stopped.clone();
        std::thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let pages = pages.clone();
                        std::thread::spawn(move || serve(stream, address, &pages));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(40)),
                }
            }
        });
        *slot = Some(address);
        Ok(address)
    }
}
fn verify_binding(app: &tauri::AppHandle, thread: &str) -> Result<(), String> {
    let client = crate::codex::get_client(app)?;
    let matches = client
        .binding
        .lock()
        .map_err(|_| "聊天连接不可用")?
        .as_ref()
        .is_some_and(|binding| binding.0 == thread);
    if matches {
        Ok(())
    } else {
        Err("聊天已切换，卡片加载已取消".into())
    }
}
#[tauri::command]
pub async fn load_mcp_app(
    app: tauri::AppHandle,
    resource: AppResource,
) -> Result<LoadedApp, String> {
    tauri::async_runtime::spawn_blocking(move || {
        verify_binding(&app, &resource.thread_id)?;
        let state = app.state::<McpAppsState>();
        let result = state.read(&resource)?;
        let mut page = page_from_resource(&result, &resource.resource_uri)?;
        verify_binding(&app, &resource.thread_id)?;
        page.scope = Some(resource);
        let address = state.address()?;
        let token = uuid::Uuid::new_v4().to_string();
        let mut pages = state.pages.lock().map_err(|_| "卡片服务不可用")?;
        if pages.len() >= 64 {
            return Err("打开的卡片过多，请切换聊天后重试".into());
        }
        pages.insert(token.clone(), page);
        Ok(LoadedApp {
            url: format!("http://{address}/mcp-app/{token}/index.html"),
            token,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn release_mcp_app(app: tauri::AppHandle, token: String) {
    let state = app.state::<McpAppsState>();
    let empty = if let Ok(mut pages) = state.pages.lock() {
        pages.remove(&token);
        pages.is_empty()
    } else {
        false
    };
    if empty {
        if let Ok(mut readers) = state.readers.try_lock() {
            readers.clear();
        }
    }
}
#[tauri::command]
pub async fn read_mcp_app_resource(
    app: tauri::AppHandle,
    token: String,
    uri: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<McpAppsState>();
        let mut resource = state
            .pages
            .lock()
            .map_err(|_| "卡片服务不可用")?
            .get(&token)
            .and_then(|page| page.scope.clone())
            .ok_or("卡片已关闭，请重新打开")?;
        verify_binding(&app, &resource.thread_id)?;
        resource.resource_uri = uri;
        let result = state.read(&resource)?;
        verify_binding(&app, &resource.thread_id)?;
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn rich_page(kind: &str, code: &str, theme: &str, address: SocketAddr) -> Result<Page, String> {
    if code.len() > MAX_HTML {
        return Err("预览内容超过 8 MB".into());
    }
    if !matches!(kind, "html" | "mermaid" | "echarts") {
        return Err("不支持的预览类型".into());
    }
    if kind == "mermaid" && code.len() > 50000 {
        return Err("Mermaid 图表过大，请拆分后预览".into());
    }
    if kind == "echarts" {
        let data: Value = serde_json::from_str(code).map_err(|_| "图表配置不是有效的 JSON")?;
        if !data.is_object() {
            return Err("图表配置必须是 JSON 对象".into());
        }
    }
    let payload=serde_json::to_string(&json!({"kind":kind,"code":if kind=="html"{""}else{code},"theme":if theme=="dark"{"dark"}else{"light"}})).map_err(|e|e.to_string())?.replace('<',"\\u003c");
    let bootstrap = format!("<script>window.__RICH_PAYLOAD__={payload};</script>");
    let runner = format!(
        "<script>{}</script>",
        include_str!("../../../src/rich-sandbox.js")
    );
    let html = if kind == "html" {
        let scripts = format!("{bootstrap}{runner}");
        if let Some(index) = code.to_ascii_lowercase().find("<head>") {
            let split = index + 6;
            format!("{}{}{}", &code[..split], scripts, &code[split..])
        } else {
            format!("<!doctype html><head><meta charset=\"utf-8\">{scripts}</head>{code}")
        }
    } else {
        let library = if kind == "mermaid" {
            "mermaid"
        } else {
            "echarts"
        };
        format!("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>html,body{{margin:0;font:13px system-ui}}#content{{width:100%;min-height:240px;overflow:auto}}.chart #content{{height:360px}}.zoom{{display:flex;gap:8px;padding:6px;position:sticky;top:0;z-index:1}}button{{font:inherit;cursor:pointer}}.diagram #content{{padding:8px;box-sizing:border-box}}</style>{bootstrap}<script src=\"http://{address}/rich-assets/{library}.js\"></script>{runner}</head><body class=\"{}\">{}<div id=\"content\"></div></body></html>",if kind=="mermaid"{"diagram"}else{"chart"},if kind=="mermaid"{"<div class=\"zoom\"><button id=\"zoom-out\">−</button><button id=\"zoom-reset\">100%</button><button id=\"zoom-in\">+</button></div>"}else{""})
    };
    let network = if kind == "html" { "https:" } else { "" };
    let ancestors = frame_ancestors(tauri::is_dev());
    let csp=format!("default-src 'none'; script-src 'unsafe-inline' http://{address} {network}; style-src 'unsafe-inline' {network}; img-src data: blob: {network}; font-src data: {network}; media-src data: blob: {network}; connect-src {}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors {ancestors}",if kind=="html"{"https: wss:"}else{"'none'"});
    Ok(Page {
        html,
        csp,
        scope: None,
    })
}
#[tauri::command]
pub async fn load_rich_preview(
    app: tauri::AppHandle,
    kind: String,
    code: String,
    theme: String,
) -> Result<LoadedApp, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_rich_preview_blocking(&app, &kind, &code, &theme)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn load_rich_preview_blocking(
    app: &tauri::AppHandle,
    kind: &str,
    code: &str,
    theme: &str,
) -> Result<LoadedApp, String> {
    let state = app.state::<McpAppsState>();
    let address = state.address()?;
    let page = rich_page(kind, code, theme, address)?;
    let token = uuid::Uuid::new_v4().to_string();
    let mut pages = state.pages.lock().map_err(|_| "预览服务不可用")?;
    if pages.len() >= 64 {
        return Err("打开的预览过多，请关闭部分预览后重试".into());
    }
    pages.insert(token.clone(), page);
    Ok(LoadedApp {
        url: format!("http://{address}/mcp-app/{token}/index.html"),
        token,
    })
}

pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<McpAppsState>();
    state.stopped.store(true, Ordering::Relaxed);
    if let Ok(mut pages) = state.pages.lock() {
        pages.clear();
    }
    if let Ok(mut readers) = state.readers.try_lock() {
        readers.clear();
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_policies_limit_the_development_origin_to_development_builds() {
        assert!(!frame_ancestors(false).contains("127.0.0.1:1420"));
        assert!(frame_ancestors(true).contains("127.0.0.1:1420"));
        let address = "127.0.0.1:49152".parse().unwrap();
        for kind in ["html", "mermaid", "echarts"] {
            let code = match kind {
                "mermaid" => "graph TD; A-->B",
                "echarts" => "{}",
                _ => "<p>test</p>",
            };
            let page = rich_page(kind, code, "light", address).unwrap();
            assert_eq!(page.csp.contains("127.0.0.1:1420"), tauri::is_dev());
            assert!(page.csp.contains("tauri://localhost"));
        }
    }
    #[test]
    fn rich_documents_escape_payloads_and_keep_scripts_in_the_sandbox() {
        let address = "127.0.0.1:12345".parse().unwrap();
        let page = rich_page(
            "mermaid",
            "graph TD\nA[\"</script><script>bad()</script>\"]",
            "dark",
            address,
        )
        .unwrap();
        assert!(page.html.contains("\\u003c/script>"));
        assert!(!page.html.contains("<script>bad()"));
        assert!(page.csp.contains("connect-src 'none'"));
        assert!(!page.csp.contains("ipc.localhost"));
        assert!(rich_page("echarts", "not JSON", "light", address).is_err());
        assert!(rich_page("echarts", "[]", "light", address).is_err());
        assert!(rich_page("unknown", "x", "light", address).is_err());
        let html = rich_page(
            "html",
            "<!doctype html><head></head><button onclick=\"this.textContent='done'\">run</button>",
            "light",
            address,
        )
        .unwrap();
        assert!(html.html.contains("onclick="));
        assert!(html.csp.contains("frame-src 'none'"));
        assert!(html.scope.is_none());
    }
    #[test]
    #[ignore = "headless browser coverage for formulas, media, charts and isolated HTML"]
    fn rich_browser() {
        let fixture = std::env::var_os("CODEX_FLOAT_RICH_BROWSER_FIXTURE").expect("fixture path");
        let script =
            std::env::var_os("CODEX_FLOAT_RICH_BROWSER_PROBE").expect("browser probe path");
        let data: Value = serde_json::from_str(&std::fs::read_to_string(fixture).unwrap()).unwrap();
        let state = McpAppsState::default();
        let address = state.address().unwrap();
        let mut urls = json!({});
        for (kind, token) in [("mermaid", "aaa"), ("echarts", "bbb"), ("html", "ccc")] {
            let page = rich_page(kind, data[kind].as_str().unwrap(), "light", address).unwrap();
            state.pages.lock().unwrap().insert(token.into(), page);
            urls[kind] = json!(format!("http://{address}/mcp-app/{token}/index.html"));
        }
        let mut command = Command::new("node");
        crate::platform::process::configure(&mut command);
        let status = command.arg(script).arg(urls.to_string()).status().unwrap();
        state.stopped.store(true, Ordering::Relaxed);
        assert!(status.success());
    }
    #[test]
    fn resources_keep_account_scope_and_never_resume_threads() {
        let resource = AppResource {
            thread_id: "01a1a396-76ee-7073-a74c-01f7dc0f4bcf".into(),
            call_id: "call".into(),
            server: "server".into(),
            resource_uri: "ui://card".into(),
            connector_id: Some("app".into()),
            target: Some(json!({"connectorId":"app","linkId":"account"})),
            cwd: None,
        };
        let params = resource_params(&resource).unwrap();
        assert!(params.get("threadId").is_none());
        assert!(params.get("originCallId").is_none());
        assert_eq!(params["target"]["linkId"], "account");
    }
    #[test]
    fn card_csp_is_scoped_and_html_is_isolated() {
        let result = json!({"contents":[{"uri":"ui://card","mimeType":"text/html;profile=mcp-app","text":"<!doctype html><html><head></head><body>card</body></html>","_meta":{"ui":{"csp":{"resourceDomains":["https://cdn.example.com","https://bad.example.com;script-src *","http://ipc.localhost"],"connectDomains":["https://api.example.com"],"frameDomains":[]}}}}]});
        let page = page_from_resource(&result, "ui://card").unwrap();
        assert_eq!(page.csp.contains("127.0.0.1:1420"), tauri::is_dev());
        assert!(page.csp.contains("https://cdn.example.com"));
        assert!(!page.csp.contains("bad.example"));
        assert!(!page.csp.contains("ipc.localhost"));
        assert!(page.csp.contains("frame-src 'none'"));
        assert!(page.html.contains("window.openai"));
        assert!(page_from_resource(&result, "ui://wrong").is_err());
        assert!(page_from_resource(
            &json!({"contents":[{"uri":"ui://x","mimeType":"application/json","text":"{}"}]}),
            "ui://x"
        )
        .is_err());
    }
    #[test]
    fn local_pages_require_tokens_and_matching_host() {
        let state = McpAppsState::default();
        let address = state.address().unwrap();
        state.pages.lock().unwrap().insert(
            "test-token".into(),
            Page {
                html: "<p>card</p>".into(),
                csp: "default-src 'none'".into(),
                scope: None,
            },
        );
        let fetch = |host: String, path: &str| {
            let mut stream = TcpStream::connect(address).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            write!(stream, "GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
            let mut reply = String::new();
            stream.read_to_string(&mut reply).unwrap();
            reply
        };
        let reply = fetch(address.to_string(), "/mcp-app/test-token/index.html");
        assert!(reply.starts_with("HTTP/1.1 200"));
        assert!(reply.contains("Content-Security-Policy:"));
        assert!(reply.ends_with("<p>card</p>"));
        assert!(
            fetch("attacker.example".into(), "/mcp-app/test-token/index.html")
                .starts_with("HTTP/1.1 404")
        );
        let script = fetch(address.to_string(), "/rich-assets/mermaid.js");
        let (_, body) = script.split_once("\r\n\r\n").unwrap();
        assert!(body.as_bytes() == asset("/rich-assets/mermaid.js").unwrap());
        state.pages.lock().unwrap().clear();
        assert!(fetch(address.to_string(), "/mcp-app/test-token/index.html")
            .starts_with("HTTP/1.1 404"));
        state.stopped.store(true, Ordering::Relaxed);
    }
    #[test]
    #[ignore = "read-only live MCP card resource check"]
    fn live_card_resource() {
        let resource = AppResource {
            thread_id: "01a1a396-76ee-7073-a74c-01f7dc0f4bcf".into(),
            call_id: "codex_float_readonly_probe".into(),
            server: "cities-skylines2".into(),
            resource_uri: "ui://cityweaver/planning/v1.html".into(),
            connector_id: None,
            target: None,
            cwd: None,
        };
        let result = read_resource(&resource).unwrap();
        let page = page_from_resource(&result, &resource.resource_uri).unwrap();
        assert!(page.html.contains("ui/initialize"));
        assert!(page.html.contains("ui/message"));
    }
    #[test]
    #[ignore = "headless browser check with a live read-only MCP UI resource"]
    fn live_card_browser() {
        let script = std::env::var_os("CODEX_FLOAT_MCP_BROWSER_PROBE").expect("browser probe path");
        let resource = AppResource {
            thread_id: "01a1a396-76ee-7073-a74c-01f7dc0f4bcf".into(),
            call_id: "codex_float_readonly_probe".into(),
            server: "cities-skylines2".into(),
            resource_uri: "ui://cityweaver/planning/v1.html".into(),
            connector_id: None,
            target: None,
            cwd: None,
        };
        let result = read_resource(&resource).unwrap();
        let page = page_from_resource(&result, &resource.resource_uri).unwrap();
        let state = McpAppsState::default();
        let address = state.address().unwrap();
        state
            .pages
            .lock()
            .unwrap()
            .insert("browser-probe".into(), page);
        let mut command = Command::new("node");
        crate::platform::process::configure(&mut command);
        let status = command
            .arg(script)
            .arg(format!("http://{address}/mcp-app/browser-probe/index.html"))
            .status()
            .unwrap();
        state.stopped.store(true, Ordering::Relaxed);
        assert!(status.success());
    }
}
