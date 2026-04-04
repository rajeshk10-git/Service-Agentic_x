/// <reference types="express" />

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireJwtUserId` from JWT claims `userId` or `sub`. */
      authUserId?: string;
    }
  }
}

export {};
