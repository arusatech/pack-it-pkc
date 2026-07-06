const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("pick-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Documents", extensions: ["pdf", "docx", "html", "txt", "md", "csv", "ipynb", "png", "jpg"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("convert-to-pkc", async (_event, filePath, options = {}) => {
  const { MarkItDown } = await import("@annadata/pack-it-pkc");
  const { packToPkc } = await import("@annadata/pack-it-pkc");

  let llmProvider;
  if (options.ggufModelPath) {
    try {
      const { NodeGgufProvider } = await import("@annadata/pack-it-pkc/inference/node");
      llmProvider = await NodeGgufProvider.create();
      await llmProvider.loadModel({ modelPath: options.ggufModelPath });
    } catch (err) {
      console.warn("GGUF model not loaded:", err.message);
    }
  }

  const engine = new MarkItDown({ llmProvider });
  const conversion = await engine.convertLocal(filePath);
  const pkcBytes = packToPkc(conversion.markdown, {
    title: conversion.title,
    source: filePath,
  });

  const outPath = filePath.replace(/\.[^.]+$/, "") + ".pkc";
  await fs.writeFile(outPath, pkcBytes);
  return { markdown: conversion.markdown, title: conversion.title, outPath };
});
