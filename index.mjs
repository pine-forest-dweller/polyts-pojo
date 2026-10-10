#!/usr/bin/env node

import express from "express";
import fs from "node:fs";
import chokidar from "chokidar";
import path from "node:path";

const WATCH_DIR = "out/";
const GAME_DIR = "game/";
const TREE_JSON_PATH = "default.project.json"; 

let kvOutToHierarchy = {}
function walk() {
    const treeFileContents = fs.readFileSync(TREE_JSON_PATH);
    const tree = JSON.parse(treeFileContents)?.tree;
    if (!tree) {
        console.error(`Invalid game tree (${TREE_JSON_PATH}). Missing tree key.`);
        return;
    }
    kvOutToHierarchy = {};

    const walkChild = (node, currentPath) => {
        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith("$")) {
                if (key == "$path") {
                    const diskPath = path.resolve(path.dirname(path.resolve(TREE_JSON_PATH)), value);
                    kvOutToHierarchy[diskPath] = currentPath;
                }
                continue;
            }
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                continue;
            }

            const next = [...currentPath, key];
            walkChild(value, next);
        }
    };
    walkChild(tree, []);
    console.log(kvOutToHierarchy)
}

function getHierarchyForFile(filePath) {
    const absPath = path.resolve(filePath);

    const entries = Object.entries(kvOutToHierarchy);
    for (const [diskPath, treePath] of entries) {
        const relativePath = path.relative(diskPath, absPath)
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;
        const segments = relativePath.split(path.sep);
        const fileName = segments.pop(); // distinct from filePath, lacks dir indicators

        let baseType = ""; // "ClientScript" || "ServerScript" || "ModuleScript"
        let cleanFileName = fileName.split(".")[0];
        if (fileName.endsWith(".server.luau")) {
            baseType = "ServerScript";
        } else if (fileName.endsWith(".client.luau")) {
            baseType = "ClientScript";
        } else if (fileName.endsWith(".luau")) {
            baseType = "ModuleScript";
        } else {
            console.error(`${fileName} does not appear to be luau?`)
            continue;
        }

        segments.push(cleanFileName);
        const fullHierarchy = [...treePath, ...segments]; 
        // console.log(`${filePath} logically belongs in ${fullHierarchy} as ${baseType}`);
        return {
            hierarchy : fullHierarchy,
            type : baseType,
        };
    }

    console.error(`Don't know where to place ${filePath} within the game. Check your ${TREE_JSON_PATH}!`);
}

const treeWatcher = chokidar.watch(TREE_JSON_PATH, {
    ignoreInitial: false,

    awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
    },
})

treeWatcher.on("add", (_path, _stats) => { walk(); });
treeWatcher.on("change", (_path, _stats) => { walk(); });

const watcher = chokidar.watch(WATCH_DIR, {
    ignored: (path, stats) => stats?.isFile() && !path.endsWith(".luau"),
    ignoreInitial: false,
    awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
    },
});

let work = [];

function handleAdd(filePath) {
    const {hierarchy, type} = getHierarchyForFile(filePath);

    const gameScriptPath = path.join(GAME_DIR, "scripts", hierarchy.join(path.sep) + ".luau");
    const editorScriptPath = path.join("scripts", hierarchy.join(path.sep) + ".luau");
    console.log(`cp ${filePath} ${gameScriptPath}`)
    fs.copyFileSync(filePath, gameScriptPath);

    const existingWorkItem = work.find(workItem => workItem.hierarchy.join("/") === hierarchy.join("/"));
    if (existingWorkItem) return;

    work.push({
        operation: "add",
        hierarchy: hierarchy,
        full_path: editorScriptPath,
        type: type,
    });
    console.log(work);
}

watcher.on("add", (filePath, _stats) => {
    console.log(`+${filePath}`);
    handleAdd(filePath)
});

watcher.on("change", (filePath, _stats) => {
    console.log(`~${filePath}`);
    handleAdd(filePath);
});

function handleUnlink(filePath) {
    const {hierarchy, type} = getHierarchyForFile(filePath);
    const gameScriptPath = path.join(GAME_DIR, "scripts", hierarchy.join(path.sep));
    fs.rmSync(gameScriptPath + ".luau");
    fs.rmSync(gameScriptPath + ".luau.meta");

    work.push({
        operation: "rm",
        hierarchy: hierarchy
    });
}

watcher.on("unlink", (filePath, _stats) => {
    console.log(`-${filePath}`);
    handleUnlink(filePath);
});

const app = express();
app.get("/", (req, res) => {
    res.send(JSON.stringify(work));
    work = [];
})

app.listen(8080, "127.0.0.1", () => { console.log("running") });