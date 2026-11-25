# FastVpsViewer

**English** | [中文](DETAIL.zh.md)

Open an on-demand Openbox desktop from your own VPS inside the DSH right sidebar, with a browser already running.

## How to use

1. Install TigerVNC and a window manager on the remote host: `apt install -y tigervnc-standalone-server openbox`.
2. Install the plugin: `dsh plugin --profile desktop add github:SaltPlayingMaimai/FastVpsViewer`, then restart DSH Desktop completely.
3. Set `sshHost` in your profile's `cordis.patch.yml` to your SSH alias.
4. Open **Remote desktop** in the right sidebar and press **Start desktop**.

A session starts `Xtigervnc` (its own X server plus VNC) and `openbox` on the remote host. The plugin reaches it through an SSH tunnel and renders the framebuffer with a bundled noVNC build served from a loopback-only port.

## When it releases

- You press **Release**;
- you close the tab or disconnect, and `idleMinutes` (default 5) elapses;
- a session runs longer than `maxSessionMinutes` (default 120);
- the remote display sees no input for `remoteIdleSeconds` (default 3600) and exits on its own;
- the plugin is unloaded or DSH exits.

Only the display this plugin started is terminated; other X or VNC sessions on the machine are left alone.

## Configuration

Every field lives under `id: fast-vps-viewer` in `cordis.patch.yml`; see the configuration table in the README.

## Limitations

- Linux remotes with TigerVNC only.
- No bidirectional clipboard, file transfer, or audio.
- Image quality follows the SSH link; lower `geometry` on slow networks.
