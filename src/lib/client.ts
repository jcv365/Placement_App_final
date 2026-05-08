export async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(60_000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const rawBody = await response.text();

  let data: unknown = null;
  if (contentType.includes("application/json") && rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error("Invalid JSON response from server");
    }
  }

  if (!response.ok) {
    const detailsMessage = data?.error?.details?.message;
    const detailsHint = data?.error?.details?.hint;
    const detailsDescription = data?.error?.details?.error_description;
    throw new Error(
      [data?.error?.message, detailsMessage, detailsDescription, detailsHint]
        .filter(Boolean)
        .join("\n") || `Request failed (${response.status}).`,
    );
  }

  if (!data) {
    throw new Error("Server returned a non-JSON response.");
  }

  if (data?.ok === false) {
    throw new Error(data?.error?.message ?? "Request failed");
  }

  return data.data ?? data;
}

type UploadFormDataOptions = {
  endpoint: string;
  formData: FormData;
  timeoutMs?: number;
  onProgress?: (percent: number) => void;
};

type UploadFormDataResult<T> = {
  ok: boolean;
  status: number;
  payload: T | null;
  rawBody: string;
};

export async function uploadFormDataJson<T>(
  options: UploadFormDataOptions,
): Promise<UploadFormDataResult<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", options.endpoint, true);
    if (
      typeof options.timeoutMs === "number" &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
    ) {
      xhr.timeout = options.timeoutMs;
    }
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (!options.onProgress || !event.lengthComputable) {
        return;
      }

      const percent = Math.min(
        100,
        Math.max(0, Math.round((event.loaded / event.total) * 100)),
      );
      options.onProgress(percent);
    };

    xhr.onload = () => {
      const rawBody = xhr.responseText ?? "";
      let payload: T | null = null;
      if (rawBody.trim()) {
        try {
          payload = JSON.parse(rawBody) as T;
        } catch {
          payload = null;
        }
      }

      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        payload,
        rawBody,
      });
    };

    xhr.onerror = () => {
      reject(new Error("Network error while uploading file"));
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          `Upload timed out after ${options.timeoutMs ?? "configured"}ms`,
        ),
      );
    };

    xhr.send(options.formData);
  });
}
