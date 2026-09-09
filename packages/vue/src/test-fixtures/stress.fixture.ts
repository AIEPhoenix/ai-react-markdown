import { createApp, defineComponent, h, nextTick, reactive } from 'vue';
import { AIMarkdown, AIMarkdownDocuments, AIMarkdownSmoothStream } from '../index';
import { useDocumentScope } from '../documents';

const state = reactive({ show: false, first: true, doc: '', content: '', tail: '', streaming: true });
const retained: { key: string; id: string; ref: WeakRef<object> }[] = [];
let subscriptions = 0;
let acquired = 0;
const Instrument = defineComponent({
  setup() {
    const scope = useDocumentScope()!;
    const observed = new WeakSet<object>();
    // Test-only instrumentation observes the actual provider-owned objects.
    // Weak references cannot keep an otherwise released document alive.
    for (const key of ['acquire', 'acquireSmooth'] as const) {
      const original = scope[key].bind(scope);
      const wrapped = (id: string) => {
        const target = original(id);
        if (!observed.has(target)) {
          observed.add(target);
          retained.push({ key, id, ref: new WeakRef(target) });
          acquired++;
          const subscribe = target.subscribe.bind(target);
          target.subscribe = (listener: () => void) => {
            subscriptions++;
            const unsubscribe = subscribe(listener);
            let active = true;
            return () => {
              if (active) {
                active = false;
                subscriptions--;
              }
              unsubscribe();
            };
          };
        }
        return target;
      };
      // Both methods preserve their original concrete return type at runtime.
      Object.assign(scope, { [key]: wrapped });
    }
    return () =>
      state.show
        ? h('section', { id: 'stress-children' }, [
            state.first
              ? h(AIMarkdownSmoothStream, {
                  id: 'stress-first',
                  documentId: state.doc,
                  content: state.content,
                  streaming: state.streaming,
                  pacing: 'responsive',
                })
              : null,
            h(
              AIMarkdownSmoothStream,
              { id: 'stress-tail', documentId: state.doc, content: state.tail, streaming: false, pacing: 'responsive' },
              { waiting: () => h('span', { id: 'stress-waiting' }, 'waiting') }
            ),
            h(AIMarkdown, { id: 'stress-reference', documentId: state.doc, content: '[link][target]' }),
            h(AIMarkdown, { documentId: state.doc, content: `[target]: https://example.com/${state.doc}` }),
          ])
        : null;
  },
});
export function startVueStress() {
  const host = document.createElement('div');
  host.id = 'stress';
  document.body.append(host);
  const app = createApp({ render: () => h(AIMarkdownDocuments, null, { default: () => h(Instrument) }) });
  app.mount(host);
  window.vueStress = {
    update: async (patch) => {
      Object.assign(state, patch);
      await nextTick();
    },
    stats: () => ({
      subscriptions,
      acquired,
      alive: retained.filter(({ ref }) => ref.deref()).map(({ key, id }) => `${key}:${id}`),
    }),
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}
declare global {
  interface Window {
    vueStress: {
      update: (patch: Partial<typeof state>) => Promise<void>;
      stats: () => { subscriptions: number; acquired: number; alive: string[] };
      unmount: () => void;
    };
  }
}
