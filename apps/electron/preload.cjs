const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("packItPkc", {
  pickFile: () => ipcRenderer.invoke("pick-file"),
  convertToPkc: (filePath, options) => ipcRenderer.invoke("convert-to-pkc", filePath, options),
});
