// @ts-nocheck
export class ConversionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ConversionError";
    this.code = code;
    this.details = details;
  }
}

export function serializeError(error) {
  if (!error || typeof error !== "object") {
    return {
      code: "unknown_error",
      message: "The image could not be converted."
    };
  }

  return {
    code: error.code || "unknown_error",
    message: error.message || "The image could not be converted.",
    details: error.details || {}
  };
}

export function errorFromPayload(payload) {
  return new ConversionError(
    payload?.code || "unknown_error",
    payload?.message || "The image could not be converted.",
    payload?.details || {}
  );
}
