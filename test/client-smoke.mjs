/**
 * Structural smoke test for the client bundle.
 *
 * Loads client.js with a fake __ModuleLoader__ / require table and asserts the
 * plugin registers the sidebar tab type (or the fallback) without throwing.
 */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

const registrations = { types: [], slots: [], injects: [] };

const fakeReact = {
  createElement: (...args) => ({ type: 'element', args }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
};

const ctx = {
  effect(fn) {
    const dispose = fn();
    return () => (typeof dispose === 'function' ? dispose() : undefined);
  },
  slots: {
    inject(name, factory) {
      registrations.injects.push(name);
      return typeof factory === 'function' ? factory() : undefined;
    },
    register(registration) {
      registrations.slots.push(registration);
      return () => {};
    },
  },
  sidebarRightTabs: {
    register(definition) {
      registrations.types.push(definition);
      return () => {};
    },
  },
  sidebarRight: {
    registerCloseHandler(kind, handler) {
      registrations.closeHandlers = registrations.closeHandlers || [];
      registrations.closeHandlers.push({ kind, handler });
      return () => {};
    },
  },
};

const sandbox = {
  window: {
    __ModuleLoader__: {
      load({ id, factory }) {
        sandbox.loaded = { id, factory };
      },
    },
  },
  navigator: { language: 'zh-CN' },
  fetch: async () => {
    throw new Error('no network in smoke test');
  },
  AbortController,
  setTimeout,
  clearTimeout,
  console,
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });

const loaded = sandbox.loaded;
if (!loaded) throw new Error('client bundle did not register a factory');

const requireStub = (name) => {
  if (name === 'react') return fakeReact;
  throw new Error(`unexpected module: ${name}`);
};
const plugin = loaded.factory(requireStub);

if (typeof plugin.apply !== 'function') throw new Error('factory did not return an apply()');
plugin.apply(ctx);

console.log('ok  bundle id:', loaded.id);
console.log('ok  tab types:', registrations.types.map((d) => `${d.id}/${d.kind}`).join(', ') || '(none)');
console.log('ok  slots:', registrations.slots.map((s) => s.name + '#' + (s.key || s.id)).join(', ') || '(none)');
console.log('ok  injects:', registrations.injects.join(', ') || '(none)');
console.log('ok  close handlers:', (registrations.closeHandlers || []).map((h) => h.kind).join(', ') || '(none)');
if (!(registrations.closeHandlers || []).some((h) => h.kind === 'fast-vps-viewer')) {
  throw new Error('tab close handler was not registered');
}

if (registrations.types.length === 0 && registrations.slots.length === 0) {
  throw new Error('no UI registered at all');
}
for (const type of registrations.types) {
  if (typeof type.title !== 'function') throw new Error('tab title must be a function');
  for (const entry of type.guide || []) {
    if (typeof entry.title !== 'function') throw new Error('guide title must be a function');
    if (entry.description !== undefined && typeof entry.description !== 'function') {
      throw new Error('guide description must be a function');
    }
  }
}
console.log('ok  guide entries well-formed:', registrations.types.map((t2) => (t2.guide || []).length).join(','));
console.log('ok  client smoke passed');
