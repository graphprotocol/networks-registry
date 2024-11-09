import fs from "fs";
import path from "path";
import { Network } from "../types/registry";

export function readFromJsonFile<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

export function getAllJsonFiles(dir: string): string[] {
  let files: string[] = [];

  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);

    if (fs.statSync(fullPath).isDirectory()) {
      files = [...files, ...getAllJsonFiles(fullPath)];
    } else if (fullPath.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

export function loadNetworks(dir: string): Network[] {
  const files = getAllJsonFiles(dir);
  return files.map((f) => JSON.parse(fs.readFileSync(f, "utf-8")) as Network);
}
