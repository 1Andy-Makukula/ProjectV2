import fs from 'fs';
import path from 'path';

const projectRoot = process.argv[2] || process.cwd();
const intermediateDir = path.join(projectRoot, '.understand-anything', 'intermediate');
const outPath = path.join(projectRoot, '.understand-anything', 'knowledge-graph.json');

const assembledPath = path.join(intermediateDir, 'assembled-graph.json');
const scanPath = path.join(intermediateDir, 'scan-result.json');

let assembled = { nodes: [], edges: [] };
try {
  assembled = JSON.parse(fs.readFileSync(assembledPath, 'utf8'));
} catch (e) {
  console.error("Could not read assembled-graph.json", e);
}

let scan = {};
try {
  scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
} catch (e) {
  console.log("No scan-result.json found, using defaults");
}

// The dashboard REQUIRES at least one layer to render anything on the canvas.
// Because we skipped Phase 4 (Architecture), we need to put all file-level
// nodes into a single default layer.
const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
const fileNodes = assembled.nodes.filter(n => fileLevelTypes.has(n.type)).map(n => n.id);

const finalGraph = {
  version: "1.0.0",
  project: {
    name: scan.projectName || "ProjectV2",
    languages: scan.languages || ["typescript"],
    frameworks: scan.frameworks || ["react"],
    description: scan.projectDescription || "KithLy V2 architecture scan",
    analyzedAt: new Date().toISOString(),
    gitCommitHash: "latest"
  },
  nodes: assembled.nodes || [],
  edges: assembled.edges || [],
  layers: [
    {
      id: "layer:project-root",
      name: "Project Root",
      description: "Default layer containing all project files.",
      nodeIds: fileNodes
    }
  ],
  tour: []
};

fs.writeFileSync(outPath, JSON.stringify(finalGraph, null, 2));
console.log('Successfully wrapped assembled-graph.json into knowledge-graph.json with Default Layer!');
