"""Export all of the pinned Laya decision model, then verify against upstream Python.

Example: python scripts/laya/export.py --output .artifacts/laya
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from typing import Any

from reference import FORMAT, INPUTS, MODEL, OUTPUTS, REVISION, Reference, calibration, cases, snapshot, write_json


def external_files(model_path: Path) -> list[dict[str, str]]:
    import onnx
    from onnx.external_data_helper import _get_all_tensors

    graph = onnx.load(str(model_path), load_external_data=False)
    locations = set()
    for tensor in _get_all_tensors(graph):
        if tensor.data_location == onnx.TensorProto.EXTERNAL:
            info = {entry.key: entry.value for entry in tensor.external_data}
            location = info.get("location", "")
            relative = Path(location)
            if not location or relative.is_absolute() or ".." in relative.parts or "\\" in location or ":" in location:
                raise ValueError(f"Unsafe ONNX external data location: {location!r}")
            if not (model_path.parent / relative).is_file():
                raise FileNotFoundError(f"Missing external weights: {location}")
            locations.add(location)
    return [{"path": location, "data": location} for location in sorted(locations)]


def export_graph(model: Any, batch: dict[str, Any], output: Path, max_length: int) -> None:
    import torch

    class Wrapper(torch.nn.Module):
        def __init__(self, original: Any):
            super().__init__()
            self.original = original

        def forward(self, input_ids: Any, attention_mask: Any, marker_pos: Any, marker_mask: Any, qtype: Any) -> tuple[Any, Any]:
            logits, act_logits = self.original(input_ids, attention_mask, marker_pos, marker_mask, qtype)
            return logits.float(), act_logits.float()

    # Torch specializes size-one broadcasting during capture. Export from the
    # non-singleton branch; verify.py must separately prove ONNX batch-one parity.
    batch_size = torch.export.Dim("batch", min=2, max=64)
    sequence = torch.export.Dim("sequence", min=8, max=max_length)
    options = torch.export.Dim("options", min=2, max=max_length)
    dynamic = (
        {0: batch_size, 1: sequence}, {0: batch_size, 1: sequence},
        {0: batch_size, 1: options}, {0: batch_size, 1: options}, {0: batch_size},
    )
    previous_fastpath = torch.backends.mha.get_fastpath_enabled()
    torch.backends.mha.set_fastpath_enabled(False)
    try:
        # Do not use no_grad here: the fused TransformerEncoder fast path is not exportable.
        torch.onnx.export(
            Wrapper(model).eval(), tuple(batch[key] for key in INPUTS), str(output),
            input_names=list(INPUTS), output_names=list(OUTPUTS),
            opset_version=18, dynamo=True, dynamic_shapes=dynamic,
            # Let ORT optimize after verification releases Torch's weights;
            # folding every FP32 weight here can double peak export memory.
            external_data=True, optimize=False, verbose=False,
        )
    finally:
        torch.backends.mha.set_fastpath_enabled(previous_fastpath)


def export(reference: Reference, output: Path) -> Path:
    import onnx

    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"Output directory must be empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    config, tokenizer = reference.config, reference.tokenizer
    if not isinstance(config["max_len"], int) or config["max_len"] < 8:
        raise ValueError("max_len must be an integer >= 8")
    batch, _ = reference.encode(cases(tokenizer.mask_token)[0]["request"])
    model_path = output / "model.onnx"
    export_graph(reference.model, batch, model_path, config["max_len"])
    onnx.checker.check_model(str(model_path))
    external_data = external_files(model_path)
    shutil.copytree(reference.source / "tokenizer", output / "tokenizer")
    card = reference.source / "README.md"
    shutil.copyfile(card, output / "UPSTREAM_MODEL_CARD.md")
    notices = []
    for name in ("LICENSE", "LICENSE.*", "NOTICE", "NOTICE.*"):
        for document in sorted(reference.source.glob(name)):
            if document.is_file():
                target = "UPSTREAM_" + document.name
                shutil.copyfile(document, output / target)
                notices.append(target)
    (output / "MODEL_PROVENANCE.md").write_text(
        f"# Original Laya checkpoint\n\nModel: `{MODEL}`\n\nRevision: `{REVISION}`\n\n"
        f"Source: https://huggingface.co/{MODEL}/tree/{REVISION}\n\n"
        "The original model card is preserved verbatim in `UPSTREAM_MODEL_CARD.md`, including its license metadata. "
        "The SDK's software license does not replace the model's licensing terms.\n\n"
        + ("Original license/notice files: " + ", ".join(f"`{name}`" for name in notices) + ".\n" if notices
           else "This revision contains no separate root LICENSE/NOTICE file; consult the preserved original model card for license information.\n"),
        encoding="utf-8",
    )
    temperatures, buckets = calibration(config)
    token_ids = {key: getattr(tokenizer, key + "_token_id") for key in ("cls", "sep", "pad", "mask")}
    if any(not isinstance(value, int) or value < 0 for value in token_ids.values()):
        raise ValueError("The checkpoint must define CLS, SEP, PAD and MASK token IDs")
    manifest = {
        "format": FORMAT, "model": MODEL, "revision": REVISION,
        "modelFile": model_path.name, "externalData": external_data, "tokenizer": "tokenizer",
        "maxLength": config["max_len"], "headMaxLength": config["head_max_len"],
        "temperature": temperatures, "temperatureByOptions": buckets,
        "tokenIds": token_ids, "maskToken": tokenizer.mask_token,
    }
    # Verification must succeed before laya.json marks the artifact as consumable.
    from verify import verify

    report, fixtures = verify(reference, model_path)
    write_json(output / "parity-report.json", report)
    write_json(output / "parity-fixtures.json", fixtures)
    manifest_path = output / "laya.json"
    write_json(manifest_path, manifest)
    return manifest_path


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="An empty output directory; existing artifacts are never overwritten")
    parser.add_argument("--cache-dir", type=Path, help="Optional Hugging Face cache directory")
    parser.add_argument("--weight-cache-dir", type=Path, help="Read-only FP32 cache; defaults to .research/laya-fp32 in this repository")
    parser.add_argument("--threads", type=int, default=4, help="CPU inference threads (default: 4)")
    parser.add_argument("--offline", action="store_true", help="Require the pinned snapshot to already exist in the cache")
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    import torch
    torch.set_num_threads(args.threads)
    print(f"Loading {MODEL}@{REVISION} on CPU in FP32", flush=True)
    reference = Reference.load(snapshot(args.cache_dir, args.offline), args.weight_cache_dir)
    print(f"Exporting encoder, decision head, and act head to {args.output}", flush=True)
    manifest = export(reference, args.output.resolve())
    print(f"Verified artifact: {manifest}", flush=True)


if __name__ == "__main__":
    main()
