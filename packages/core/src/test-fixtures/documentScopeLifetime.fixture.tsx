/* eslint-disable react-hooks/immutability -- Browser regression probe records weak observations only; never retain the scope itself. */
import { Suspense, StrictMode, startTransition, useContext, useEffect, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AIMarkdownDocuments, useDocumentRegistry } from '../components/AIMarkdownDocuments';
import { SmoothCoordinatorContext } from '../components/smoothStream/coordinator';
import type { RegistryInternal } from '@ai-react-markdown/engine';

declare global {
  interface Window {
    scopeProbe: {
      observed: Record<string, [WeakRef<object>, WeakRef<object>]>;
      attempted: string[];
      identityErrors: string[];
      change: (id: string) => void;
      unmount: () => void;
    };
  }
}
const probe = (window.scopeProbe = {
  observed: {} as Record<string, [WeakRef<object>, WeakRef<object>]>,
  attempted: [] as string[],
  identityErrors: [] as string[],
  change: (_id: string) => {},
  unmount: () => {},
});
const pending = new Promise<void>(() => {});
function Probe({ id, sibling = false }: { id: string; sibling?: boolean }) {
  const registry = useDocumentRegistry(id) as RegistryInternal;
  const coordinator = useContext(SmoothCoordinatorContext)!.getCoordinator(id);
  const instance = useId();
  if (sibling) {
    const previous = probe.observed[id];
    if (previous?.[0].deref() !== registry || previous?.[1].deref() !== coordinator) {
      probe.identityErrors.push(id);
    }
  } else probe.observed[id] = [new WeakRef(registry), new WeakRef(coordinator)];
  useEffect(() => {
    registry.registerChunk(instance, new Set(), new Set());
    coordinator.register(instance);
    return () => {
      registry.releaseSymbol(instance);
      coordinator.release(instance);
    };
  }, [registry, coordinator, instance]);
  if (id.startsWith('abandoned')) {
    probe.attempted.push(id);
    throw pending;
  }
  return sibling ? null : <div id="committed">{id}</div>;
}
function App() {
  const [id, setId] = useState('initial');
  probe.change = (next) => startTransition(() => setId(next));
  return (
    <AIMarkdownDocuments>
      <Suspense fallback="waiting">
        <Probe id={id} />
        <Probe id={id} sibling />
      </Suspense>
    </AIMarkdownDocuments>
  );
}
const root = createRoot(document.getElementById('root')!);
probe.unmount = () => root.unmount();
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
