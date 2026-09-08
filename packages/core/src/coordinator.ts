import { createSmoothCoordinator as createInternalCoordinator, type SmoothCoordinator } from './smoothCoordinator';

/** Create one turn-taking scope.
 * Why: sibling chunks coordinate reveal without a framework or DOM dependency.
 * Recommended pattern: register after mount, report sticky completion, release on unmount.
 * Footguns: registration order controls reveal; completion cannot be retracted.
 */
export function createSmoothCoordinator(onEmpty?: () => void): SmoothCoordinator {
  return createInternalCoordinator(onEmpty);
}
