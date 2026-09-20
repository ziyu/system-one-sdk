"""Compare an exported ONNX graph against the pinned original PyTorch model.

This is CPU export parity, not a browser/WebGPU compatibility or latency claim.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import re
import sys
from pathlib import Path
from typing import Any

from reference import FORMAT, INPUTS, MODEL, OUTPUTS, REVISION, Reference, calibration, cases, read_json, snapshot, write_json


def _asset(directory: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value or re.search(r"^[/.]|[\\?#:]|(?:^|/)\.\.(?:/|$)", value):
        raise ValueError("Manifest asset paths must be relative to its directory")
    return directory / value


def _verify_manifest_metadata(reference: Reference, manifest: dict[str, Any], directory: Path) -> None:
    temperatures, buckets = calibration(reference.config)
    expected = {
        "maxLength": reference.config["max_len"], "headMaxLength": reference.config["head_max_len"],
        "temperature": temperatures, "temperatureByOptions": buckets,
        "tokenIds": {key: getattr(reference.tokenizer, key + "_token_id") for key in ("cls", "sep", "pad", "mask")},
        "maskToken": reference.tokenizer.mask_token,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValueError(f"Manifest {key} differs from the pinned original checkpoint")
    tokenizer = _asset(directory, manifest.get("tokenizer"))
    for name in ("tokenizer.json", "tokenizer_config.json"):
        with (reference.source / "tokenizer" / name).open("rb") as original, (tokenizer / name).open("rb") as exported:
            if hashlib.file_digest(original, "sha256").digest() != hashlib.file_digest(exported, "sha256").digest():
                raise ValueError(f"Exported {name} differs from the pinned original tokenizer")


def _compare_answers(expected: Any, actual: Any, path: str = "response", atol: float = 0.0002) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or expected.keys() != actual.keys():
            raise AssertionError(f"{path}: mismatched keys")
        for key, value in expected.items():
            _compare_answers(value, actual[key], f"{path}.{key}", atol)
    elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
        if not isinstance(actual, (int, float)) or abs(expected - actual) > atol:
            raise AssertionError(f"{path}: {actual!r} != {expected!r} within {atol}")
    elif expected != actual:
        raise AssertionError(f"{path}: {actual!r} != {expected!r}")


def verify(reference: Reference, model_path: Path, *, atol: float = 0.0005, rtol: float = 0.0001, input_cases: list[dict[str, Any]] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    import numpy as np
    import onnxruntime as ort
    import torch

    input_cases = input_cases if input_cases is not None else cases(reference.tokenizer.mask_token)
    if not isinstance(input_cases, list) or not input_cases:
        raise ValueError("Parity verification requires a nonempty array of cases")
    # Never hold a second complete 421M FP32 checkpoint in ORT alongside Torch.
    # Keep only the small input/output fixtures, then release the reference model.
    reference_data = []
    previous_fastpath = torch.backends.mha.get_fastpath_enabled()
    torch.backends.mha.set_fastpath_enabled(False)
    try:
        for case in input_cases:
            request = case["request"]
            tensors, items = reference.encode(request)
            feeds = {key: tensors[key].cpu().numpy() for key in INPUTS}
            with torch.no_grad():
                expected = tuple(value.cpu().numpy() for value in reference.model(*(tensors[key] for key in INPUTS)))
            decoded_torch = reference.decode(request, *expected, items)
            original_api = max(len(item["markers"]) for item in items) >= 2
            # Standalone singleton choices crash the original API's topk(2).
            # Verify this explicit SDK extension against the original model
            # with a masked second marker, without claiming native API parity.
            upstream = reference.upstream_answers(request) if original_api else decoded_torch
            _compare_answers(upstream, decoded_torch, atol=0.00001)
            reference_data.append((case, feeds, expected, items, upstream, original_api))
            print(f"Reference captured: {case['name']}", flush=True)
    finally:
        torch.backends.mha.set_fastpath_enabled(previous_fastpath)
    reference.model = None
    torch.compiler.reset()
    gc.collect()
    print("Released PyTorch weights; opening ONNX Runtime for numerical comparison", flush=True)
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = min(torch.get_num_threads(), 4)
    session = ort.InferenceSession(str(model_path), sess_options=session_options, providers=["CPUExecutionProvider"])
    expected_types = {"input_ids": "tensor(int64)", "attention_mask": "tensor(int64)", "marker_pos": "tensor(int64)", "marker_mask": "tensor(bool)", "qtype": "tensor(int64)"}
    if {item.name: item.type for item in session.get_inputs()} != expected_types:
        raise AssertionError("ONNX inputs must match the five-input Laya contract")
    if {item.name: item.type for item in session.get_outputs()} != {name: "tensor(float)" for name in OUTPUTS}:
        raise AssertionError("ONNX outputs must be FP32 logits and act_logits")
    results, fixtures = [], []
    for case, feeds, expected, items, upstream, original_api in reference_data:
        actual = session.run(list(OUTPUTS), feeds)
        np.testing.assert_array_equal(actual[0][~feeds["marker_mask"]], -10000.0, err_msg=f"{case['name']}: padded options must remain masked")
        errors = {}
        for name, left, right in zip(OUTPUTS, expected, actual):
            if left.shape != right.shape or right.dtype != np.float32 or not np.isfinite(right).all():
                raise AssertionError(f"{case['name']}.{name}: invalid shape, dtype, or nonfinite output")
            np.testing.assert_allclose(right, left, atol=atol, rtol=rtol, err_msg=f"{case['name']}.{name}")
            errors[name] = float(np.abs(right - left).max())
        decoded_onnx = reference.decode(case["request"], *actual, items)
        _compare_answers(upstream, decoded_onnx)
        results.append({"name": case["name"], "shapes": {key: list(value.shape) for key, value in feeds.items()}, "maxAbsoluteError": errors, "originalApiCompared": original_api})
        fixtures.append({"name": case["name"], "request": case["request"], "inputs": {key: value.tolist() for key, value in feeds.items()}, "outputs": {name: value.tolist() for name, value in zip(OUTPUTS, expected)}, "upstreamResponse": upstream, "originalApiCompared": original_api})
        print(f"PASS {case['name']}: logits={errors['logits']:.6g}, act_logits={errors['act_logits']:.6g}", flush=True)
    report = {
        "model": MODEL, "revision": REVISION, "provider": "CPUExecutionProvider",
        "precision": "float32", "atol": atol, "rtol": rtol,
        "versions": {name: importlib.metadata.version(name) for name in ("torch", "transformers", "onnx", "onnxscript", "onnx-ir", "onnxruntime", "numpy", "safetensors", "huggingface-hub", "tokenizers")},
        "cases": results, "browserVerified": False,
    }
    return report, {"format": "system-one-laya-parity-v1", "model": MODEL, "revision": REVISION, "cases": fixtures}


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--weight-cache-dir", type=Path)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--cases", type=Path, help="Optional JSON array of {name, request} fixtures")
    parser.add_argument("--report", type=Path, help="Optional output report path")
    parser.add_argument("--fixtures", type=Path, help="Optional browser parity input/output fixture path")
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    import torch
    torch.set_num_threads(args.threads)
    manifest = read_json(args.manifest)
    if (manifest.get("format"), manifest.get("model"), manifest.get("revision")) != (FORMAT, MODEL, REVISION):
        raise ValueError("Verification requires the pinned upstream model/revision and manifest format")
    model_path = _asset(args.manifest.parent, manifest.get("modelFile"))
    if not model_path.is_file():
        raise FileNotFoundError(model_path)
    reference = Reference.load(snapshot(args.cache_dir, args.offline), args.weight_cache_dir)
    _verify_manifest_metadata(reference, manifest, args.manifest.parent)
    report, fixtures = verify(reference, model_path, input_cases=read_json(args.cases) if args.cases else None)
    if args.report:
        write_json(args.report, report)
    if args.fixtures:
        write_json(args.fixtures, fixtures)
    print(f"Verified {len(report['cases'])} cases against original Python. Browser/WebGPU verification remains separate.", flush=True)


if __name__ == "__main__":
    main()
