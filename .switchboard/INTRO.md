# Project rules for Switchboard

<!-- Added to every agent's Switchboard briefing for this project (tracking and logging scope only).
     Change it with a pull request - agents pick it up in their next session. -->

Project: **VIctory** — runs GTA VI (Xbox Series X|S) natively on Windows. Rust workspace, host D3D12.
Goal: get the title's world rendering. Today (2026-11-23): boot, menus, intro video, world loading all work; the world itself is black and the host GPU fails within seconds. The top blocker is the "GPU world: stop host device loss" task.

- **RULE 1 (asset policy — `docs/asset-policy.md`): nothing from the game is ever committed.** No assets, no code, no dumps, no decompiled output, no screenshots, in any form. The pre-commit hook runs `cargo xtask policy --staged` and is authoritative; do not bypass, weaken or "exception" it. Game files live outside the repo (`victory.toml`, which is git-ignored).
- Work on short-lived branches; one task per branch.
- Ask in the channel before changing shared contracts (function signatures across crates, CLI flags, config schema).
- Builds: `cargo test --workspace` (no game data needed) · `cargo build --release -p victory`. Diagnostics build: `cargo build --profile diag -p victory --features diagnostics`.
- Before entering the world on a real GPU use `VICTORY_D3D12_WARP=1` — a live GPU failure currently resets the display driver. GPU-failure forensics: `VICTORY_D3D12_DRED=1`, logs in `crashes.log`.
- Shaders are compiled from the title's console code at first use (`crates/victory-shader`); GPU/descriptor/pipeline work lives in `crates/victory-gpu`; host API shims in `crates/victory-hle`.
- If a task's area is contested or you touch another's file, coordinate in the channel first (`post --file <path>`).
