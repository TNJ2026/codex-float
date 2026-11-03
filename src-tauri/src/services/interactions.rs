use serde_json::{json, Value};

pub fn reply_request(
    thread: &str,
    request_id: Value,
    kind: &str,
    payload: Value,
) -> Result<(&'static str, Value), String> {
    if !(request_id.is_string() || request_id.is_i64() || request_id.is_u64()) {
        return Err("请求 ID 格式不正确".into());
    }
    let method = match kind {
        "item/commandExecution/requestApproval" => "thread-follower-command-approval-decision",
        "item/fileChange/requestApproval" => "thread-follower-file-approval-decision",
        "item/permissions/requestApproval" => {
            "thread-follower-permissions-request-approval-response"
        }
        "item/tool/requestUserInput" => "thread-follower-submit-user-input",
        "mcpServer/elicitation/request" => "thread-follower-submit-mcp-server-elicitation-response",
        _ => return Err("此请求需要在 Codex 主窗口处理".into()),
    };
    let mut params = json!({"conversationId":thread,"requestId":request_id});
    if kind == "item/commandExecution/requestApproval" || kind == "item/fileChange/requestApproval"
    {
        let decision = payload["decision"].as_str().ok_or("缺少审批选项")?;
        if !["accept", "acceptForSession", "decline", "cancel"].contains(&decision) {
            return Err("不支持的审批选项".into());
        }
        params["decision"] = json!(decision);
    } else {
        let response = &payload["response"];
        if !response.is_object() {
            return Err("回复内容格式不正确".into());
        }
        if kind == "item/tool/requestUserInput" && !response["answers"].is_object() {
            return Err("缺少问题回答".into());
        }
        if kind == "item/permissions/requestApproval"
            && (response["scope"] != "turn" || !response["permissions"].is_object())
        {
            return Err("权限回复仅支持当前轮次".into());
        }
        if kind == "mcpServer/elicitation/request"
            && ![Some("accept"), Some("decline"), Some("cancel")]
                .contains(&response["action"].as_str())
        {
            return Err("不支持的表单操作".into());
        }
        params["response"] = response.clone();
    }
    Ok((method, params))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_are_explicit_and_preserve_typed_request_ids() {
        let (method, params) = reply_request(
            "thread",
            json!(12),
            "item/tool/requestUserInput",
            json!({"response":{"answers":{"q":{"answers":["chosen"]}}}}),
        )
        .unwrap();
        assert_eq!(method, "thread-follower-submit-user-input");
        assert_eq!(params["requestId"], 12);
        assert_eq!(params["response"]["answers"]["q"]["answers"][0], "chosen");
        assert!(reply_request("thread", json!(1), "arbitrary-method", json!({})).is_err());
        assert!(reply_request(
            "thread",
            json!(1),
            "item/commandExecution/requestApproval",
            json!({"decision":"always"})
        )
        .is_err());
        assert!(reply_request(
            "thread",
            json!(1),
            "item/permissions/requestApproval",
            json!({"response":{"permissions":{},"scope":"session"}})
        )
        .is_err());
    }
}
