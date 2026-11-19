use wasm_bindgen::prelude::*;

use crate::bim::building::Building;
use crate::bim::base_types::Id;
use super::base_types::WasmId;


#[wasm_bindgen]
pub struct WasmBuilding {
    binding: Building,
}

#[wasm_bindgen]
impl WasmBuilding {
    #[wasm_bindgen(constructor)]   
    #[wasm_bindgen(js_name = fromData)]
    pub fn from_json(topology_json: &str,construction_json: &str) -> Result<WasmBuilding, JsValue> {
        Building::from_json(topology_json, construction_json)
            .map(|binding| WasmBuilding { binding })
            .map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = faceIds)]
    pub fn face_ids(&self) -> js_sys::Array {
        self.binding
            .topology
            .face_ids()
            .into_iter()
            .map(WasmId::from)
            .map(JsValue::from)
            .collect()
    }

    #[wasm_bindgen(js_name = layerGeometry)]
    pub fn layer_geometry(&self, face_id: WasmId) -> Result<JsValue, JsValue> {
        let face_id = Id {index: face_id.index, generation: face_id.generation};

        let geometry = self
            .binding
            .layer_geometry(face_id)
            .map_err(|e| JsValue::from_str(&e))?;

        serde_wasm_bindgen::to_value(&geometry)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = solveJoints)]
    pub fn solve_joints(&mut self) {
        self.binding.solve_joints();
    }

    /// Layer geometry of every face as a JSON string:
    /// `[{ uuid, type, layers: [{ name, uuid, area, inner: [[x,y,z]], outer: [[x,y,z]], joints: [{ face, layer_idx } | null] }] }]`.
    /// Joint faces are given by uuid, as in the Python binding.
    #[wasm_bindgen(js_name = geometryJson)]
    pub fn geometry_json(&self) -> Result<String, JsValue> {
        let topology = &self.binding.topology;
        let mut faces = Vec::new();

        for face_id in topology.face_ids() {
            let face = topology.face(face_id).ok_or_else(|| JsValue::from_str("Face not found"))?;
            let geometry = self.binding.layer_geometry(face_id).map_err(|e| JsValue::from_str(&e))?;

            let mut layers = Vec::with_capacity(geometry.len());
            for (layer_idx, (name, uuid, joints, layer, area)) in geometry.into_iter().enumerate() {
                let points = |pts: &[openmaths::Vector3]| -> Vec<[f64; 3]> {
                    pts.iter().map(|p| [p.x, p.y, p.z]).collect()
                };
                let layer_joints: Vec<serde_json::Value> = joints
                    .get(layer_idx)
                    .map(|row| {
                        row.iter()
                            .map(|joint| match joint {
                                Some(j) => serde_json::json!({
                                    "face": topology.face(j.face_id).map(|f| f.uuid.clone()),
                                    "layer_idx": j.layer_idx,
                                }),
                                None => serde_json::Value::Null,
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                layers.push(serde_json::json!({
                    "name": name,
                    "uuid": uuid,
                    "area": area,
                    "inner": points(&layer.inner),
                    "outer": points(&layer.outer),
                    "joints": layer_joints,
                }));
            }

            faces.push(serde_json::json!({
                "uuid": face.uuid,
                "type": face.face_type,
                "layers": layers,
            }));
        }

        serde_json::to_string(&faces).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}