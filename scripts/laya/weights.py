"""Load inference-only FP32 weights without a private copy of the full model.

Windows reserves commit for safetensors' copy-on-write mapping. Combining that
mapping, FP32 conversion and an ONNX exporter can exceed the system commit limit
even when the checkpoint fits in physical RAM. Convert in small chunks to a
verified cache file, then map that file read-only. Returned tensors must never
be modified in place or used with an optimizer.
"""
from __future__ import annotations

import hashlib
import json
import math
import mmap
import os
from pathlib import Path
import struct
from typing import Any
import uuid
import warnings

import numpy as np

FORMAT = "system-one-laya-readonly-fp32-v1"
CHUNK_BYTES = 8 * 1024 * 1024
DTYPES = {
    "F16": ("<f2", "F32"), "BF16": ("<u2", "F32"),
    "F32": ("<f4", "F32"), "F64": ("<f8", "F32"),
    "I64": ("<i8", "I64"), "I32": ("<i4", "I32"),
    "I16": ("<i2", "I16"), "I8": ("i1", "I8"),
    "U8": ("u1", "U8"), "BOOL": ("?", "BOOL"),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK_BYTES), b""):
            digest.update(block)
    return digest.hexdigest()


def layout(checkpoint: Path) -> tuple[int, dict[str, Any], dict[str, Any], int]:
    size = checkpoint.stat().st_size
    with checkpoint.open("rb") as stream:
        prefix = stream.read(8)
        if len(prefix) != 8:
            raise ValueError("Truncated safetensors header")
        header_size = struct.unpack("<Q", prefix)[0]
        if header_size > min(64 * 1024 * 1024, size - 8):
            raise ValueError("Invalid safetensors header length")
        header = json.loads(stream.read(header_size))
    if not isinstance(header, dict):
        raise ValueError("Safetensors header must be an object")
    header.pop("__metadata__", None)
    offset, records, previous_end = 0, {}, 0
    ordered = sorted(header.items(), key=lambda item: item[1]["data_offsets"][0])
    for name, tensor in ordered:
        dtype, shape, bounds = tensor["dtype"], tensor["shape"], tensor["data_offsets"]
        if dtype not in DTYPES or not isinstance(shape, list) or any(type(value) is not int or value < 0 for value in shape):
            raise ValueError(f"Unsupported tensor metadata: {name}")
        if not isinstance(bounds, list) or len(bounds) != 2 or any(type(value) is not int for value in bounds):
            raise ValueError(f"Invalid tensor offsets: {name}")
        begin, end = bounds
        count = math.prod(shape)
        source_dtype, target_dtype = DTYPES[dtype]
        if begin < previous_end or end - begin != count * np.dtype(source_dtype).itemsize or end > size - 8 - header_size:
            raise ValueError(f"Overlapping or out-of-bounds tensor data: {name}")
        previous_end = end
        offset = (offset + 63) // 64 * 64
        nbytes = count * (4 if target_dtype == "F32" else np.dtype(source_dtype).itemsize)
        records[name] = {"dtype": target_dtype, "shape": shape, "offset": offset, "nbytes": nbytes}
        offset += nbytes
    return 8 + header_size, header, records, offset


def prepare_readonly_weights(checkpoint: Path, cache_dir: Path) -> tuple[Path, dict[str, Any]]:
    checkpoint = Path(checkpoint)
    fingerprint = sha256(checkpoint)
    data_start, header, records, total = layout(checkpoint)
    directory = Path(cache_dir) / fingerprint
    directory.mkdir(parents=True, exist_ok=True)
    data_path, index_path = directory / "weights.fp32.bin", directory / "index.json"
    expected = {"format": FORMAT, "sourceSha256": fingerprint, "tensors": records, "totalBytes": total}
    if data_path.is_file() and index_path.is_file():
        try:
            cached = json.loads(index_path.read_text(encoding="utf-8"))
            if isinstance(cached, dict) and all(cached.get(key) == value for key, value in expected.items()) and data_path.stat().st_size == total and sha256(data_path) == cached.get("dataSha256"):
                return data_path, cached
        except (ValueError, OSError):
            pass

    # Let the official parser validate the original container before using its
    # byte offsets. Release this short-lived mapping before FP32 model loading.
    from safetensors import safe_open

    with safe_open(str(checkpoint), framework="numpy", device="cpu") as source:
        if set(source.keys()) != set(header):
            raise ValueError("Safetensors metadata differs from its official parser")
        for name, tensor in header.items():
            if source.get_slice(name).get_shape() != tensor["shape"] or source.get_slice(name).get_dtype() != tensor["dtype"]:
                raise ValueError(f"Safetensors metadata mismatch: {name}")

    suffix = f".{os.getpid()}.{uuid.uuid4().hex}.tmp"
    pending_data, pending_index = directory / ("weights" + suffix), directory / ("index" + suffix)
    digest = hashlib.sha256()
    try:
        with checkpoint.open("rb") as source, pending_data.open("wb") as target:
            for name, record in records.items():
                padding = b"\0" * (record["offset"] - target.tell())
                target.write(padding)
                digest.update(padding)
                tensor = header[name]
                input_dtype = np.dtype(DTYPES[tensor["dtype"]][0])
                source.seek(data_start + tensor["data_offsets"][0])
                remaining = math.prod(record["shape"])
                while remaining:
                    count = min(remaining, CHUNK_BYTES // input_dtype.itemsize)
                    raw = source.read(count * input_dtype.itemsize)
                    if len(raw) != count * input_dtype.itemsize:
                        raise ValueError(f"Truncated tensor: {name}")
                    values = np.frombuffer(raw, dtype=input_dtype)
                    if tensor["dtype"] == "BF16":
                        converted = (values.astype("<u4") << 16).view("<f4")
                    elif record["dtype"] == "F32":
                        converted = values.astype("<f4", copy=False)
                    else:
                        converted = values
                    block = converted.tobytes()
                    target.write(block)
                    digest.update(block)
                    remaining -= count
            target.flush()
            os.fsync(target.fileno())
        if pending_data.stat().st_size != total:
            raise ValueError("Converted weight file has an unexpected size")
        index = {**expected, "dataSha256": digest.hexdigest()}
        pending_index.write_text(json.dumps(index, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(pending_data, data_path)
        os.replace(pending_index, index_path)
        return data_path, index
    finally:
        pending_data.unlink(missing_ok=True)
        pending_index.unlink(missing_ok=True)


def load_readonly_state(checkpoint: Path, cache_dir: Path) -> dict[str, Any]:
    """Return read-only CPU tensors suitable for load_state_dict(assign=True).

    torch.frombuffer retains the mapping's owner for each live tensor. Do not
    close the mapping while the model, exported graph or its tensors are alive.
    """
    import torch

    data_path, index = prepare_readonly_weights(checkpoint, cache_dir)
    torch_dtypes = {
        "F32": torch.float32, "I64": torch.int64, "I32": torch.int32,
        "I16": torch.int16, "I8": torch.int8, "U8": torch.uint8, "BOOL": torch.bool,
    }
    with data_path.open("rb") as stream:
        mapping = mmap.mmap(stream.fileno(), length=0, access=mmap.ACCESS_READ)
    state = {}
    with warnings.catch_warnings():
        # Intentional read-only parameter storage; no optimizer/in-place writes.
        warnings.filterwarnings("ignore", message="The given buffer is not writable")
        for name, record in index["tensors"].items():
            count = math.prod(record["shape"])
            dtype = torch_dtypes[record["dtype"]]
            state[name] = (torch.frombuffer(mapping, dtype=dtype, count=count, offset=record["offset"]).reshape(tuple(record["shape"]))
                           if count else torch.empty(tuple(record["shape"]), dtype=dtype))
    return state
