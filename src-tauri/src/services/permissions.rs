use serde_json::{json, Value};

// Snapshot fields contain both representations; the update API accepts only one.
pub(super) fn wire_patch(mut patch: Value) -> Value {
    if patch
        .get("sandboxPolicy")
        .is_some_and(|value| !value.is_null())
    {
        if let Some(fields) = patch.as_object_mut() {
            fields.remove("permissions");
        }
    } else if patch.get("permissions").is_none_or(Value::is_null) {
        if let Some(profile) = patch["activePermissionProfile"]["id"].as_str() {
            patch["permissions"] = json!(profile);
        }
    }
    if let Some(fields) = patch.as_object_mut() {
        fields.remove("activePermissionProfile");
    }
    patch
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wire_permissions_are_mutually_exclusive_and_keep_exact_policy() {
        let policy = json!({"type":"workspaceWrite","writableRoots":["D:/repo","D:/extra"],"networkAccess":false});
        let wire = wire_patch(
            json!({"model":"test","approvalPolicy":"on-request","permissions":":workspace","activePermissionProfile":{"id":":workspace"},"sandboxPolicy":policy}),
        );
        assert_eq!(wire["sandboxPolicy"], policy);
        assert_eq!(wire["approvalPolicy"], "on-request");
        assert_eq!(wire["model"], "test");
        assert!(wire.get("permissions").is_none());
        assert!(wire.get("activePermissionProfile").is_none());
        let wire = wire_patch(json!({"activePermissionProfile":{"id":"custom-profile"}}));
        assert_eq!(wire["permissions"], "custom-profile");
        assert!(wire.get("sandboxPolicy").is_none());
        assert!(wire.get("activePermissionProfile").is_none());
    }
}
