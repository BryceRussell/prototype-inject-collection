import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import { addContentCollection } from "./add-content-collection";

export default defineConfig({
	integrations: [
		{
			name: "add-schema-to-collection",
			hooks: {
				"astro:config:setup": async ({ config, logger }) => {
					await addContentCollection({
						srcDir: fileURLToPath(config.srcDir.toString()),
						seedDir: resolve(fileURLToPath(config.root.toString()), "seed"),
						moduleName: "@astrojs/starlight/schema",
						exportName: "docsSchema",
						collection: "docs",
						call: true,
						safe: false,
						overwrite: true,
						logger,
					});

					// await addContentCollection({
					// 	srcDir: fileURLToPath(config.srcDir.toString()),
					// 	moduleName: "my-theme/collections",
					// 	exportName: "default",
					// 	collection: "blog",
					// 	call: true,
					// 	overwrite: true,
					// 	logger,
					// });
				},
			},
		},
	],
});
