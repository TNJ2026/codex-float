use serde_json::{json, Value};

fn fast_tier(model: &Value) -> Option<String> {
    model["serviceTiers"]
        .as_array()
        .and_then(|tiers| {
            tiers.iter().find_map(|tier| {
                let id = tier["id"].as_str()?;
                let name = tier["name"].as_str().unwrap_or("").to_ascii_lowercase();
                (matches!(id, "fast" | "priority") || matches!(name.as_str(), "fast" | "priority"))
                    .then(|| id.to_owned())
            })
        })
        .or_else(|| {
            model["additionalSpeedTiers"].as_array().and_then(|tiers| {
                tiers
                    .iter()
                    .filter_map(Value::as_str)
                    .find(|id| matches!(*id, "fast" | "priority"))
                    .map(str::to_owned)
            })
        })
}
fn speed_params(
    thread: &str,
    expected_model: &str,
    current: &Value,
    tier: &str,
) -> Result<Value, String> {
    if current["model"] != expected_model {
        return Err("模型已在主 App 变化，请重新打开速度设置".into());
    }
    let mut params = json!({"conversationId":thread,"threadSettings":{"serviceTier":tier},"condition":{"ifModelEquals":expected_model}});
    if let Some(effort) = current.get("reasoningEffort") {
        params["condition"]["ifEffortEquals"] = effort.clone();
    }
    Ok(params)
}
#[tauri::command]
pub async fn update_speed_settings(
    app: tauri::AppHandle,
    thread_id: String,
    model: String,
    fast: bool,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tier = if fast {
            let models = super::model_settings::model_catalog(&app, false)?;
            let entry = models
                .iter()
                .find(|entry| entry["model"] == model)
                .ok_or("当前模型已不可用，请刷新模型列表")?;
            fast_tier(entry).ok_or("当前模型未提供快速模式，或账号暂无此档位")?
        } else {
            "default".to_owned()
        };
        let client = crate::codex::get_client(&app)?;
        let binding = client
            .binding
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .clone()
            .ok_or("请先连接聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，速度设置未更新".into());
        }
        let response = client.rpc(
            "thread-follower-read-model-settings",
            json!({"conversationId":thread_id}),
            1,
            Some(&binding.1),
        )?;
        let params = speed_params(&thread_id, &model, &response["result"]["settings"], &tier)?;
        let result = client.rpc(
            "thread-follower-update-thread-settings",
            params,
            2,
            Some(&binding.1),
        )?;
        if result["result"]["applied"] != true {
            return Err("速度设置未应用，请刷新后重试".into());
        }
        Ok(json!({"threadSettings":{"serviceTier":tier}}))
    })
    .await
    .map_err(|error| error.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn speed_uses_advertised_tiers_and_changes_only_service_tier() {
        assert_eq!(
            fast_tier(&json!({"serviceTiers":[{"id":"priority","name":"Fast"}]})).as_deref(),
            Some("priority")
        );
        assert_eq!(
            fast_tier(&json!({"serviceTiers":[{"id":"fast","name":"Fast"}]})).as_deref(),
            Some("fast")
        );
        assert_eq!(
            fast_tier(&json!({"additionalSpeedTiers":["fast"]})).as_deref(),
            Some("fast")
        );
        assert!(
            fast_tier(&json!({"serviceTiers":[{"id":"ultrafast","name":"Ultrafast"}]})).is_none()
        );
        let params = speed_params(
            "t",
            "model",
            &json!({"model":"model","reasoningEffort":null}),
            "default",
        )
        .unwrap();
        assert_eq!(params["threadSettings"], json!({"serviceTier":"default"}));
        assert_eq!(params["condition"]["ifEffortEquals"], Value::Null);
        assert!(speed_params("t", "old", &json!({"model":"new"}), "fast").is_err());
    }
}
