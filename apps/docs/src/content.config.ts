import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema({ extend: z.object({ 'nav.docs': z.string(), 'nav.examples': z.string() }) }),
  }),
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
