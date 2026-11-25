# FastVpsViewer — 设计与实施计划

> 一个 DeepSeek Harness（DSH）插件：在自己的 VPS 上按需拉起一个 Openbox 桌面，并把画面嵌进 DSH 右侧栏。
> 本文件是公开仓库的一部分，记录目标、架构与里程碑。

> **English abstract** — FastVpsViewer opens an on-demand Openbox desktop from a Linux VPS inside the DSH right sidebar. It reuses the remote host's TigerVNC server over a single SSH connection, renders the framebuffer with a bundled noVNC build on a loopback-only port, and releases every remote process when the session is stopped, goes idle, hits a cap, or the plugin unloads. The remainder of this document is in Chinese.

## 1. 目标

- 一条 SSH 连接、零公网端口，把远端 VPS 的图形桌面显示在本地 DSH 里。
- **连接方式可配置**：SSH 别名 / host+port+user / 私钥，统统写在插件配置里。
- **按需启动、自动释放**：不用的时候远端不跑任何图形进程，不烧 CPU 和内存。
- 不要求远端安装 DSH、Node，也不要求远端暴露任何端口。

## 2. 非目标（v1 明确不做）

- 不做多用户、多租户、权限系统。
- 不支持 Windows / macOS 远端（只针对 Linux + TigerVNC）。
- 不替代专业远程桌面（不做剪贴板双向、文件传输、音频）。
- 不修改 DSH 本体，只做一个 profile 插件。

## 3. 调研结论

| 方案 | 结论 |
|---|---|
| dsh-remote-screen2 | 依赖远端 guacd + xrdp，安装重；脚本默认把 guacd 绑到 `0.0.0.0:4822` 且无认证，有安全风险。 |
| dsh-remote-desks | 镜像的是「另一套 DSH 的 WebUI」，不是桌面。但它的工程结论很有价值：Electron 里嵌入页面不能访问与宿主同端口的回环地址，必须独立端口 + 票据。 |
| dsh-rayrun-computer | 买他家云电脑，不能接自己的 VPS。 |
| dsh-sev | 管远端 DSH 会话，不是图形桌面。 |

**结论：没有现成插件能「用自己已有的 SSH 配置，按需开自己的 VPS 桌面」。** 自己写一个薄层最合适。

## 4. 实测环境（目标 VPS）

```
Debian GNU/Linux 13 (trixie) · 1 vCPU · 961 MiB RAM · 9.2 GiB 可用磁盘
TigerVNC 1.15 (tigervnc-standalone-server) 已安装
openbox 3.6.1 已安装；xterm 已安装
Xvfb / x11vnc / xrdp / guacd 未安装
无 X socket、无图形进程、5900/5901 未监听
sudo 免密（root 登录）
```

实测命令（start → 监听 → kill 全部通过）：

```sh
vncserver :1 -geometry 1280x800 -depth 24 -localhost yes \
  -SecurityTypes None -rfbport 5901 -xstartup /tmp/xstartup
# → 127.0.0.1:5901 LISTEN，Xtigervnc + openbox + xterm 正常运行
vncserver -kill :1   # → 进程全部退出，无残留
```

**所以远端不需要装任何东西**：TigerVNC 自带 X server（Xtigervnc），一个进程搞定显示 + VNC。

## 5. 架构

```
┌──────────────────── 本地 Mac（DSH Desktop）────────────────────┐
│  DSH 进程                                                       │
│  ├─ 插件 host 半边 (index.js)                                   │
│  │   ├─ 生命周期状态机：idle → starting → running → stopping     │
│  │   ├─ ssh 子进程：开始/结束远端桌面、-L 端口转发              │
│  │   └─ 本地 HTTP 服务 127.0.0.1:<viewerPort>                   │
│  │        ├─ /             viewer 页面（noVNC 内置）            │
│  │        ├─ /vendor/...   noVNC 静态资源（随仓库内置）          │
│  │        ├─ /api/*        状态 / 启动 / 结束                    │
│  │        └─ /ws           WebSocket → 127.0.0.1:<tunnelPort>   │
│  └─ 插件 client 半边 (client.js)                                 │
│      └─ 右侧栏「远端桌面」标签 → 面板内嵌 viewer iframe         │
└─────────────────────────────────────────────────────────────────┘
          │ ssh（用户自己的 ~/.ssh/config、密钥、agent）
          ▼
┌────────────────────── 远端 VPS ────────────────────────────────┐
│  Xtigervnc :N  （X server + VNC，127.0.0.1:<5900+N>，仅回环）  │
│  └─ openbox + 配置里指定的启动程序                              │
└─────────────────────────────────────────────────────────────────┘
```

为什么多一跳本地 HTTP：Electron 里嵌入的页面**不能**访问与 DSH 宿主同端口的回环地址，所以 viewer 必须活在自己的端口上；同时 WebSocket 需要一个真正的 origin 来承载 noVNC。

## 6. 资源释放（五层）

1. **正常结束**：关闭右侧栏标签（`sidebarRight.registerCloseHandler`）→ 立即 `/api/stop` → 关隧道 + `vncserver -kill`；面板上不再有单独按钮。
2. **断连兜底**：最后一个 WebSocket 断开后计时（默认 1 分钟，可配）→ 自动 stop，覆盖关闭事件没送达的情况。
3. **硬上限**：单次会话最长（默认 120 分钟，可配）→ 自动 stop。
4. **远端兜底**：`-MaxIdleTime`（Xtigervnc 参数，默认 3600 秒无输入）→ 远端自己退出；`-autokill` 默认开启，X 会话结束即回收。
5. **进程死亡**：插件卸载 / DSH 退出 → `ctx.effect` 的 disposer 关掉 ssh 子进程与本地服务。

原则：**只杀自己拉起来的**。停止只对配置里的显示号执行 `vncserver -kill`，不 `pkill`。

## 7. 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `sshHost` | `my-vps` | `~/.ssh/config` 里的别名，或 IP / 主机名 |
| `sshPort` | `22` | SSH 端口 |
| `sshUser` | 空 | 用户名，留空用 ssh 默认 |
| `auth` | `agent` | `agent`＝按 `~/.ssh/config` + ssh-agent 走（等同终端 `ssh <host>`，BatchMode 不提示）；`key`＝指定 `-i` 且 `IdentitiesOnly`；`password`＝SSH_ASKPASS，密码仅本机 |
| `identityFile` | 空 | `auth=key` 时的私钥路径 |
| `sshOptions` | `[]` | 额外 ssh 参数，如 `-o IdentityFile=...` |
| `display` | `1` | 远端 X display 号（`:1`） |
| `vncPort` | `5900 + display` | 实际监听端口，默认跟随 display |
| `viewerPort` | `19600` | 本地 viewer 端口，占用时自动向后找 |
| `geometry` | `1600x900` | 初始分辨率（`autoResize` 打开时只用于连接前） |
| `autoResize` | `true` | 桌面跟着面板大小走（noVNC `resizeSession` → TigerVNC RandR） |
| `maximize` | `true` | 窗口启动即铺满桌面；openbox 用私有 `openbox-rc.xml`（`<application class="*"><maximized>`） |
| `desktop` | `openbox` | 窗口管理器 / 桌面命令 |
| `startupCommands` | `['browser']` | 桌面起来后执行什么；`browser` 自动挑第一个可用的浏览器 |
| `idleMinutes` | `5` | 无连接多久回收 |
| `maxSessionMinutes` | `120` | 单次会话硬上限 |
| `remoteIdleSeconds` | `3600` | 远端 `-MaxIdleTime` 兜底 |

**面板设置**（`/api/ping` 带 `features` 做能力协商，宿主与界面版本不一致时客户端会明确提示重启）：`GET/PUT /api/settings`，持久化到 `~/.dsh/fast-vps-viewer.json`（600），优先级高于 bundle 配置；面板右上「设置」直接改，运行中的会话可「保存并重启会话」立刻生效。

## 7.1 文件与拖拽（2026-11-25）

- `GET /api/files?path=` 列目录（远端 `find -printf`，不依赖 ls 解析），`GET /api/files/download` 流式下载，`POST /api/files/delete` 删除，`POST /api/upload` 走 ssh stdin 上传（≤512 MB）；
- 路径只允许在 `filesRoot`（默认 `~`）之下，`~` 在命令里展开为 `"$HOME"`，避免注入；
- 面板「文件」卡片提供浏览/下载/删除/上传；
- 把本地文件拖到画面 → 上传到 `uploadDir`（默认 `~/Downloads`），再由用户在远端文件选择框里选它——VNC 本身不传文件，不能替用户点浏览器附件。

## 7.3 命令行不再经过 VNC（2026-11-25）

- 「命令行」卡片改为 `POST /api/terminal` → `terminal.html` → `ws://…/term` → 宿主 spawn `ssh -tt <host> 'stty rows R cols C; exec bash -l'`；
- 浏览器侧用内置 xterm.js（MIT）渲染，面板宽高换算成 PTY 大小；
- 好处：不启动 X/VNC，1 秒级可用；关标签即断开 SSH；
- 局限：PTY 大小在打开时固定，之后缩放面板不会重排；`ssh -tt` 依赖服务器允许分配 pty。

## 7.4 启动动画（2026-11-25）

浏览器会话启动要 4–8 秒（SSH + Xtigervnc + 浏览器），面板在 `phase=starting` 时显示旋转指示 + "正在连接服务器并启动桌面…"，避免看起来卡死。

## 8. 里程碑

- **M0 环境验证** ✅ 已在目标 VPS 上跑通 TigerVNC 起停。
- **M1 host 半边** ✅ 状态机 + ssh 起停 + 本地 HTTP/WS + 内置 noVNC viewer；已装进 profile 并经真实 DSH 进程验证。
- **M2 client 半边** ✅ 右侧栏标签 + 指南卡片 + 面板 body 已在无头 Chromium 里真点通（见 §10）；Desktop 应用内的一次目视确认仍待重启。
- **M3 资源释放** ✅ 空闲 / 上限 / 远端兜底 / disposer 全链路已实现，起停实测无残留。
- **M4 发布** ✅ README（中英，含截图）、locale、icon、DETAIL、LICENSE、两个 smoke 测试，已推送公开仓库。

## 9. 风险与备选

| 风险 | 处理 |
|---|---|
| 目标机没有 TigerVNC | 配置里给 `installHint`，插件在启动失败时提示 `apt install tigervnc-standalone-server openbox` |
| 用户 ssh 需要交互输入密码 | 默认 `BatchMode=yes` 快速失败并给出原因；文档说明用 key / agent |
| 端口冲突 | viewer 端口自动向后探测；远端端口可配 |
| 安全 | VNC 只绑回环 + `SecurityTypes None`；本地 viewer 只绑 127.0.0.1 + 每次会话随机 token；control API 校验 Origin |
| DSH 客户端 bundle 加载失败 | client 半边全部 try/catch，失败只影响入口按钮，不影响 host 能力 |

## 9.1 发布纪律

每次推送都要把 `plan.md` 与 `handoff.md` 一起带上：`npm run verify` 会跑 `scripts/check-docs.mjs`（文档存在性 + README 链接 + `files[]`），CI 上同样执行，漏了会红。

## 10. 端到端验证（2026-11-25）

用一个临时 `dsh web`（profile `fvvtest`）+ 本机缓存的 Chromium（`playwright-core` 无头）真的走了一遍浏览器里的路径：

- 引导图里出现本插件的 client 行（`{"id":"fast-vps-viewer","url":"plugins/??…&rev=…"}`），bundle 通过 combo 路由 200 返回；
- 控制台没有 `pending` / `did not activate` 告警，出现 `[fast-vps-viewer] registered sidebar tab type`；
- 打开右侧栏，「远端桌面」卡片在指南里；点开后出现「启动远端桌面」按钮；
- 点启动 → 远端拉起 Xtigervnc → 面板里出现 `iframe` → 内部 `canvas 1600×900`、状态「已连接」；
- 默认启动命令 `browser` 在目标 VPS 上真的选中了 `firefox-esr`，画面里就是 Firefox 窗口（`docs/screenshot.png`）；
- 点「结束并释放」→ 远端 `vncserver -list` 归零，无残留进程。

第二轮（用户反馈"黑屏 / 两个结束按钮"之后）补的验证：

- 生成的 `xstartup.sh` 在 VPS 上实测同时拉起 `Xtigervnc + openbox + firefox-esr`；
- iframe 带 `chrome=0`，viewer 用 `body[data-embedded]` 隐藏自带顶栏，面板上只剩一个「结束并释放」；
- 连续两次 `node test/smoke.mjs` 全绿，`ssh` 短暂被服务端拒绝时 master 会自动重试。

这三轮在真实浏览器/真实主机里暴露的问题与修法，见 `handoff.md` 的「调试记录」。

## 11. 「点一下把文件塞进网页输入框」设计（2026-11-25）

### 为什么不能直接做

VNC 只传画面和键鼠事件，不传文件；浏览器里的「选择文件」是远端原生对话框。所以"拖进去就出现在聊天框附件里"必须绕过 VNC，在远端浏览器内部动手。三条可行路径，按侵入性排序：

### 方案 A：文件架 + 人工一步（今天就能做，零风险）

- 面板里加一个**文件架**：`~/Downloads` 与最近上传的文件，每项四个动作：下载 / 删除 / 复制远端路径 / 「待附加」；
- 上传走已有的 `/api/upload`（拖拽或选择）；
- 用户在网页里点附件，弹出的远端对话框直接定位到 `~/Downloads`（文件已排好序/最近在上）；
- 诚实地说，这不是自动化，但它是所有方案的回退兜底，且不依赖浏览器类型。

### 方案 B：Chromium + CDP 自动注入（真·点一下）

前提：远端用 Chromium（Firefox 没有 CDP 的文件注入能力）。

1. 启动浏览器时加 `--remote-debugging-port=9222 --remote-allow-origins=*`，只绑 `127.0.0.1`；
2. 宿主用 SSH 隧道把 9222 接到本地（复用现有的 `-L` 机制），Node 22 自带全局 `WebSocket`，不需要额外依赖；
3. 新增 `POST /api/attach {path}`：
   - `Page.getFrameTree` 找到当前 frame；
   - `DOM.getDocument` → `DOM.querySelector('input[type=file]')`；
   - `DOM.setFileInputFiles({ nodeId, files: [远端绝对路径] })`；
   - 找不到 input 时，回退到 `Input.dispatchDragEvent`（`dragData.files`），把文件模拟成拖放；
   - 页面若用"点按钮才创建 input"的写法，先用 `Input.dispatchMouseEvent` 点一次上传按钮。
4. 面板文件架上每项一个「塞进网页」按钮，调 `/api/attach`。

风险与限制：只支持 Chromium；ChatGPT/Claude 等站点可能对自动化有检测；页面结构变化会让选择器失效（因此选择器做成可配，默认探测可见的 `input[type=file]`）。

### 方案 C：WebExtension（Firefox / Chromium 都能用，最稳）

- 插件自带一个极小的扩展 `fastvps-attach`：content script 连本地 WebSocket（经 SSH 隧道到宿主），收到文件字节后构造 `File`，在页面里找 `input[type=file]` 或派发 `drop` 事件；
- 优点：不依赖浏览器调试端口、不伪造 CDP、对页面"拖放上传"的网站最自然；
- 代价：要往远端浏览器 profile 里装扩展（Firefox 需要 `policies.json` 或临时加载；Chromium 需要 `--load-extension`），属于"一次安装、长期生效"。


### 会不会违背"服务器上不常驻东西"的初衷？

先分清两种"常驻"：**进程常驻**（开机自启、一直吃内存）和**磁盘产物**（装了个包、放了个文件，但没在跑）。

| 方案 | 运行期常驻 | 磁盘/安装 | 端口 |
|---|---|---|---|
| A 文件架 | 无 | 无 | 无 |
| B Chromium + CDP | 无（Chromium 就是我们按需拉起的那个浏览器，只是多一个启动参数） | 远端要装 Chromium（约 100 MB），默认浏览器锁定 Chromium | 9222 仅绑回环，且只在会话期间存在 |
| C WebExtension | 无（浏览器不开时扩展什么都不做） | 往浏览器 profile 里放一个几十 KB 的扩展 | 扩展复用 viewer 服务的端口，本来只在会话期间存在 |

所以 B / C **不新增常驻进程、不开公网端口、闲置时占用为 0**——"运行期不常驻"这条守住了。

真正被改变的是更严格的那条：**"远端零安装"**。从"只要 TigerVNC + openbox + 浏览器"变成"再加 Chromium 或一个扩展"。这是一次性的安装成本，不是运行期负担。

结论：

- 如果你的地线是"不能常驻进程/端口" → B、C 都合格；
- 如果你的地线是"远端什么都不许装" → 只有 A 合格，B/C 都算越线；
- 折中：B/C 做成**可选能力**，插件在面板里显示"未安装扩展 → 只能手动选文件"，装了就自动升级体验。

### 推荐路线

1. 先做方案 A 的文件架（小、稳、立刻有用，也是 B/C 的 UI 基础）；
2. 默认浏览器目前是 Firefox ESR → 走**方案 C** 更匹配；如果你愿意在远端装 Chromium，方案 B 的开发量更小；
3. 无论哪条，**永远不自动点发送**：只把文件放进输入框/附件区，发送仍由人按。

