"""Small exact-value tests for the memory-efficient checkpoint loader."""
from __future__ import annotations

import json
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np

from weights import load_readonly_state, prepare_readonly_weights


def checkpoint(path: Path, tensors: dict[str, tuple[str, np.ndarray]]) -> None:
    header, payload = {}, bytearray()
    for name, (dtype, tensor) in tensors.items():
        block = tensor.tobytes()
        header[name] = {"dtype": dtype, "shape": list(tensor.shape), "data_offsets": [len(payload), len(payload) + len(block)]}
        payload.extend(block)
    encoded = json.dumps(header).encode("utf-8")
    path.write_bytes(struct.pack("<Q", len(encoded)) + encoded + payload)


class ReadonlyWeightsTest(unittest.TestCase):
    def test_precision_and_strict_meta_assignment(self) -> None:
        import torch

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "model.safetensors"
            original = np.array([[1.5, -2], [0.125, 3.25]], dtype=np.float16)
            checkpoint(source, {"weight": ("F16", original), "bias": ("F32", np.array([0.25, -0.5], dtype=np.float32))})
            state = load_readonly_state(source, root / "cache")
            with torch.device("meta"):
                model = torch.nn.Linear(2, 2)
            model.load_state_dict(state, strict=True, assign=True)
            model.to(device="cpu", dtype=torch.float32).eval()
            with torch.inference_mode():
                actual = model(torch.tensor([[2.0, 4.0]])).numpy()
            np.testing.assert_array_equal(actual, np.array([[-4.75, 12.75]], dtype=np.float32))
            self.assertEqual(model.weight.data_ptr(), state["weight"].data_ptr(), "Assign must not copy the full checkpoint")
            del model, state  # Release the mapping before Windows removes the cache.

    def test_bfloat_integer_bool_scalar_and_cache_integrity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "model.safetensors"
            checkpoint(source, {
                "bf16": ("BF16", np.array([0x3FC0, 0xC000], dtype="<u2")),
                "count": ("I64", np.array(42, dtype="<i8")),
                "mask": ("BOOL", np.array([True, False], dtype=np.bool_)),
            })
            state = load_readonly_state(source, root / "cache")
            self.assertEqual(state["bf16"].tolist(), [1.5, -2.0])
            self.assertEqual(state["count"].item(), 42)
            self.assertEqual(state["mask"].tolist(), [True, False])
            del state  # Windows must release the read-only mapping before replacement.
            data, index = prepare_readonly_weights(source, root / "cache")
            expected = data.read_bytes()
            data.write_bytes(b"\0" * len(expected))
            restored, second = prepare_readonly_weights(source, root / "cache")
            self.assertEqual(restored.read_bytes(), expected)
            self.assertEqual(second["dataSha256"], index["dataSha256"])

    def test_invalid_offsets_fail_before_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "bad.safetensors"
            header = json.dumps({"x": {"dtype": "F32", "shape": [2], "data_offsets": [0, 8]}}).encode()
            source.write_bytes(struct.pack("<Q", len(header)) + header)
            with self.assertRaisesRegex(ValueError, "out-of-bounds"):
                prepare_readonly_weights(source, root / "cache")


if __name__ == "__main__":
    unittest.main()
