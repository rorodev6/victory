# Instructions for AI coding assistants

You are helping a user run this repository: a Windows runtime that runs an Xbox Series X|S game executable from
**the user's own game files** and translates its GPU work to Direct3D 12. Typical requests: "set it up", "build it",
"launch the game", "it crashes, look at my error log", "fix my crash".

## Hard rules

- **Never copy, upload, commit or paste game data** (the game's executable, its `.rpf` archives, shaders, textures,
  saves). Only the user's own installation is used, at run time, from where it is. See `docs/asset-policy.md`.
- **Never modify the user's game files.**
- **Ask before changing the system**: installing software, editing the hosts file, changing drivers or Windows
  settings, deleting files. Move instead of deleting.
- **Logs contain local paths** (the Windows user name). Before the user shares a log publicly (GitHub issue, Discord),
  replace `C:\Users\<name>` with `C:\Users\USER`, and ask before posting anything on the user's behalf.
- Don't commit or push unless the user asks.

## Setup

1. Windows 10 21H2+ or Windows 11, a GPU with mesh shaders and Shader Model 6.6 (AMD RDNA2+, NVIDIA Turing+),
   a current driver. 16 GB RAM minimum, 32 GB recommended.
2. Install Rust (`rustup`, the toolchain in `rust-toolchain.toml` is picked up automatically) and Visual Studio
   Build Tools with "Desktop development with C++" (MSVC x64 + a Windows SDK).
3. Build: `cargo build --profile diag -p victory --features diagnostics` (output: `target\diag\victory.exe`).
4. Optional, once per update (~10 min): pre-translate every shader:
   `.\target\diag\victory.exe warm "<folder of game_scarlett_master.exe>"`.

## Running

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\play.ps1 -Game "<path to game_scarlett_master.exe>"
```

`play.ps1` sets the recommended preset and writes, for every run, `logs\<date_time>\`:
- `err.txt` — the runtime's log (the one to read),
- `out.txt` — standard output,
- `run.txt` — build profile, Windows version, game path, exit code.

The path is remembered in `play.local.txt`; later runs need no argument. Expect 3-4 fps in the 3D world on a
mid-range card; menus and videos run at 30 fps.

## Reading a crash ("look at my err.txt")

Take the newest folder under `logs\`. The log has ANSI colour codes; strip them first
(`sed 's/\x1b\[[0-9;]*m//g'` or PowerShell `-replace '\x1b\[[0-9;]*m',''`). Then look, from the end backwards, for:

| In err.txt | Meaning | What to try |
|------------|---------|-------------|
| `panicked at` | A bug in the runtime | Report it with the 30 lines around it |
| `device removed` / `DXGI_ERROR_DEVICE_REMOVED` / `hung` | The GPU driver reset | Remove `VICTORY_INDIRECT_WINDOW` from `play.ps1`; update the driver |
| `Shader Model` / `mesh shader` / `does not support` while creating the device | GPU or OS too old | See "Windows 10" below |
| `out of memory` / `E_OUTOFMEMORY` | Video memory full | Keep `VICTORY_TEXTURE_LOW=2`; close other GPU apps |
| `placed resource does not fit`, `refused`, `does not translate` | Usually harmless warnings | Only relevant if the picture is wrong |
| The log just stops | Crash outside the runtime's logging | Check `run.txt`'s exit code and Windows Event Viewer → Application |

Known harmless lines: `host pipeline refused ... compute 39f0e9aeb156a61c`, `a stage of the ray-tracing structure
builder, which is off`, `a pipeline creation method that is not implemented ... slot=0x218`.

Report to the user in plain language: what failed, the likely cause, and one concrete next step. If a code fix is
needed, make it, build, and have the user run `play.ps1` again; compare the new `err.txt` with the old one.

## Windows 10

The runtime uses the system's Direct3D 12. Windows 10's does not provide Shader Model 6.6, which the game needs; the
D3D12 Agility SDK would, but `victory.exe` does not export `D3D12SDKVersion` / `D3D12SDKPath` yet, so dropping
`D3D12Core.dll` into a `D3D12` folder has no effect. Until that is added, Windows 11 is required.

## Reporting a problem upstream

Open an issue on https://github.com/rorodev6/victory/issues with: GPU, driver version, Windows version (`run.txt`),
what happened, and the end of `err.txt` (paths redacted, see the hard rules). Ask the user before posting.

## Where things are

- `apps/victory` — the command line (`run`, `warm`, `translate`, `config`).
- `crates/victory-gpu` — D3D12 translation (`host.rs` submissions, `texture.rs` textures, `resource.rs` resources).
- `crates/victory-shader` — GFX10 shader → DXIL translator.
- `crates/victory-hle` — the Xbox system services the game calls.
- Settings are environment variables `VICTORY_*`; each is documented where it is read (`grep -rn VICTORY_NAME crates`).
