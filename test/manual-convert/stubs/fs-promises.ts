/** Browser stub — local file paths are not used in the manual convert page. */
export async function readFile(): Promise<never> {
  throw new Error("readFile is not available in the browser. Use convertBytes with uploaded file data.");
}
