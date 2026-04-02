export class ApplicationError extends Error {
  constructor(public readonly message: string) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message);
  }
}

export class ConflictError extends ApplicationError {
  constructor(
    message: string,
    public readonly constraintTarget?: string,
  ) {
    super(message);
  }
}

export class BadRequestError extends ApplicationError {
  constructor(message: string) {
    super(message);
  }
}

export class ValidationError extends ApplicationError {
  constructor(
    message: string,
    public readonly errors: Record<string, string[]>,
  ) {
    super(message);
  }
}
