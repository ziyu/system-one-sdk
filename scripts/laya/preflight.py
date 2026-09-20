"""Small random-weight architecture diagnostic. This is NOT trained Laya parity.

Exercises the actual upstream decision model and ModernBERT implementation at
small dimensions, without downloading the checkpoint or creating laya.json.
"""
from __future__ import annotations

import argparse
import gc
import sys
import tempfile
from pathlib import Path
from typing import Any

from export import export_graph
from reference import DEFAULT_CACHE_DIR, INPUTS, MODEL, OUTPUTS, REVISION, upstream_modules


def batch(batch_size: int, sequence: int, options: int) -> dict[str, Any]:
    import torch

    ids = torch.randint(4, 128, (batch_size, sequence), dtype=torch.int64)
    attention = torch.ones_like(ids)
    positions = torch.arange(1, 2 * options, 2, dtype=torch.int64).repeat(batch_size, 1)
    mask = torch.ones((batch_size, options), dtype=torch.bool)
    ids[:, 0], ids[:, -1] = 1, 2
    for row in range(batch_size):
        count = max(1, options - row)
        mask[row, count:] = False
        positions[row, count:] = 0
        ids[row, positions[row, :count]] = 3
        if row:
            attention[row, -row:] = 0
            ids[row, -row:] = 0
    return {"input_ids": ids, "attention_mask": attention, "marker_pos": positions, "marker_mask": mask, "qtype": torch.arange(batch_size, dtype=torch.int64) % 3}


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    import numpy as np
    import onnxruntime as ort
    import torch
    from huggingface_hub import hf_hub_download
    from transformers import AutoConfig, AutoModel

    print("DIAGNOSTIC ONLY: small random-weight architecture, not trained Laya inference", flush=True)
    sources = {
        name: Path(hf_hub_download(MODEL, name, revision=REVISION, token=False,
                                  cache_dir=str(args.cache_dir or DEFAULT_CACHE_DIR),
                                  local_files_only=args.offline))
        for name in ("rl_common.py", "rl_agent_api.py", "encoder/config.json")
    }
    common, _ = upstream_modules(sources["rl_common.py"].parent)
    config = AutoConfig.from_pretrained(sources["encoder/config.json"].parent, local_files_only=True, trust_remote_code=False)
    config.hidden_size, config.intermediate_size, config.num_attention_heads = 128, 256, 2
    config.num_hidden_layers, config.layer_types = 4, config.layer_types[:4]
    config.vocab_size, config.max_position_embeddings = 128, 512
    config.pad_token_id, config.cls_token_id, config.sep_token_id = 0, 1, 2
    config.bos_token_id, config.eos_token_id, config.reference_compile = 1, 2, False
    torch.manual_seed(9)
    torch.set_num_threads(2)
    model = common.DecisionModel(AutoModel.from_config(config, attn_implementation="sdpa"), head_layers=2, n_act=2).eval()
    previous_fastpath = torch.backends.mha.get_fastpath_enabled()
    torch.backends.mha.set_fastpath_enabled(False)
    work = Path(__file__).resolve().parents[2] / ".research"
    work.mkdir(exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="laya-preflight-", dir=work) as temporary:
            path = Path(temporary) / "diagnostic.onnx"
            export_graph(model, batch(4, 48, 4), path, 512)
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
            try:
                for dimensions in ((4, 48, 4), (1, 17, 2), (3, 137, 5), (2, 512, 11)):
                    tensors = batch(*dimensions)
                    with torch.no_grad():
                        expected = tuple(value.numpy() for value in model(*(tensors[key] for key in INPUTS)))
                    actual = session.run(list(OUTPUTS), {key: value.numpy() for key, value in tensors.items()})
                    errors = []
                    for left, right in zip(expected, actual):
                        np.testing.assert_allclose(right, left, atol=0.00005, rtol=0.0001)
                        errors.append(float(np.max(np.abs(right - left))))
                    print(f"PASS diagnostic B/S/K={dimensions}: raw errors={errors}", flush=True)
            finally:
                del session
                gc.collect()
    finally:
        torch.backends.mha.set_fastpath_enabled(previous_fastpath)
    print("Architecture preflight passed; the full trained checkpoint still requires export.py verification", flush=True)


if __name__ == "__main__":
    main()
