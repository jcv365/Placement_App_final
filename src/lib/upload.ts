import { readTextFromFile } from "@/lib/documentText";

export async function readTextFromFormData(
  formData: FormData,
  textField: string,
): Promise<{
  text?: string;
  fileBytes?: ArrayBuffer;
  fileName?: string;
  mimeType?: string;
}> {
  const textValue = formData.get(textField);
  const typedText = typeof textValue === "string" ? textValue.trim() : "";
  const file = formData.get("file");
  const fileBytes = file instanceof File ? await file.arrayBuffer() : undefined;
  const fileName = file instanceof File ? file.name : undefined;
  const mimeType = file instanceof File ? file.type : undefined;

  const textFromFile =
    !typedText && fileBytes
      ? await readTextFromFile({
          fileName,
          mimeType,
          bytes: fileBytes,
        })
      : undefined;

  const text = typedText || textFromFile;

  if (!text && !fileBytes) {
    return {};
  }

  return { text, fileBytes, fileName, mimeType };
}
