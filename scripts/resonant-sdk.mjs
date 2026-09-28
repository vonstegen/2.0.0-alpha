#!/usr/bin/env node
// Machine-readable SDK category discovery CLI. Deterministic JSON on stdout for
// AI-harness consumption. No side effects; pure read of the category registry.
//
// Usage:
//   node scripts/resonant-sdk.mjs describe-category <category> [--subtype <s>] [--compact]
//   node scripts/resonant-sdk.mjs list-categories

import { describeCategory, listAddOnCategories, UnknownCategoryError } from "../packages/addon-sdk/src/category-registry.ts";

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const [, , command, category, ...rest] = process.argv;
const args = new Map();
for (let i = 0; i < rest.length; i++) {
  const token = rest[i];
  if (token === "--subtype" && rest[i + 1]) args.set("subtype", rest[++i]);
  else if (token === "--compact") args.set("compact", true);
}

try {
  if (command === "describe-category") {
    if (!category) {
      fail('Usage: resonant-sdk describe-category <category> [--subtype <s>] [--compact]');
    } else {
      const description = describeCategory(category, { subtype: args.get("subtype") });
      print(args.get("compact") ? {
        schemaVersion: description.schemaVersion,
        category: description.category,
        subtype: description.subtype,
        label: description.descriptor.label,
        purpose: description.descriptor.purpose,
        recommendedRuntimeFamilies: description.descriptor.recommendedRuntimeFamilies,
        recommendedSurfaces: description.descriptor.recommendedSurfaces,
        eligibleSystemSlots: description.descriptor.eligibleSystemSlots,
        requiredManifestFields: description.descriptor.requiredManifestFields,
        optionalManifestFields: description.descriptor.optionalManifestFields,
        providerCredentialOptions: description.descriptor.providerCredentialOptions,
        securityInvariants: description.descriptor.securityInvariants,
        sdkModules: description.descriptor.sdkModules,
        templates: description.descriptor.templates,
        examples: description.descriptor.examples,
        testSuites: description.descriptor.testSuites,
        docs: description.descriptor.docs,
        subtypeDetail: description.subtypeDetail,
      } : description);
    }
  } else if (command === "list-categories") {
    print({ schemaVersion: "resonant-sdk/category-list/v1", categories: listAddOnCategories() });
  } else {
    fail('Usage: resonant-sdk <describe-category|list-categories>');
  }
} catch (error) {
  if (error instanceof UnknownCategoryError) fail(error.message);
  else throw error;
}
