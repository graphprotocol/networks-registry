import { getAllJsonFiles } from "./utils/fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import fs from "fs";

const ERRORS: string[] = [];

async function main() {
  const [
    ,
    ,
    networksPath = "registry",
    schemaPath = "schemas/registry.schema.json",
  ] = process.argv;

  const files = getAllJsonFiles(networksPath);
  if (files.length === 0) {
    console.error("No JSON files found");
    process.exit(1);
  }
  console.log(`Discovered ${files.length} JSON files`);

  const ajv = new Ajv();
  addFormats(ajv);
  const registrySchema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  ajv.addSchema(registrySchema, "registrySchema");
  const validate = ajv.getSchema("registrySchema#/$defs/Network")!;

  for (const file of files) {
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (!validate(json)) {
        ERRORS.push(
          ...validate.errors!.map(
            (e) => `File ${file} is invalid: ${e.instancePath} ${e.message}`,
          ),
        );
      } else {
        console.log(`  ${file} is valid`);
      }
    } catch (e) {
      ERRORS.push(`File ${file} is not a valid JSON: ${e.message}`);
    }
  }

  if (ERRORS.length > 0) {
    console.error("Validation errors:");
    for (const error of ERRORS) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log("All networks are valid\n");
}

await main();
