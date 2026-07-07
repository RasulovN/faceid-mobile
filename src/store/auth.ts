import { create } from 'zustand';
import { api, setOnUnauthorized, tokenStorage } from '@/lib/api';
import type { Company, Employee, LoginResponse, MeResponse, User } from '@/types/api';

export type AuthStatus = 'loading' | 'authed' | 'guest';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  employee: Employee | null;
  company: Company | null;
  /** Ilova ochilganda: secure-store'dagi tokenlar bilan sessiyani tiklaydi. */
  bootstrap: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
  /** /auth/me ni qayta yuklaydi (profil yangilanganda). */
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  employee: null,
  company: null,

  bootstrap: async () => {
    try {
      const access = await tokenStorage.getAccess();
      const refresh = await tokenStorage.getRefresh();
      if (!access && !refresh) {
        set({ status: 'guest' });
        return;
      }
      const me = await api<MeResponse>('/auth/me');
      set({
        status: 'authed',
        user: me.user,
        employee: me.employee ?? null,
        company: me.company ?? null,
      });
    } catch {
      // Token yaroqsiz yoki tarmoq yo'q — login ekraniga
      set({ status: 'guest', user: null, employee: null, company: null });
    }
  },

  signIn: async (identifier, password) => {
    const res = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      auth: false,
      body: { identifier, password },
    });
    await tokenStorage.set(res.accessToken, res.refreshToken);
    // employee/company ma'lumotini olish uchun /auth/me
    const me = await api<MeResponse>('/auth/me');
    set({
      status: 'authed',
      user: me.user,
      employee: me.employee ?? null,
      company: me.company ?? null,
    });
  },

  refreshMe: async () => {
    if (get().status !== 'authed') return;
    const me = await api<MeResponse>('/auth/me');
    set({ user: me.user, employee: me.employee ?? null, company: me.company ?? null });
  },

  signOut: async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // server xatosi chiqishga to'siq bo'lmasin
    }
    await tokenStorage.clear();
    set({ status: 'guest', user: null, employee: null, company: null });
  },
}));

// 401 (refresh ham o'tmadi) → avtomatik logout holati
setOnUnauthorized(() => {
  useAuthStore.setState({ status: 'guest', user: null, employee: null, company: null });
});
