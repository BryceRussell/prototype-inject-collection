import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import { addContentCollection } from "./add-content-collection";

export default defineConfig({
	integrations: [
		{
			name: "add-schema-to-collection",
			hooks: {
				"astro:config:setup": ({ config, logger }) => {
					
					addContentCollection({
						seedDir: resolve(fileURLToPath(config.root.toString()), "seed"),
						moduleName: "@astrojs/starlight/schema",
						exportName: "docsSchema",
						collection: "docs",
						overwrite: true,
						config,
						logger,
					});

					addContentCollection({
						moduleName: "my-theme/collections",
						exportName: "default",
						collection: "blog",
						overwrite: true,
						config,	
						logger,
					});

				},
			},
		},
	],
});
