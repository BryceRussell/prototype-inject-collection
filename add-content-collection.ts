import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HookParameters } from "astro";
import { AstroError } from "astro/errors";
import {
	type CallExpression,
	Node,
	type ObjectLiteralExpression,
	Project,
	type SourceFile,
	VariableDeclarationKind,
} from "ts-morph";

interface Option {
	seedDir?: string;
	moduleName: string;
	exportName: string;
	collection: string;
	suffix?: string;
	type?: "content" | "data";
	overwrite?: boolean;
	config: HookParameters<"astro:config:setup">["config"];
	logger: HookParameters<"astro:config:setup">["logger"];
}

// Validates/transforms strings into absolute directory path
function stringToDir(base: string, path: string): string {
	// Check if path is string
	if (!path) {
		throw new AstroError(`Invalid path!`, `"${path}"`);
	}

	// Check if path is a file URL
	if (path.startsWith("file:/")) {
		path = fileURLToPath(path);
	}

	// Check if path is relative
	if (!isAbsolute(path)) {
		path = resolve(base, path);
	}

	// Check if path is a file
	if (extname(path)) {
		path = dirname(path);
	}

	// Check if path exists
	if (!existsSync(path)) {
		throw new AstroError(`Path does not exist!`, `"${path}"`);
	}

	return path;
}

export function addContentCollection(option: Option) {
	const {
		moduleName,
		exportName,
		collection,
		suffix = "Schema",
		overwrite = false,
		type,
		config,
		logger,
	} = option;

	let { seedDir } = option;

	let importName = exportName === "default" ? collection + suffix : exportName;

	const rootDir = fileURLToPath(config.root.toString());
	const srcDir = fileURLToPath(config.srcDir.toString());
	const contentDir = resolve(srcDir, "content");
	const contentConfig = resolve(srcDir, "content/config.ts");
	const collectionDir = resolve(srcDir, "content/" + collection);

	if (seedDir) seedDir = stringToDir(rootDir, seedDir);

	// If src directory does not exist, create one
	if (!existsSync(srcDir)) {
		mkdirSync(srcDir);
	}

	// If src/content directory does not exist, create one
	if (!existsSync(contentDir)) {
		mkdirSync(contentDir);
	}

	// If content collection config does not exist, create one
	if (!existsSync(contentConfig)) {
		writeFileSync(contentConfig, "");
	}

	// If collection directory does not exist, create one
	if (!existsSync(collectionDir)) {
		mkdirSync(collectionDir);

		// If there is a seed directory, initialize collection directory with contents of seed directory
		if (seedDir && existsSync(seedDir)) {
			try {
				cpSync(seedDir, collectionDir, { recursive: true });
			} catch {
				// throw new AstroError(`Failed to seed '${collection}' collection`, seedDir)
				logger.warn(`Failed to seed '${collection}' collection: ${seedDir}`);
			}
		}
	}

	// Initilize ts-morph
	const project = new Project();
	const sourceFile = project.addSourceFileAtPath(contentConfig);

	addImport({
		sourceFile,
		moduleName: "astro:content",
		importName: "z",
	});

	addImport({
		sourceFile,
		moduleName: "astro:content",
		importName: "defineCollection",
	});

	const updatedImport = addImport({
		sourceFile,
		moduleName,
		importName,
		defaultImport: exportName === "default",
	});

	// Update importName, could have been prefixed with `_` to avoid conflicts
	importName = updatedImport.importAlias || updatedImport.importName;

	// Get 'collections' variable statement
	let collectionsStatement = sourceFile.getVariableStatement("collections");

	// If there is no 'collections' variable, create one
	if (!collectionsStatement) {
		collectionsStatement = sourceFile.addVariableStatement({
			declarationKind: VariableDeclarationKind.Const,
			declarations: [{ name: "collections", initializer: "{}" }],
		});
	}

	// If 'collections' statement does not have export declaration ('export { collections }') or export on variable statement, add export
	if (
		!sourceFile.getExportedDeclarations().get("collections") &&
		!collectionsStatement.isExported()
	) {
		collectionsStatement.setIsExported(true);
	}

	// If 'collections' statement is not 'const' make it 'const'
	if (collectionsStatement.getDeclarationKind() !== "const") {
		collectionsStatement.setDeclarationKind(VariableDeclarationKind.Const);
	}

	const collectionsDeclaration = collectionsStatement.getDeclarations()[0];

	let collectionsObject = collectionsDeclaration?.getInitializer();

	// If 'collections' variable does not have a value or the value is not an object, make it an object
	if (
		!collectionsObject ||
		!Node.isObjectLiteralExpression(collectionsObject)
	) {
		collectionsDeclaration!.setInitializer("{}");
		collectionsObject = collectionsDeclaration!.getInitializer();
	}

	addFunctionCallToProperty(collectionsObject as ObjectLiteralExpression, {
		name: collection,
		func: "defineCollection",
		arguments: [
			`{ ${type === "data" ? `type: 'data', ` : ""}` +
				`schema: ${importName}() }`,
		],
		overwrite,
	});

	sourceFile.organizeImports();

	sourceFile.saveSync();
}

function isImportNameAvailable(option: {
	sourceFile: SourceFile;
	moduleName: string;
	importName: string;
}) {
	const { sourceFile, moduleName, importName } = option;

	const isImport = sourceFile.getImportDeclarations().some((imprt) => {
		if (imprt.getModuleSpecifier().getLiteralText() === moduleName)
			return false;

		if (imprt.getDefaultImport()?.getText() === importName) return true;

		return imprt
			.getNamedImports()
			.some(
				(i) =>
					i.getAliasNode()?.getText() === importName ||
					i.getNameNode().getText() === importName,
			);
	});

	const isVariable = sourceFile
		.getVariableDeclarations()
		.some((varible) => varible.getName() === importName);

	const isFunction = sourceFile
		.getFunctions()
		.some((func) => func.getName() === importName);

	return {
		importName,
		available: !(isImport || isVariable || isFunction),
		isImport,
		isVariable,
		isFunction,
	};
}

// Safely add import
function addImport(option: {
	sourceFile: SourceFile;
	moduleName: string;
	importName: string;
	importAlias?: string;
	defaultImport?: boolean;
}) {
	const { sourceFile, moduleName, defaultImport } = option;

	// Test if name of import is already being used inside file
	const isAvailable = isImportNameAvailable({
		sourceFile,
		moduleName,
		importName: option.importAlias || option.importName,
	});

	// If importName already exists inside the file, prefix importName/importAlias with `_` until the name does not exist in the file
	while (!isAvailable.available) {
		Object.assign(
			isAvailable,
			isImportNameAvailable({
				sourceFile,
				moduleName,
				importName: `_${isAvailable.importName}`,
			}),
		);
		// Update option with new importName/importAlias
		if (!defaultImport || option.importAlias)
			option.importAlias = isAvailable.importName;
		else option.importName = isAvailable.importName;
	}

	const { importName, importAlias } = option;

	const declaration = sourceFile.getImportDeclaration(moduleName);

	// Remove namespace import (import * as something)
	declaration?.removeNamespaceImport();

	// Handle default imports on existing import declaration
	if (declaration && defaultImport) {
		const imprt = declaration.getDefaultImport();
		if (imprt) {
			// If default export exists, rename it
			imprt.replaceWithText(importAlias || importName);
		} else {
			// If default export does not exist, add it
			declaration.setDefaultImport(importAlias || importName);
		}
		return option;
	}

	// Handle named imports on existing import declaration
	if (declaration) {
		// Find named import for 'importName'
		const imprt = declaration
			.getNamedImports()
			.find((i) => i.getNameNode().getText() === importName);
		if (imprt) {
			// If named import has an alias, rename or remove it
			if (imprt.getAliasNode()?.getText() !== importAlias) {
				if (importAlias) {
					imprt.setAlias(importAlias);
				} else {
					imprt.removeAlias();
				}
			}
		} else {
			// If named import does not exist, add it
			declaration.addNamedImport({
				name: importName,
				alias: importAlias!,
			});
		}
		return option;
	}

	// If there is no import declaration for module, add it
	sourceFile.addImportDeclaration({
		moduleSpecifier: moduleName,
		...(defaultImport
			? { defaultImport: importAlias || importName }
			: { namedImports: [{ name: importName, alias: importAlias! }] }),
	});

	return option;
}

// Adds a function call to an object property
function addFunctionCallToProperty(
	object: ObjectLiteralExpression,
	options: {
		name: string;
		func: string;
		arguments: string[];
		overwrite?: boolean;
	},
) {
	const { name, func, overwrite } = options;

	const initializer = func + `(${options.arguments.join(", ")})`;

	// Find property inside object
	const property = object
		.getProperties()
		.find((prop) => prop.getFirstChild()?.getText() === name);

	// If property does not exist, add it and return early
	if (!property) {
		object.addPropertyAssignment({
			name,
			initializer,
		});
		return object;
	}

	// Todo, add ability to check module of property value, allow overwriting if it is equal to moduleName
	if (!overwrite) return object;

	// Check if property value is a function call, replace if not
	if (!Node.isCallExpression(property.getLastChild())) {
		property.getLastChild()?.replaceWithText(initializer);
	}

	// Check if function name is correct, replace if not
	if (
		(property.getLastChild() as CallExpression).getExpression().getText() !==
		func
	) {
		(property.getLastChild() as CallExpression).setExpression(func);
	}

	// Loop over function arguments, if they do not match defined argument exactly (including whitespace), remove or replace them
	const args = (property.getLastChild() as CallExpression).getArguments();
	for (const [i, arg] of args.entries()) {
		if (options.arguments[i]) {
			if (arg.getText() !== options.arguments[i]) {
				arg.replaceWithText(options.arguments[i]!);
			}
			continue;
		} else {
			(property.getLastChild() as CallExpression).removeArgument(arg);
		}
	}

	return object;
}
