# 交接说明（handoff）

> 给下一个接手的人（或下一次会话的我）：现在做到哪、验证过什么、还差什么。

> **English abstract** — A Chinese handoff note: host and client are verified end-to-end (a temporary `dsh web` plus headless Chromium drove the real sidebar flow and rendered a Firefox window from the VPS); the only unverified surface is the packaged Electron desktop. It records the browser-only bugs found and fixed, and the current defaults (a browser opens automatically; one release button; sessions release themselves). Repository: <https://github.com/SaltPlayingMaimai/FastVpsViewer>.

## 一句话状态

插件已安装进 `desktop` profile。host 与 client 两半都**已端到端验证**：临时 `dsh web` + 无头 Chromium 里真的点开了右侧栏卡片、点了启动、看到远端画面（`canvas 1600×900`，openbox + **firefox-esr**），随后释放，远端无残留。
默认行为已按用户预期改成"**打开就是浏览器**"：`startupCommands` 默认 `['browser']`，自动挑选 firefox / firefox-esr / chromium / google-chrome / epiphany。
唯一还没做的是**在打包后的 Electron 桌面应用里目视确认一次**（需要重启 DSH Desktop）。
代码已推送到公开仓库 <https://github.com/SaltPlayingMaimai/FastVpsViewer>（`main`），最新提交见仓库；README 与 `docs/screenshot.png` 已同步成 Firefox 那一帧。

## 环境事实

| 项 | 值 |
|---|---|
| DSH | `0.2.2-rc.5`，Desktop 版，profile `desktop` |
| DSH Web GUI | `http://127.0.0.1:52107` |
| profile 目录 | `~/.dsh/profiles/desktop` |
| 目标 VPS | 一个 root 登录、密钥免密的 Linux VPS（具体主机信息只在本地 profile 配置里，不写进仓库） |
| VPS 系统 | Debian 13 (trixie)，1 vCPU，961 MiB RAM，9.2 GiB 可用 |
| VPS 现有软件 | TigerVNC 1.15（tigervnc-standalone-server + tools）、openbox 3.6.1、xterm、**firefox-esr 153**、node |
| VPS 缺失 | Xvfb、x11vnc、xrdp、guacd（**都不需要装**） |
| VPS 负载 | Claude Code 常驻（`claude` + `node` 约 500 MB）；swap 2.3 GB 已用约 0.5 GB。开 Firefox 会明显变慢，`geometry` 建议 1280×800 或更小 |
| GitHub | 账号 `SaltPlayingMaimai`；推送用的是 macOS 钥匙串里已保存的 GitHub token（`git -c http.extraheader="Authorization: basic <base64(x-access-token:TOKEN)>"`），不要把它写进仓库 |
| 公开仓库 | <https://github.com/SaltPlayingMaimai/FastVpsViewer> |
| 本地代码 | `~/Desktop/GithubCode/DeepSeek工作区/fastvpsviewer`（工作副本） |
| 目标仓库 | `~/Desktop/GithubCode/FastVpsViewer`（git 仓库，`origin` 指向上面那个公开仓库；profile 的 `fast-vps-viewer` 以 link 方式指向它） |

## 已验证

1. 远端手工验证：
   ```sh
   vncserver :1 -geometry 1280x800 -depth 24 -localhost yes \
     -SecurityTypes None -rfbport 5901 -xstartup /tmp/fvv-xstartup
   # → 127.0.0.1:5901 LISTEN；Xtigervnc + openbox + xterm 正常
   vncserver -kill :1   # → 全部退出，无残留
   ```
2. `node test/smoke.mjs` 全绿：
   ```
   ok  ping {"name":"fast-vps-viewer","version":"0.1.0","port":19650}
   ok  initial phase idle
   ok  start running has-url
   ok  rfb handshake through ws bridge: "RFB 003.008\n"
   ok  viewer page bytes 881
   ok  novnc bundle 200 text/javascript; charset=utf-8
   ok  stop idle
   ```
   证明：SSH 起停、远端端口探测、`ssh -L` 隧道、手写 WebSocket 帧、noVNC 静态资源都通。
3. 装进真实 profile 后在 DSH 进程里验证（HMR 已激活 host 半边）：
   ```
   curl 127.0.0.1:19600/api/ping     → {"name":"fast-vps-viewer",...}
   POST /api/start                    → phase=running，远端 vncserver -list 出现 :1 / 5901
   POST /api/stop                     → phase=idle，远端 Xtigervnc/openbox/xterm 全部退出
   ```
   说明 bundle patch、插件激活、配置读取（`sshHost: <your-alias>`）在真实宿主里都正确。
4. 浏览器里的完整链路（临时 `dsh web` + `playwright-core` 无头 Chromium）：
   - 引导图里出现 `{"id":"fast-vps-viewer","url":"plugins/??…&rev=…"}`，bundle 路由 200，无 `did not activate` 告警；
   - 右侧栏指南出现「远端桌面」→ 点开出现「启动远端桌面」→ 启动后 `iframe` 里 `canvas 1600×900`、状态「已连接」；
   - 「结束并释放」后远端 `vncserver -list` 归零。
5. 默认浏览器与重复按钮（用户反馈之后补的）：
   - 生成的 `xstartup.sh` 在 VPS 上实测：`Xtigervnc + openbox + firefox-esr` 全部起来，画面就是 Firefox（`docs/screenshot.png` 即这一帧）；
   - iframe 带 `chrome=0`，viewer 用 `body[data-embedded]` 隐藏自带顶栏，面板只剩一个「结束并释放」；
   - 连续两次 `node test/smoke.mjs` 全绿；`ssh` 被服务端短暂拒绝时 master 会自动重试。

## 没验证的（风险点）

| 风险 | 说明 | 怎么验 |
|---|---|---|
| Electron 桌面里的渲染 | 无头 Chromium 走的是纯 Web 外壳；Desktop 用 `<webview>`/`dsh-app://`，iframe 策略可能不同 | 重启 DSH Desktop 看面板里有没有画面 |
| 重启才生效 | DSH 启动时读入 client bundle（`?rev=` 哈希），改客户端必须**完整重启应用** | — |
| 多实例端口 | 同一台机器跑多个 DSH 时，client 从 19600 开始探测，会连到先响应的那个实例 | 需要的话以后给每个实例分配固定端口段 |

## 代码结构

```
index.js          host：配置归一化、状态机、ssh、HTTP、手写 WS（无第三方依赖）
client.js         client：右侧栏标签 + 降级按钮
viewer/           index.html / app.js / style.css（noVNC 播放器）
vendor/novnc/     noVNC 1.6.0（MIT），esbuild 从官方 ESM 源码打成的单文件 novnc.js + LICENSE
test/smoke.mjs    host 端到端冒烟（真实 VPS）
test/client-smoke.mjs  client bundle 结构冒烟（假 ctx）
docs/DETAIL.md    插件详情页
plan.md           设计与计划
```

## 关键设计决策

1. **不引入任何 npm 依赖**：WebSocket 帧、HTTP 静态服务都手写，避免用户装插件时编译原生模块或拉一堆包。
2. **用系统 `ssh` 而不是 ssh2**：直接复用用户的 `~/.ssh/config`、密钥、agent，行为与终端里一致。
3. **TigerVNC 而不是 Xvfb + x11vnc**：Xtigervnc 一个进程就是 X + VNC，1 核 1G 的机器上最省。
4. **独立 loopback 端口**：Electron 里嵌入页面不能访问与宿主同端口的回环地址（`dsh-remote-desks` 的实测结论），所以 viewer 必须活在自己的端口上。
5. **一条 multiplexed SSH 连接**：`ControlMaster` + `ControlPath`，Start/Stop 的所有远程命令和 `-L` 隧道共用一条 TCP，避免短时间多条连接被服务端掐断。
6. **client 半边对齐了官方插件的真实调用形状**（读发行版 bundle 核对）：`sidebarRightTabs.register({ id, kind, title: () => …, guide: [{ id, order, title: () => …, description: () => … }], keepMounted })` 里 **title / description 必须是函数**，不是字符串；注册要包在 `ctx.effect` 里，body 要包在 `ctx.slots.inject('sidebar.right.pane.tab', …)` 里才能随面板生命周期回收。
7. **释放靠五层**：手动 / 空闲 / 硬上限 / 远端 `-MaxIdleTime` / disposer；停止只 kill 自己的 display。


## 调试记录（2026-11-25 下午）

| 现象 | 根因 | 修法 |
|---|---|---|
| 重启后右侧栏没有任何入口 | client bundle 的 `inject` 用了 `{ required, optional }` 对象形式，Cordis 把 `required`/`optional` 当成两个服务名，插件永远 pending | 改成数组 `inject: ['slots', 'sidebarRightTabs']` |
| 指南卡片渲染崩 | `tabType.title` / `guide[].title` / `guide[].description` 必须是函数（官方代码直接 `entry.title()`） | 全部改成 `() => …` |
| viewer 页面黑屏且报 "does not provide an export named 'default'" | npm 版 noVNC 的 `lib/` 是 **CommonJS**，浏览器 ESM 用不了 | 用 esbuild 把官方 GitHub 的 ESM 源码（`core/rfb.js`）打成单文件 `vendor/novnc/novnc.js` |
| 启动偶尔失败、报"远端缺少 TigerVNC" | 每次操作都新开 SSH 连接，短时间大量连接会被服务端/网络断开；且错误信息没有区分 ssh 失败 | 一个会话只用**一条** multiplexed SSH 连接（`ControlMaster` + `ControlPath`），所有命令走它，隧道也挂在它上面；ssh 退出码 255 单独报错 |
| 桌面全黑 | 只起了窗口管理器，没有任何窗口 | `startupCommands` 默认 `['browser']`（按 firefox → firefox-esr → chromium → google-chrome → epiphany 挑一个）；每个命令先 `command -v` 探测，缺什么写进 `start.log`；连上后 3.5 秒采样一次画面，全黑就弹提示 |
| 用户要的是浏览器不是终端 | 默认开 xterm 只是为了一开始有个窗口 | 改成 `browser` 魔法值，VPS 上自带 firefox-esr，实测直接出 Firefox 窗口 |
| 面板上出现两个「结束并释放」 | 面板自己的顶栏一个，iframe 里 viewer 页面还有一个 | iframe URL 带 `chrome=0`，viewer 用 `body[data-embedded]` 把自带顶栏藏掉 |
| 启动偶尔失败（ssh 连接被掐） | 服务端对短时间内的大量新连接会短暂拒绝（OpenSSH 的 per-source 惩罚），手工 ssh 也会偶发 `Connection closed` | master 连接最多重试 3 次、每次间隔 1.5s；会话内只保持一条连接 |
| 设置面板报 `Unexpected token 'o', "not found" is not valid JSON` | 宿主插件是旧版本（HMR 可能只更新了 client），`/api/settings` 404 返回纯文本 `not found`，客户端直接 `res.json()` 就炸 | `/api/ping` 增加 `features` 做能力协商，客户端只连带 `settings` 的实例、并跳过旧实例；`call()` 改为先取文本再尝试 JSON，404 给出"请重启 DSH Desktop"的可读提示 |

验证方式：`playwright-core` + 本机缓存的 Chromium 无头加载临时 `dsh web`（profile `fvvtest`），真的点开指南卡片、点启动，截图确认 `canvas 1600x900` 且画面里能看到 xterm。

## 运行期设置

- 面板右上「设置」可改连接（host / port / user / auth / 私钥 / 密码）、初始分辨率与「跟随面板」、startupCommands、回收策略，并可「测试连接」（`POST /api/test`）；
- auth 三档：`agent`（等同终端 `ssh <host>`，读 `~/.ssh/config` + ssh-agent，BatchMode 不提示）/ `key`（`-i` + IdentitiesOnly）/ `password`（askpass）
- 密码认证走 `SSH_ASKPASS`（脚本与密码文件都在 `~/.dsh/fast-vps-viewer/`，700/600），密码只写不读，`GET /api/settings` 只回 `hasPassword`；
- `autoResize` 默认开：viewer 的 `resizeSession` 让 TigerVNC 跟随窗口（实测 900×666 → 1200×766）；
- 保存写到 `~/.dsh/fast-vps-viewer.json`（600），宿主启动时与下次 Start 时叠加在 bundle 配置之上；
- `GET/PUT /api/settings`，PUT 返回 `restartRequired`（会话运行中时为 true）；
- 「保存并重启会话」= stop + start，用新配置重开会话。


## 自适应分辨率（2026-11-25 晚）

- `autoResize` 默认开：viewer 侧 `rfb.resizeSession = true`（关闭时退回 `scaleViewport`），TigerVNC 通过 RandR 跟随窗口；
- `geometry` 只在连接前决定初始尺寸；
- 实测：900×700 窗口 → canvas 900×666；拉到 1200×800 → canvas 1200×766，远端确实跟着变；
- 面板设置里是「桌面尺寸跟随面板」勾选框 + 「初始分辨率」。

## 文档纪律（每次推送都要满足）

- 每次改完功能/修完 bug，**plan.md 与 handoff.md 必须同一条提交一起更新**，再 push；
- `npm run verify` = client 结构冒烟 + `scripts/check-docs.mjs`：检查 README（中英）、plan、handoff、DETAIL（中英）都存在且非空，README 里真的链接了 plan/handoff，`package.json` 的 `files[]` 也包含它们；
- `.github/workflows/verify.yml` 在每次 push/PR 上跑这条命令，漏交文档会直接红。

## 窗口铺满（2026-11-25）

- `maximize` 默认开：xstartup 里从 `/etc/xdg/openbox/rc.xml` 复制一份到 `~/.fast-vps-viewer/openbox-rc.xml`，用 `awk` 插入 `<application class="*"><maximized>yes</maximized></application>`，再 `openbox --config-file` 启动；
- 不动用户自己的 `~/.config/openbox`；非 openbox 的窗口管理器忽略该选项；
- 实测 `xprop _NET_WM_STATE` 出现 `MAXIMIZED_VERT/HORZ`，Firefox 铺满 1600×900；
- 注意：会话被强杀后 Firefox 可能弹 "Restore Session"，点 Start New Session 即可（不是插件错误）。

## 启动器（2026-11-25）

- 面板初始态是卡片网格：浏览器 / 命令行 / 添加自定义 APP / 设置；点卡片 → `POST /api/start {startup:[cmd]}`；
- 自定义 APP：名字 + 命令，存进 `settings.apps`（经 `PUT /api/settings`），面板里列在「我的应用」，可删；
- 宿主侧 `ensureRunning(startupOverride)` 只覆盖这一次会话的 `startupCommands`，不改配置；
- 浏览器卡片不写死 Firefox：`GET /api/browser` 探测（60 秒缓存，ssh 失败不缓存），卡片显示实际名字，未探测到则显示「自动选择 Chrome / Firefox」；实测返回 `firefox`
- 无头浏览器实测：四张卡片渲染正常、点「命令行」发出的请求体是 `{"startup":["xterm"]}`、新宿主确实只起了 xterm；
- 注意：用户当前运行的实例若还是旧宿主，会忽略请求体（表现为点了没反应/开了默认程序），重启 DSH 即恢复。

## 关闭即释放（2026-11-25）

- 面板不再有「结束并释放」按钮；关闭右侧栏标签走 `ctx.sidebarRight.registerCloseHandler('fast-vps-viewer', …)`，同步触发一次 `/api/stop`（fire-and-forget）；
- 关标签后 iframe 被销毁、WebSocket 断开，`idleMinutes`（默认 1 分钟）是事件没送达时的兜底；
- 面板的「设置」里仍有「保存并重启会话」，需要换配置时用它；
- 无头 Chromium 里没能驱动"Dock 标签的关闭手势"（DSH 的关闭是右键菜单/快捷键，DOM 里没有常驻的 ✕ 按钮），所以这一条只做了 API 层注册的断言；真机确认一次即可。

## 截图与脱敏（2026-11-25）

- `docs/launcher.png` 只保留右侧栏区域的裁剪图（710×250），并用背景色盖掉了主机别名；
- `docs/screenshot.png` 是 viewer 自己的页面，并用背景色盖掉了顶栏里的 `主机 · display · 分辨率`；
- 之前的全窗口截图（含左侧会话列表、账号、工作区名）只存在于旧仓库，已把旧仓库改名为 `FastVpsViewer-archived` 并转为私有；新仓库的历史从单条提交重新开始；
- 以后截图一律只截右侧栏 / viewer，不含 DSH 侧边栏。

## 文件管理与拖拽（2026-11-25）

- 宿主：`/api/files`（find 列表）、`/api/files/download`（ssh cat 流式）、`/api/files/delete`、`/api/upload`（ssh stdin，512MB 上限）；
- 路径护栏：所有路径都换算成 `"$HOME"/…` 或绝对路径的单引号形式，且必须以 `filesRoot`（默认 `~`）开头；
- 面板新增「文件」卡片（浏览/下载/删除/上传）；已连接时把本地文件拖到画面 → 传到 `uploadDir`（默认 `~/Downloads`）并提示路径；
- 明确边界：拖拽只是把文件送到服务器，浏览器附件仍需用户在远端点一次（VNC 不传文件）；
- 实测：上传 20 字节文件 → 列表可见 → 下载内容一致 → 删除成功；`/etc` 被护栏拒绝；无头 Chromium 里文件视图渲染出 37 个条目。


## 文件塞进网页输入框（设计，2026-11-25）

结论先说：VNC 不传文件，浏览器原生文件框也不受网页脚本控制，所以必须绕到浏览器内部。三条路已写进 `plan.md` §11：

| 方案 | 可行性 | 代价 | 适用 |
|---|---|---|---|
| A 文件架 + 人工一步 | 今天可做 | 无 | 全部 |
| B Chromium CDP 注入 | 能真做到"点一下" | 需远端装 Chromium + 开调试端口 | Chromium |
| C WebExtension | 能真做到"点一下"，最稳 | 要往远端浏览器装扩展 | Firefox / Chromium |

推荐：先 A 打底，再按目标浏览器选 B 或 C（当前默认 Firefox ESR → 优先 C）。

实现注意点（给下一个人）：

1. `POST /api/attach` 需要接收远端**绝对路径**，路径仍走 `filesRoot` 护栏；
2. 方案 B 的 CDP 连接复用现有 SSH `-L` 隧道，Node 22 的全局 `WebSocket` 够用，不要引第三方 CDP 库；
3. 方案 C 的扩展要能配置端口/token，连接失败要静默重试，不能影响页面；
4. 只填不发送；任何自动提交都要明确禁止；
5. 站点检测（ChatGPT/Claude 可能识别自动化）要写进 README 的已知限制。


## 截图文件名带版本（2026-11-25）

GitHub 的图片代理（camo）按 URL 缓存，重写历史后同一个 `docs/launcher.png` 仍可能被旧的未脱敏图命中。所以截图不再用固定名字：

- `docs/ui-launcher.png`、`docs/ui-desktop.png`；
- 以后每次换图都换一个新文件名（旧文件删除），README 同步改链接；
- 名字里不要带含义（launcher/screenshot 足矣），避免下次又踩缓存。


补充判断（2026-11-25）：B/C 都**不新增常驻进程、不开公网端口**，闲置占用为 0；它们只是多了磁盘产物（Chromium 包 / 扩展包）。所以不违背"运行期不常驻"，但违背更严格的"远端零安装"。落地时做成可选能力：没装扩展就回退到方案 A 的手动选文件。

## 下一步

1. **完整重启 DSH Desktop**，检查：右侧栏指南里是否出现「远端桌面」卡片 → 点开后是否有「启动远端桌面」按钮 → 启动后 iframe 里是否出现 **Firefox** 窗口，并且只有**一个**「结束并释放」。
2. 如果侧栏入口没出现，先看 DevTools console：正常应有 `[fast-vps-viewer] registered sidebar tab type`；失败会打 `sidebar tab registration failed` 并自动降级成输入框左边的 🖥 按钮。
3. 可选打磨：多机配置（`hosts: []`）、剪贴板、`browserHome`（默认打开指定网址）、把 `test/smoke.mjs` 接进 CI（需要能 ssh 的 runner）。
4. 已知取舍：1 核 1 GB 的机器上 Firefox + Claude Code 同时跑会卡；如果只是查页面，建议用完就点「结束并释放」。
