"""Pinned upstream loading, input fixtures, and Laya's original answer semantics.

The model and preprocessing are loaded from the same immutable HF snapshot:
https://huggingface.co/convaiinnovations/laya/tree/1c5edc17a7acd8701df6fc341c0d179f1c62c982
No remote Transformers custom code or Hugging Face token is needed.
"""
from __future__ import annotations

import importlib.util
import importlib.metadata
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

MODEL = "convaiinnovations/laya"
REVISION = "1c5edc17a7acd8701df6fc341c0d179f1c62c982"
FORMAT = "system-one-laya-onnx-v1"
DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[2] / ".research" / "laya-hf"
INPUTS = ("input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype")
OUTPUTS = ("logits", "act_logits")


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def calibration(config: dict[str, Any]) -> tuple[list[float], dict[str, float]]:
    temperatures = config.get("temperature", [1.0, 1.0, 1.0])
    buckets = config.get("temperature_by_options", {})
    positive = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0
    if not isinstance(temperatures, list) or len(temperatures) != 3 or not all(map(positive, temperatures)):
        raise ValueError("temperature must contain three finite positive numbers")
    if not isinstance(buckets, dict) or any(
        not re.fullmatch(r"(?:choice|score|noul):(?:2|3-5|6-10|11\+)", key) or not positive(value)
        for key, value in buckets.items()
    ):
        raise ValueError("temperature_by_options must map Laya type/cardinality buckets to positive numbers")
    return list(map(float, temperatures)), {key: float(value) for key, value in buckets.items()}


def snapshot(cache_dir: Path | None = None, offline: bool = False) -> Path:
    from huggingface_hub import snapshot_download

    return Path(snapshot_download(
        repo_id=MODEL, revision=REVISION, token=False,
        cache_dir=str(cache_dir or DEFAULT_CACHE_DIR),
        local_files_only=offline,
        allow_patterns=["rl_common.py", "rl_agent_api.py", "rl_agent_config.json", "model.safetensors", "encoder/config.json", "tokenizer/*", "README.md", "LICENSE", "LICENSE.*", "NOTICE", "NOTICE.*"],
    ))


def _module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load pinned upstream module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def upstream_modules(source: Path) -> tuple[ModuleType, ModuleType]:
    common = _module("_system_one_laya_common", source / "rl_common.py")
    previous = sys.modules.get("rl_common")
    sys.modules["rl_common"] = common
    try:
        api = _module("_system_one_laya_api", source / "rl_agent_api.py")
    finally:
        if previous is None:
            del sys.modules["rl_common"]
        else:
            sys.modules["rl_common"] = previous
    return common, api


@dataclass
class Reference:
    source: Path
    config: dict[str, Any]
    tokenizer: Any
    model: Any
    common: ModuleType
    api: ModuleType

    @classmethod
    def load(cls, source: Path, weight_cache: Path | None = None) -> Reference:
        import torch
        from transformers import AutoTokenizer
        from weights import load_readonly_state

        common, api = upstream_modules(source)
        config = read_json(source / "rl_agent_config.json")
        encoder_config = read_json(source / "encoder/config.json")
        expected_version = encoder_config.get("transformers_version")
        if expected_version and importlib.metadata.version("transformers") != expected_version:
            raise RuntimeError(f"Use transformers=={expected_version} from scripts/laya/requirements.txt to match the saved encoder")
        calibration(config)
        tokenizer = AutoTokenizer.from_pretrained(source / "tokenizer", local_files_only=True, trust_remote_code=False)
        print("Constructing the pinned architecture without allocating random checkpoint weights", flush=True)
        with torch.device("meta"):
            model = common.build_model(config, encoder_dir=str(source / "encoder"))
        # ModernBERT 5.0.0 keeps four rotary buffers out of the checkpoint.
        # Recreate just that small module on CPU before materializing weights.
        rotary = model.encoder.rotary_emb
        model.encoder.rotary_emb = type(rotary)(config=model.encoder.config, device=torch.device("cpu"))
        print("Loading trained safetensors with strict parameter matching", flush=True)
        weight_cache = weight_cache or Path(__file__).resolve().parents[2] / ".research" / "laya-fp32"
        model.load_state_dict(load_readonly_state(source / "model.safetensors", weight_cache), strict=True, assign=True)
        remaining_meta = [name for name, value in (*model.named_parameters(), *model.named_buffers()) if value.is_meta]
        if remaining_meta:
            raise RuntimeError(f"Unmaterialized model state after loading: {remaining_meta}")
        # Mapped parameters are inference-only: set metadata, never mutate data.
        model = model.to(device="cpu", dtype=torch.float32).requires_grad_(False).eval()
        model.encoder.config.reference_compile = False
        return cls(source, config, tokenizer, model, common, api)

    def questions(self, request: dict[str, Any]) -> dict[str, Any]:
        return {
            key: {**question, "type": "noul" if question["type"] == "boolean" else question["type"]}
            for key, question in request["questions"].items()
        }

    def encode(self, request: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        items = []
        for key, definition in self.questions(request).items():
            question = self.api.RLAgent._to_internal(definition)
            count = len(self.common.render_options(question))
            if count < 1:
                raise ValueError(f"question {key!r}: at least one option is required")
            ids, markers = self.common.build_sequence(
                self.tokenizer, request["state"], question, self.config["max_len"], self.config["head_max_len"],
            )
            if len(markers) != count:
                raise ValueError(f"question {key!r}: options do not fit in max_len={self.config['max_len']}")
            items.append({
                "ids": ids, "markers": markers, "qtype": self.common.QTYPES[question["t"]],
                "target": [0.0] * count, "label": -1, "episode": 0, "ep_step": 0, "ep_len": 1,
            })
        if not items:
            raise ValueError("At least one question is required")
        batch = self.common.collate_items([items], self.tokenizer.pad_token_id)
        if batch["marker_pos"].shape[1] < 2:
            import torch.nn.functional as functional

            # SDK singleton choices pad the marker axis so the original act
            # head's topk(2) remains defined. The added option is always masked.
            batch["marker_pos"] = functional.pad(batch["marker_pos"], (0, 1), value=0)
            batch["marker_mask"] = functional.pad(batch["marker_mask"], (0, 1), value=False)
        return {key: batch[key] for key in INPUTS}, items

    def upstream_answers(self, request: dict[str, Any]) -> dict[str, Any]:
        import torch

        # Reuse the strictly loaded model; RLAgent.__init__ would allocate a second checkpoint.
        agent = self.api.RLAgent.__new__(self.api.RLAgent)
        agent.cfg, agent.tok, agent.model = self.config, self.tokenizer, self.model
        agent.device, agent.dtype = torch.device("cpu"), torch.float32
        agent.temperature, agent.temperature_by_options = calibration(self.config)
        return agent.system_one(request["state"], self.questions(request))

    def decode(self, request: dict[str, Any], logits: Any, act_logits: Any, items: list[dict[str, Any]]) -> dict[str, Any]:
        import numpy as np
        import torch

        temperatures, buckets = calibration(self.config)
        # Upstream applies softmax to the raw act head independently of answer temperature.
        act = torch.softmax(torch.from_numpy(np.array(act_logits, dtype=np.float32, copy=True)), -1).numpy()
        answers = {}
        for row, (key, definition) in enumerate(self.questions(request).items()):
            question = self.api.RLAgent._to_internal(definition)
            count, qtype = len(items[row]["markers"]), items[row]["qtype"]
            temperature = buckets.get(self.common.temp_bucket(qtype, count), temperatures[qtype])
            z = np.asarray(logits[row, :count], dtype=np.float32) / temperature
            probabilities = np.exp(z - z.max())
            probabilities /= probabilities.sum()
            extension = {"act_probability": float(act[row, 0])}
            if question["t"] == "noul":
                answers[key] = {"type": "noul", "noul": round(float(probabilities[1]), 4), "rl_agent": extension}
                continue
            keys = list(question["crit"]) if question["t"] == "choice" else list(map(str, range(count)))
            answer = {
                "type": question["t"],
                "probabilities": {name: round(float(probability), 4) for name, probability in zip(keys, probabilities)},
                "confidence": round(self.common.confidence_from_probs(probabilities, count), 4),
                "rl_agent": extension,
            }
            if question["t"] == "choice":
                answer["choice"] = keys[int(probabilities.argmax())]
            else:
                answer["score"] = round(float((np.arange(count) * probabilities).sum()), 4)
                answer["legend"] = {str(index): value for index, value in enumerate(question["crit"])}
            answers[key] = answer
        return {"model": "rl-agent", "answers": answers, "usage": {"input_tokens": sum(len(item["ids"]) for item in items), "output_tokens": 0}}


def cases(mask_token: str) -> list[dict[str, Any]]:
    return [
        {"name": "mixed-types-padded-options", "request": {
            "state": "The customer cannot sign in after a password reset. They are frustrated but polite.",
            "questions": {
                "route": {"type": "choice", "instructions": "Which queue should handle this?", "criteria": {"access": "Account access", "billing": "Payments", "sales": None, "other": "Something else"}},
                "urgency": {"type": "score", "instructions": "How urgent is the request?", "criteria": ["low", "normal", "urgent"]},
                "login": {"type": "boolean", "instructions": "Does the customer need help signing in?"},
                "only": {"type": "choice", "instructions": "Select the available queue.", "criteria": {"support": None}},
            },
        }},
        {"name": "one-row-two-options", "request": {
            "state": "The light is off.",
            "questions": {"on": {"type": "boolean", "instructions": "Is the light on?", "criteria": {"true": "The light is on", "false": "The light is off"}}},
        }},
        {"name": "singleton-with-masked-padding", "request": {
            "state": "Only one action is available.",
            "questions": {"only": {"type": "choice", "instructions": "Choose an action.", "criteria": {"continue": None}}},
        }},
        {"name": "structured-unicode-and-mask", "request": {
            "state": {"text": f"Café 東京 {mask_token} and a literal marker", "events": [None, True, {"count": 2}]},
            "questions": {"route": {"type": "choice", "instructions": {"task": f"Select a label {mask_token}", "language": "français"}, "criteria": {f"label-{i}": "Label " + str(i) for i in range(11)}}},
        }},
        {"name": "state-truncation", "request": {
            "state": "The shipment has been delayed and the customer is asking for an update. " * 160,
            "questions": {"delay": {"type": "score", "instructions": "Rate the reported delay.", "criteria": ["none", "short", "moderate", "long", "very long"]}},
        }},
        {"name": "instruction-and-option-truncation", "request": {
            "state": "Please choose a support queue.",
            "questions": {"route": {"type": "choice", "instructions": "Select the best option. " * 100, "criteria": {f"queue-{i}": (f"Support queue {i} handles requests. " * 60) for i in range(8)}}},
        }},
    ]
