# FastVpsViewer

[English](DETAIL.md) | **中文**

在 DSH 右侧栏里，按需打开你自己 VPS 上的 Openbox 桌面 —— 默认直接启动一个浏览器。

## 怎么用

1. 在远端装好 TigerVNC 与窗口管理器：`apt install -y tigervnc-standalone-server openbox`。
2. 装插件：`dsh plugin --profile desktop add github:SaltPlayingMaimai/FastVpsViewer`，然后完整重启 DSH Desktop。
3. 在 profile 的 `cordis.patch.yml` 里把 `sshHost` 改成你的 SSH 别名。
4. 打开右侧栏的「远端桌面」，点「启动远端桌面」。

启动后远端会跑一个 `Xtigervnc` 进程（自带 X server）和一个 `openbox`。本地插件通过 SSH 隧道把画面接到一个只监听 `127.0.0.1` 的小服务上，再用内置的 noVNC 渲染出来。

## 什么时候会释放

- 点「结束并释放」；
- 关掉标签页、断开连接超过 `idleMinutes`（默认 5 分钟）；
- 单次会话超过 `maxSessionMinutes`（默认 120 分钟）；
- 远端 `remoteIdleSeconds`（默认 3600 秒）没有输入时自行退出；
- 插件卸载或 DSH 退出时。

插件只终止它自己按配置启动的 display，不会影响机器上其它的 X / VNC 会话。

## 配置

所有字段都在 `cordis.patch.yml` 的 `id: fast-vps-viewer` 下，见 README 的配置表。

## 限制

- 只支持 Linux + TigerVNC。
- 不支持剪贴板双向、文件传输、音频。
- 画面质量取决于 SSH 链路；慢速网络下建议调小 `geometry`。
