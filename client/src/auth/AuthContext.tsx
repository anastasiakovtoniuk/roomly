import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LoginBody, RegisterBody, User } from '@roomly/shared';
import * as authApi from '../api/auth';
import { ApiError, subscribeToUnauthenticated } from '../api/http';

type AuthState =
  | { status: 'loading'; user: null; error: null }
  | { status: 'authenticated'; user: User; error: null }
  | { status: 'anonymous'; user: null; error: null }
  | { status: 'error'; user: null; error: unknown };

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  login: (body: LoginBody) => Promise<User>;
  register: (body: RegisterBody) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, error: null });
  const requestVersion = useRef(0);

  const restore = useCallback((signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    return authApi
      .getMe(signal)
      .then(({ user }) => {
        if (!signal?.aborted && version === requestVersion.current) {
          setState({ status: 'authenticated', user, error: null });
        }
      })
      .catch((error: unknown) => {
        if (signal?.aborted || version !== requestVersion.current) return;
        setState(
          error instanceof ApiError && error.code === 'UNAUTHENTICATED'
            ? { status: 'anonymous', user: null, error: null }
            : { status: 'error', user: null, error },
        );
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void restore(controller.signal);
    return () => controller.abort();
  }, [restore]);

  useEffect(
    () =>
      subscribeToUnauthenticated(() => {
        // Вихід в іншій вкладці або видалена сесія: перевіряємо сервер, а не лишаємо застарілий user.
        void restore();
      }),
    [restore],
  );

  const refresh = useCallback(async () => {
    setState({ status: 'loading', user: null, error: null });
    await restore();
  }, [restore]);

  const login = useCallback(async (body: LoginBody) => {
    const { user } = await authApi.login(body);
    // Пізня відповідь початкового /me не має перекрити новий вхід.
    ++requestVersion.current;
    setState({ status: 'authenticated', user, error: null });
    return user;
  }, []);

  const register = useCallback(async (body: RegisterBody) => {
    const { user } = await authApi.register(body);
    ++requestVersion.current;
    setState({ status: 'authenticated', user, error: null });
    return user;
  }, []);

  const logout = useCallback(async () => {
    // Очищаємо стан лише після підтвердженого видалення серверної сесії.
    await authApi.logout();
    ++requestVersion.current;
    setState({ status: 'anonymous', user: null, error: null });
  }, []);

  const value = useMemo(
    () => ({ ...state, refresh, login, register, logout }),
    [state, refresh, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth має використовуватися всередині AuthProvider');
  return auth;
}
