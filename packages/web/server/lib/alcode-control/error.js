export class AlcodeControlError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'AlcodeControlError';
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

/** Legacy alias: shared code still imports the pre-rename error name. */
export const OpenChamberControlError = AlcodeControlError;

export const asControlError = (error, fallbackMessage, fallbackStatus = 500) => {
  if (error instanceof AlcodeControlError) return error;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return new AlcodeControlError(message || fallbackMessage, Number(error?.statusCode) || Number(error?.status) || fallbackStatus, {
    ...(error?.goalConfigured === true ? { goalConfigured: true } : {}),
  });
};
