# RaptorQR Architecture

RaptorQR is a pnpm monorepo for camera-based QR transfer. The project is split so the protocol and codec code can become a reusable low-level library, while the CLI and web app remain consumers of that library.

## Monorepo Layout

```text
packages/raptorqr-core
  src/protocol      fixed header, CRC32C, transfer profiles
  src/sender        packetizers and frame scheduling
  src/fec           RaptorQ facade, deprecated JS RLNC, outer RS helpers
  src/qr            QR capacity, encode/decode facades, raster helpers
  src/gif           GIF parse/render helpers
  src/reconstruct   payload assembly

packages/raptorqr-fast-qr-wasm
  src/wasm          fast_qr wasm-bindgen artifacts
  src/build_fast_qr_wasm_colab.py

packages/raptorqr-raptorq-wasm
  src/wasm          cberner/raptorq wasm-bindgen artifacts
  src/build_raptorq_wasm_colab.py

packages/raptorqr-cli
  src/raptorqr.ts        CLI entrypoint
  src/terminal_raster.ts terminal QR renderer
  src/static_server.ts   built web app preview server

apps/web
  src/app          Preact routes and UI
  src/workers      encode, decode, GIF, and QR render workers
  src/lib          app-local worker orchestration
  src/tests        browser/WebAssembly integration tests
```

## Package Boundaries

`@raptorqr/core` owns protocol behavior and public transfer APIs. It exports environment-neutral modules from `@raptorqr/core`, browser wrappers from `@raptorqr/core/browser`, and Node/CLI wrappers from `@raptorqr/core/node`.

`@raptorqr/fast-qr-wasm` owns the generated fast_qr renderer artifacts. Core imports it directly for browser and Node QR rendering.

`@raptorqr/raptorq-wasm` owns the generated RaptorQ codec artifacts. Core imports it directly for the primary FEC path.

`@raptorqr/cli` depends on core and the split WASM packages. It bundles to `packages/raptorqr-cli/dist/raptorqr.js` and copies required WASM sidecars next to the bundle.

`@raptorqr/web` is private. It owns Vite, Preact UI, workers, and app-local worker pools. App-local `@/*` imports must not leak into packages.

## Protocol

The transport packet keeps the existing 8-byte header plus payload plus CRC32C trailer. The protocol does not add QR profile negotiation to the header; the receiver infers QR version from decoded symbols and packet payload size.

FEC codec detection uses the existing symbol index field:

* `symbolIndex = 0..23`: deprecated JS RLNC compatible packets
* `symbolIndex = 31`: primary RaptorQ WASM packets

`wasm-raptorq` is the default FEC codec. `js-rlnc` remains explicit and test-covered, but it is deprecated and is never used as an automatic fallback if RaptorQ WASM is unavailable.

## QR Encoding And Decoding

QR generation and FEC are separate layers:

* FEC codec: `wasm-raptorq` or deprecated `js-rlnc`
* QR encoder: `fast-qr-wasm` or `zxing-wasm`

fast_qr WASM exposes both RGBA rendering and raw matrix output. The web app uses RGBA output for live/GIF rendering; the CLI uses matrix output for terminal rendering.

ZXing WASM is used for decoding and remains available as a QR writer option in the browser.

## Build And Test

Root commands orchestrate package-level commands:

```bash
pnpm build
pnpm test
pnpm dev:web
```

> 注意：`pnpm dev:web` 是 HTTP 开发服务器（localhost 热更新），手机/局域网摄像头需在安全上下文（HTTPS）下运行，请改用仓库根部的 `serve_web.py`（或 `pnpm serve` / `pnpm serve:build`）。

The test split follows ownership:

* core: protocol, packetization, FEC, reconstruction
* fast-qr-wasm: generated fast_qr type/build verification
* raptorq-wasm: generated RaptorQ artifact verification
* cli: terminal raster and CLI encode pipeline
* web: browser QR/GIF/ZXing/worker integration
