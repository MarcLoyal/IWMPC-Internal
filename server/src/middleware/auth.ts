import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { audit } from '../services/audit';

export const COOKIE_NAME = 'iwmpc_session';
const SESSION_HOURS = 12;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET is not set');
  return value;
}

export function startSession(res: Response, userId: number) {
  const token = jwt.sign({ sub: userId }, secret(), { expiresIn: `${SESSION_HOURS}h` });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: '/',
  });
}

export function endSession(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Wraps an async route so thrown errors reach the error handler. */
export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** The user id in the session cookie, if it is valid. Does not check the user is still active. */
export function sessionUserId(req: Request): number | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const id = Number((jwt.verify(token, secret()) as jwt.JwtPayload).sub);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

/** Requires a logged-in, active user. The user is re-read every request so deactivating takes effect at once. */
export const requireUser: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  (async () => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw new AppError(401, 'Please log in.');
    let userId: number;
    try {
      userId = Number((jwt.verify(token, secret()) as jwt.JwtPayload).sub);
    } catch {
      throw new AppError(401, 'Your login has expired. Please log in again.');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw new AppError(401, 'Please log in.');
    req.user = user;
  })().then(() => next(), next);
};

/** Allows only the listed roles. Use after requireUser. */
export const allow =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      const denied = new AppError(403, 'Your user account is not allowed to do this.');
      if (!req.user) {
        next(denied);
        return;
      }
      // Record the attempt, then refuse it. The path has no query string, so nothing typed into a search is kept.
      audit(prisma, req.user.id, 'access.denied', 'access', null, null, {
        method: req.method,
        path: (req.baseUrl + req.path).replace(/(.)\/+$/, '$1'),
        role: req.user.role,
      }).then(
        () => next(denied),
        (err) => {
          console.error(err);
          next(denied);
        },
      );
      return;
    }
    next();
  };
