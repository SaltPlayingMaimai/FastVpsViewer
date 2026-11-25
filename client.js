/**
 * FastVpsViewer — client half.
 *
 * Registers a right-sidebar tab type ("远端桌面") whose body embeds the
 * loopback viewer served by the host half. Falls back to a composer-dock
 * button when the tab registry is not available in this composition.
 */
window.__ModuleLoader__.load({
  id: 'fast-vps-viewer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TYPE_ID = 'fast-vps-viewer';
    let lastBase = null;
    const PORT_START = 19600;
    const PORT_COUNT = 20;

    const zh = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');
    const t = (en, cn) => (zh ? cn : en);

    const styles = {
      root: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--dsw-alias-bg-base, #0d1117)',
      },
      bar: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-subtle, #30363d)',
        fontSize: 12,
        color: 'var(--dsw-alias-text-secondary, #8b949e)',
        flex: 'none',
      },
      grow: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      button: {
        font: 'inherit',
        color: 'inherit',
        background: 'rgba(127, 127, 127, 0.12)',
        border: '1px solid rgba(127, 127, 127, 0.35)',
        borderRadius: 6,
        padding: '2px 8px',
        cursor: 'pointer',
      },
      frame: { flex: 1, border: 0, width: '100%', minHeight: 0 },
      center: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        textAlign: 'center',
        color: 'var(--dsw-alias-text-secondary, #8b949e)',
        fontSize: 13,
      },
      settingsOverlay: {
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        background: 'rgba(13, 17, 23, 0.72)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 16,
        overflow: 'auto',
      },
      settingsCard: {
        width: '100%',
        maxWidth: 520,
        background: 'inherit',
        border: '1px solid rgba(127, 127, 127, 0.35)',
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        color: 'var(--dsw-alias-text-primary, #e6edf3)',
      },
      settingsTitle: { fontSize: 14, fontWeight: 600 },
      launcher: { flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 },
      launcherHead: { display: 'flex', flexDirection: 'column', gap: 3 },
      launcherTitle: { fontSize: 13, fontWeight: 600 },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 },
      card: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        background: 'rgba(127, 127, 127, 0.10)',
        border: '1px solid rgba(127, 127, 127, 0.28)',
        borderRadius: 10,
        padding: '12px 12px 10px',
        cursor: 'pointer',
        minHeight: 92,
      },
      cardIcon: { fontSize: 18, lineHeight: 1.1, fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
      cardTitle: { fontSize: 13, fontWeight: 600 },
      cardDesc: { fontSize: 11, opacity: 0.7, lineHeight: 1.4 },
      savedWrap: { display: 'flex', flexDirection: 'column', gap: 8 },
      savedCard: { position: 'relative' },
      removeApp: {
        position: 'absolute',
        top: 4,
        right: 6,
        border: 0,
        background: 'transparent',
        color: 'inherit',
        opacity: 0.45,
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        padding: 2,
      },
      appForm: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        border: '1px solid rgba(127, 127, 127, 0.28)',
        borderRadius: 10,
      },
      sectionLabel: { fontSize: 11, opacity: 0.65, textTransform: 'uppercase', letterSpacing: 0.4 },
      fileList: { flex: 1, overflow: 'auto', padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 },
      fileRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6 },
      fileName: {
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        padding: 0,
      },
      fileMeta: { fontSize: 11, opacity: 0.6, minWidth: 60, textAlign: 'right' },
      dropZone: {
        position: 'absolute',
        inset: 0,
        zIndex: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(47, 129, 247, 0.18)',
        border: '2px dashed #2f81f7',
        fontSize: 13,
        pointerEvents: 'none',
      },
      spinnerWrap: {
        position: 'absolute',
        inset: 0,
        zIndex: 7,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        background: 'rgba(13, 17, 23, 0.55)',
      },
      spinner: {
        width: 22,
        height: 22,
        border: '2px solid rgba(127,127,127,0.35)',
        borderTopColor: '#2f81f7',
        borderRadius: '50%',
        animation: 'fvvspin 0.9s linear infinite',
      },
      spinnerText: { fontSize: 12, opacity: 0.8 },
      inlineLoading: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontSize: 12, opacity: 0.8 },
      spinnerSmall: {
        width: 12,
        height: 12,
        border: '2px solid rgba(127,127,127,0.35)',
        borderTopColor: '#2f81f7',
        borderRadius: '50%',
        animation: 'fvvspin 0.9s linear infinite',
      },
      toast: {
        position: 'absolute',
        left: '50%',
        bottom: 14,
        transform: 'translateX(-50%)',
        padding: '6px 12px',
        borderRadius: 8,
        background: 'rgba(22, 27, 34, 0.95)',
        border: '1px solid rgba(127,127,127,0.35)',
        fontSize: 12,
        color: '#e6edf3',
        zIndex: 8,
      },
      groupTitle: { fontSize: 12, fontWeight: 600, opacity: 0.75, marginTop: 2 },
      checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' },
      form: { display: 'flex', flexDirection: 'column', gap: 10 },
      field: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 },
      fieldLabel: { fontSize: 12, color: 'var(--dsw-alias-text-secondary, #8b949e)' },
      input: {
        font: 'inherit',
        color: 'inherit',
        background: 'rgba(127, 127, 127, 0.10)',
        border: '1px solid var(--dsw-alias-border-subtle, #30363d)',
        borderRadius: 6,
        padding: '5px 8px',
        width: '100%',
      },
      row: { display: 'flex', gap: 10, alignItems: 'flex-end' },
      help: { fontSize: 11, color: 'var(--dsw-alias-text-secondary, #8b949e)', lineHeight: 1.5 },
      notice: { fontSize: 12, color: 'var(--dsw-alias-accent, #2f81f7)' },
      primary: {
        font: 'inherit',
        color: '#fff',
        background: '#2f81f7',
        border: '1px solid transparent',
        borderRadius: 6,
        padding: '5px 14px',
        cursor: 'pointer',
      },
    };

    async function probePort() {
      let outdated = false;
      for (let i = 0; i < PORT_COUNT; i += 1) {
        const port = PORT_START + i;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 400);
          const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: ctrl.signal });
          clearTimeout(timer);
          if (!res.ok) continue;
          const data = await res.json();
          if (!data || data.name !== 'fast-vps-viewer') continue;
          const features = Array.isArray(data.features) ? data.features : [];
          if (!features.includes('settings') || !features.includes('files') || !features.includes('terminal-init')) {
            outdated = true;
            continue;
          }
          return `http://127.0.0.1:${port}`;
        } catch {
          /* port not ours */
        }
      }
      if (outdated) {
        throw new Error(t(
          'The running plugin is older than this UI. Restart DSH Desktop so both halves match.',
          '运行中的插件比界面旧。请完整重启 DSH Desktop，让两边版本一致。',
        ));
      }
      throw new Error(t('FastVpsViewer host is not running', 'FastVpsViewer 宿主插件没有运行'));
    }


    async function call(base, path, method) {
      const res = await fetch(`${base}${path}`, {
        method: method || 'GET',
        headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok || data === null) {
        if (res.status === 404) {
          throw new Error(t(
            'The host plugin has no such endpoint. Restart DSH Desktop so both halves match.',
            '宿主插件没有这个接口。请完整重启 DSH Desktop，让两边版本一致。',
          ));
        }
        throw new Error(data?.error || `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      }
      return data;
    }

    function releaseInBackground(base) {
      const run = async () => {
        try {
          const b = base || lastBase || (await probePort());
          await fetch(`${b}/api/stop`, {
            method: 'POST',
            headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json' },
            body: '{}',
          });
        } catch {
          /* the session is gone already, or the host is shutting down */
        }
      };
      run();
    }

    function toForm(settings) {
      return {
        sshHost: settings.sshHost || '',
        sshPort: String(settings.sshPort ?? 22),
        sshUser: settings.sshUser || '',
        auth: settings.auth || 'agent',
        identityFile: settings.identityFile || '',
        password: '',
        hasPassword: Boolean(settings.hasPassword),
        autoResize: settings.autoResize !== false,
        maximize: settings.maximize !== false,
        geometry: settings.geometry || '',
        startup: (settings.startupCommands || []).join('\n'),
        idle: String(settings.idleMinutes ?? ''),
        max: String(settings.maxSessionMinutes ?? ''),
      };
    }

    function Body() {
      const [phase, setPhase] = React.useState('loading');
      const [base, setBase] = React.useState(null);
      const [viewerUrl, setViewerUrl] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [meta, setMeta] = React.useState('');
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [form, setForm] = React.useState(null);
      const [notice, setNotice] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [apps, setApps] = React.useState([]);
      const [browser, setBrowser] = React.useState(undefined);
      const [view, setView] = React.useState('launcher');
      const [files, setFiles] = React.useState(null);
      const [filesError, setFilesError] = React.useState('');
      const [filesLoading, setFilesLoading] = React.useState(false);
      const pathRef = React.useRef(null);
      const [toast, setToast] = React.useState('');
      const [dropping, setDropping] = React.useState(false);
      const [terminalUrl, setTerminalUrl] = React.useState(null);
      const [uploadDir, setUploadDir] = React.useState('~/Downloads');
      const [appFormOpen, setAppFormOpen] = React.useState(false);
      const [appName, setAppName] = React.useState('');
      const [appCommand, setAppCommand] = React.useState('');
      const alive = React.useRef(true);

      React.useEffect(() => () => { alive.current = false; }, []);

      const refresh = React.useCallback(async () => {
        try {
          const b = base || (await probePort());
          if (!alive.current) return;
          setBase(b);
          lastBase = b;
          const status = await call(b, '/api/status');
          if (!alive.current) return;
          setPhase(status.phase);
          setViewerUrl(status.viewerUrl);
          setMeta(`${status.sshHost} · :${status.display}`);
          setError(status.error || null);
          const settings = await call(b, '/api/settings');
          if (!alive.current) return;
          setApps(settings.settings?.apps || []);
          if (settings.settings?.uploadDir) setUploadDir(settings.settings.uploadDir);
          try {
            const detected = await call(b, '/api/browser');
            if (alive.current) setBrowser(detected.browser ?? null);
          } catch {
            if (alive.current) setBrowser(undefined);
          }
        } catch (err) {
          if (!alive.current) return;
          setPhase('error');
          setError(String(err.message || err));
        }
      }, [base]);

      React.useEffect(() => { refresh(); }, [refresh]);

      const human = (n) => (n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

      const loadFiles = async (target) => {
        setFilesError('');
        setFilesLoading(true);
        try {
          const b = base || (await probePort());
          setBase(b);
          const data = await call(b, `/api/files?path=${encodeURIComponent(target)}`);
          if (!alive.current) return;
          const entries = (data.entries || []).slice().sort((a, b2) => {
            if (a.type !== b2.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b2.name);
          });
          setFiles({ ...data, entries });
        } catch (err) {
          if (alive.current) setFilesError(String(err.message || err));
        } finally {
          if (alive.current) setFilesLoading(false);
        }
      };

      const downloadFile = (file) => {
        const b = base || lastBase;
        if (!b) return;
        const target = files.path === '~' ? `~/${file.name}` : `${files.path}/${file.name}`;
        const a = document.createElement('a');
        a.href = `${b}/api/files/download?path=${encodeURIComponent(target)}`;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      const deleteFile = async (file) => {
        const target = files.path === '~' ? `~/${file.name}` : `${files.path}/${file.name}`;
        if (typeof window.confirm === 'function' && !window.confirm(`${t('Delete', '删除')} ${target}?`)) return;
        setFilesLoading(true);
        try {
          const b = base || lastBase;
          const res = await fetch(`${b}/api/files/delete`, {
            method: 'POST',
            headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json' },
            body: JSON.stringify({ path: target }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          await loadFiles(files.path);
        } catch (err) {
          setFilesError(String(err.message || err));
        } finally {
          setFilesLoading(false);
        }
      };

      const uploadFiles = async (fileList, dir) => {
        const b = base || (await probePort());
        setBase(b);
        const total = fileList.length;
        let ok = 0;
        for (const file of fileList) {
          try {
            const res = await fetch(`${b}/api/upload?dir=${encodeURIComponent(dir)}`, {
              method: 'POST',
              headers: { 'x-fast-vps-viewer': '1', 'x-filename': file.name, 'content-type': 'application/octet-stream' },
              body: file,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            ok += 1;
          } catch (err) {
            setToast(`${t('Upload failed: ', '上传失败：')}${err.message}`);
          }
        }
        if (ok) setToast(t(`Uploaded ${ok}/${total} to ${dir}`, `已上传 ${ok}/${total} 个文件到 ${dir}`));
      };

      const openTerminal = async () => {
        setError(null);
        try {
          const b = base || (await probePort());
          setBase(b);
          const data = await call(b, '/api/terminal', 'POST');
          setTerminalUrl(data.url);
        } catch (err) {
          setError(String(err.message || err));
        }
      };

      const startWith = async (startup) => {
        setError(null);
        setPhase('starting');
        try {
          const b = base || (await probePort());
          setBase(b);
          const res = await fetch(`${b}/api/start`, {
            method: 'POST',
            headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json' },
            body: JSON.stringify({ startup }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          if (!alive.current) return;
          setPhase(data.phase);
          setViewerUrl(data.viewerUrl);
          setMeta(`${data.sshHost} · :${data.display}`);
        } catch (err) {
          if (!alive.current) return;
          setPhase('error');
          setError(String(err.message || err));
        }
      };

      const saveApp = async () => {
        const command = appCommand.trim();
        if (!command) return;
        const name = appName.trim() || command.split(/\s+/)[0];
        const next = [...apps, { name: name.slice(0, 60), command }];
        try {
          const b = base || (await probePort());
          setBase(b);
          const res = await fetch(`${b}/api/settings`, {
            method: 'PUT',
            headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json' },
            body: JSON.stringify({ apps: next }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          setApps(data.settings?.apps || next);
          setAppFormOpen(false);
          setAppName('');
          setAppCommand('');
          startWith([command]);
        } catch (err) {
          setNotice(String(err.message || err));
        }
      };

      const removeApp = async (name) => {
        const next = apps.filter((app) => app.name !== name);
        try {
          const b = base || (await probePort());
          const res = await fetch(`${b}/api/settings`, {
            method: 'PUT',
            headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json' },
            body: JSON.stringify({ apps: next }),
          });
          const data = await res.json();
          if (res.ok) setApps(data.settings?.apps || next);
        } catch {
          /* ignore */
        }
      };

      const openSettings = async () => {
        setSettingsOpen(true);
        setNotice('');
        try {
          const b = base || (await probePort());
          setBase(b);
          const data = await call(b, '/api/settings');
          if (!alive.current) return;
          setForm(toForm(data.settings || {}));
        } catch (err) {
          setNotice(String(err.message || err));
        }
      };

      const saveSettings = async () => {
        if (!form) return;
        setBusy(true);
        setNotice('');
        try {
          const body = {
            sshHost: form.sshHost.trim(),
            sshPort: Number(form.sshPort) || 22,
            sshUser: form.sshUser.trim(),
            auth: form.auth,
            identityFile: form.identityFile.trim(),
            geometry: form.geometry.trim(),
            autoResize: form.autoResize,
            maximize: form.maximize,
            startupCommands: form.startup.split('\n').map((line) => line.trim()).filter(Boolean),
            idleMinutes: Number(form.idle),
            maxSessionMinutes: Number(form.max),
          };
          if (form.password) body.password = form.password;
          const res = await fetch(`${base}/api/settings`, {
            method: 'PUT',
            headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          setForm(toForm(data.settings || {}));
          setNotice(data.restartRequired
            ? t('Saved. Restart the session to apply.', '已保存。重启会话后生效。')
            : t('Saved.', '已保存。'));
          refresh();
        } catch (err) {
          setNotice(String(err.message || err));
        } finally {
          setBusy(false);
        }
      };

      const testConnection = async () => {
        setBusy(true);
        setNotice(t('Testing…', '测试中…'));
        try {
          const b = base || (await probePort());
          setBase(b);
          const res = await fetch(`${b}/api/test`, {
            method: 'POST',
            headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json' },
            body: '{}',
          });
          const data = await res.json();
          setNotice(data.ok
            ? t('Connection works.', '连接成功。')
            : `${t('Connection failed: ', '连接失败：')}${data.message || data.error || ''}`);
        } catch (err) {
          setNotice(String(err.message || err));
        } finally {
          setBusy(false);
        }
      };

      const restart = async () => {
        setBusy(true);
        try {
          if (base) {
            await call(base, '/api/stop', 'POST');
            const status = await call(base, '/api/start', 'POST');
            if (!alive.current) return;
            setPhase(status.phase);
            setViewerUrl(status.viewerUrl);
          }
        } catch (err) {
          setNotice(String(err.message || err));
        } finally {
          setBusy(false);
        }
      };

      const start = async () => {
        setError(null);
        setPhase('starting');
        try {
          const b = base || (await probePort());
          setBase(b);
          const status = await call(b, '/api/start', 'POST');
          if (!alive.current) return;
          setPhase(status.phase);
          setViewerUrl(status.viewerUrl);
          setMeta(`${status.sshHost} · :${status.display}`);
        } catch (err) {
          if (!alive.current) return;
          setPhase('error');
          setError(String(err.message || err));
        }
      };

      const stop = async () => {
        try {
          if (base) await call(base, '/api/stop', 'POST');
        } catch (err) {
          setError(String(err.message || err));
        }
        setViewerUrl(null);
        setPhase('idle');
      };

      const settingsPanel = settingsOpen ? h('div', { style: styles.settingsOverlay },
        h('div', { style: styles.settingsCard },
          h('div', { style: styles.settingsTitle }, t('Settings', '设置')),
          form ? h('div', { style: styles.form },
            h('div', { style: styles.groupTitle }, t('Connection', '连接')),
            field(t('Host, IP, or ~/.ssh/config alias', '主机 / IP / SSH 别名'), h('input', {
              style: styles.input,
              value: form.sshHost,
              onChange: (e) => setForm({ ...form, sshHost: e.target.value }),
              placeholder: 'my-vps',
            })),
            h('div', { style: styles.row },
              field(t('Port', '端口'), h('input', {
                style: styles.input,
                value: form.sshPort,
                onChange: (e) => setForm({ ...form, sshPort: e.target.value }),
                placeholder: '22',
              })),
              field(t('User', '用户名'), h('input', {
                style: styles.input,
                value: form.sshUser,
                onChange: (e) => setForm({ ...form, sshUser: e.target.value }),
                placeholder: t('current user', '留空=当前用户'),
              })),
              field(t('Auth', '认证方式'), h('select', {
                style: styles.input,
                value: form.auth,
                onChange: (e) => setForm({ ...form, auth: e.target.value }),
              },
                h('option', { value: 'agent' }, t('Use my ~/.ssh/config + agent', '跟随系统 ssh 配置（推荐）')),
                h('option', { value: 'key' }, t('Specific private key file', '指定私钥文件')),
                h('option', { value: 'password' }, t('Password', '密码')),
              )),
            ),
            h('div', { style: styles.help }, form.auth === 'agent'
              ? t(
                'Behaves exactly like "ssh <host>" in your terminal: reads ~/.ssh/config (Host/User/Port/IdentityFile/ProxyJump) and the keys already loaded in ssh-agent. It never prompts, so the key must be usable without a passphrase prompt.',
                '和你终端里敲 “ssh <主机>” 完全一样：读 ~/.ssh/config 里的 Host/User/Port/IdentityFile/ProxyJump，用 ssh-agent 里已经加载的密钥。它不会弹提示，所以密钥必须能免交互使用（已加载进 agent，或本身没有口令）。',
              )
              : form.auth === 'key'
                ? t(
                  'Only this key is offered (-i + IdentitiesOnly), so a per-host default in ~/.ssh/config is ignored.',
                  '只用你指定的这一把私钥（-i + IdentitiesOnly），~/.ssh/config 里按主机配的默认密钥会被忽略。',
                )
                : t(
                  'The password is stored on this machine (0600) and handed to ssh through SSH_ASKPASS. It is never returned by the API.',
                  '密码只存在本机（0600），通过 SSH_ASKPASS 交给 ssh，接口不会把它读回去。',
                )),
            form.auth === 'key' ? field(t('Private key path', '私钥路径'), h('input', {
              style: styles.input,
              value: form.identityFile,
              onChange: (e) => setForm({ ...form, identityFile: e.target.value }),
              placeholder: '~/.ssh/id_ed25519',
            })) : null,
            form.auth === 'password' ? field(
              form.hasPassword ? t('Password (stored, type to replace)', '密码（已保存，输入可替换）') : t('Password', '密码'),
              h('input', {
                style: styles.input,
                type: 'password',
                value: form.password,
                onChange: (e) => setForm({ ...form, password: e.target.value }),
                placeholder: form.hasPassword ? '••••••••' : '',
                autoComplete: 'off',
              }),
            ) : null,
            h('div', { style: styles.help }, t(
              'Password and key files stay on this machine; the plugin never sends them anywhere.',
              '密码和私钥只保存在本机，插件不会把它们发送到任何地方。',
            )),
            h('label', { style: styles.checkboxRow },
              h('input', {
                type: 'checkbox',
                checked: form.autoResize,
                onChange: (e) => setForm({ ...form, autoResize: e.target.checked }),
              }),
              h('span', null, t('Fit the desktop to the panel (dynamic resize)', '桌面尺寸跟随面板（动态调整）')),
            ),
            field(form.autoResize ? t('Initial resolution', '初始分辨率') : t('Resolution', '分辨率'), h('input', {
              style: styles.input,
              value: form.geometry,
              onChange: (e) => setForm({ ...form, geometry: e.target.value }),
              placeholder: '1600x900',
            })),
            h('label', { style: styles.checkboxRow },
              h('input', {
                type: 'checkbox',
                checked: form.maximize,
                onChange: (e) => setForm({ ...form, maximize: e.target.checked }),
              }),
              h('span', null, t('Maximize windows on start (openbox)', '启动时窗口铺满桌面（openbox）')),
            ),
            form.autoResize ? h('div', { style: styles.help }, t(
              'The initial size is used until the viewer connects, then the server follows the window.',
              '这个尺寸只用于连接前；连上之后远端会跟着窗口大小变。',
            )) : null,
            field(t('Programs to launch (one per line)', '启动时运行的程序（一行一个）'), h('textarea', {
              style: { ...styles.input, height: 92, resize: 'vertical', fontFamily: 'ui-monospace, monospace' },
              value: form.startup,
              onChange: (e) => setForm({ ...form, startup: e.target.value }),
              placeholder: 'browser\nbrowser https://example.com\nxterm',
            })),
            h('div', { style: styles.row },
              field(t('Release after idle (minutes)', '空闲多久回收（分钟）'), h('input', {
                style: styles.input,
                value: form.idle,
                onChange: (e) => setForm({ ...form, idle: e.target.value }),
              })),
              field(t('Max session (minutes)', '单次会话上限（分钟）'), h('input', {
                style: styles.input,
                value: form.max,
                onChange: (e) => setForm({ ...form, max: e.target.value }),
              })),
            ),
            h('div', { style: styles.help }, t(
              'browser picks firefox/firefox-esr/chromium; "browser <url>" opens that page.',
              'browser 会自动挑选浏览器；写成 “browser https://…” 可直接打开某个网址。',
            )),
          ) : h('div', { style: styles.help }, t('Loading…', '加载中…')),
          notice ? h('div', { style: styles.notice }, notice) : null,
          h('div', { style: { ...styles.row, justifyContent: 'flex-end', gap: 8 } },
            h('button', { type: 'button', style: styles.button, onClick: () => setSettingsOpen(false) }, t('Close', '关闭')),
            h('button', { type: 'button', style: styles.button, disabled: busy, onClick: testConnection }, t('Test', '测试连接')),
            h('button', { type: 'button', style: styles.button, disabled: busy, onClick: saveSettings }, t('Save', '保存')),
            viewerUrl ? h('button', { type: 'button', style: styles.primary, disabled: busy, onClick: restart }, t('Save & restart', '保存并重启会话')) : null,
          ),
        ),
      ) : null;

      if (viewerUrl) {
        return h('div', {
          style: styles.root,
          onDragOver: (e) => { e.preventDefault(); setDropping(true); },
          onDragLeave: () => setDropping(false),
          onDrop: (e) => {
            e.preventDefault();
            setDropping(false);
            const dropped = Array.from(e.dataTransfer?.files || []);
            if (dropped.length) uploadFiles(dropped, uploadDir).catch(() => {});
          },
        },
          h('div', { style: styles.bar },
            h('span', { style: styles.grow }, meta),
            h('button', { type: 'button', style: styles.button, onClick: openSettings }, t('Settings', '设置')),
          ),
          dropping ? h('div', { style: styles.dropZone }, t('Drop files to upload to the VPS', '松手即上传到 VPS')) : null,
          h('iframe', {
            src: viewerUrl + (viewerUrl.includes('?') ? '&' : '?') + 'chrome=0',
            style: styles.frame,
            allow: 'clipboard-read; clipboard-write',
            title: t('Remote desktop', '远端桌面'),
          }),
          settingsPanel,
        );
      }

      const terminalView = terminalUrl ? h('div', { style: styles.root },
        h('div', { style: styles.bar },
          h('button', { type: 'button', style: styles.button, onClick: () => setTerminalUrl(null) }, '←'),
          h('span', { style: styles.grow }, t('Terminal over SSH', 'SSH 命令行（不经过 VNC）')),
          h('button', { type: 'button', style: styles.button, onClick: () => setTerminalUrl(null) }, t('Close', '关闭')),
        ),
        h('iframe', {
          src: terminalUrl,
          style: styles.frame,
          title: t('Terminal', '命令行'),
        }),
      ) : null;

      if (terminalView) return terminalView;

      const filesView = h('div', { style: styles.root },
        h('style', null, '@keyframes fvvspin{to{transform:rotate(360deg)}}'),
        h('div', { style: styles.bar },
          h('button', { type: 'button', style: styles.button, onClick: () => setView('launcher') }, '←'),
          h('input', {
            key: files ? files.path : 'root',
            ref: pathRef,
            defaultValue: files ? files.path : '~',
            style: { ...styles.input, flex: 1, minWidth: 0, fontFamily: 'ui-monospace, monospace' },
            spellCheck: false,
            onKeyDown: (e) => {
              if (e.key !== 'Enter') return;
              const target = (pathRef.current?.value || '~').trim() || '~';
              loadFiles(target);
            },
            placeholder: t('Type a path and press Enter', '输入路径后回车'),
            'aria-label': t('Path', '路径'),
          }),
          h('button', {
            type: 'button',
            style: styles.button,
            disabled: filesLoading,
            onClick: () => loadFiles((pathRef.current?.value || '~').trim() || '~'),
          }, t('Go', '前往')),
          h('button', {
            type: 'button',
            style: styles.button,
            onClick: async () => {
              const b = base || (await probePort());
              setBase(b);
              const input = document.createElement('input');
              input.type = 'file';
              input.multiple = true;
              input.onchange = () => uploadFiles(Array.from(input.files || []), files?.path || '~').then(() => loadFiles(files?.path || '~'));
              input.click();
            },
          }, t('Upload', '上传')),
          h('button', {
            type: 'button',
            style: styles.button,
            disabled: !files?.parent || filesLoading,
            onClick: () => files?.parent && loadFiles(files.parent),
          }, t('Up', '上一级')),
        ),
        filesError ? h('div', { style: { ...styles.help, color: 'var(--dsw-alias-danger, #f85149)', padding: '6px 10px' } }, filesError) : null,
        h('div', { style: styles.fileList },
          filesLoading ? h('div', { style: styles.inlineLoading },
            h('div', { style: styles.spinnerSmall }),
            h('span', null, t('Loading…', '加载中…')),
          ) : null,
          !filesLoading && files?.entries?.length === 0 ? h('div', { style: styles.help }, t('This folder is empty', '这个目录是空的')) : null,
          (files?.entries || []).map((entry) => h('div', { key: entry.name, style: styles.fileRow },
            h('button', {
              type: 'button',
              style: styles.fileName,
              onClick: () => {
                if (entry.type === 'dir') loadFiles(files.path === '~' ? `~/${entry.name}` : `${files.path}/${entry.name}`);
                else downloadFile(entry);
              },
              title: entry.type === 'dir' ? t('Open folder', '打开目录') : t('Download', '下载'),
            }, `${entry.type === 'dir' ? '📁' : '📄'} ${entry.name}`),
            h('span', { style: styles.fileMeta }, entry.type === 'dir' ? '—' : human(entry.size)),
            entry.type === 'file' ? h('button', { type: 'button', style: styles.button, onClick: () => downloadFile(entry) }, t('Download', '下载')) : null,
            h('button', { type: 'button', style: styles.button, onClick: () => deleteFile(entry) }, t('Delete', '删除')),
          )),
        ),
        toast ? h('div', { style: styles.toast }, toast) : null,
      );

      const loading = phase === 'loading' || phase === 'starting' || phase === 'stopping';

      const browserText = () => {
        if (browser === undefined) return t('Auto-picks Chrome or Firefox', '自动选择 Chrome / Firefox');
        if (browser === null) return t('No browser found on the server', '服务器上没有找到浏览器');
        const names = {
          firefox: 'Firefox',
          'firefox-esr': 'Firefox ESR',
          chromium: 'Chromium',
          'chromium-browser': 'Chromium',
          'google-chrome': 'Google Chrome',
          'epiphany-browser': 'Epiphany',
        };
        return t(`On the server: ${names[browser] || browser}`, `服务器上的 ${names[browser] || browser}`);
      };

      const card = (icon, title, desc, onClick, key) => h('button', {
        type: 'button',
        key: key || title,
        style: styles.card,
        disabled: loading,
        onClick,
      },
        h('span', { style: styles.cardIcon, 'aria-hidden': true }, icon),
        h('span', { style: styles.cardTitle }, title),
        h('span', { style: styles.cardDesc }, desc),
      );

      if (view === 'files' && !viewerUrl) return filesView;

      return h('div', { style: styles.root },
        h('style', null, '@keyframes fvvspin{to{transform:rotate(360deg)}}'),
        loading ? h('div', { style: styles.spinnerWrap },
          h('div', { style: styles.spinner }),
          h('div', { style: styles.spinnerText }, t('Starting the desktop on the VPS…', '正在连接服务器并启动桌面…')),
        ) : null,
        h('div', { style: styles.launcher },
          h('div', { style: styles.launcherHead },
            h('div', { style: styles.launcherTitle }, t('Open on the VPS', '在 VPS 上打开')),
            meta ? h('div', { style: styles.help }, meta) : null,
          ),
          error ? h('div', { style: { color: 'var(--dsw-alias-danger, #f85149)', fontSize: 12 } }, error) : null,
          h('div', { style: styles.grid },
            card('🌐', t('Browser', '浏览器'), browserText(), () => startWith(['browser'])),
            card('>_', t('Terminal', '命令行'), t('SSH shell, no desktop', 'SSH 命令行，不启动桌面'), openTerminal),
            card('＋', t('Add an app', '添加自定义 APP'), t('Any command, saved for later', '任意命令，保存下来下次直接用'), () => setAppFormOpen(true)),
            card('📁', t('Files', '文件'), t('Browse, download, delete', '浏览、下载、删除'), async () => { setView('files'); await loadFiles('~'); }),
            card('⚙', t('Settings', '设置'), t('Connection, size, release', '连接、尺寸、回收'), openSettings),
          ),
          apps.length ? h('div', { style: styles.savedWrap },
            h('div', { style: styles.sectionLabel }, t('My apps', '我的应用')),
            h('div', { style: styles.grid },
              apps.map((app) => h('div', { key: app.name, style: styles.savedCard },
                card('▸', app.name, app.command, () => startWith([app.command]), app.name),
                h('button', {
                  type: 'button',
                  style: styles.removeApp,
                  title: t('Remove', '移除'),
                  onClick: (e) => { e.stopPropagation(); removeApp(app.name); },
                }, '×'),
              )),
            ),
          ) : null,
          appFormOpen ? h('div', { style: styles.appForm },
            h('div', { style: styles.sectionLabel }, t('New app', '新的 APP')),
            h('input', {
              style: styles.input,
              placeholder: t('Name (optional)', '名字（可留空）'),
              value: appName,
              onChange: (e) => setAppName(e.target.value),
            }),
            h('input', {
              style: styles.input,
              placeholder: t('Command, e.g. libreoffice --writer', '命令，例如 libreoffice --writer'),
              value: appCommand,
              onChange: (e) => setAppCommand(e.target.value),
            }),
            h('div', { style: { ...styles.row, justifyContent: 'flex-end', gap: 8 } },
              h('button', { type: 'button', style: styles.button, onClick: () => setAppFormOpen(false) }, t('Cancel', '取消')),
              h('button', { type: 'button', style: styles.primary, disabled: !appCommand.trim(), onClick: saveApp }, t('Save & start', '保存并启动')),
            ),
          ) : null,
          notice ? h('div', { style: styles.notice }, notice) : null,
        ),
        settingsPanel,
      );
    }

    function field(label, control) {
      return h('label', { style: styles.field },
        h('span', { style: styles.fieldLabel }, label),
        control,
      );
    }

    function DockButton(props) {
      const [busy, setBusy] = React.useState(false);
      const onClick = async () => {
        setBusy(true);
        try {
          const b = await probePort();
          const status = await call(b, '/api/start', 'POST');
          if (!status.viewerUrl) return;
          window.open(status.viewerUrl, '_blank');
        } catch (err) {
          console.warn('[fast-vps-viewer]', err);
        } finally {
          setBusy(false);
        }
      };
      return h('button', {
        type: 'button',
        onClick,
        disabled: busy,
        title: t('Open remote desktop', '打开远端桌面'),
        style: { ...styles.button, padding: '4px 10px' },
      }, busy ? '…' : '🖥');
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        const registerFallback = () => {
          ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
            name: 'conversation.composer.dock',
            id: `${TYPE_ID}-dock`,
            order: 60,
          }, (props) => h(DockButton, { ...props, ctx }))), 'fast-vps-viewer: dock fallback');
        };

        try {
          if (!ctx.sidebarRightTabs || typeof ctx.sidebarRightTabs.register !== 'function') {
            throw new Error('sidebarRightTabs unavailable');
          }
          ctx.effect(() => ctx.sidebarRightTabs.register({
            id: TYPE_ID,
            kind: TYPE_ID,
            title: () => t('Remote desktop', '远端桌面'),
            guide: [{
              id: 'open',
              order: 10,
              title: () => t('Remote desktop', '远端桌面'),
              description: () => t('Openbox on your VPS', '按需打开 VPS 上的 Openbox 桌面'),
            }],
            keepMounted: true,
          }), 'fast-vps-viewer: tab type');

          ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TYPE_ID,
          }, Body)), 'fast-vps-viewer: pane body');

          // Closing the tab releases the remote desktop; the idle timer is only
          // a safety net for crashes and reloads.
          if (typeof ctx.sidebarRight.registerCloseHandler === 'function') {
            ctx.effect(() => ctx.sidebarRight.registerCloseHandler(TYPE_ID, () => {
              releaseInBackground(null);
            }), 'fast-vps-viewer: close releases');
          }
          console.info('[fast-vps-viewer] registered sidebar tab type');
        } catch (err) {
          console.warn('[fast-vps-viewer] sidebar tab registration failed', err);
          registerFallback();
          console.info('[fast-vps-viewer] registered composer fallback button');
        }
      },
    };
  },
});
