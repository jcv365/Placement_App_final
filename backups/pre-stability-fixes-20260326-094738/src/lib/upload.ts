import { readTextFromFile } from "@/lib/documentText";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

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

  if (file instanceof File && file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File exceeds maximum size of ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
    );
  }

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
