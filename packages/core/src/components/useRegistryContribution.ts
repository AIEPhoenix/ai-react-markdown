import { useEffect, useState } from 'react';
import { createContributionSession, type ContributionOptions } from '@ai-react-markdown/runtime';

/** The runtime publishes only after React commits a registered chunk. */
export function useRegistryContribution({
  pipeline,
  ownLabels,
  registry,
  targetPhantoms,
  sym,
  clobberPrefix,
  chain,
}: ContributionOptions) {
  const [session] = useState(createContributionSession);
  useEffect(() => {
    session.commit({ pipeline, ownLabels, registry, targetPhantoms, sym, clobberPrefix, chain });
  }, [session, pipeline, ownLabels, registry, targetPhantoms, sym, clobberPrefix, chain]);
}
