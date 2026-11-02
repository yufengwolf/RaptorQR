# RaptorQR

通过屏幕播放高吞吐动画二维码、摄像头读取，在设备间实现**目前已知最快**的文件与文本传输。

全部在浏览器或终端本地运行：无上传服务器、无蓝牙、无数据线。

> **维护说明**：本仓库为 RaptorQR 的独立维护分支，已从上游 `infrost/RaptorQR` 分离，不再关联原作者的远程仓库与社区讨论。
> 原项目以 MIT 协议发布，版权归原作者所有（见 `LICENSE`）；本分支在此基础上独立维护。

## 目录

- [性能](#性能)
- [软件包](#软件包)
- [功能特性](#功能特性)
- [常见问题](#常见问题)
- [开发](#开发)
- [部署](#部署)
- [命令行 CLI](#命令行-cli)
- [WASM 产物](#wasm-产物)
- [实现说明](#实现说明)
- [致谢与许可](#致谢与许可)

## 性能

RaptorQR 使用 Rust 实现的 [`cberner/raptorq`](https://github.com/cberner/raptorq)（RaptorQ，RFC 6330）编译为 WASM，作为主喷泉码编解码器；并将 [`erwanvivien/fast_qr`](https://github.com/erwanvivien/fast_qr) 编译为 WASM 用于高速二维码渲染（相比上游 WASM 包做了更完整的封装）；扫描则使用 ZXing WASM。

相比原本纯 JavaScript 的传输链路，性能有数量级提升。实测中，新链路在实际传输场景下至少达到 **50 倍以上**的吞吐提升。

实测示例：

| 场景 | 结果 |
| --- | --- |
| V20 二维码，4 码并行播放，30 FPS | 最高 300 个解码二维码符号/秒 |
| V30 二维码，4 码并行播放，30 FPS | 100+ 个解码二维码符号/秒 |
| 95.2 KB 文件传输（V30-L × 4QR@30fps） | 375 ms，约 254.0 KB/s |
| 6.5 MB 文件传输（V30-L × 4QR@30fps） | 36 s，约 183.6 KB/s |

> 95.2 KB 与 6.5 MB 测试以 **iPhone 16 / Safari 作为扫码端** 作为「实验室结果」测得。实际速度取决于设备摄像头素质、浏览器性能、光线、二维码尺寸与版本、播放速率及扫描设置。
>
> 当前 RaptorQ WASM 链路已可用于本地离线传输工作流。

## 软件包

| 软件包 | 版本 | 安装 | 用途 |
| --- | --- | --- | --- |
| `@raptorqr/core` | — | `pnpm add @raptorqr/core` | [打包、调度、渲染与解码](packages/raptorqr-core/README.md#send-with-raptorq) |
| `@raptorqr/cli` | — | `pnpm add --global @raptorqr/cli` | [终端发送端与本地静态服务器](packages/raptorqr-cli/README.md#usage) |
| `@raptorqr/fast-qr-wasm` | — | `pnpm add @raptorqr/fast-qr-wasm` | [以 RGBA 或矩阵渲染二维码](packages/raptorqr-fast-qr-wasm/README.md#render-rgba) |
| `@raptorqr/raptorq-wasm` | — | `pnpm add @raptorqr/raptorq-wasm` | [底层 RaptorQ 编解码](packages/raptorqr-raptorq-wasm/README.md#encode-and-decode) |

大多数应用只需安装 `@raptorqr/core`；它已在内部使用上述两个 WASM 包。仅在进行底层编解码或渲染集成时，才需要直接安装 WASM 包。未发布的 Preact/Vite 网页应用位于 `apps/web`。

## 功能特性

- 浏览器发送端/接收端，支持文本与文件传输
- 改进版的发送/接收界面：实时播放、扫描、参数调优与传输状态
- 通过 `raptorqr` CLI 的终端发送端
- 主用 RaptorQ WASM 喷泉码编解码器
- JS RLNC 兼容编解码器（已弃用）
- fast_qr WASM 二维码渲染（ZXing WASM 二维码写入器作为可选）
- ZXing WASM 二维码扫描，解码参数可配置
- 并行二维码播放、实时 Canvas 渲染，以及可选的 GIF 导出
- 可调二维码版本、ECC 等级、播放 FPS、扫描 FPS 与冗余开销

## 常见问题

### RaptorQR 可以离线使用吗？

可以。网页应用自带 `sw.js`，已具备 PWA 能力。首次加载后，即使断网也可再次打开同一链接。

### RaptorQR 会把我的文件上传到别处吗？

不会。传输完全在浏览器或终端本地运行。文件与文本在发送端被编码为动画二维码，在接收端从摄像头画面解码还原。

## 开发

### 安装依赖

```bash
pnpm install
```

### 本地开发（改代码、热更新）

```bash
pnpm dev:web
```

随后打开终端打印的 Vite 地址，通常是 `http://localhost:5173`。Vite 开发服务器是 **HTTP**，仅在 `localhost` 下才能调用摄像头；手机/局域网访问请走下方的「本地运行」。

### 本地运行（实际上手 / 手机摄像头接收）

本工具的真实使用场景是「电脑播放二维码、手机摄像头接收」，而浏览器**只在安全上下文（HTTPS 或 localhost）下才允许调用摄像头 API**，纯 HTTP（含局域网 IP 的 HTTP）会被直接拒绝。仓库根部附带的 `serve_web.py` 是一个局域网自签 HTTPS 服务（证书 SAN 已包含 localhost 与局域网 IP），用来托管构建产物：

```bash
pnpm build            # 先构建前端产物到 apps/web/dist
pnpm serve            # 等价于 python serve_web.py，默认 https://0.0.0.0:8443
```

手机浏览器打开 `https://<电脑局域网IP>:8443/`，点「继续」忽略证书警告即可（默认中文界面，右上角可切换中/英文）。

- 换端口：`python serve_web.py --port 9000`
- 一步到位（构建 + 启动）：`pnpm serve:build`
- 更省事的公网方案见下方[部署](#部署)（Cloudflare Pages / Vercel，合法证书零警告）。

### 构建全部内容

```bash
pnpm build
```

## 部署

本工程是**纯前端、零后端**的静态站点：发送端与接收端全部在浏览器本地运行，数据不上传任何服务器。合法证书由平台提供，无「不安全」警告。

### Cloudflare Pages（推荐）

1. 连接本仓库（或上传 `apps/web/dist`）。
2. 构建设置：
   - **构建命令**：`pnpm --filter @raptorqr/web build`
   - **输出目录**：`apps/web/dist`
   - **Node 版本**：22（在 Pages 设置或 `package.json` 的 `engines` 中指定）
3. 无需 SPA 回退规则：网页使用 `base: './'` 与 hash 路由，静态托管即可直接打开。

> 公网部署**不会影响传输速度**——传输是「屏幕→摄像头」的本地光信道，平台仅在手机首次下载网页时用到网络；实际速率由摄像头/光信道硬件上限决定。

### Vercel

仓库根目录已包含 `vercel.json`，Vercel 可直接从 monorepo 部署，无需在后台修改项目根目录。Vercel 会执行：

```bash
pnpm --filter @raptorqr/web build
```

并托管：

```text
apps/web/dist
```

### 局域网 HTTPS（手机调用摄像头）

仓库根目录的 `serve_web.py` 是一个局域网自签 HTTPS 服务，用于在本机托管 `apps/web/dist` 并通过包含局域网 IP 的证书让手机摄像头可用。需**先构建**再启动：

```bash
pnpm build             # 构建前端产物到 apps/web/dist
pnpm serve             # 等价于 python serve_web.py，默认 https://0.0.0.0:8443
# 或一步完成：pnpm serve:build
```

手机浏览器打开 `https://<电脑局域网IP>:8443/`，点击「继续」忽略证书警告即可。打开后默认中文界面，右上角可切换中/英文。换端口用 `python serve_web.py --port 9000`。

## 命令行 CLI

```bash
raptorqr document.pdf
echo "Hello, world!" | raptorqr
raptorqr --serve --port 8080
```

- `raptorqr document.pdf`：读取本地文件，保留文件名与 MIME 元数据，在终端循环播放 RaptorQ 二维码流。它不会上传文件、生成链接或写出新文件；用 RaptorQR 接收端扫描该二维码流即可在接收设备还原 `document.pdf`。
- `echo "Hello, world!" | raptorqr`：从 stdin 读取文本，以同样的循环终端二维码流展示。
- `raptorqr --serve --port 8080`：启动一个托管已构建网页应用的本地静态服务器。先运行 `pnpm build`，再打开 `http://localhost:8080`。

按 `q` 或 `Ctrl-C` 停止终端二维码发送端。

CLI 产物构建于：

```text
packages/raptorqr-cli/dist/raptorqr.js
```

CLI 会将其所需的 WASM 附属文件拷贝到同一 `dist/` 目录。

## WASM 产物

生成产物位于：

```text
packages/raptorqr-fast-qr-wasm/src/wasm
packages/raptorqr-raptorq-wasm/src/wasm
```

构建脚本为：

```text
packages/raptorqr-fast-qr-wasm/src/build_fast_qr_wasm_colab.py
packages/raptorqr-raptorq-wasm/src/build_raptorq_wasm_colab.py
```

可将脚本粘贴到 Colab notebook 中构建 WASM 产物。脚本会下载并构建上游 Rust 依赖，再将其编译为 WASM。

## 实现说明

协议沿用既有的固定 8 字节传输头。RaptorQ 数据包使用保留的符号索引哨兵值，而 JS RLNC 数据包使用旧的象征索引区间。

`wasm-raptorq` 是默认的 FEC 编解码器。`js-rlnc` 仍被导出且有测试覆盖，但已弃用，且绝不会作为自动回退使用。

更深入的协议与软件包概览见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 致谢与许可

RaptorQR 建立在优秀的开源项目与开发者社区之上。

### 使用的开源项目

- [cberner/raptorq](https://github.com/cberner/raptorq) — WASM FEC 编解码器所用的 RaptorQ / RFC 6330 喷泉码实现。
- [erwanvivien/fast_qr](https://github.com/erwanvivien/fast_qr) — 编译为 WASM 的高速二维码渲染库。
- [Sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm) — 用于二维码/条码扫描的 ZXing-C++ WebAssembly 构建。
- [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp) — ZXing 的 C++ 移植，底层条码图像处理库。
- [ZXing](https://github.com/zxing/zxing) — 最初的开源多格式条码扫描项目。
- [Preact](https://preactjs.com/) — 网页应用使用的轻量 UI 框架。
- [Vite](https://vite.dev/) — 前端构建工具与开发服务器。
- [pnpm](https://pnpm.io/) — monorepo 工作区使用的包管理器。

### 许可

本项目以 **MIT 协议**发布。原项目版权归 **© 2026 Haixiang** 所有（见 `LICENSE`）；本独立维护分支在保留原许可与版权声明的前提下进行维护与修改。
