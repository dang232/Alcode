export class AlcodeControlError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'AlcodeControlError';
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

export const asControlError = (error, fallbackMessage, fallbackStatus = 500) => {
  if (error instanceof AlcodeControlError) return error;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return new AlcodeControlError(message || fallbackMessage, Number(error?.statusCode) || Number(error?.status) || fallbackStatus, {
    ...(error?.goalConfigured === true ? { goalConfigured: true } : {}),
  });
};
