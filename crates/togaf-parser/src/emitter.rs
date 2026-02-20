//! PlanDocument -> plan.json serialization

use crate::schema::PlanDocument;

/// Serialize a PlanDocument to pretty-printed JSON
pub fn to_json(doc: &PlanDocument) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(doc)
}

/// Serialize a PlanDocument to compact JSON
pub fn to_json_compact(doc: &PlanDocument) -> Result<String, serde_json::Error> {
    serde_json::to_string(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emitter_produces_valid_json() {
        let doc = PlanDocument::default();
        let json = to_json(&doc).unwrap();
        // Verify it roundtrips
        let _: PlanDocument = serde_json::from_str(&json).unwrap();
    }
}
