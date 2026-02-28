import path from "node:path";
import { fileURLToPath } from "node:url";

import madge from "madge";
import { createNeo4jDriver } from "./neo4j-config.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..");
const targetPath = path.join(repoRoot, "apps", "core-api", "src");
const CHUNK_SIZE = 200;

const chunkRows = <T>(rows: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
};

const ingestCode = async () => {
  const driver = createNeo4jDriver();
  const session = driver.session();

  try {
    const result = await madge(targetPath, {
      baseDir: repoRoot,
      fileExtensions: ["ts"]
    });
    const graph = result.obj();
    const files = new Set<string>();

    for (const [source, imports] of Object.entries(graph)) {
      files.add(source);
      for (const imported of imports) {
        files.add(imported);
      }
    }

    const fileRows = Array.from(files).map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
    }));

    for (const chunk of chunkRows(fileRows, CHUNK_SIZE)) {
      await session.run(
        "UNWIND $rows AS row MERGE (f:CodeFile {path: row.path}) SET f.name = row.name",
        { rows: chunk }
      );
    }

    const edgeRows: Array<{ source: string; target: string }> = [];
    for (const [sourcePath, imports] of Object.entries(graph)) {
      for (const targetPath of imports) {
        edgeRows.push({ source: sourcePath, target: targetPath });
      }
    }

    for (const chunk of chunkRows(edgeRows, CHUNK_SIZE)) {
      await session.run(
        "UNWIND $rows AS row MATCH (a:CodeFile {path: row.source}), (b:CodeFile {path: row.target}) MERGE (a)-[:IMPORTS]->(b)",
        { rows: chunk }
      );
    }

    const edgeCount = edgeRows.length;

    console.log(
      `Analyzed ${files.size} files and created ${edgeCount} import relationships.`
    );
  } finally {
    await session.close();
    await driver.close();
  }
};

ingestCode().catch((error) => {
  console.error("Code ingestion failed.", error);
  process.exitCode = 1;
});
