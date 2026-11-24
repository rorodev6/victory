# Progress (November 2026)

This repository contains **no game data**. You need your own copy of the game (see `victory.example.toml`).

## What works

- Boot, intro, menus and the loading screen, reproducibly.
- First cutscene: **audio** and **subtitles**.
- **Entering the world no longer crashes the GPU.** The D3D12 device used to be removed about a minute
  after entering the world (page fault / TDR). This is fixed; see below.
- In the world: 450–1300 draws per frame, with no device removal over multi-minute runs.

## Black screen / device removal when entering the world: cause and fix

D3D12 GPU-based validation (`VICTORY_D3D12_DEBUG=1 VICTORY_D3D12_GBV=1`) reported
"SRV dimension expected BUFFER, in descriptor TEXTURE2D" 172 times.

- Compute shader `a133bf0a24aff410` reads a structured buffer (`t71`, through `s_buffer_load`).
- The title places that buffer at an address that is not a multiple of its stride. `buffer_srv` failed,
  and `null_for` put a null **texture** view in its place.
- Read as a buffer on an AMD GPU, that view gives a wild address, then a page fault and device removal.

Fixes:
- `crates/victory-gpu/src/descriptor/host.rs`:
  - a misaligned structured view becomes a RAW view (16-byte alignment is enough);
  - a buffer view the host cannot make becomes a null buffer view.
- `crates/victory-gpu/src/draw.rs`: a table entry that a shader reads as a buffer, but where the title
  binds a texture, becomes a null buffer.

Result: 0 dimension errors under GPU-based validation.

## In-world speed

The cause was in `Host::execute`. After every submission, each declared UAV range was copied back into
title memory with `WriteProcessMemory`: about 1600 copies and **29.7 GB per frame**.

Fixes:
- ranges are merged per buffer and per submission (`merged_ranges`);
- only the pages that changed are written back (`write_changed`).

Result: **7–8 s per frame → about 0.8 s per frame** (from 0.1 to about 1.2 fps).

## To do

- The world image is not verified yet: it may still come out black or incomplete. Some shaders do not
  translate yet (a lane mask read as data, 64-bit image atomics, an address in an SGPR that is not a root
  parameter).
- Speed: refresh copies and write watching still cost about 0.5–1 s per frame.
- 8 "Incompatible texture barrier layout" warnings under GPU-based validation.
- Controller input, in-game audio, 30-minute stability.

## Diagnostics added (build with `--profile diag --features diagnostics`)

- `VICTORY_D3D12_GBV=1`: GPU-based validation, used together with `VICTORY_D3D12_DEBUG=1`. It is slow.
- `VICTORY_SHADER_DUMP=<dir>[;hash,...]`: dumps console shaders. The folder must be outside the repository.
- Pipelines carry their shader names in debug-layer and DRED messages.
- DRED reports list the history of host buffers.
- The `copystat` line shows copy-back counters ("copies back").
