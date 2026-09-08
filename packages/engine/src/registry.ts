import { createRegistry as createInternalRegistry, type RegistryController } from './components/documentRegistry';

/** Create a document registry owned by one adapter scope.
 * Why: adapters require registration and publication without implementation fields.
 * Recommended pattern: allocate per document, register after mount and pair every
 * registration with releaseSymbol using the same chunk identity.
 * Footguns: onEmpty runs during deferred cleanup; reads are read-only snapshots.
 */
export function createRegistry(onEmpty?: () => void): RegistryController {
  return createInternalRegistry(onEmpty);
}
export type {
  Registry,
  RegistryController,
  ChunkData,
  FootnoteDef,
  LinkDef,
  RefKind,
  RefRecord,
} from './components/documentRegistry';
