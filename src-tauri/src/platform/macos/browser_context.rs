use crate::services::context::ContextItem;

pub fn read_pages() -> Result<Vec<ContextItem>, String> {
    read_pages_with_limit(32_000)
}
pub fn read_pages_with_limit(limit: usize) -> Result<Vec<ContextItem>, String> {
    let limit = limit.clamp(1000, 100_000);
    // Only running browsers are queried. No tab is navigated or activated.
    let script = r#"var result=[]; ['Google Chrome','Microsoft Edge','Brave Browser','Safari'].forEach(function(name){var app=Application(name); if(!app.running()) return; try {app.windows().forEach(function(window){try {var tab=name==='Safari'?window.currentTab():window.activeTab();var url=tab.url(),content='',truncated=false;try {var js='document.body ? document.body.innerText : ""';content=String(name==='Safari'?app.doJavaScript(js,{in:tab}):app.execute(tab,{javascript:js}));truncated=content.length>32000;content=content.slice(0,32000);if(/[\uD800-\uDBFF]$/.test(content))content=content.slice(0,-1);}catch(e){} if(url!==tab.url())return;result.push({kind:'browser',label:tab.name?tab.name():tab.title(),url:url,source:name,content:content,path:'',language:'',browserWindowId:name+':'+window.id(),autoUpdate:true,contentType:content?'body':'selection',truncated:truncated,description:content?(truncated?'正文已截断至 32,000 字符':'已读取网页正文'):'未能读取正文；浏览器可能未允许通过自动化执行 JavaScript'});}catch(e){}});}catch(e){}}); JSON.stringify(result);"#;
    let script = script
        .replace("32000", &limit.to_string())
        .replace("32,000", &limit.to_string());
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("无法读取浏览器，请检查系统自动化授权".into());
    }
    let pages: Vec<ContextItem> =
        serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(pages
        .into_iter()
        .filter(|page| page.url.starts_with("http://") || page.url.starts_with("https://"))
        .collect())
}
