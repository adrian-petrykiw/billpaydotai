// src/types/errors.ts

export class CustomError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = "INTERNAL_ERROR"
  ) {
    super(message);
    this.name = "CustomError";
  }
}

export class ValidationError extends CustomError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class AuthorizationError extends CustomError {
  constructor(message: string) {
    super(message, 401, "AUTHORIZATION_ERROR");
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends CustomError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND_ERROR");
    this.name = "NotFoundError";
  }
}
